import { EventEmitter } from 'node:events';

import { FilteringService } from '@src/core/filtering/filteringService.js';
import type { ServerManager } from '@src/core/server/serverManager.js';
import { ClientStatus } from '@src/core/types/index.js';

import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ModernInboundBridgeFactory } from './modernHttpRoutes.js';
import {
  closeModernSubscriptions,
  getModernSubscriptionCapabilities,
  serveModernSubscription,
} from './modernSubscriptions.js';

const authState = vi.hoisted(() => ({ allowed: true }));
vi.mock('@src/config/configuredServerTargets.js', () => ({ getConfiguredServerTargets: () => ({}) }));
vi.mock('@src/core/protocol/requestHandlerUtils.js', () => ({
  filterConnectionsForSession: (value: unknown) => value,
}));
vi.mock('@src/core/filtering/filteringService.js', () => ({
  FilteringService: { getFilteredConnections: (value: unknown) => value },
}));
vi.mock('@src/core/capabilities/runtimeCapabilityCatalog.js', () => ({
  acquireRuntimeCapabilityCatalog: async () => ({}),
}));
vi.mock('@src/core/protocol/resourceTemplateRouting.js', () => ({
  resolveResourceRoute: () => ({ entry: { route: { connectionKey: 'provider' } } }),
}));
vi.mock('@src/transport/http/middlewares/scopeAuthMiddleware.js', () => ({
  getAuthInfo: () => ({ token: 'synthetic', clientId: 'test' }),
  revalidateAuthInfo: async () => authState.allowed,
}));

function fixture() {
  const connection = {
    status: ClientStatus.Connected,
    adapter: {},
    capabilities: { tools: { listChanged: true }, resources: { subscribe: true } },
  };
  const connections = new Map([['provider', connection]]);
  const manager = { getClients: () => connections } as unknown as ServerManager;
  const frames: string[] = [];
  const response = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    headersSent: false,
    writableLength: 0,
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    set() {
      return this;
    },
    flushHeaders() {
      this.headersSent = true;
    },
    write: vi.fn((frame: string) => {
      frames.push(frame);
      return true;
    }),
    end(frame?: string) {
      if (frame) frames.push(frame);
      this.writableEnded = true;
    },
    destroy() {
      this.destroyed = true;
      response.emit('close');
    },
    json(body: unknown) {
      this.body = body;
      this.writableEnded = true;
    },
  });
  const controller = new AbortController();
  let notify!: (note: { method: string; params?: Record<string, unknown> }) => void;
  const close = vi.fn(async () => undefined);
  const subscribe = vi.fn(async (_uri: string, _signal?: AbortSignal) => undefined);
  const prepare = vi.fn(async (filter: Record<string, unknown>) => filter);
  const factory = vi.fn(async (_manager, _config, options) => {
    notify = options!.subscriptionNotification!;
    return { targetConnectionId: 'private', outbound: {} as never, subscribe, prepareSubscriptions: prepare, close };
  }) as ModernInboundBridgeFactory;
  function start(filter: Record<string, unknown> = {}) {
    const req = {
      body: { jsonrpc: '2.0', id: 7, method: 'subscriptions/listen', params: { notifications: filter } },
      get: () => undefined,
    } as unknown as Request;
    return serveModernSubscription(req, response as unknown as Response, manager, {}, factory, controller.signal);
  }
  return {
    manager,
    connections,
    connection,
    frames,
    response,
    controller,
    close,
    subscribe,
    prepare,
    start,
    notify: (note: Parameters<typeof notify>[0]) => notify(note),
  };
}
const live: ReturnType<typeof fixture>[] = [];
function tracked() {
  const value = fixture();
  live.push(value);
  return value;
}
afterEach(async () => {
  for (const value of live) await closeModernSubscriptions(value.manager);
  live.length = 0;
  authState.allowed = true;
  vi.useRealTimers();
});
const messages = (frames: string[]) => frames.map((frame) => JSON.parse(frame.split('data: ')[1]));

