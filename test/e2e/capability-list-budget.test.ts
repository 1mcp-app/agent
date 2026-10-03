import { Client as ModernClient, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { ClientStatus } from '@src/core/types/index.js';
import { RESPONSE_JSON_VALUE_LIMITS, toJsonValue } from '@src/sdk/contracts/index.js';
import { Client as LegacyClient } from '@src/sdk/legacy/client/index.js';
import { ClientFactory } from '@src/sdk/legacy/client/runtime/clientFactory.js';
import { createLegacyOutboundConnection } from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import { Server as LegacyServer } from '@src/sdk/legacy/server/index.js';
import { ServerManager } from '@src/sdk/legacy/server/runtime/serverManager.js';
import { createModernInboundLegacyBridge } from '@src/sdk/legacy/transport/http/modernInboundLegacyBridge.js';
import { ListToolsRequestSchema, ResultSchema } from '@src/sdk/legacy/types.js';
import { setupModernHttpRoutes } from '@src/transport/http/routes/modernHttpRoutes.js';

import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

const TOOL_COUNT = 150;
// Each tool fits one upstream page; together they exceed the aggregate node budget.
const OPAQUE_ENTRIES = Math.ceil(RESPONSE_JSON_VALUE_LIMITS.maxNodes / TOOL_COUNT) + 100;

function upstreamTool(index: number) {
  return {
    name: `tool_${String(index).padStart(3, '0')}`,
    inputSchema: { type: 'object' },
    _meta: { 'example.com/opaque': Array.from({ length: OPAQUE_ENTRIES }, () => 0) },
  };
}

async function listen(server: HttpServer): Promise<URL> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
}

async function closeHttp(server: HttpServer): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

describe('aggregated tools/list responses', () => {
  const cleanup: Array<() => Promise<unknown>> = [];
  afterEach(async () => {
    for (const step of cleanup.splice(0).reverse()) await step();
  });

  it.each(['legacy', 'modern'] as const)(
    'pages an oversized catalog so every %s response fits the response limits',
    async (inboundEra) => {
      const backend = new LegacyServer({ name: 'fixture', version: '1' }, { capabilities: { tools: {} } });
      backend.setRequestHandler(ListToolsRequestSchema, async (request) => {
        const index = request.params?.cursor === undefined ? 0 : Number(request.params.cursor);
        return {
          tools: [upstreamTool(index)],
          ...(index + 1 < TOOL_COUNT ? { nextCursor: String(index + 1) } : {}),
        };
      });
      const [upstreamClientTransport, upstreamServerTransport] = InMemoryTransport.createLinkedPair();
      const upstreamClient = new ClientFactory().createClient(upstreamClientTransport, {});
      cleanup.push(() => backend.close());
      await backend.connect(upstreamServerTransport);
      await upstreamClient.connect(upstreamClientTransport);
      const connection = createLegacyOutboundConnection({
        name: 'fixture',
        client: upstreamClient,
        transport: upstreamClientTransport,
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
      cleanup.push(async () => ServerManager.resetInstance());

      let request: (params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
      if (inboundEra === 'legacy') {
        const client = new LegacyClient({ name: 'inbound', version: '1' });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await manager.connectTransport(serverTransport, 'budget-inbound', {});
        await client.connect(clientTransport);
        cleanup.push(() => client.close());
        request = (params) => client.request({ method: 'tools/list', ...(params ? { params } : {}) }, ResultSchema);
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
          { versionNegotiation: { mode: { pin: '2026-07-28' } } },
        );
        await client.connect(new StreamableHTTPClientTransport(await listen(server)));
        cleanup.push(() => client.close());
        request = (params) =>
          client.request({ method: 'tools/list', ...(params ? { params } : {}) }, z.looseObject({}));
      }

      const names: string[] = [];
      let cursor: string | undefined;
      let responses = 0;
      do {
        const response = await request(cursor === undefined ? undefined : { cursor });
        // The invariant: what we assembled and sent fits the limits applied when sending it.
        expect(() => toJsonValue(response, RESPONSE_JSON_VALUE_LIMITS)).not.toThrow();
        names.push(...(response.tools as Array<{ name: string }>).map((tool) => tool.name));
        cursor = response.nextCursor as string | undefined;
        responses += 1;
        // Each modern request runs in a fresh session, which cannot resume a catalog cursor yet.
      } while (cursor !== undefined && inboundEra === 'legacy' && responses <= TOOL_COUNT);

      if (inboundEra === 'modern') {
        expect(cursor).toBeDefined();
        expect(names.length).toBeGreaterThan(0);
        expect(names.length).toBeLessThan(TOOL_COUNT);
        return;
      }
      expect(responses).toBeGreaterThan(1);
      expect(names).toHaveLength(TOOL_COUNT);
      expect(new Set(names).size).toBe(TOOL_COUNT);
    },
    60_000,
  );
});
