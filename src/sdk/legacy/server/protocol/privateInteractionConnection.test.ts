import { Client as ModernClient, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, Server as ModernServer } from '@modelcontextprotocol/server';
import { createMockLegacyInboundConnection } from '@test/unit-utils/MockFactories.js';

import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import {
  createCapabilityVisibility,
  createResourceRouteOwner,
  revokeResourceRouteOwner,
} from '@src/core/capabilities/capabilityVisibility.js';
import {
  acquireRuntimeCapabilityCatalog,
  RUNTIME_CATALOG_SCOPE_TTL_MS,
} from '@src/core/capabilities/runtimeCapabilityCatalog.js';
import { ClientStatus } from '@src/core/types/index.js';
import { Client } from '@src/sdk/legacy/client/index.js';
import {
  createLegacyOutboundConnection,
  requestLegacyOutbound,
  setOutboundNotificationHandler,
} from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import type { AuthProviderTransport } from '@src/sdk/legacy/client/runtime/legacyTransport.js';
import { Server } from '@src/sdk/legacy/server/index.js';
import type { RequestHandlerExtra } from '@src/sdk/legacy/shared/protocol.js';
import {
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  type ServerNotification,
  type ServerRequest,
} from '@src/sdk/legacy/types.js';

import { z } from 'zod';

import { withPrivateInteractionConnection } from './privateInteractionConnection.js';

const lease = vi.hoisted(() => ({ wait: () => Promise.resolve(), entered: vi.fn() }));
vi.mock('./requestInteractionScope.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./requestInteractionScope.js')>()),
  withRequestInteractionScope: async (
    _connection: unknown,
    _inbound: unknown,
    _extra: unknown,
    operation: () => Promise<unknown>,
    _provider: unknown,
    assertCurrent?: () => void,
  ) => {
    lease.entered();
    await lease.wait();
    assertCurrent?.();
    return operation();
  },
}));

async function fixture(privateResources = true) {
  lease.entered.mockClear();
  lease.wait = () => Promise.resolve();
  const peers: Server[] = [];
  const reads = vi.fn();
  const recreate = (): AuthProviderTransport => {
    const hasResources = peers.length === 0 || privateResources;
    const peer = new Server(
      { name: 'fixture', version: '1' },
      { capabilities: hasResources ? { resources: { listChanged: true } } : {} },
    );
    const peerIndex = peers.length;
    peers.push(peer);
    if (hasResources) {
      peer.setRequestHandler(ListResourcesRequestSchema, async () => ({
        resources: [{ name: 'listed', uri: 'file:///listed' }],
      }));
      peer.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [] }));
      peer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        reads(peerIndex, request.params.uri);
        return { contents: [{ uri: request.params.uri, text: 'ok' }] };
      });
    }
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    void peer.connect(serverTransport);
    return Object.assign(clientTransport, { recreate });
  };
  const client = new Client({ name: 'source', version: '1' });
  const transport = recreate();
  await client.connect(transport);
  const source = createLegacyOutboundConnection({
    name: 'provider',
    client,
    transport,
    status: ClientStatus.Connected,
    capabilities: { resources: { listChanged: true } },
  });
  const connections = new Map([['provider', source]]);
  const owner = createResourceRouteOwner();
  const snapshot = await acquireRuntimeCapabilityCatalog(
    connections,
    createCapabilityVisibility([['provider', 'provider']], 'bridge', undefined, owner),
  );
  const uri = snapshot.projectUnlistedResource('provider', 'urn:provider:unlisted');
  const entry = snapshot.resolve('resources', uri)!.entry;
  const inboundServer = new Server({ name: 'inbound', version: '1' });
  vi.spyOn(inboundServer, 'getClientCapabilities').mockReturnValue({ roots: {} });
  const inbound = createMockLegacyInboundConnection({ canonicalSchemaProjection: true, server: inboundServer });
  const assertCurrent = () => {
    const current = snapshot.resolve('resources', uri);
    if (
      current?.entry !== entry ||
      current.connection !== source ||
      current.entry.route.upstreamIdentity !== 'urn:provider:unlisted'
    )
      throw new Error('Resource route is unavailable');
  };
  const extra: RequestHandlerExtra<ServerRequest, ServerNotification> = {
    signal: new AbortController().signal,
    requestId: 'read',
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
  };
  const operation = (selected: typeof source) =>
    requestLegacyOutbound(selected, 'resources/read', { uri: entry.route.upstreamIdentity });
  return {
    source,
    inbound,
    extra,
    entry,
    assertCurrent,
    operation,
    owner,
    peers,
    reads,
    read: () => withPrivateInteractionConnection(source, inbound, extra, entry, operation, assertCurrent, entry),
    close: async () => {
      await source.adapter.close();
      await inboundServer.close();
      await Promise.all(peers.map((peer) => peer.close()));
    },
  };
}

