import {
  createLegacyTimeoutMs,
  ErrorCode,
  type JsonValue,
  type LegacySdkRequest,
  OneMcpProtocolError,
} from '@src/sdk/contracts/index.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMockLegacySdkAdapter } from '../../../test/unit-utils/MockFactories.js';
import { BackendSleep } from './backendSleep.js';
import { BackendSleepAdapter } from './backendSleepAdapter.js';

afterEach(() => vi.useRealTimers());

describe('Backend Sleep adapter', () => {
  it('rejects missing cached discovery pages without waking while preserving valid cached pagination', async () => {
    vi.useFakeTimers();
    const request = vi.fn(async ({ params }: LegacySdkRequest): Promise<JsonValue> => {
      if (params && typeof params === 'object' && !Array.isArray(params) && params.cursor === 'next') {
        return { tools: [{ name: 'second', inputSchema: { type: 'object' } }] };
      }
      return { tools: [{ name: 'first', inputSchema: { type: 'object' } }], nextCursor: 'next' };
    });
    const wake = vi.fn(async () => {});
    const lifecycle = new BackendSleep({ idleTimeoutMs: 30_000, release: async () => {}, wake, isCurrent: () => true });
    const adapter = new BackendSleepAdapter(createMockLegacySdkAdapter({ request }), lifecycle);
    await adapter.refresh({ tools: {} });
    lifecycle.ready();
    await vi.advanceTimersByTimeAsync(30_000);
    try {
      await expect(
        adapter.request({ id: 'valid' as LegacySdkRequest['id'], method: 'tools/list', params: { cursor: 'next' } }),
      ).resolves.toEqual({ tools: [{ name: 'second', inputSchema: { type: 'object' } }] });
      await expect(
        adapter.request({ id: 'stale' as LegacySdkRequest['id'], method: 'tools/list', params: { cursor: 'missing' } }),
      ).rejects.toMatchObject({ code: -32602 });
      expect(wake).not.toHaveBeenCalled();
      expect(request).toHaveBeenCalledTimes(2);
    } finally {
      lifecycle.stop();
    }
  });

  it.each(['cancel', 'deadline'] as const)(
    'returns promptly on %s after dispatch without waiting for upstream completion',
    async (stop) => {
      vi.useFakeTimers();
      let complete!: (value: { messages: [] }) => void;
      const request = vi.fn(
        () =>
          new Promise<{ messages: [] }>((resolve) => {
            complete = resolve;
          }),
      );
      const lifecycle = new BackendSleep({
        idleTimeoutMs: 30_000,
        release: async () => {},
        wake: async () => {},
        isCurrent: () => true,
      });
      const adapter = new BackendSleepAdapter(createMockLegacySdkAdapter({ request }), lifecycle);
      lifecycle.ready();
      let outcome = 'pending';
      const id = 'prompt' as LegacySdkRequest['id'];
      const pending = adapter.request({ id, method: 'prompts/get', timeoutMs: createLegacyTimeoutMs(100) }).then(
        () => {
          outcome = 'resolved';
        },
        () => {
          outcome = 'rejected';
        },
      );
      try {
        await vi.advanceTimersByTimeAsync(0);
        expect(request).toHaveBeenCalledTimes(1);
        if (stop === 'cancel') await adapter.cancel(id);
        else await vi.advanceTimersByTimeAsync(100);
        await vi.advanceTimersByTimeAsync(0);
        expect(outcome).toBe('rejected');
      } finally {
        complete({ messages: [] });
        await pending;
        lifecycle.stop();
      }
    },
  );

  it('deducts wake latency from the dispatched request deadline', async () => {
    vi.useFakeTimers();
    const request = vi.fn(async () => ({ messages: [] }));
    let finishWake!: () => void;
    const lifecycle = new BackendSleep({
      idleTimeoutMs: 30_000,
      release: async () => {},
      wake: () =>
        new Promise<void>((resolve) => {
          finishWake = resolve;
        }),
      isCurrent: () => true,
    });
    const adapter = new BackendSleepAdapter(createMockLegacySdkAdapter({ request }), lifecycle);
    lifecycle.ready();
    await vi.advanceTimersByTimeAsync(30_000);
    try {
      const pending = adapter.request({
        id: 'prompt' as LegacySdkRequest['id'],
        method: 'prompts/get',
        timeoutMs: createLegacyTimeoutMs(100),
      });
      await vi.advanceTimersByTimeAsync(60);
      finishWake();
      await expect(pending).resolves.toEqual({ messages: [] });
      expect(request).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 40 }));
    } finally {
      lifecycle.stop();
    }
  });

  it('retains resource discovery when the backend does not implement templates', async () => {
    vi.useFakeTimers();
    const request = vi.fn(async ({ method }: LegacySdkRequest) => {
      if (method === 'resources/templates/list')
        throw new OneMcpProtocolError(ErrorCode.MethodNotFound, 'Method not found');
      return { resources: [{ name: 'document', uri: 'file:///document' }] };
    });
    const lifecycle = new BackendSleep({
      idleTimeoutMs: 30_000,
      release: async () => {},
      wake: async () => {},
      isCurrent: () => true,
    });
    const adapter = new BackendSleepAdapter(createMockLegacySdkAdapter({ request }), lifecycle);
    try {
      await adapter.refresh({ resources: {} });
      lifecycle.ready();
      await vi.advanceTimersByTimeAsync(30_000);
      await expect(
        adapter.request({ id: 'templates' as LegacySdkRequest['id'], method: 'resources/templates/list' }),
      ).resolves.toEqual({ resourceTemplates: [] });
      await expect(
        adapter.request({ id: 'resources' as LegacySdkRequest['id'], method: 'resources/list' }),
      ).resolves.toEqual({ resources: [{ name: 'document', uri: 'file:///document' }] });
      expect(lifecycle.snapshot().state).toBe('sleeping');
    } finally {
      lifecycle.stop();
    }
  });

  it('serves retained discovery without starting a sleeping backend', async () => {
    vi.useFakeTimers();
    const request = vi.fn(async () => ({ tools: [{ name: 'hello', inputSchema: { type: 'object' } }] }));
    const wake = vi.fn(async () => {});
    const lifecycle = new BackendSleep({ idleTimeoutMs: 30_000, release: async () => {}, wake, isCurrent: () => true });
    const adapter = new BackendSleepAdapter(createMockLegacySdkAdapter({ request }), lifecycle);
    await adapter.refresh({ tools: {} });
    lifecycle.ready();
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await adapter.request({ id: 'list' as LegacySdkRequest['id'], method: 'tools/list' });
    expect(result).toEqual({ tools: [{ name: 'hello', inputSchema: { type: 'object' } }] });
    expect(wake).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
    lifecycle.stop();
  });
  it('rejects a changed operation contract after wake without dispatching stale arguments', async () => {
    vi.useFakeTimers();
    const original = createMockLegacySdkAdapter({
      request: vi.fn(async () => ({ tools: [{ name: 'hello', inputSchema: { type: 'object' } }] })),
    });
    const replacementRequest = vi.fn(async () => ({ tools: [{ name: 'hello', inputSchema: { type: 'string' } }] }));
    let adapter!: BackendSleepAdapter;
    const lifecycle = new BackendSleep({
      idleTimeoutMs: 30_000,
      release: async () => {},
      isCurrent: () => true,
      wake: async () => {
        adapter.current = createMockLegacySdkAdapter({ request: replacementRequest });
        await adapter.refresh({ tools: {} });
      },
    });
    adapter = new BackendSleepAdapter(original, lifecycle);
    await adapter.refresh({ tools: {} });
    lifecycle.ready();
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(
      adapter.request({
        id: 'call' as LegacySdkRequest['id'],
        method: 'tools/call',
        params: { name: 'hello', arguments: {} },
      }),
    ).rejects.toThrow(/changed/);
    expect(replacementRequest).toHaveBeenCalledTimes(1);
    lifecycle.stop();
  });

  it.each(['cancel', 'deadline'] as const)(
    'does not dispatch a prompt stopped by %s during shared startup',
    async (stop) => {
      vi.useFakeTimers();
      let complete!: () => void;
      const request = vi.fn(async () => ({ content: [] }));
      const lifecycle = new BackendSleep({
        idleTimeoutMs: 30_000,
        release: async () => {},
        wake: () =>
          new Promise<void>((resolve) => {
            complete = resolve;
          }),
        isCurrent: () => true,
      });
      const adapter = new BackendSleepAdapter(createMockLegacySdkAdapter({ request }), lifecycle);
      lifecycle.ready();
      await vi.advanceTimersByTimeAsync(30_000);
      const id = 'cancelled' as LegacySdkRequest['id'];
      const pending = adapter
        .request({ id, method: 'prompts/get', timeoutMs: createLegacyTimeoutMs(100) })
        .catch((error: Error) => error.message);
      await Promise.resolve();
      if (stop === 'cancel') await adapter.cancel(id);
      else await vi.advanceTimersByTimeAsync(100);
      complete();
      expect(await pending).toMatch(/cancelled/);
      expect(request).not.toHaveBeenCalled();
      lifecycle.stop();
    },
  );
});
