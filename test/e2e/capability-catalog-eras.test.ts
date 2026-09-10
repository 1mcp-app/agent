import { Client as ModernClient, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, Server as ModernServer } from '@modelcontextprotocol/server';

import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { MCP_URI_SEPARATOR } from '@src/constants.js';
import { ClientStatus } from '@src/core/types/index.js';
import { Client as LegacyClient } from '@src/sdk/legacy/client/index.js';
import { createLegacyOutboundConnection } from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import { Server as LegacyServer } from '@src/sdk/legacy/server/index.js';
import { ServerManager } from '@src/sdk/legacy/server/runtime/serverManager.js';
import { createModernInboundLegacyBridge } from '@src/sdk/legacy/transport/http/modernInboundLegacyBridge.js';
import {
  CallToolRequestSchema,
  CompleteRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ResultSchema,
} from '@src/sdk/legacy/types.js';
import { setupModernHttpRoutes } from '@src/transport/http/routes/modernHttpRoutes.js';
import { buildUri } from '@src/utils/core/parsing.js';

import express from 'express';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { capabilities, prompt, resource, results, template, tool } from './fixtures/capabilityCatalog.js';

const schemas = [
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ReadResourceRequestSchema,
  CompleteRequestSchema,
];

async function listen(server: HttpServer): Promise<URL> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
}

async function closeHttp(server: HttpServer): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

describe('capability catalog with real SDK peers', () => {
  it.each([
    ['legacy', 'legacy'],
    ['legacy', 'modern'],
    ['modern', 'legacy'],
    ['modern', 'modern'],
  ] as const)('round-trips mixed capabilities and exact routes in the %s-%s cell', async (inboundEra, outboundEra) => {
    const cleanup: Array<() => Promise<unknown>> = [];
    const observed: Array<{ method: string; params?: unknown }> = [];
    try {
      let connection;
      if (outboundEra === 'legacy') {
        const backend = new LegacyServer({ name: 'fixture', version: '1' }, { capabilities });
        for (const schema of schemas) {
          backend.setRequestHandler(schema, async (request) => {
            observed.push(request);
            return results[request.method];
          });
        }
        const client = new LegacyClient({ name: 'gateway-backend', version: '1' });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        cleanup.push(() => backend.close());
        await backend.connect(serverTransport);
        await client.connect(clientTransport);
        connection = createLegacyOutboundConnection({
          name: 'fixture',
          client,
          transport: clientTransport,
          status: ClientStatus.Connected,
          capabilities,
        });
      } else {
        const handler = createMcpHandler(
          () => {
            const backend = new ModernServer({ name: 'fixture', version: '2' }, { capabilities });
            for (const schema of schemas) {
              backend.setRequestHandler(schema.shape.method.value, async (request) => {
                observed.push(request);
                return results[request.method] as never;
              });
            }
            return backend;
          },
          { legacy: 'reject' },
        );
        const server = createServer(toNodeHandler(handler));
        cleanup.push(
          () => closeHttp(server),
          () => handler.close(),
        );
        const url = await listen(server);
        const client = new ModernClient(
          { name: 'gateway-backend', version: '2' },
          {
            versionNegotiation: { mode: { pin: '2026-07-28' } },
          },
        );
        const transport = new StreamableHTTPClientTransport(url);
        await client.connect(transport);
        connection = createLegacyOutboundConnection({
          name: 'fixture',
          client,
          transport,
          status: ClientStatus.Connected,
          capabilities,
        });
      }
      cleanup.push(() => connection.adapter.close());
      const manager = ServerManager.getOrCreateInstance(
        { name: 'aggregate', version: '1' },
        { capabilities: { ...capabilities, logging: {} } },
        new Map([['fixture', connection]]),
        {},
      );
      cleanup.push(() => ServerManager.resetInstance());
      let request: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
      if (inboundEra === 'legacy') {
        const client = new LegacyClient({ name: 'inbound', version: '1' });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await manager.connectTransport(serverTransport, 'fixture-inbound', {});
        await client.connect(clientTransport);
        cleanup.push(() => client.close());
        request = (method, params) => client.request({ method, ...(params ? { params } : {}) }, ResultSchema);
      } else {
        const app = express();
        app.use(express.json());
        setupModernHttpRoutes(app as never, manager as never, [], createModernInboundLegacyBridge, {
          allowsHost: () => true,
          allowsOrigin: () => true,
        });
        const server = createServer(app);
        cleanup.push(() => closeHttp(server));
        const client = new ModernClient(
          { name: 'inbound', version: '2' },
          {
            versionNegotiation: { mode: { pin: '2026-07-28' } },
          },
        );
        await client.connect(new StreamableHTTPClientTransport(await listen(server)));
        cleanup.push(() => client.close());
        expect(client.getServerCapabilities()).toEqual(capabilities);
        request = (method, params) => client.request({ method, ...(params ? { params } : {}) }, z.looseObject({}));
      }
      const publicIdentity = (value: string) => buildUri('fixture', value, MCP_URI_SEPARATOR);
      expect(await request('tools/list')).toMatchObject({ tools: [{ ...tool, name: publicIdentity(tool.name) }] });
      expect(await request('prompts/list')).toMatchObject({
        prompts: [{ ...prompt, name: publicIdentity(prompt.name) }],
      });
      expect(await request('resources/list')).toMatchObject({
        resources: [{ ...resource, uri: publicIdentity(resource.uri) }],
      });
      expect(await request('resources/templates/list')).toMatchObject({
        resourceTemplates: [{ ...template, uriTemplate: publicIdentity(template.uriTemplate) }],
      });
      expect(await request('tools/call', { name: publicIdentity(tool.name), arguments: {} })).toMatchObject(
        results['tools/call'],
      );
      expect(
        await request('prompts/get', { name: publicIdentity(prompt.name), arguments: { topic: 'test' } }),
      ).toMatchObject(results['prompts/get']);
      expect(await request('resources/read', { uri: publicIdentity(resource.uri) })).toMatchObject({
        contents: [{ uri: publicIdentity(resource.uri), text: 'Guide' }],
      });
      expect(await request('resources/read', { uri: publicIdentity('file:///dynamic') })).toMatchObject({
        contents: [{ uri: publicIdentity(resource.uri), text: 'Guide' }],
      });
      expect(
        await request('completion/complete', {
          ref: { type: 'ref/prompt', name: publicIdentity(prompt.name) },
          argument: { name: 'topic', value: 't' },
        }),
      ).toMatchObject(results['completion/complete']);
      expect(observed).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ method: 'tools/call', params: expect.objectContaining({ name: tool.name }) }),
          expect.objectContaining({ method: 'prompts/get', params: expect.objectContaining({ name: prompt.name }) }),
          expect.objectContaining({ method: 'resources/read', params: expect.objectContaining({ uri: resource.uri }) }),
          expect.objectContaining({
            method: 'resources/read',
            params: expect.objectContaining({ uri: 'file:///dynamic' }),
          }),
        ]),
      );
    } finally {
      for (const close of cleanup.reverse()) await close();
    }
  });
});
