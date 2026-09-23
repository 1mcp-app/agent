import type { InboundConnection, OutboundConnection } from '@src/core/types/index.js';
import { ServerStatus } from '@src/core/types/index.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  bindOwnedNotificationAuthorization,
  cleanupOwnedResources,
  deliverOwnedResourceUpdate,
  enqueueOwnedCatalogNotification,
  enqueueOwnedNotification,
  loseOwnedResourceCoverage,
  registerOwnedCatalogConnection,
  requireOwnedNotificationAuthorization,
  subscribeOwnedResource,
  unsubscribeOwnedResource,
} from './resourceSubscriptions.js';

const mocks = vi.hoisted(() => ({
  request: vi.fn().mockResolvedValue({}),
  route: vi.fn(),
  acquire: vi.fn().mockResolvedValue({}),
  notification: vi.fn(),
  openModern: vi.fn(),
}));
vi.mock('@src/core/capabilities/runtimeCapabilityCatalog.js', () => ({
  acquireRuntimeCapabilityCatalog: mocks.acquire,
}));
vi.mock('@src/core/protocol/requestHandlerUtils.js', () => ({
  getRequestSession: () => 'session',
  resolveCapabilityVisibility: () => ({ serverCandidates: new Set(['backend']) }),
}));
vi.mock('@src/sdk/legacy/client/runtime/modernSubscriptions.js', () => ({ openModernSubscription: mocks.openModern }));
vi.mock('@src/sdk/legacy/shared/resourceTemplateRouting.js', () => ({ resolveResourceRoute: mocks.route }));
vi.mock('@src/sdk/legacy/client/runtime/legacyOutboundConnection.js', () => ({
  requestLegacyOutbound: mocks.request,
  setOutboundNotificationHandler: mocks.notification,
}));

const inbounds: InboundConnection[] = [];
function fixture() {
  const inbound = {
    status: ServerStatus.Connected,
    adapter: { notify: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) },
  } as unknown as InboundConnection;
  inbounds.push(inbound);
  return inbound;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const update = (uri = 'file:///a', sequence = 0) => ({
  method: 'notifications/resources/updated',
  params: { uri, sequence },
});

