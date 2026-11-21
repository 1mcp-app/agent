import { Client as ModernClient } from '@modelcontextprotocol/client';
import {
  createMockClient,
  createMockLegacyInboundConnection,
  createMockLegacyOutboundConnection,
  createMockServer,
  createMockTransport,
} from '@test/unit-utils/MockFactories.js';

import { notifyBackendCapabilityChanges } from '@src/core/capabilities/capabilityPagination.js';
import { acquireRuntimeCapabilityCatalog } from '@src/core/capabilities/runtimeCapabilityCatalog.js';
import { getRequestSession, resolveCapabilityVisibility } from '@src/core/protocol/requestHandlerUtils.js';
import { BackendSleep } from '@src/core/server/backendSleep.js';
import { BackendSleepAdapter } from '@src/core/server/backendSleepAdapter.js';
import { ClientStatus } from '@src/core/types/client.js';
import type { Client } from '@src/sdk/legacy/client/index.js';
import type { AuthProviderTransport } from '@src/sdk/legacy/client/runtime/legacyTransport.js';
import { ModernSdkClientAdapter } from '@src/sdk/legacy/client/runtime/modernSdkClientAdapter.js';
import type { Server } from '@src/sdk/legacy/server/index.js';
import { GetPromptRequestSchema } from '@src/sdk/legacy/types.js';

import { registerPromptHandlers } from './promptRequestHandlers.js';

vi.mock('@src/core/server/serverManager.js', () => ({
  ServerManager: {
    get current() {
      return { getTemplateServerManager: () => undefined };
    },
  },
}));

afterEach(() => vi.useRealTimers());

describe.each(['legacy', 'modern'] as const)('prompt dispatch after Backend Sleep (%s)', (era) => {
  it.each(['removed', 'changed', 'unchanged', 'during-preparation'] as const)(
    'revalidates a %s prompt before dispatch',
    async (change) => {
      vi.useFakeTimers();
      const original = { name: 'hello', arguments: [{ name: 'topic', required: true }] };
      let replacement = [original];
      if (change === 'removed') replacement = [];
      if (change === 'changed') replacement = [{ ...original, arguments: [{ name: 'newTopic', required: true }] }];
      const makeConnection = (prompts: (typeof original)[]) => {
        const request = vi.fn(async ({ method }: { method: string }) => {
          if (method === 'prompts/list') return { prompts };
          return { messages: [] };
        });
        const connection = createMockLegacyOutboundConnection({
          name: 'provider',
          capabilities: { prompts: {} },
          client: createMockClient({ request: request as never }) as Client,
        });
        if (era === 'modern') {
          const client = new ModernClient({ name: 'provider', version: '1' });
          vi.spyOn(client, 'getProtocolEra').mockReturnValue('modern');
          vi.spyOn(client, 'getNegotiatedProtocolVersion').mockReturnValue('2026-07-28');
          vi.spyOn(client, 'request').mockImplementation(request as never);
          return {
            connection: {
              ...connection,
              adapter: new ModernSdkClientAdapter(client, createMockTransport() as AuthProviderTransport),
            },
            request,
          };
        }
        return { connection, request };
      };
      const first = makeConnection([original]);
      const next = makeConnection(replacement);
      let adapter!: BackendSleepAdapter;
      const connection = {
        ...first.connection,
        get adapter() {
          return adapter;
        },
      };
      const lifecycle = new BackendSleep({
        idleTimeoutMs: 30_000,
        release: async () => {},
        isCurrent: () => true,
        onChange: (snapshot) => {
          connection.status = snapshot.state === 'awake' ? ClientStatus.Connected : ClientStatus.Sleeping;
        },
        wake: async () => {
          adapter.current = next.connection.adapter;
          const changed = await adapter.refresh({ prompts: {} });
          await notifyBackendCapabilityChanges(connection, changed);
        },
      });
      adapter = new BackendSleepAdapter(first.connection.adapter, lifecycle);
      const connections = new Map([['provider', connection]]);
      const setRequestHandler = vi.fn();
      const inbound = createMockLegacyInboundConnection({
        tags: [],
        canonicalSchemaProjection: era === 'modern',
        server: createMockServer({ setRequestHandler, getClientCapabilities: () => ({}) }) as Server,
      });
      await adapter.refresh({ prompts: {} });
      const catalog = await acquireRuntimeCapabilityCatalog(
        connections,
        resolveCapabilityVisibility(connections, inbound, getRequestSession(inbound), 'prompts'),
      );
      const name = catalog.generation.entries.find((entry) => entry.route.kind === 'prompts')!.route.publicIdentity;
      registerPromptHandlers(connections, inbound);
      const handler = setRequestHandler.mock.calls.find(([schema]) => schema === GetPromptRequestSchema)![1];
      if (change === 'during-preparation') {
        const ensureAwake = lifecycle.ensureAwake.bind(lifecycle);
        let admissions = 0;
        vi.spyOn(lifecycle, 'ensureAwake').mockImplementation(async (signal) => {
          await ensureAwake(signal);
          if (++admissions === 2) await notifyBackendCapabilityChanges(connection, ['prompts/list']);
        });
      }
      lifecycle.ready();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(connection.status).toBe(ClientStatus.Sleeping);
      try {
        const result = handler(
          { method: 'prompts/get', params: { name, arguments: { topic: 'old' } } },
          {
            signal: new AbortController().signal,
            requestId: 'get-prompt',
            sendNotification: vi.fn(),
            sendRequest: vi.fn(),
          },
        );
        if (change === 'unchanged') await expect(result).resolves.toEqual({ messages: [] });
        else await expect(result).rejects.toThrow();
        expect(next.request.mock.calls.filter(([request]) => request.method === 'prompts/get')).toHaveLength(
          change === 'unchanged' ? 1 : 0,
        );
      } finally {
        lifecycle.stop();
      }
    },
  );
});

