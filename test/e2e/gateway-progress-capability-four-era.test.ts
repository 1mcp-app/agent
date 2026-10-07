import { Client as ModernClient, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { toNodeHandler } from '@modelcontextprotocol/node';
import {
  createMcpHandler,
  MissingRequiredClientCapabilityError,
  Server as ModernServer,
  ProtocolError,
} from '@modelcontextprotocol/server';

import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { ClientStatus } from '@src/core/types/index.js';
import { Client as LegacyClient } from '@src/sdk/legacy/client/index.js';
import { createLegacyOutboundConnection } from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import { Server as LegacyServer } from '@src/sdk/legacy/server/index.js';
import { ServerManager } from '@src/sdk/legacy/server/runtime/serverManager.js';
import { createModernInboundLegacyBridge } from '@src/sdk/legacy/transport/http/modernInboundLegacyBridge.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ProgressNotificationSchema,
  ReadResourceRequestSchema,
  ResultSchema,
} from '@src/sdk/legacy/types.js';
import { setupModernHttpRoutes } from '@src/transport/http/routes/modernHttpRoutes.js';
import { buildPublicResourceUri } from '@src/utils/core/resourceUris.js';

import express from 'express';
import { describe, expect, it } from 'vitest';

async function listen(server: HttpServer): Promise<URL> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
}
async function closeHttp(server: HttpServer): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
const tools = [{ name: 'act', inputSchema: { type: 'object' as const, properties: {} } }];
const capabilities = { tools: {} };
const aggregateCapabilities = { tools: {}, prompts: {}, resources: {}, completions: {}, logging: {} };
const result = { content: [{ type: 'text' as const, text: 'completed once' }] };

