import { createMockInboundConnection, createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import {
  bindResourceRouteOwner,
  createResourceRouteOwner,
  revokeResourceRouteOwner,
} from '@src/core/capabilities/capabilityVisibility.js';
import {
  acquireRuntimeCapabilityCatalog,
  RUNTIME_CATALOG_SCOPE_TTL_MS,
} from '@src/core/capabilities/runtimeCapabilityCatalog.js';
import { requestLegacyAdapter } from '@src/core/client/legacyAdapterRequest.js';
import { getRequestSession, resolveCapabilityVisibility } from '@src/core/protocol/requestHandlerUtils.js';
import type { OutboundConnection } from '@src/core/types/index.js';
import type { JsonValue } from '@src/sdk/contracts/index.js';
import type { RequestHandlerExtra } from '@src/sdk/legacy/shared/protocol.js';
import { projectResourceUri } from '@src/sdk/legacy/shared/resourceTemplateRouting.js';
import { ReadResourceRequestSchema, type ServerNotification, type ServerRequest } from '@src/sdk/legacy/types.js';

import { registerResourceHandlers } from './resourceRequestHandlers.js';

type ReadHandler = (
  request: { method: 'resources/read'; params: { uri: string } },
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
) => Promise<{ contents: Array<{ uri: string }> }>;

const lease = vi.hoisted(() => ({ wait: () => Promise.resolve(), entered: vi.fn() }));
const server = vi.hoisted(() => ({ setRequestHandler: vi.fn<(_schema: unknown, handler: ReadHandler) => void>() }));

vi.mock('@src/core/server/serverManager.js', () => ({
  ServerManager: {
    get current() {
      return { getTemplateServerManager: () => undefined };
    },
  },
}));
vi.mock('@src/sdk/legacy/server/runtime/legacyInboundConnection.js', () => ({
  getLegacyInboundServer: () => server,
}));
vi.mock('@src/sdk/legacy/client/runtime/legacyOutboundConnection.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@src/sdk/legacy/client/runtime/legacyOutboundConnection.js')>()),
  requestLegacyOutbound: (connection: OutboundConnection, method: string, params?: JsonValue) =>
    requestLegacyAdapter(connection.adapter, method, params),
}));
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

async function fixture() {
  server.setRequestHandler.mockClear();
  lease.entered.mockClear();
  let release!: () => void;
  const pendingLease = new Promise<void>((resolve) => {
    release = resolve;
  });
  lease.wait = () => pendingLease;
  const connection = createMockOutboundConnection({
    name: 'provider',
    capabilities: { resources: {} },
    adapter: {
      request: vi.fn(async ({ method, params }): Promise<JsonValue> => {
        if (method === 'resources/list') return { resources: [{ name: 'listed', uri: 'file:///listed' }] };
        if (method === 'resources/templates/list')
          return { resourceTemplates: [{ name: 'template', uriTemplate: 'custom:///items/{id}' }] };
        if (method === 'resources/read') return { contents: [{ uri: (params as { uri: string }).uri, text: 'ok' }] };
        throw new Error(`Unexpected method: ${method}`);
      }),
    },
  });
  const connections = new Map([['provider', connection]]);
  const owner = createResourceRouteOwner();
  const inbound = createMockInboundConnection({ tags: [], context: { sessionId: 'private-bridge' } });
  bindResourceRouteOwner(inbound.context!, owner);
  const snapshot = await acquireRuntimeCapabilityCatalog(
    connections,
    resolveCapabilityVisibility(connections, inbound, getRequestSession(inbound), 'resources'),
  );
  const handles = {
    opaque: snapshot.projectUnlistedResource('provider', 'urn:provider:opaque'),
    listed: projectResourceUri(snapshot, 'provider', 'file:///listed'),
    template: projectResourceUri(snapshot, 'provider', 'custom:///items/one'),
  };
  registerResourceHandlers(connections, inbound);
  const handler = server.setRequestHandler.mock.calls.find(([schema]) => schema === ReadResourceRequestSchema)?.[1];
  if (!handler) throw new Error('Read handler was not registered');
  const extra: RequestHandlerExtra<ServerRequest, ServerNotification> = {
    signal: new AbortController().signal,
    requestId: 'read',
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
  };
  return {
    owner,
    release,
    handles,
    read: (uri: string) => handler({ method: 'resources/read', params: { uri } }, extra),
    readCalls: () =>
      vi.mocked(connection.adapter.request).mock.calls.filter(([request]) => request.method === 'resources/read'),
  };
}

describe('resource read dispatch lease fence', () => {
  it.each(['revoke', 'expire'] as const)(
    'rejects an opaque handle that becomes invalid while queued: %s',
    async (invalidation) => {
      const now = Date.now();
      const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
      try {
        const state = await fixture();
        const pending = state.read(state.handles.opaque);
        const rejected = expect(pending).rejects.toMatchObject({ code: -32602 });
        await vi.waitFor(() => expect(lease.entered).toHaveBeenCalledTimes(1));
        expect(state.readCalls()).toHaveLength(0);
        if (invalidation === 'revoke') revokeResourceRouteOwner(state.owner);
        else clock.mockReturnValue(now + RUNTIME_CATALOG_SCOPE_TTL_MS);
        state.release();
        await rejected;
        expect(state.readCalls()).toHaveLength(0);
      } finally {
        clock.mockRestore();
      }
    },
  );

  it.each(['opaque', 'listed', 'template'] as const)(
    'dispatches a current %s route once after admission',
    async (kind) => {
      const state = await fixture();
      const pending = state.read(state.handles[kind]);
      await vi.waitFor(() => expect(lease.entered).toHaveBeenCalledTimes(1));
      expect(state.readCalls()).toHaveLength(0);
      state.release();
      expect((await pending).contents[0].uri).toBe(state.handles[kind]);
      expect(state.readCalls()).toHaveLength(1);
    },
  );
});