it('cancels prompt dispatch during post-wake discovery', async () => {
  vi.useFakeTimers();
  const prompt = { name: 'hello' };
  let slow = false;
  let started!: () => void;
  const listingStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  let finish!: () => void;
  const blocked = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const request = vi.fn(async ({ method }: { method: string }) => {
    if (method === 'prompts/list') {
      if (slow) {
        started();
        await blocked;
      }
      return { prompts: [prompt] };
    }
    return { messages: [] };
  });
  const original = createMockLegacyOutboundConnection({
    name: 'provider',
    capabilities: { prompts: {} },
    client: createMockClient({ request: request as never }) as Client,
  });
  const lifecycle = new BackendSleep({
    idleTimeoutMs: 30_000,
    release: async () => {},
    isCurrent: () => true,
    onChange: (snapshot) => {
      connection.status = snapshot.state === 'awake' ? ClientStatus.Connected : ClientStatus.Sleeping;
    },
    wake: async () => {
      await adapter.refresh({ prompts: {} });
      slow = true;
    },
  });
  const adapter = new BackendSleepAdapter(original.adapter, lifecycle);
  const connection = { ...original, adapter };
  const connections = new Map([['provider', connection]]);
  const setRequestHandler = vi.fn();
  const inbound = createMockLegacyInboundConnection({
    tags: [],
    server: createMockServer({ setRequestHandler, getClientCapabilities: () => ({}) }) as Server,
  });
  await adapter.refresh({ prompts: {} });
  const catalog = await acquireRuntimeCapabilityCatalog(
    connections,
    resolveCapabilityVisibility(connections, inbound, getRequestSession(inbound), 'prompts'),
  );
  const name = catalog.generation.entries.find((entry) => entry.route.kind === 'prompts')!.route.publicIdentity;
  registerPromptHandlers(connections, inbound);
  const handler = setRequestHandler.mock.calls.find(([schema]) => schema === GetPromptRequestSchema)![1];
  lifecycle.ready();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(connection.status).toBe(ClientStatus.Sleeping);
  const controller = new AbortController();
  let settled = false;
  const pending = handler(
    { method: 'prompts/get', params: { name } },
    { signal: controller.signal, requestId: 'cancel-prompt', sendNotification: vi.fn(), sendRequest: vi.fn() },
  );
  const outcome = pending.then(
    () => {
      settled = true;
      return 'resolved';
    },
    () => {
      settled = true;
      return 'rejected';
    },
  );
  try {
    await listingStarted;
    controller.abort();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    expect(await outcome).toBe('rejected');
    expect(request.mock.calls.filter(([request]) => request.method === 'prompts/get')).toHaveLength(0);
  } finally {
    finish();
    await outcome;
    lifecycle.stop();
  }
});