describe('request progress and missing-capability wire semantics', () => {
  it.each([
    ['legacy', 'legacy', 'tools/call'],
    ['legacy', 'modern', 'tools/call'],
    ['modern', 'legacy', 'tools/call'],
    ['modern', 'modern', 'tools/call'],
    ['legacy', 'legacy', 'prompts/get'],
    ['legacy', 'modern', 'prompts/get'],
    ['legacy', 'legacy', 'resources/read'],
    ['legacy', 'modern', 'resources/read'],
  ] as const)(
    'correlates progress without raw token or metadata leakage: %s inbound / %s upstream / %s',
    async (inboundEra, upstreamEra, method) => {
      const sourceCapabilities =
        method === 'tools/call' ? { tools: {} } : method === 'prompts/get' ? { prompts: {} } : { resources: {} };
      const upstreamUri = 'file:///item';
      const publicUri = buildPublicResourceUri('fixture', upstreamUri);
      const operationResult =
        method === 'tools/call'
          ? result
          : method === 'prompts/get'
            ? { messages: [{ role: 'user', content: { type: 'text', text: 'prompt' } }] }
            : { contents: [{ uri: upstreamUri, text: 'resource' }] };
      const expectedResult =
        method === 'resources/read' ? { contents: [{ uri: publicUri, text: 'resource' }] } : operationResult;
      const businessParams =
        method === 'resources/read' ? { uri: publicUri } : { name: 'fixture_1mcp_act', arguments: {} };
      const cleanup: Array<() => Promise<unknown>> = [];
      const privateTokens: unknown[] = [];
      const received: Array<{ params?: Record<string, unknown> }> = [];
      let executions = 0;
      try {
        let connection;
        if (upstreamEra === 'legacy') {
          const recreate = () => {
            const peer = new LegacyServer({ name: 'fixture', version: '1' }, { capabilities: sourceCapabilities });
            const requestSchema =
              method === 'tools/call'
                ? CallToolRequestSchema
                : method === 'prompts/get'
                  ? GetPromptRequestSchema
                  : ReadResourceRequestSchema;
            if (method === 'tools/call') peer.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
            else if (method === 'prompts/get')
              peer.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [{ name: 'act' }] }));
            else {
              peer.setRequestHandler(ListResourcesRequestSchema, async () => ({
                resources: [{ uri: upstreamUri, name: 'act' }],
              }));
              peer.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [] }));
            }
            peer.setRequestHandler(requestSchema as typeof CallToolRequestSchema, async (request, extra) => {
              executions++;
              expect(request.params).toMatchObject(
                method === 'resources/read' ? { uri: upstreamUri } : { name: 'act' },
              );
              const token = request.params._meta?.progressToken;
              privateTokens.push(token);
              expect(request.params._meta ?? {}).not.toHaveProperty('secret');
              await extra.sendNotification({
                method: 'notifications/progress',
                params: { progressToken: 'unsolicited', progress: 99 },
              });
              if (token !== undefined)
                for (const progress of [0, 50, 100])
                  await extra.sendNotification({
                    method: 'notifications/progress',
                    params: { progressToken: token, progress, total: 100 },
                  });
              return operationResult as typeof result;
            });
            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            void peer.connect(serverTransport);
            cleanup.push(() => peer.close());
            return Object.assign(clientTransport, { recreate });
          };
          const clientTransport = recreate();
          const client = new LegacyClient({ name: 'gateway-upstream', version: '1' });
          await client.connect(clientTransport);
          connection = createLegacyOutboundConnection({
            name: 'fixture',
            client,
            transport: clientTransport,
            status: ClientStatus.Connected,
            capabilities: sourceCapabilities,
          });
        } else {
          const handler = createMcpHandler(
            () => {
              const peer = new ModernServer({ name: 'fixture', version: '2' }, { capabilities: sourceCapabilities });
              if (method === 'tools/call') peer.setRequestHandler('tools/list', async () => ({ tools }));
              else if (method === 'prompts/get')
                peer.setRequestHandler('prompts/list', async () => ({ prompts: [{ name: 'act' }] }));
              else {
                peer.setRequestHandler('resources/list', async () => ({
                  resources: [{ uri: upstreamUri, name: 'act' }],
                }));
                peer.setRequestHandler('resources/templates/list', async () => ({ resourceTemplates: [] }));
              }
              peer.setRequestHandler(method, async (_request, context) => {
                executions++;
                expect(_request.params).toMatchObject(
                  method === 'resources/read' ? { uri: upstreamUri } : { name: 'act' },
                );
                const token = context.mcpReq._meta?.progressToken;
                privateTokens.push(token);
                expect(context.mcpReq._meta ?? {}).not.toHaveProperty('secret');
                await context.mcpReq.notify({
                  method: 'notifications/progress',
                  params: { progressToken: 'unsolicited', progress: 99 },
                });
                if (token !== undefined)
                  for (const progress of [0, 50, 100])
                    await context.mcpReq.notify({
                      method: 'notifications/progress',
                      params: { progressToken: token, progress, total: 100 },
                    });
                return operationResult as typeof result;
              });
              return peer;
            },
            { legacy: 'reject' },
          );
          const http = createServer(toNodeHandler(handler));
          cleanup.push(
            () => handler.close(),
            () => closeHttp(http),
          );
          const client = new ModernClient(
            { name: 'gateway-upstream', version: '2' },
            { versionNegotiation: { mode: { pin: '2026-07-28' } } },
          );
          const transport = new StreamableHTTPClientTransport(await listen(http));
          await client.connect(transport);
          connection = createLegacyOutboundConnection({
            name: 'fixture',
            client,
            transport,
            status: ClientStatus.Connected,
            capabilities: sourceCapabilities,
          });
        }
        cleanup.push(() => connection.adapter.close());
        const manager = ServerManager.getOrCreateInstance(
          { name: 'aggregate', version: '1' },
          { capabilities: aggregateCapabilities },
          new Map([['fixture', connection]]),
          {},
        );
        cleanup.push(() => ServerManager.resetInstance());
        let invoke: (params: Record<string, unknown>) => Promise<unknown>;
        if (inboundEra === 'legacy') {
          const client = new LegacyClient({ name: 'caller', version: '1' });
          client.setNotificationHandler(ProgressNotificationSchema, async (notification) => {
            received.push(notification);
          });
          const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
          await manager.connectTransport(serverTransport, 'progress-caller', {});
          await client.connect(clientTransport);
          invoke = (params) => client.request({ method, params }, ResultSchema, { timeout: 3000 });
          cleanup.push(() => client.close());
        } else {
          const app = express();
          app.use(express.json());
          setupModernHttpRoutes(app as never, manager as never, [], createModernInboundLegacyBridge, {
            allowsHost: () => true,
            allowsOrigin: () => true,
          });
          const http = createServer(app);
          cleanup.push(() => closeHttp(http));
          const client = new ModernClient(
            { name: 'caller', version: '2' },
            { versionNegotiation: { mode: { pin: '2026-07-28' } } },
          );
          client.setNotificationHandler('notifications/progress', async (notification) => {
            received.push(notification);
          });
          await client.connect(new StreamableHTTPClientTransport(await listen(http)));
          invoke = (params) => client.request({ method, params }, { timeout: 3000 });
          cleanup.push(() => client.close());
        }
        for (let index = 0; index < 2; index++) {
          const before = received.length;
          expect(
            await invoke({
              ...businessParams,
              _meta: { progressToken: 'same-public-token', secret: 'do not forward' },
            }),
          ).toMatchObject(expectedResult);
          expect(received.slice(before).map((note) => note.params)).toEqual(
            [0, 50, 100].map((progress) => ({ progressToken: 'same-public-token', progress, total: 100 })),
          );
        }
        expect(privateTokens).toHaveLength(2);
        expect(privateTokens.every((token) => typeof token === 'number')).toBe(true);
        if (inboundEra === 'legacy' || upstreamEra === 'modern') expect(privateTokens[0]).not.toBe(privateTokens[1]);
        expect(await invoke(businessParams)).toMatchObject(expectedResult);
        expect(privateTokens[2]).toBeUndefined();
        expect(received).toHaveLength(6);
        expect(executions).toBe(3);
      } finally {
        for (const close of cleanup.reverse()) await close();
      }
    },
    15000,
  );

  it.each(['missing-capability', 'unrelated-protocol-error'] as const)(
    'preserves trusted HTTP capability semantics without replay: %s',
    async (failureKind) => {
      let executions = 0;
      const handler = createMcpHandler(
        () => {
          const peer = new ModernServer({ name: 'fixture', version: '2' }, { capabilities });
          peer.setRequestHandler('tools/list', async () => ({ tools }));
          peer.setRequestHandler('tools/call', async () => {
            executions++;
            if (failureKind === 'missing-capability')
              throw new MissingRequiredClientCapabilityError({ requiredCapabilities: { sampling: {} } });
            throw new ProtocolError(-32603, 'Unrelated failure mentioning -32021', {
              requiredCapabilities: { sampling: {} },
              secret: 'upstream-private',
            });
          });
          return peer;
        },
        { legacy: 'reject' },
      );
      const backendHttp = createServer(toNodeHandler(handler));
      const client = new ModernClient(
        { name: 'gateway-upstream', version: '2' },
        { versionNegotiation: { mode: { pin: '2026-07-28' } } },
      );
      const transport = new StreamableHTTPClientTransport(await listen(backendHttp));
      await client.connect(transport);
      const connection = createLegacyOutboundConnection({
        name: 'fixture',
        client,
        transport,
        status: ClientStatus.Connected,
        capabilities,
      });
      const manager = ServerManager.getOrCreateInstance(
        { name: 'aggregate', version: '1' },
        { capabilities: aggregateCapabilities },
        new Map([['fixture', connection]]),
        {},
      );
      const app = express();
      app.use(express.json());
      setupModernHttpRoutes(app as never, manager as never, [], createModernInboundLegacyBridge, {
        allowsHost: () => true,
        allowsOrigin: () => true,
      });
      const gatewayHttp = createServer(app);
      try {
        const response = await fetch(await listen(gatewayHttp), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            'MCP-Protocol-Version': '2026-07-28',
            'Mcp-Method': 'tools/call',
            'Mcp-Name': 'fixture_1mcp_act',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
              name: 'fixture_1mcp_act',
              arguments: {},
              _meta: {
                'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                'io.modelcontextprotocol/clientInfo': { name: 'caller', version: '1' },
                'io.modelcontextprotocol/clientCapabilities': {},
              },
            },
          }),
        });
        const payload = await response.json();
        if (failureKind === 'missing-capability') {
          expect(response.status, JSON.stringify(payload)).toBe(400);
          expect(payload).toMatchObject({ error: { code: -32021, data: { requiredCapabilities: { sampling: {} } } } });
        } else {
          expect(response.status).toBe(200);
          expect(payload.error.code).not.toBe(-32021);
          expect(payload.error.data).not.toHaveProperty('requiredCapabilities');
          expect(JSON.stringify(payload)).not.toContain('upstream-private');
        }
        expect(executions).toBe(1);
      } finally {
        await closeHttp(gatewayHttp);
        await ServerManager.resetInstance();
        await connection.adapter.close();
        await handler.close();
        await closeHttp(backendHttp);
      }
    },
    10000,
  );
});