describe('owned legacy resource subscriptions', () => {
  let upstream: OutboundConnection;
  let connections: Map<string, OutboundConnection>;
  beforeEach(() => {
    mocks.request.mockReset().mockResolvedValue({});
    mocks.acquire.mockReset().mockResolvedValue({});
    mocks.notification.mockClear();
    mocks.openModern.mockReset().mockImplementation(async (_connection, filter) => ({
      honoredFilter: filter,
      close: vi.fn().mockResolvedValue(undefined),
    }));
    upstream = { name: 'backend', adapter: {} } as OutboundConnection;
    connections = new Map([['backend', upstream]]);
    mocks.route.mockReset().mockImplementation((_snapshot, uri: string) => ({
      connection: upstream,
      upstreamIdentity: uri.replace('public:', ''),
      entry: {},
    }));
  });
  afterEach(async () => {
    await Promise.all(inbounds.splice(0).map(cleanupOwnedResources));
    vi.useRealTimers();
  });

  it('keeps a peer watch alive and forwards only exact subscribed URI bytes', async () => {
    const first = fixture();
    const second = fixture();
    const unrelated = fixture();
    await Promise.all([
      subscribeOwnedResource(connections, first, 'public:file:///a'),
      subscribeOwnedResource(connections, second, 'public:file:///a'),
      subscribeOwnedResource(connections, unrelated, 'public:file:///a%2F'),
    ]);
    expect(mocks.request.mock.calls.filter(([, method]) => method === 'resources/subscribe')).toHaveLength(2);
    await unsubscribeOwnedResource(first, 'public:file:///a');
    expect(mocks.request.mock.calls.filter(([, method]) => method === 'resources/unsubscribe')).toHaveLength(0);
    deliverOwnedResourceUpdate(upstream, update());
    await vi.waitFor(() => expect(second.adapter.notify).toHaveBeenCalledTimes(1));
    expect(first.adapter.notify).not.toHaveBeenCalled();
    expect(unrelated.adapter.notify).not.toHaveBeenCalled();
    expect(second.adapter.notify).toHaveBeenCalledWith({
      method: 'notifications/resources/updated',
      params: { uri: 'public:file:///a', sequence: 0, server: 'backend' },
    });
    await unsubscribeOwnedResource(second, 'public:file:///a');
    expect(mocks.request).toHaveBeenCalledWith(upstream, 'resources/unsubscribe', { uri: 'file:///a' });
  });

  it('preserves per-owner ordering without awaiting a slow owner', async () => {
    const slow = fixture();
    const fast = fixture();
    const blocked = deferred();
    vi.mocked(slow.adapter.notify).mockReturnValueOnce(blocked.promise);
    await Promise.all([slow, fast].map((owner) => subscribeOwnedResource(connections, owner, 'public:file:///a')));
    deliverOwnedResourceUpdate(upstream, update('file:///a', 1));
    deliverOwnedResourceUpdate(upstream, update('file:///a', 2));
    await vi.waitFor(() => expect(fast.adapter.notify).toHaveBeenCalledTimes(2));
    expect(slow.adapter.notify).toHaveBeenCalledTimes(1);
    blocked.resolve();
    await vi.waitFor(() => expect(slow.adapter.notify).toHaveBeenCalledTimes(2));
    expect(vi.mocked(slow.adapter.notify).mock.calls.map(([value]) => value.params)).toEqual([
      { uri: 'public:file:///a', sequence: 1, server: 'backend' },
      { uri: 'public:file:///a', sequence: 2, server: 'backend' },
    ]);
  });

  it('terminates overflow only for the slow owner and preserves the peer watch', async () => {
    const slow = fixture();
    const fast = fixture();
    const blocked = deferred();
    vi.mocked(slow.adapter.notify).mockReturnValueOnce(blocked.promise);
    await Promise.all([slow, fast].map((owner) => subscribeOwnedResource(connections, owner, 'public:file:///a')));
    for (let sequence = 0; sequence < 65; sequence++) {
      deliverOwnedResourceUpdate(upstream, update('file:///a', sequence));
      await vi.waitFor(() => expect(fast.adapter.notify).toHaveBeenCalledTimes(sequence + 1));
    }
    expect(slow.adapter.close).toHaveBeenCalledTimes(1);
    expect(fast.adapter.close).not.toHaveBeenCalled();
    expect(mocks.request.mock.calls.filter(([, method]) => method === 'resources/unsubscribe')).toHaveLength(0);
    blocked.resolve();
  });

  it('terminates coverage loss before sending and only removes owned watches', async () => {
    const first = fixture();
    const second = fixture();
    await subscribeOwnedResource(connections, first, 'public:file:///a');
    await subscribeOwnedResource(connections, second, 'public:file:///b');
    loseOwnedResourceCoverage(upstream, 'file:///a');
    expect(first.adapter.close).toHaveBeenCalledTimes(1);
    expect(second.adapter.close).not.toHaveBeenCalled();
    deliverOwnedResourceUpdate(upstream, update());
    expect(first.adapter.notify).not.toHaveBeenCalled();
    mocks.route.mockImplementation(() => {
      throw new Error('No longer visible');
    });
    deliverOwnedResourceUpdate(upstream, update('file:///b'));
    await vi.waitFor(() => expect(second.adapter.close).toHaveBeenCalledTimes(1));
    expect(second.adapter.notify).not.toHaveBeenCalled();
  });

  it('does not attach a cancelled first setup and lets its peer establish coverage', async () => {
    const first = fixture();
    const second = fixture();
    const blocked = deferred();
    mocks.acquire.mockReturnValueOnce(blocked.promise);
    const controller = new AbortController();
    const operation = subscribeOwnedResource(connections, first, 'public:file:///a', controller.signal);
    const rejected = expect(operation).rejects.toThrow('cancelled');
    controller.abort();
    await subscribeOwnedResource(connections, second, 'public:file:///a');
    blocked.resolve();
    await rejected;
    expect(mocks.request.mock.calls.filter(([, method]) => method === 'resources/subscribe')).toHaveLength(1);
    deliverOwnedResourceUpdate(upstream, update());
    await vi.waitFor(() => expect(second.adapter.notify).toHaveBeenCalledTimes(1));
    expect(first.adapter.notify).not.toHaveBeenCalled();
  });

  it('bounds setup admission before unresolved catalog requests finish', async () => {
    const owner = fixture();
    const blocked = deferred();
    mocks.acquire.mockReturnValue(blocked.promise);
    const pending = Array.from({ length: 64 }, (_, index) =>
      subscribeOwnedResource(connections, owner, `public:file:///${index}`),
    );
    await expect(subscribeOwnedResource(connections, owner, 'public:file:///overflow')).rejects.toThrow('admission');
    const settled = Promise.allSettled(pending);
    await cleanupOwnedResources(owner);
    blocked.resolve();
    expect((await settled).every((result) => result.status === 'rejected')).toBe(true);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('terminates idle coverage loss on a bounded periodic check', async () => {
    vi.useFakeTimers();
    const owner = fixture();
    await subscribeOwnedResource(connections, owner, 'public:file:///a');
    mocks.route.mockImplementation(() => {
      throw new Error('Route removed');
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(owner.adapter.close).toHaveBeenCalledOnce();
    expect(owner.adapter.notify).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fails closed when the subscription grant is revoked', async () => {
    const owner = fixture();
    const authorize = vi.fn().mockResolvedValue(true);
    await subscribeOwnedResource(connections, owner, 'public:file:///a', undefined, authorize);
    authorize.mockResolvedValue(false);
    deliverOwnedResourceUpdate(upstream, update());
    await vi.waitFor(() => expect(owner.adapter.close).toHaveBeenCalledOnce());
    expect(owner.adapter.notify).not.toHaveBeenCalled();
  });

  it('bounds catalog notification delivery without blocking a peer', async () => {
    const slow = fixture();
    const fast = fixture();
    const blocked = deferred();
    vi.mocked(slow.adapter.notify).mockReturnValueOnce(blocked.promise);
    const notification = { method: 'notifications/resources/list_changed', params: {} };
    enqueueOwnedNotification(connections, slow, notification);
    await vi.waitFor(() => expect(slow.adapter.notify).toHaveBeenCalledOnce());
    enqueueOwnedNotification(connections, fast, notification);
    await vi.waitFor(() => expect(fast.adapter.notify).toHaveBeenCalledOnce());
    for (let i = 0; i < 64; i++) enqueueOwnedNotification(connections, slow, notification);
    expect(slow.adapter.close).toHaveBeenCalledOnce();
    expect(fast.adapter.close).not.toHaveBeenCalled();
    blocked.resolve();
  });

  it('enforces process admission across independent owners', async () => {
    const subscribers = Array.from({ length: 16 }, fixture);
    await Promise.all(
      subscribers.flatMap((owner) =>
        Array.from({ length: 64 }, (_, index) => subscribeOwnedResource(connections, owner, `public:file:///${index}`)),
      ),
    );
    await expect(subscribeOwnedResource(connections, fixture(), 'public:file:///overflow')).rejects.toThrow(
      'admission',
    );
  });

  it('owns independent modern upstream handles for two watchers of the same URI', async () => {
    Object.assign(upstream.adapter, { protocol: { era: 'modern' } });
    const first = fixture();
    const second = fixture();
    await subscribeOwnedResource(connections, first, 'public:file:///a');
    await subscribeOwnedResource(connections, second, 'public:file:///a');
    expect(mocks.openModern).toHaveBeenCalledTimes(2);
    expect(mocks.request).not.toHaveBeenCalled();
    const firstHandle = await mocks.openModern.mock.results[0].value;
    const secondHandle = await mocks.openModern.mock.results[1].value;
    await unsubscribeOwnedResource(first, 'public:file:///a');
    expect(firstHandle.close).toHaveBeenCalledOnce();
    expect(secondHandle.close).not.toHaveBeenCalled();
    mocks.openModern.mock.calls[1][2]({
      method: 'notifications/resources/updated',
      params: { uri: 'file:///a', _meta: { 'io.modelcontextprotocol/subscriptionId': 1, retained: true } },
    });
    await vi.waitFor(() => expect(second.adapter.notify).toHaveBeenCalledOnce());
    expect(second.adapter.notify).toHaveBeenCalledWith({
      method: 'notifications/resources/updated',
      params: { uri: 'public:file:///a', server: 'backend', _meta: { retained: true } },
    });
    expect(first.adapter.notify).not.toHaveBeenCalled();
  });

  it('does not terminate a resource-only modern bridge when catalog coverage is lost', async () => {
    Object.assign(upstream, { capabilities: { tools: { listChanged: true } }, status: 'connected' });
    Object.assign(upstream.adapter, { protocol: { era: 'modern' } });
    const catalog = fixture();
    const resource = Object.assign(fixture(), { subscriptionListKinds: [] });
    registerOwnedCatalogConnection(connections, catalog, upstream, 'tools');
    registerOwnedCatalogConnection(connections, resource, upstream, 'tools');
    await subscribeOwnedResource(connections, resource, 'public:file:///a');
    const handler = mocks.notification.mock.calls.find(
      ([, schema]) => schema.shape.method.value === 'notifications/1mcp/subscription_lost',
    )?.[2];
    expect(handler).toBeTypeOf('function');
    handler({ method: 'notifications/1mcp/subscription_lost', params: { catalog: true } });
    expect(catalog.adapter.close).toHaveBeenCalledOnce();
    expect(resource.adapter.close).not.toHaveBeenCalled();
  });

  it('releases a never-resolving delivery on its deadline', async () => {
    vi.useFakeTimers();
    const owner = fixture();
    vi.mocked(owner.adapter.notify).mockImplementation(() => new Promise(() => {}));
    enqueueOwnedNotification(connections, owner, { method: 'notifications/tools/list_changed' });
    await vi.advanceTimersByTimeAsync(0);
    expect(owner.adapter.notify).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30_001);
    expect(owner.adapter.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not send HTTP notifications until initialization binds the original grant', async () => {
    const owner = fixture();
    requireOwnedNotificationAuthorization(connections, owner);
    enqueueOwnedNotification(connections, owner, { method: 'notifications/tools/list_changed' });
    await Promise.resolve();
    expect(owner.adapter.notify).not.toHaveBeenCalled();
    const authorize = vi.fn().mockResolvedValue(true);
    bindOwnedNotificationAuthorization(connections, owner, authorize);
    enqueueOwnedNotification(connections, owner, { method: 'notifications/tools/list_changed' });
    await vi.waitFor(() => expect(owner.adapter.notify).toHaveBeenCalledOnce());
    authorize.mockResolvedValue(false);
    enqueueOwnedNotification(connections, owner, { method: 'notifications/tools/list_changed' });
    await vi.waitFor(() => expect(owner.adapter.close).toHaveBeenCalledOnce());
    expect(owner.adapter.notify).toHaveBeenCalledOnce();
  });

  it('rejects a catalog event from a source the recipient does not own', async () => {
    const owner = fixture();
    const hidden = {
      ...upstream,
      name: 'hidden',
      adapter: { ...upstream.adapter },
      capabilities: { tools: { listChanged: true } },
      status: 'connected',
    } as OutboundConnection;
    Object.assign(upstream, { capabilities: { tools: { listChanged: true } }, status: 'connected' });
    connections.set('hidden', hidden);
    registerOwnedCatalogConnection(connections, owner, upstream, 'tools');
    registerOwnedCatalogConnection(connections, owner, hidden, 'tools');
    enqueueOwnedCatalogNotification(connections, owner, hidden, { method: 'notifications/tools/list_changed' });
    await Promise.resolve();
    expect(owner.adapter.notify).not.toHaveBeenCalled();
    enqueueOwnedCatalogNotification(connections, owner, upstream, { method: 'notifications/tools/list_changed' });
    await vi.waitFor(() => expect(owner.adapter.notify).toHaveBeenCalledOnce());
  });

  it('snapshots queued notification payloads before a caller can mutate them', async () => {
    const owner = fixture();
    const blocked = deferred();
    vi.mocked(owner.adapter.notify).mockReturnValueOnce(blocked.promise);
    await subscribeOwnedResource(connections, owner, 'public:file:///a');
    deliverOwnedResourceUpdate(upstream, update('file:///a', 1));
    await vi.waitFor(() => expect(owner.adapter.notify).toHaveBeenCalledOnce());
    const queued = update('file:///a', 2);
    deliverOwnedResourceUpdate(upstream, queued);
    queued.params.sequence = 999;
    blocked.resolve();
    await vi.waitFor(() => expect(owner.adapter.notify).toHaveBeenCalledTimes(2));
    expect(vi.mocked(owner.adapter.notify).mock.calls[1][0].params).toMatchObject({ sequence: 2 });
  });

  it('pins subscribe and cleanup to the adapter generation even when the connection object is reused', async () => {
    const first = fixture();
    const second = fixture();
    const previousAdapter = upstream.adapter;
    await subscribeOwnedResource(connections, first, 'public:file:///a');
    const oldHandler = mocks.notification.mock.calls.find(
      ([, schema]) => schema.shape.method.value === 'notifications/resources/updated',
    )![2];
    const currentAdapter = { ...previousAdapter };
    Object.assign(upstream, { adapter: currentAdapter });
    await subscribeOwnedResource(connections, second, 'public:file:///a');
    const subscribeCalls = mocks.request.mock.calls.filter(([, method]) => method === 'resources/subscribe');
    expect(subscribeCalls).toHaveLength(2);
    expect(subscribeCalls[0][0].adapter).toBe(previousAdapter);
    expect(subscribeCalls[1][0].adapter).toBe(currentAdapter);
    await unsubscribeOwnedResource(first, 'public:file:///a');
    const unsubscribeCalls = mocks.request.mock.calls.filter(([, method]) => method === 'resources/unsubscribe');
    expect(unsubscribeCalls).toHaveLength(1);
    expect(unsubscribeCalls[0][0].adapter).toBe(previousAdapter);
    oldHandler(update());
    await Promise.resolve();
    expect(second.adapter.notify).not.toHaveBeenCalled();
    deliverOwnedResourceUpdate(upstream, update());
    await vi.waitFor(() => expect(second.adapter.notify).toHaveBeenCalledOnce());
    await unsubscribeOwnedResource(second, 'public:file:///a');
    expect(mocks.request.mock.calls.filter(([, method]) => method === 'resources/unsubscribe')[1][0].adapter).toBe(
      currentAdapter,
    );
  });

  it('rejects oversized URI and terminates oversized delivery', async () => {
    const owner = fixture();
    await expect(subscribeOwnedResource(connections, owner, 'a'.repeat(8193))).rejects.toThrow('URI exceeds');
    await subscribeOwnedResource(connections, owner, 'public:file:///a');
    deliverOwnedResourceUpdate(upstream, {
      ...update(),
      params: { uri: 'file:///a', payload: 'a'.repeat(1024 * 1024) },
    });
    expect(owner.adapter.close).toHaveBeenCalledOnce();
    expect(owner.adapter.notify).not.toHaveBeenCalled();
  });
});
