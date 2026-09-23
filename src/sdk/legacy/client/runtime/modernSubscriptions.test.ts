import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler, Server } from '@modelcontextprotocol/server';

import { describe, expect, it, vi } from 'vitest';

import type { AuthProviderTransport } from './legacyTransport.js';
import { ModernSdkClientAdapter } from './modernSdkClientAdapter.js';
import {
  ensureModernSubscriptionCoverage,
  openModernSubscription,
  registerModernSubscriptions,
} from './modernSubscriptions.js';

const idKey = 'io.modelcontextprotocol/subscriptionId';

function fakePeer() {
  const client = new Client({ name: 'test', version: '1' });
  const connection = {};
  const transport: AuthProviderTransport = { start: async () => {}, send: async () => {}, close: async () => {} };
  const pending: Array<{ id: string; accept: () => void; end: () => void; signal?: AbortSignal }> = [];
  vi.spyOn(client, 'listen').mockImplementation((filter, options) => {
    const id = `listen:${pending.length}`;
    void transport.send({ jsonrpc: '2.0', id, method: 'subscriptions/listen', params: { notifications: filter } });
    let end!: () => void;
    const closed = new Promise<'remote'>((resolve) => {
      end = () => resolve('remote');
    });
    return new Promise((resolve, reject) => {
      const close = async () => {
        end();
      };
      options?.signal?.addEventListener(
        'abort',
        () => {
          end();
          reject(new Error('aborted'));
        },
        { once: true },
      );
      pending.push({
        id,
        signal: options?.signal,
        end,
        accept: () => resolve({ honoredFilter: filter, close, closed }),
      });
    });
  });
  registerModernSubscriptions(connection, client, transport, async (filter) => filter);
  const emit = (id: string, uri = 'test://resource') =>
    transport.onmessage?.({
      jsonrpc: '2.0',
      method: 'notifications/resources/updated',
      params: { uri, _meta: { [idKey]: id } },
    });
  return { connection, pending, emit, client, transport };
}

