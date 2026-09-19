import { Client as ModernClient, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, Server } from '@modelcontextprotocol/server';

import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { SDKOAuthServerProvider } from '@src/auth/sdkOAuthServerProvider.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { ClientStatus } from '@src/core/types/index.js';
import { InteractionOwner } from '@src/gateway/interactions/interactionOwner.js';
import { createLegacyOutboundConnection } from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import { ServerManager } from '@src/sdk/legacy/server/runtime/serverManager.js';
import { createModernInboundLegacyBridge } from '@src/sdk/legacy/transport/http/modernInboundLegacyBridge.js';
import { createScopeAuthMiddleware } from '@src/transport/http/middlewares/scopeAuthMiddleware.js';
import { setupModernHttpRoutes } from '@src/transport/http/routes/modernHttpRoutes.js';

import express from 'express';
import { describe, expect, it, vi } from 'vitest';

async function listen(server: HttpServer): Promise<URL> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
}

async function close(server: HttpServer): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

const cases = [
  {
    name: 'sampling.tools',
    capabilities: { roots: {}, sampling: {} },
    forbidden: {
      method: 'sampling/createMessage',
      params: {
        messages: [{ role: 'user', content: { type: 'text', text: 'Sample' } }],
        maxTokens: 10,
        tools: [{ name: 'local', inputSchema: { type: 'object', properties: {} } }],
      },
    },
  },
  {
    name: 'elicitation.url',
    capabilities: { roots: {}, elicitation: { form: {} } },
    forbidden: {
      method: 'elicitation/create',
      params: { mode: 'url', message: 'Login', url: 'https://example.invalid/login', elicitationId: 'fixture' },
    },
  },
  { name: 'missing baseline capability', capabilities: {}, forbidden: { method: 'roots/list' } },
];

describe('native round capability admission', () => {
  it.each(cases)(
    'rejects undeclared $name before exposing a round, including manual continuation',
    async ({ capabilities, forbidden }) => {
      const cleanup: Array<() => Promise<unknown>> = [];
      const park = vi.spyOn(InteractionOwner.prototype, 'park');
      let upstreamCalls = 0;
      let sideEffects = 0;
      try {
        const upstream = createMcpHandler(
          () => {
            const server = new Server({ name: 'peer', version: '1' }, { capabilities: { tools: {} } });
            server.setRequestHandler('tools/list', async () => ({
              tools: [{ name: 'act', inputSchema: { type: 'object', properties: {} } }],
            }));
            server.setRequestHandler('tools/call', async (_request, context) => {
              upstreamCalls++;
              if (context.mcpReq.requestState() === undefined)
                return { resultType: 'input_required', requestState: 'private-upstream-state' };
              sideEffects++;
              return { content: [{ type: 'text', text: 'done' }] };
            });
            return server;
          },
          { legacy: 'reject' },
        );
        cleanup.push(() => upstream.close());
        // Inject a schema-valid but capability-invalid peer response AFTER the upstream SDK's checks.
        // The caller below uses raw HTTP, so client auto-fulfilment cannot provide the tested protection.
        const peer = createServer(
          toNodeHandler({
            fetch: async (request: Request) => {
              const response = await upstream.fetch(request);
              const frame = await response.clone().json();
              if (frame?.result?.resultType !== 'input_required') return response;
              frame.result.inputRequests = {
                ...(Object.hasOwn(capabilities, 'roots') ? { allowed: { method: 'roots/list' } } : {}),
                forbidden,
              };
              const headers = new Headers(response.headers);
              headers.delete('content-length');
              return new Response(JSON.stringify(frame), { status: response.status, headers });
            },
          }),
        );
        cleanup.push(() => close(peer));
        const client = new ModernClient(
          { name: 'gateway', version: '1' },
          {
            capabilities: { roots: {}, sampling: {}, elicitation: { form: {}, url: {} } },
            versionNegotiation: { mode: { pin: '2026-07-28' } },
          },
        );
        const transport = new StreamableHTTPClientTransport(await listen(peer));
        await client.connect(transport);
        const connection = createLegacyOutboundConnection({
          name: 'fixture',
          client,
          transport,
          status: ClientStatus.Connected,
          capabilities: { tools: {} },
        });
        cleanup.push(() => connection.adapter.close());
        const manager = ServerManager.getOrCreateInstance(
          { name: 'aggregate', version: '1' },
          { capabilities: { tools: {}, prompts: {}, resources: {}, completions: {}, logging: {} } },
          new Map([['fixture', connection]]),
          {},
        );
        cleanup.push(() => ServerManager.resetInstance());
        const app = express();
        app.use(express.json());
        const expiresAt = Date.now() + 120_000;
        const provider = {
          verifyAccessToken: async (token: string) => {
            if (token !== 'fixture-token') throw new Error('Invalid fixture credential');
            return { token, clientId: 'owner', scopes: [], expiresAt };
          },
        } as unknown as SDKOAuthServerProvider;
        const config = AgentConfigManager.getInstance();
        const features = config.get('features');
        try {
          config.updateConfig({ features: { ...features, auth: true, scopeValidation: true } });
          app.use(createScopeAuthMiddleware(provider));
        } finally {
          config.updateConfig({ features });
        }
        setupModernHttpRoutes(app as never, manager, [], createModernInboundLegacyBridge, {
          allowsHost: () => true,
          allowsOrigin: () => true,
        });
        const listener = createServer(app);
        cleanup.push(() => close(listener));
        const url = await listen(listener);
        const params = {
          name: 'fixture_1mcp_act',
          arguments: {},
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': { name: 'manual-caller', version: '1' },
            'io.modelcontextprotocol/clientCapabilities': capabilities,
          },
        };
        const post = async (id: number, extra: Record<string, unknown> = {}) => {
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              Authorization: 'Bearer fixture-token',
              'Content-Type': 'application/json',
              Accept: 'application/json',
              'MCP-Protocol-Version': '2026-07-28',
              'Mcp-Method': 'tools/call',
              'Mcp-Name': params.name,
            },
            body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { ...params, ...extra } }),
          });
          return response.json();
        };
        const rejected = await post(1);
        expect(rejected.error).toBeDefined();
        expect(rejected.result).toBeUndefined();
        expect(upstreamCalls, JSON.stringify(rejected)).toBe(1);
        expect(sideEffects).toBe(0);
        expect(park).not.toHaveBeenCalled();
        const manual = await post(2, {
          requestState: 'private-upstream-state',
          inputResponses: { allowed: { roots: [] }, forbidden: { action: 'accept', content: {} } },
        });
        expect(manual.error).toBeDefined();
        expect(manual.result).toBeUndefined();
        expect(upstreamCalls).toBe(1);
        expect(sideEffects).toBe(0);
        expect(park).not.toHaveBeenCalled();
      } finally {
        for (const dispose of cleanup.reverse()) await dispose();
        park.mockRestore();
      }
    },
  );
});