describe('modern subscription ownership', () => {
  it('advertises only supported notification coverage across the visible provider set', () => {
    const value = tracked();
    value.connections.clear();
    expect(getModernSubscriptionCapabilities(value.manager, {})).toEqual({ tools: {}, prompts: {}, resources: {} });
    value.connections.set('supported', value.connection);
    expect(getModernSubscriptionCapabilities(value.manager, {})).toEqual({
      tools: { listChanged: true },
      prompts: {},
      resources: { subscribe: true },
    });
    value.connections.set('unsupported', { ...value.connection, capabilities: { tools: {}, resources: {} } } as never);
    expect(getModernSubscriptionCapabilities(value.manager, {})).toEqual({
      tools: {},
      prompts: {},
      resources: { subscribe: true },
    });
    const filtered = vi
      .spyOn(FilteringService, 'getFilteredConnections')
      .mockReturnValueOnce(new Map([['supported', value.connection]]) as never);
    expect(getModernSubscriptionCapabilities(value.manager, { tags: ['visible'] })).toEqual({
      tools: { listChanged: true },
      prompts: {},
      resources: { subscribe: true },
    });
    filtered.mockRestore();
    value.connections.set('supported', { ...value.connection, status: ClientStatus.Disconnected } as never);
    expect(getModernSubscriptionCapabilities(value.manager, {})).toEqual({ tools: {}, prompts: {}, resources: {} });
    value.connections.clear();
    value.connections.set('full', {
      ...value.connection,
      capabilities: {
        tools: { listChanged: true },
        prompts: { listChanged: true },
        resources: { listChanged: true, subscribe: true },
      },
    } as never);
    expect(getModernSubscriptionCapabilities(value.manager, {})).toEqual({
      tools: { listChanged: true },
      prompts: { listChanged: true },
      resources: { listChanged: true, subscribe: true },
    });
  });

  it('buffers setup notifications until the truthful acknowledgement and preserves order/exact URI', async () => {
    const value = tracked();
    value.subscribe.mockImplementation(async (uri) => {
      value.notify({ method: 'notifications/resources/updated', params: { uri } });
      value.notify({ method: 'notifications/resources/updated', params: { uri: uri + '/child' } });
      value.notify({ method: 'notifications/resources/updated', params: { uri, sequence: 2 } });
    });
    const pending = value.start({ resourceSubscriptions: ['file:///exact'] });
    await vi.waitFor(() => expect(value.frames).toHaveLength(3));
    const notes = messages(value.frames);
    expect(notes[0]).toMatchObject({
      method: 'notifications/subscriptions/acknowledged',
      params: { notifications: { resourceSubscriptions: ['file:///exact'] } },
    });
    expect(notes.slice(1).map((note) => note.params.uri)).toEqual(['file:///exact', 'file:///exact']);
    expect(notes[2].params.sequence).toBe(2);
    expect(notes.every((note) => note.params._meta['io.modelcontextprotocol/subscriptionId'] === 7)).toBe(true);
    value.controller.abort();
    await pending;
    expect(value.close).toHaveBeenCalledTimes(1);
  });
  it('rejects unknown filters explicitly without creating a bridge', async () => {
    const value = tracked();
    await value.start({ unsupported: true });
    expect(value.response.statusCode).toBe(400);
    expect(value.close).not.toHaveBeenCalled();
  });
  it('terminates a setup burst at the queue bound before acknowledgement', async () => {
    const value = tracked();
    value.prepare.mockImplementation(async () => {
      for (let i = 0; i < 65; i++) value.notify({ method: 'notifications/tools/list_changed' });
      return { toolsListChanged: true };
    });
    await value.start({ toolsListChanged: true });
    expect(value.frames).toHaveLength(0);
    expect(value.response.destroyed).toBe(true);
    expect(value.close).toHaveBeenCalled();
  });
  it('a blocked subscriber cannot delay another and overflowing it closes only its stream', async () => {
    const slow = tracked();
    const fast = tracked();
    const p1 = slow.start({ toolsListChanged: true });
    const p2 = fast.start({ toolsListChanged: true });
    await vi.waitFor(() => expect(fast.frames).toHaveLength(1));
    slow.response.write.mockImplementation((frame) => {
      slow.frames.push(frame);
      return false;
    });
    slow.notify({ method: 'notifications/tools/list_changed' });
    await vi.waitFor(() => expect(slow.frames).toHaveLength(2));
    for (let i = 0; i < 65; i++) slow.notify({ method: 'notifications/tools/list_changed' });
    fast.notify({ method: 'notifications/tools/list_changed' });
    await vi.waitFor(() => expect(fast.frames).toHaveLength(2));
    expect(slow.response.destroyed).toBe(true);
    expect(fast.response.destroyed).toBe(false);
    fast.controller.abort();
    await Promise.all([p1, p2]);
  });
  it('revalidates authority before delivering queued notifications', async () => {
    const value = tracked();
    const pending = value.start({ toolsListChanged: true });
    await vi.waitFor(() => expect(value.frames).toHaveLength(1));
    authState.allowed = false;
    value.notify({ method: 'notifications/tools/list_changed' });
    await pending;
    expect(messages(value.frames).some((note) => note.method === 'notifications/tools/list_changed')).toBe(false);
    expect(messages(value.frames).at(-1)).toMatchObject({ id: 7, result: { resultType: 'complete' } });
  });
  it('retiring an unrelated provider does not terminate selected coverage', async () => {
    const value = tracked();
    value.connections.set('unrelated', { ...value.connection, capabilities: { prompts: {} } } as never);
    const pending = value.start({ toolsListChanged: true });
    await vi.waitFor(() => expect(value.frames).toHaveLength(1));
    value.connections.delete('unrelated');
    value.notify({ method: 'notifications/tools/list_changed' });
    await vi.waitFor(() => expect(value.frames).toHaveLength(2));
    expect(value.response.destroyed).toBe(false);
    value.controller.abort();
    await pending;
  });
  it('ends acknowledged catalog coverage when a new same-kind provider appears', async () => {
    const value = tracked();
    const pending = value.start({ toolsListChanged: true });
    await vi.waitFor(() => expect(value.frames).toHaveLength(1));
    value.connections.set('new-provider', { ...value.connection, capabilities: { tools: {} } } as never);
    value.notify({ method: 'notifications/tools/list_changed' });
    await pending;
    expect(messages(value.frames).at(-1)).toMatchObject({ result: { resultType: 'complete' } });
    expect(messages(value.frames).some((note) => note.method === 'notifications/tools/list_changed')).toBe(false);
  });

  it('aborts watch setup on disconnect and never starts later URI watches', async () => {
    const value = tracked();
    value.subscribe.mockImplementation(
      (_uri, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
        }),
    );
    const pending = value.start({ resourceSubscriptions: ['file:///first', 'file:///second'] });
    await vi.waitFor(() => expect(value.subscribe).toHaveBeenCalledTimes(1));
    value.controller.abort();
    await pending;
    expect(value.subscribe).toHaveBeenCalledTimes(1);
    expect(value.close).toHaveBeenCalledTimes(1);
    expect(value.frames).toHaveLength(0);
  });
  it('bounds process-wide setup even across managers and releases completed reservations', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const values = Array.from({ length: 32 }, () => tracked());
    for (const value of values)
      value.prepare.mockImplementation(async () => {
        await gate;
        return {};
      });
    const pending = values.map((value) => value.start());
    await vi.waitFor(() => expect(values.at(-1)!.prepare).toHaveBeenCalled());
    const extra = tracked();
    await extra.start();
    expect(extra.response.statusCode).toBe(503);
    for (const value of values) value.controller.abort();
    release();
    await Promise.all(pending);
    const recovered = tracked();
    const next = recovered.start();
    await vi.waitFor(() => expect(recovered.frames).toHaveLength(1));
    recovered.controller.abort();
    await next;
  });

  it('new subscriptions have no retained replay', async () => {
    const first = tracked();
    const pending = first.start({ toolsListChanged: true });
    await vi.waitFor(() => expect(first.frames).toHaveLength(1));
    first.notify({ method: 'notifications/tools/list_changed' });
    await vi.waitFor(() => expect(first.frames).toHaveLength(2));
    first.controller.abort();
    await pending;
    const second = tracked();
    const next = second.start({ toolsListChanged: true });
    await vi.waitFor(() => expect(second.frames).toHaveLength(1));
    expect(messages(second.frames)[0].method).toBe('notifications/subscriptions/acknowledged');
    second.controller.abort();
    await next;
  });
});
