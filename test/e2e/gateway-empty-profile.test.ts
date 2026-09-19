import { Client as ModernClient, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { ClientStatus } from '@src/core/types/index.js';
import { Client } from '@src/sdk/legacy/client/index.js';
import { ClientFactory } from '@src/sdk/legacy/client/runtime/clientFactory.js';
import { createLegacyOutboundConnection } from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import { Server } from '@src/sdk/legacy/server/index.js';
import { ServerManager } from '@src/sdk/legacy/server/runtime/serverManager.js';
import { createModernInboundLegacyBridge } from '@src/sdk/legacy/transport/http/modernInboundLegacyBridge.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@src/sdk/legacy/types.js';
import { setupModernHttpRoutes } from '@src/transport/http/routes/modernHttpRoutes.js';

import express from 'express';
import { describe, expect, it } from 'vitest';

describe('empty modern interaction profile reuse', () => {
  it.each([
    { name: 'factory empty profile', known: true, profile: {}, reusable: true },
    {
      name: 'factory union profile',
      known: true,
      profile: { roots: {}, sampling: {}, elicitation: { form: {} } },
      reusable: false,
    },
    { name: 'untracked empty profile', known: false, profile: {}, reusable: false },
  ])('uses only proven empty initialization: $name', async ({ known, profile, reusable }) => {
    let dispatches = 0;
    const backend = new Server({ name: 'fixture', version: '1' }, { capabilities: { tools: {} } });
    backend.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{ name: 'act', inputSchema: { type: 'object', properties: {} } }],
    }));
    backend.setRequestHandler(CallToolRequestSchema, async () => {
      dispatches++;
      return { content: [{ type: 'text', text: 'done' }] };
    });
    const [sourceTransport, backendTransport] = InMemoryTransport.createLinkedPair();
    const source = known
      ? new ClientFactory().createClient(sourceTransport, profile)
      : new Client({ name: 'untracked', version: '1' }, { capabilities: profile });
    await backend.connect(backendTransport);
    await source.connect(sourceTransport);
    // This is the actual profile received at the real legacy initialize boundary.
    expect(backend.getClientCapabilities()).toEqual(profile);
    const connection = createLegacyOutboundConnection({
      name: 'fixture',
      client: source,
      transport: sourceTransport,
      status: ClientStatus.Connected,
      capabilities: { tools: {} },
    });
    const manager = ServerManager.getOrCreateInstance(
      { name: 'aggregate', version: '1' },
      { capabilities: { tools: {}, prompts: {}, resources: {}, completions: {}, logging: {} } },
      new Map([['fixture', connection]]),
      {},
    );
    const app = express();
    app.use(express.json());
    setupModernHttpRoutes(app as never, manager, [], createModernInboundLegacyBridge, {
      allowsHost: () => true,
      allowsOrigin: () => true,
    });
    const listener = createServer(app);
    await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
    const caller = new ModernClient(
      { name: 'ordinary', version: '1' },
      { capabilities: {}, versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );
    try {
      await caller.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${(listener.address() as AddressInfo).port}/mcp`)),
      );
      const result = caller.request({ method: 'tools/call', params: { name: 'fixture_1mcp_act', arguments: {} } });
      if (reusable) {
        await expect(result).resolves.toMatchObject({ content: [{ text: 'done' }] });
        expect(dispatches).toBe(1);
      } else {
        await expect(result).rejects.toBeDefined();
        expect(dispatches).toBe(0);
      }
    } finally {
      await caller.close();
      await ServerManager.resetInstance();
      await connection.adapter.close();
      await backend.close();
      listener.closeAllConnections();
      await new Promise<void>((resolve, reject) => listener.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