describe('issued resource reads on isolated legacy peers', () => {
  it('reads a current issued URI once on a fresh private peer without rediscovery membership', async () => {
    const state = await fixture();
    try {
      await state.read();
      expect(state.peers).toHaveLength(2);
      expect(state.reads).toHaveBeenCalledExactlyOnceWith(1, 'urn:provider:unlisted');
    } finally {
      await state.close();
    }
  });

  it.each(['copied-proof', 'copied-entry', 'missing-assertion'] as const)(
    'rejects invalid authority before isolated admission: %s',
    async (invalid) => {
      const state = await fixture();
      try {
        const copy = structuredClone(state.entry);
        await expect(
          withPrivateInteractionConnection(
            state.source,
            state.inbound,
            state.extra,
            invalid === 'copied-entry' ? copy : state.entry,
            state.operation,
            invalid === 'missing-assertion' ? undefined : state.assertCurrent,
            invalid === 'missing-assertion' ? state.entry : copy,
          ),
        ).rejects.toThrow('interaction_lost');
        expect(state.peers).toHaveLength(1);
        expect(state.reads).not.toHaveBeenCalled();
      } finally {
        await state.close();
      }
    },
  );

  it.each(['revoke', 'expire'] as const)(
    'rejects an already invalid handle before private admission: %s',
    async (invalid) => {
      const clock = vi.spyOn(Date, 'now');
      const state = await fixture();
      try {
        if (invalid === 'revoke') revokeResourceRouteOwner(state.owner);
        else clock.mockReturnValue(Date.now() + RUNTIME_CATALOG_SCOPE_TTL_MS);
        await expect(state.read()).rejects.toThrow('Resource route is unavailable');
        expect(state.peers).toHaveLength(1);
        expect(state.reads).not.toHaveBeenCalled();
      } finally {
        clock.mockRestore();
        await state.close();
      }
    },
  );

  it.each(['revoke', 'expire', 'resource-epochs'] as const)(
    'rejects invalidation during isolated admission: %s',
    async (invalid) => {
      const clock = vi.spyOn(Date, 'now');
      const state = await fixture();
      let release!: () => void;
      lease.wait = () =>
        new Promise<void>((resolve) => {
          release = resolve;
        });
      try {
        const pending = state.read();
        const rejected = expect(pending).rejects.toBeDefined();
        await vi.waitFor(() => expect(lease.entered).toHaveBeenCalledTimes(1));
        if (invalid === 'revoke') revokeResourceRouteOwner(state.owner);
        else if (invalid === 'expire') clock.mockReturnValue(Date.now() + RUNTIME_CATALOG_SCOPE_TTL_MS);
        else {
          await state.peers[0].notification({ method: 'notifications/resources/list_changed' });
          // This protocol notification invalidates both resource and template epochs.
          await vi.waitFor(() => expect(state.assertCurrent).toThrow('Resource route is unavailable'));
        }
        release();
        await rejected;
        expect(state.peers).toHaveLength(2);
        expect(state.reads).not.toHaveBeenCalled();
      } finally {
        release?.();
        clock.mockRestore();
        await state.close();
      }
    },
  );

  it('rejects an admitted modern resource lease when its owned catalog stream is lost', async () => {
    lease.entered.mockClear();
    let release!: () => void;
    lease.wait = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const reads = vi.fn();
    const handler = createMcpHandler(
      () => {
        const peer = new ModernServer(
          { name: 'modern-resource-peer', version: '1' },
          { capabilities: { resources: { listChanged: true } } },
        );
        peer.setRequestHandler('resources/list', async () => ({
          resources: [{ name: 'listed', uri: 'urn:owned:listed' }],
        }));
        peer.setRequestHandler('resources/templates/list', async () => ({ resourceTemplates: [] }));
        peer.setRequestHandler('resources/read', async (message) => {
          reads(message.params.uri);
          return { contents: [{ uri: message.params.uri, text: 'actual-modern-peer' }] };
        });
        return peer;
      },
      { legacy: 'reject' },
    );
    let catalogResponse: ServerResponse | undefined;
    const nodeHandler = toNodeHandler(handler);
    const http = createServer((request, response) => {
      if (request.headers['mcp-method'] === 'subscriptions/listen') catalogResponse = response;
      void nodeHandler(request, response);
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const client = new ModernClient(
      { name: 'owned-resource-reader', version: '1' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`),
    );
    await client.connect(transport);
    const source = createLegacyOutboundConnection({
      name: 'modern-resource-peer',
      client,
      transport,
      status: ClientStatus.Connected,
      capabilities: { resources: { listChanged: true } },
    });
    await source.adapter.start();
    const connections = new Map([['modern-resource-peer', source]]);
    const owner = createResourceRouteOwner();
    const snapshot = await acquireRuntimeCapabilityCatalog(
      connections,
      createCapabilityVisibility([['modern-resource-peer', 'modern-resource-peer']], 'owned-bridge', undefined, owner),
    );
    const uri = snapshot.projectUnlistedResource('modern-resource-peer', 'urn:owned:unlisted');
    const entry = snapshot.resolve('resources', uri)!.entry;
    const assertCurrent = () => {
      if (snapshot.resolve('resources', uri)?.entry !== entry) throw new Error('Resource route is unavailable');
    };
    const inboundServer = new Server({ name: 'inbound', version: '1' });
    const inbound = createMockLegacyInboundConnection({ canonicalSchemaProjection: true, server: inboundServer });
    const extra: RequestHandlerExtra<ServerRequest, ServerNotification> = {
      signal: new AbortController().signal,
      requestId: 'held-modern-read',
      sendNotification: vi.fn(),
      sendRequest: vi.fn(),
    };
    let invalidatedBeforeCallback = false;
    const lost = vi.fn(() => {
      invalidatedBeforeCallback = snapshot.resolve('resources', uri) === undefined;
    });
    setOutboundNotificationHandler(
      source,
      z.object({ method: z.literal('notifications/1mcp/subscription_lost') }),
      lost,
    );
    try {
      const pending = withPrivateInteractionConnection(
        source,
        inbound,
        extra,
        entry,
        (selected) => requestLegacyOutbound(selected, 'resources/read', { uri: entry.route.upstreamIdentity }),
        assertCurrent,
        entry,
      );
      const rejected = expect(pending).rejects.toThrow('interaction_lost');
      await vi.waitFor(() => expect(lease.entered).toHaveBeenCalledOnce());
      expect(catalogResponse).toBeDefined();
      // Keep the backend capable of reading while only its owned listen stream ends.
      catalogResponse!.end();
      await vi.waitFor(() => expect(lost).toHaveBeenCalledOnce());
      release();
      await rejected;
      expect(invalidatedBeforeCallback).toBe(true);
      expect(reads).not.toHaveBeenCalled();
    } finally {
      release?.();
      lease.wait = () => Promise.resolve();
      await source.adapter.close();
      await inboundServer.close();
      await handler.close();
      http.closeAllConnections();
      await new Promise<void>((resolve, reject) => http.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it('rejects a fresh private peer without resource capability before any resource read', async () => {
    const state = await fixture(false);
    try {
      await expect(state.read()).rejects.toThrow('interaction_lost');
      expect(state.peers).toHaveLength(2);
      expect(state.reads).not.toHaveBeenCalled();
    } finally {
      await state.close();
    }
  });
});
