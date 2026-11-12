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
import type { Client } from '@src/sdk/legacy/client/index.js';
import type { AuthProviderTransport } from '@src/sdk/legacy/client/runtime/legacyTransport.js';
import { ModernSdkClientAdapter } from '@src/sdk/legacy/client/runtime/modernSdkClientAdapter.js';
import type { Server } from '@src/sdk/legacy/server/index.js';
import { projectResourceUri } from '@src/sdk/legacy/shared/resourceTemplateRouting.js';
import {
  ReadResourceRequestSchema,
  ResourceUpdatedNotificationSchema,
  SubscribeRequestSchema,
} from '@src/sdk/legacy/types.js';

import { registerResourceHandlers } from './resourceRequestHandlers.js';
import { cleanupOwnedResources, setupOwnedResourceNotifications } from './resourceSubscriptions.js';

vi.mock('@src/core/server/serverManager.js', () => ({
  ServerManager: {
    get current() {
      return { getTemplateServerManager: () => undefined };
    },
  },
}));
afterEach(() => vi.useRealTimers());

describe.each([
  ['legacy', 'read'],
  ['legacy', 'subscribe'],
  ['modern', 'read'],
] as const)('resource %s %s after Backend Sleep', (era, operation) => {
  it.each([
    ['listed', 'hidden'],
    ['listed', 'removed'],
    ['listed', 'changed'],
    ['listed', 'unchanged'],
    ['template', 'hidden'],
    ['template', 'removed'],
    ['template', 'changed'],
    ['template', 'unchanged'],
  ] as const)('revalidates a %s resource that is %s after wake', async (kind, change) => {
    vi.useFakeTimers();
    const resource = { name: 'document', uri: 'file:///document', mimeType: 'text/plain' };
    const template = { name: 'items', uriTemplate: 'custom:///items/{id}', mimeType: 'text/plain' };
    const makeConnection = (replacement: boolean) => {
      let resources = [resource];
      let resourceTemplates = [template];
      if (replacement && kind === 'listed') {
        if (change === 'removed') resources = [];
        if (change === 'changed') resources = [{ ...resource, mimeType: 'application/json' }];
      }
      if (replacement && kind === 'template') {
        if (change === 'removed') resourceTemplates = [];
        if (change === 'changed') resourceTemplates = [{ ...template, mimeType: 'application/json' }];
      }
      const request = vi.fn(async ({ method, params }: { method: string; params?: { uri?: string } }) => {
        if (method === 'resources/list') return { resources };
        if (method === 'resources/templates/list') return { resourceTemplates };
        if (method === 'resources/read') return { contents: [{ uri: params?.uri, text: 'ok' }] };
        return {};
      });
      const notifications = vi.fn();
      const connection = createMockLegacyOutboundConnection({
        name: 'provider',
        capabilities: { resources: { subscribe: true } },
        client: createMockClient({ request: request as never, setNotificationHandler: notifications }) as Client,
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
          notifications,
        };
      }
      return { connection, request, notifications };
    };
    const first = makeConnection(false);
    const next = makeConnection(true);
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
      wake: async () => {
        adapter.current = next.connection.adapter;
        if (change === 'hidden') {
          Object.assign(inbound, { tags: ['hidden'], tagFilterMode: 'simple-or' });
        }
        const changed = await adapter.refresh({ resources: { subscribe: true } });
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
    await adapter.refresh({ resources: { subscribe: true } });
    const catalog = await acquireRuntimeCapabilityCatalog(
      connections,
      resolveCapabilityVisibility(connections, inbound, getRequestSession(inbound), 'resources'),
    );
    const uri = projectResourceUri(catalog, 'provider', kind === 'listed' ? resource.uri : 'custom:///items/one');
    registerResourceHandlers(connections, inbound);
    setupOwnedResourceNotifications(connection);
    const notify = vi.spyOn(inbound.adapter, 'notify').mockResolvedValue(undefined);
    const schema = operation === 'read' ? ReadResourceRequestSchema : SubscribeRequestSchema;
    const handler = setRequestHandler.mock.calls.find(([candidate]) => candidate === schema)![1];
    lifecycle.ready();
    await vi.advanceTimersByTimeAsync(30_000);
    try {
      const pending = handler(
        { method: `resources/${operation}`, params: { uri } },
        {
          signal: new AbortController().signal,
          requestId: 'resource-operation',
          sendNotification: vi.fn(),
          sendRequest: vi.fn(),
        },
      );
      if (change === 'unchanged') {
        const expected = operation === 'read' ? { contents: [{ uri, text: 'ok' }] } : {};
        await expect(pending).resolves.toEqual(expected);
        if (operation === 'subscribe') {
          const callback = next.notifications.mock.calls.find(
            ([schema]) => schema === ResourceUpdatedNotificationSchema,
          )?.[1];
          expect(callback).toBeTypeOf('function');
          callback({
            method: 'notifications/resources/updated',
            params: { uri: kind === 'listed' ? resource.uri : 'custom:///items/one' },
          });
          await vi.advanceTimersByTimeAsync(0);
          expect(notify).toHaveBeenCalledWith({
            method: 'notifications/resources/updated',
            params: { uri, server: 'provider' },
          });
        }
      } else await expect(pending).rejects.toThrow();
      expect(next.request.mock.calls.filter(([request]) => request.method === `resources/${operation}`)).toHaveLength(
        change === 'unchanged' ? 1 : 0,
      );
    } finally {
      await cleanupOwnedResources(inbound);
      lifecycle.stop();
    }
  });
});
