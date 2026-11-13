import { Client as ModernClient } from '@modelcontextprotocol/client';
import {
  createMockClient,
  createMockLegacyInboundConnection,
  createMockLegacyOutboundConnection,
  createMockServer,
  createMockTransport,
} from '@test/unit-utils/MockFactories.js';

import { BackendSleep } from '@src/core/server/backendSleep.js';
import { BackendSleepAdapter } from '@src/core/server/backendSleepAdapter.js';
import type { Client } from '@src/sdk/legacy/client/index.js';
import type { AuthProviderTransport } from '@src/sdk/legacy/client/runtime/legacyTransport.js';
import { ModernSdkClientAdapter } from '@src/sdk/legacy/client/runtime/modernSdkClientAdapter.js';
import type { Server } from '@src/sdk/legacy/server/index.js';
import type { RequestHandlerExtra } from '@src/sdk/legacy/shared/protocol.js';
import { ListRootsRequestSchema, type ServerNotification, type ServerRequest } from '@src/sdk/legacy/types.js';

import { withRequestInteractionScope } from './requestInteractionScope.js';

it('rebinds reverse requests to the replacement session and rejects callbacks from the released session', async () => {
  const createProvider = () => {
    const handlers = vi.fn();
    const connection = createMockLegacyOutboundConnection({
      client: createMockClient({ setRequestHandler: handlers }) as Client,
    });
    return { connection, handlers };
  };
  const first = createProvider();
  const replacement = createProvider();
  const lifecycle = new BackendSleep({
    idleTimeoutMs: 30_000,
    release: async () => {},
    wake: async () => {},
    isCurrent: () => true,
  });
  const adapter = new BackendSleepAdapter(first.connection.adapter, lifecycle);
  const connection = { ...first.connection, adapter };
  const inbound = createMockLegacyInboundConnection({
    server: createMockServer({ getClientCapabilities: () => ({ roots: {} }) }) as Server,
  });
  const extra: RequestHandlerExtra<ServerRequest, ServerNotification> = {
    signal: new AbortController().signal,
    requestId: 'first',
    sendNotification: vi.fn(),
    sendRequest: vi.fn().mockResolvedValue({ roots: [] }),
  };
  const rootsHandler = (provider: typeof first) =>
    provider.handlers.mock.calls.find(([schema]) => schema === ListRootsRequestSchema)?.[1];
  try {
    await withRequestInteractionScope(connection, inbound, extra, async () => {
      await expect(rootsHandler(first)({ method: 'roots/list' })).resolves.toEqual({ roots: [] });
    });
    adapter.current = replacement.connection.adapter;
    await withRequestInteractionScope(connection, inbound, { ...extra, requestId: 'replacement' }, async () => {
      expect(rootsHandler(replacement)).toBeTypeOf('function');
      await expect(rootsHandler(replacement)({ method: 'roots/list' })).resolves.toEqual({ roots: [] });
      await expect(rootsHandler(first)({ method: 'roots/list' })).rejects.toThrow('interaction_lost');
    });
    expect(extra.sendRequest).toHaveBeenCalledTimes(2);
  } finally {
    lifecycle.stop();
  }
});

it('rejects replacement callbacks in a still-active superseded modern scope', async () => {
  const provider = () => {
    const client = new ModernClient({ name: 'provider', version: '1' });
    vi.spyOn(client, 'getProtocolEra').mockReturnValue('modern');
    vi.spyOn(client, 'getNegotiatedProtocolVersion').mockReturnValue('2026-07-28');
    const adapter = new ModernSdkClientAdapter(client, createMockTransport() as AuthProviderTransport);
    const handlers = vi.spyOn(adapter, 'registerRequestHandler');
    return { adapter, handlers };
  };
  const first = provider();
  const next = provider();
  const lifecycle = new BackendSleep({
    idleTimeoutMs: 30_000,
    release: async () => {},
    wake: async () => {},
    isCurrent: () => true,
  });
  const adapter = new BackendSleepAdapter(first.adapter, lifecycle);
  const connection = { ...createMockLegacyOutboundConnection(), adapter };
  const inbound = createMockLegacyInboundConnection({
    server: createMockServer({ getClientCapabilities: () => ({ roots: {} }) }) as Server,
  });
  const extra: RequestHandlerExtra<ServerRequest, ServerNotification> = {
    signal: new AbortController().signal,
    requestId: 'first',
    sendNotification: vi.fn(),
    sendRequest: vi.fn().mockResolvedValue({ roots: [] }),
  };
  try {
    await withRequestInteractionScope(connection, inbound, extra, async () => {
      adapter.current = next.adapter;
      await withRequestInteractionScope(connection, inbound, { ...extra, requestId: 'next' }, async () => {});
      const handler = next.handlers.mock.calls.find(([schema]) => schema === ListRootsRequestSchema)![1];
      await expect(handler({ method: 'roots/list' } as never)).rejects.toThrow('interaction_lost');
    });
    expect(extra.sendRequest).not.toHaveBeenCalled();
  } finally {
    lifecycle.stop();
  }
});