describe('modern subscription ownership', () => {
  it('demultiplexes two simultaneous same-URI listens and buffers notifications until acknowledgement', async () => {
    const peer = fakePeer();
    const first = vi.fn();
    const second = vi.fn();
    const firstOpen = openModernSubscription(
      peer.connection,
      { resourceSubscriptions: ['test://resource'] },
      first,
      vi.fn(),
    );
    const secondOpen = openModernSubscription(
      peer.connection,
      { resourceSubscriptions: ['test://resource'] },
      second,
      vi.fn(),
    );
    peer.emit(peer.pending[0].id);
    expect(first).not.toHaveBeenCalled();
    peer.pending[1].accept();
    peer.pending[0].accept();
    const [one, two] = await Promise.all([firstOpen, secondOpen]);
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    await one.close();
    peer.emit(peer.pending[0].id);
    peer.emit(peer.pending[1].id);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    await two.close();
  });

  it('aborts overflowing setup and reports coverage loss once', async () => {
    const peer = fakePeer();
    const lost = vi.fn();
    const opening = openModernSubscription(
      peer.connection,
      { resourceSubscriptions: ['test://resource'] },
      vi.fn(),
      lost,
    );
    for (let i = 0; i < 65; i++) peer.emit(peer.pending[0].id);
    await expect(opening).rejects.toThrow('aborted');
    expect(peer.pending[0].signal?.aborted).toBe(true);
    expect(lost).toHaveBeenCalledOnce();
  });

  it('cancels a pending setup without leaving its notification callback live', async () => {
    const peer = fakePeer();
    const controller = new AbortController();
    const note = vi.fn();
    const lost = vi.fn();
    const opening = openModernSubscription(peer.connection, {}, note, lost, controller.signal);
    controller.abort();
    await expect(opening).rejects.toThrow('aborted');
    peer.emit(peer.pending[0].id);
    expect(note).not.toHaveBeenCalled();
    expect(lost).not.toHaveBeenCalled();
  });

  it('relays remote closure only to its owner', async () => {
    const peer = fakePeer();
    const lost = vi.fn();
    const opening = openModernSubscription(
      peer.connection,
      { resourceSubscriptions: ['test://resource'] },
      vi.fn(),
      lost,
    );
    peer.pending[0].accept();
    const handle = await opening;
    peer.pending[0].end();
    await Promise.resolve();
    expect(lost).toHaveBeenCalledOnce();
    await handle.close();
    expect(lost).toHaveBeenCalledOnce();
  });

  it('enforces process-wide admission across independent connections and releases cancelled setups', async () => {
    const peer = fakePeer();
    const controllers = Array.from({ length: 1024 }, () => new AbortController());
    const openings = controllers.map((controller) =>
      openModernSubscription(peer.connection, {}, vi.fn(), vi.fn(), controller.signal),
    );
    const other = fakePeer();
    await expect(openModernSubscription(other.connection, {}, vi.fn(), vi.fn())).rejects.toThrow('admission exhausted');
    for (const controller of controllers) controller.abort();
    await Promise.allSettled(openings);
    const next = openModernSubscription(other.connection, {}, vi.fn(), vi.fn());
    other.pending[0].accept();
    await (await next).close();
  });

  it('filters unexpected URI and notification types even when the peer sends them', async () => {
    const peer = fakePeer();
    const notify = vi.fn();
    const opening = openModernSubscription(
      peer.connection,
      { resourceSubscriptions: ['test://resource'] },
      notify,
      vi.fn(),
    );
    peer.pending[0].accept();
    const handle = await opening;
    peer.emit(peer.pending[0].id, 'test://resource/child');
    expect(notify).not.toHaveBeenCalled();
    peer.emit(peer.pending[0].id);
    expect(notify).toHaveBeenCalledOnce();
    await handle.close();
  });

  it('terminates overflowing catalog coverage without closing unrelated interactions', async () => {
    const peer = fakePeer();
    vi.spyOn(peer.client, 'getProtocolEra').mockReturnValue('modern');
    vi.spyOn(peer.client, 'getNegotiatedProtocolVersion').mockReturnValue('2026-07-28');
    vi.spyOn(peer.client, 'getServerCapabilities').mockReturnValue({ tools: { listChanged: true } });
    const adapter = new ModernSdkClientAdapter(peer.client, peer.transport);
    const starting = adapter.start();
    peer.pending[0].accept();
    await starting;
    for (let index = 0; index < 80; index++) {
      peer.transport.onmessage?.({
        jsonrpc: '2.0',
        method: 'notifications/tools/list_changed',
        params: { _meta: { [idKey]: peer.pending[0].id } },
      });
    }
    expect(await adapter.nextEvent()).toMatchObject({
      type: 'notification',
      notification: { method: 'notifications/1mcp/subscription_lost', params: { catalog: true } },
    });
    await Promise.resolve();
    expect(peer.pending[0].signal?.aborted).toBe(true);
    expect(adapter.state).toBe('running');
    vi.spyOn(peer.client, 'request').mockResolvedValue({ content: [] } as never);
    await expect(
      adapter.request({ id: 'unrelated' as never, method: 'tools/call', params: { name: 'read' } }),
    ).resolves.toEqual({ content: [] });
    const renewed = ensureModernSubscriptionCoverage(adapter, { toolsListChanged: true });
    peer.pending[1].accept();
    expect(await renewed).toEqual({ toolsListChanged: true });
    await adapter.close();
  });

  it('captures real pinned SDK stream IDs and accepted filters', async () => {
    const handler = createMcpHandler(
      () =>
        new Server(
          { name: 'peer', version: '1' },
          { capabilities: { resources: { subscribe: true, listChanged: true } } },
        ),
      { legacy: 'reject' },
    );
    const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
      fetch: async (input, init) => handler.fetch(new Request(input, init)),
    });
    const client = new Client(
      { name: 'gateway', version: '1' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );
    await client.connect(transport);
    const adapter = new ModernSdkClientAdapter(client, transport as unknown as AuthProviderTransport);
    try {
      const subscription = await openModernSubscription(
        adapter,
        { toolsListChanged: true, resourceSubscriptions: ['test://resource'] },
        vi.fn(),
        vi.fn(),
      );
      expect(subscription.honoredFilter).toEqual({ resourceSubscriptions: ['test://resource'] });
      expect(
        await ensureModernSubscriptionCoverage(adapter, { resourcesListChanged: true, toolsListChanged: true }),
      ).toEqual({ resourcesListChanged: true });
      await subscription.close();
      const request = vi.spyOn(client, 'request');
      await adapter.request({
        id: 'watch' as never,
        method: 'resources/subscribe',
        params: { uri: 'test://resource' },
      });
      await adapter.request({
        id: 'unwatch' as never,
        method: 'resources/unsubscribe',
        params: { uri: 'test://resource' },
      });
      expect(request).not.toHaveBeenCalled();
    } finally {
      await adapter.close();
    }
  });
});
