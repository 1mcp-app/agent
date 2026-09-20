import { Client as ModernClient } from '@modelcontextprotocol/client';

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { requestLegacyAdapter } from '@src/core/client/legacyAdapterRequest.js';
import { runtimeAdmission } from '@src/core/server/runtimeDrain.js';
import { Client } from '@src/sdk/legacy/client/index.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { observeBackendDispatchLifetime } from './backendDispatchLifetime.js';
import { LegacySdkClientAdapter } from './legacySdkClientAdapter.js';
import type { AuthProviderTransport } from './legacyTransport.js';
import { ModernSdkClientAdapter } from './modernSdkClientAdapter.js';

async function fixture(era: 'legacy' | 'modern' = 'legacy') {
  const [transport, backend] = InMemoryTransport.createLinkedPair();
  let pendingId: string | number | undefined;
  let calls = 0;
  let cancellations = 0;
  backend.onmessage = (message) => {
    if (!('method' in message)) return;
    if (message.method === 'notifications/cancelled') {
      cancellations++;
      return;
    }
    if (!('id' in message)) return;
    if (message.method === 'initialize') {
      void backend.send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: (message.params as { protocolVersion: string }).protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'ignores-cancellation', version: '1' },
        },
      });
    } else if (message.method === 'tools/call') {
      pendingId = message.id;
      calls++;
    }
  };
  await backend.start();
  const client =
    era === 'legacy'
      ? new Client({ name: 'drain-test', version: '1' }, { capabilities: {} })
      : new ModernClient({ name: 'drain-test', version: '2' });
  client.onerror = () => undefined; // Late responses are ignored by the SDK's already-cancelled waiter.
  await client.connect(transport);
  const adapter =
    client instanceof Client
      ? new LegacySdkClientAdapter(client, transport)
      : new ModernSdkClientAdapter(client, transport);
  return {
    adapter,
    transport,
    get calls() {
      return calls;
    },
    get cancellations() {
      return cancellations;
    },
    complete: async () => {
      if (pendingId === undefined) throw new Error('No dispatched request');
      await backend.send({ jsonrpc: '2.0', id: pendingId, result: { content: [] } });
    },
    close: async () => {
      await adapter.close();
      await backend.close();
    },
  };
}

afterEach(() => {
  runtimeAdmission.resume();
  vi.useRealTimers();
});

describe('backend dispatch lifetime', () => {
  it.each([
    ['legacy', 'cancel'],
    ['legacy', 'timeout'],
    ['modern', 'cancel'],
    ['modern', 'timeout'],
  ] as const)('keeps real %s SDK work counted after %s until the late wire response', async (era, mode) => {
    const peer = await fixture(era);
    vi.useFakeTimers();
    try {
      const abort = new AbortController();
      const call = requestLegacyAdapter(
        peer.adapter,
        'tools/call',
        { name: 'slow' },
        { signal: abort.signal, timeoutMs: 100 },
      );
      const rejected = expect(call).rejects.toBeDefined();
      await vi.advanceTimersByTimeAsync(0);
      expect(peer.calls).toBe(1);
      if (mode === 'cancel') abort.abort();
      else await vi.advanceTimersByTimeAsync(100);
      await rejected;
      expect(peer.cancellations).toBe(1);
      expect(runtimeAdmission.close()).toMatchObject({ active: 1, closed: true });
      expect(() => runtimeAdmission.commit()).toThrow('not drained');
      await peer.complete();
      expect(runtimeAdmission.snapshot().active).toBe(0);
      expect(peer.calls).toBe(1);
    } finally {
      await peer.close();
    }
  });

  it('does not count background SDK requests without an admitted root', async () => {
    const peer = await fixture();
    try {
      const call = peer.adapter.request({ id: 'background' as never, method: 'tools/call', params: { name: 'slow' } });
      await vi.waitFor(() => expect(peer.calls).toBe(1));
      expect(runtimeAdmission.snapshot().active).toBe(0);
      await peer.complete();
      await call;
    } finally {
      await peer.close();
    }
  });

  it('preserves reinstalled SDK callbacks, exact transport identity, and fail-closed disconnect accounting', async () => {
    const receive = vi.fn();
    const transport: AuthProviderTransport = {
      start: async () => {},
      send: async () => {},
      close: async () => {},
      onmessage: receive,
    };
    const other: AuthProviderTransport = { start: async () => {}, send: async () => {}, close: async () => {} };
    observeBackendDispatchLifetime(transport);
    observeBackendDispatchLifetime(other);
    await runtimeAdmission.run(async () => {
      await transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/call' });
    });
    expect(runtimeAdmission.snapshot().active).toBe(1);
    other.onmessage?.({ jsonrpc: '2.0', id: 1, result: {} });
    transport.onclose?.();
    expect(runtimeAdmission.snapshot().active).toBe(1);
    const reconnectedReceive = vi.fn();
    transport.onmessage = reconnectedReceive;
    observeBackendDispatchLifetime(transport);
    transport.onmessage?.({ jsonrpc: '2.0', id: 1, result: {} });
    expect(runtimeAdmission.snapshot().active).toBe(0);
    expect(reconnectedReceive).toHaveBeenCalledOnce();
    expect(receive).not.toHaveBeenCalled();
  });
});
