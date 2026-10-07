import { Client as ModernClient, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { advanceCapabilityPaginationGeneration } from '@src/core/capabilities/capabilityPagination.js';
import { LazyLoadingOrchestrator } from '@src/core/capabilities/lazyLoadingOrchestrator.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { ClientStatus } from '@src/core/types/index.js';
import { ClientFactory } from '@src/sdk/legacy/client/runtime/clientFactory.js';
import { createLegacyOutboundConnection } from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import { Server as LegacyServer } from '@src/sdk/legacy/server/index.js';
import { ServerManager } from '@src/sdk/legacy/server/runtime/serverManager.js';
import { createModernInboundLegacyBridge } from '@src/sdk/legacy/transport/http/modernInboundLegacyBridge.js';
import { ListToolsRequestSchema } from '@src/sdk/legacy/types.js';
import { setupModernHttpRoutes } from '@src/transport/http/routes/modernHttpRoutes.js';

import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const listResultSchema = z.looseObject({
  isError: z.boolean().optional(),
  structuredContent: z.looseObject({
    tools: z.array(z.looseObject({ name: z.string() })),
    nextCursor: z.string().optional(),
    error: z.unknown().optional(),
  }),
});

describe('native tool_list with real stateless HTTP peers', () => {
  it.each([false, true])(
    'continues alpha to beta without upstream relisting or retaining private bridges (verified grant: %s)',
    async (authenticated) => {
      const config = AgentConfigManager.getInstance();
      const originalLazy = config.get('lazyLoading');
      config.updateConfig({ lazyLoading: { ...originalLazy, enabled: true } });
      const capabilities = { tools: {}, resources: {}, prompts: {}, completions: {}, logging: {} };
      const backend = new LegacyServer({ name: 'fixture', version: '1' }, { capabilities: { tools: {} } });
      let upstreamLists = 0;
      backend.setRequestHandler(ListToolsRequestSchema, async () => {
        upstreamLists++;
        return { tools: ['alpha', 'beta'].map((name) => ({ name, inputSchema: { type: 'object' as const } })) };
      });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const upstreamClient = new ClientFactory().createClient(clientTransport, {});
      await backend.connect(serverTransport);
      await upstreamClient.connect(clientTransport);
      const connection = createLegacyOutboundConnection({
        name: 'fixture',
        client: upstreamClient,
        transport: clientTransport,
        status: ClientStatus.Connected,
        capabilities: { tools: {} },
      });
      connection.tags = ['safe'];
      const connections = new Map([['fixture', connection]]);
      const manager = ServerManager.getOrCreateInstance(
        { name: 'aggregate', version: '1' },
        { capabilities },
        connections,
        {},
      );
      const lazy = new LazyLoadingOrchestrator(connections, config);
      const sessions: string[] = [];
      const bridgeIds: string[] = [];
      const app = express();
      app.use(express.json());
      let grant = {
        token: 'verified-token-a',
        clientId: 'same-client',
        grantedScopes: ['safe'],
        grantedTags: ['safe'],
      };
      let tags = ['safe'];
      const cleanups: Array<() => Promise<void> | void> = [];
      // Record the production cleanup seams while preserving their registration.
      const registerCleanup = manager.registerCleanup.bind(manager);
      manager.registerCleanup = (cleanup) => {
        cleanups.push(cleanup);
        return registerCleanup(cleanup);
      };
      setupModernHttpRoutes(
        app as never,
        manager as never,
        [
          (_req, res, next) => {
            if (authenticated) res.locals.auth = grant;
            res.locals.validatedTags = tags;
            res.locals.tagFilterMode = 'simple-or';
            next();
          },
        ],
        async (...args) => {
          const bridge = await createModernInboundLegacyBridge(...args);
          bridgeIds.push(bridge.targetConnectionId);
          sessions.push(manager.getServer(bridge.targetConnectionId)!.context!.sessionId!);
          return bridge;
        },
        { allowsHost: () => true, allowsOrigin: () => true },
      );
      const server = createServer(app);
      const client = new ModernClient(
        { name: 'native-list', version: '2' },
        { versionNegotiation: { mode: { pin: '2026-07-28' } } },
      );
      let closedClient = false;
      try {
        await lazy.initialize();
        manager.setLazyLoadingOrchestrator(lazy);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        await client.connect(
          new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`)),
        );
        const call = (cursor?: string) =>
          client.request(
            {
              method: 'tools/call',
              params: { name: 'tool_list', arguments: { limit: 1, ...(cursor ? { cursor } : {}) } },
            },
            listResultSchema,
          );
        const first = await call();
        expect(first.isError).not.toBe(true);
        expect(first.structuredContent.tools.map((tool) => tool.name)).toEqual(['alpha']);
        expect(first.structuredContent.nextCursor).toEqual(expect.any(String));
        const cursor = first.structuredContent.nextCursor!;
        const listsAfterIssuance = upstreamLists;
        const second = await call(cursor);
        expect(second.isError).not.toBe(true);
        expect(second.structuredContent.tools.map((tool) => tool.name)).toEqual(['beta']);
        expect(second.structuredContent.nextCursor).toBeUndefined();
        expect(upstreamLists).toBe(listsAfterIssuance);
        expect(sessions.slice(0, 2).every((session) => session.startsWith('modern-'))).toBe(true);
        expect(new Set(sessions.slice(0, 2)).size).toBe(2);
        expect(bridgeIds.every((id) => manager.getServer(id) === undefined)).toBe(true);
        if (authenticated) {
          grant = { ...grant, token: 'verified-token-b' };
          expect((await call(cursor)).isError).toBe(true);
          grant = { ...grant, token: 'verified-token-a', grantedScopes: ['narrow'] };
          expect((await call(cursor)).isError).toBe(true);
          grant = { ...grant, grantedScopes: ['safe'] };
        }
        tags = ['hidden'];
        expect((await call(cursor)).isError).toBe(true);
        tags = ['safe'];
        advanceCapabilityPaginationGeneration(connections, 'tools');
        expect((await call(cursor)).isError).toBe(true);
        expect(upstreamLists).toBe(listsAfterIssuance);
        // A separate fresh walk isolates lifetime rejection from the prior epoch change.
        const fresh = await call();
        expect(fresh.isError).not.toBe(true);
        expect(fresh.structuredContent.nextCursor).toEqual(expect.any(String));
        const listsAfterFreshIssuance = upstreamLists;
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
          vi.setSystemTime(Date.now() + 15 * 60 * 1000);
          expect((await call(fresh.structuredContent.nextCursor)).isError).toBe(true);
        } finally {
          vi.useRealTimers();
        }
        expect(upstreamLists).toBe(listsAfterFreshIssuance);
        expect(bridgeIds.every((id) => manager.getServer(id) === undefined)).toBe(true);
        await Promise.all(cleanups.map((cleanup) => cleanup()));
        const priorBridgeCount = bridgeIds.length;
        await expect(call(cursor)).rejects.toThrow('Capability cursor owner is unavailable');
        expect(bridgeIds).toHaveLength(priorBridgeCount);
        await client.close();
        closedClient = true;
      } finally {
        if (!closedClient) await client.close();
        server.closeAllConnections();
        if (server.listening)
          await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
        await ServerManager.resetInstance();
        await connection.adapter.close();
        await backend.close();
        config.updateConfig({ lazyLoading: originalLazy });
      }
      expect(server.listening).toBe(false);
      expect(bridgeIds.every((id) => manager.getServer(id) === undefined)).toBe(true);
    },
  );
});
