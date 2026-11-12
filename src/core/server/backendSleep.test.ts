import {
  CancelledNotificationSchema,
  SubscriptionsAcknowledgedNotificationSchema,
  SubscriptionsListenRequestSchema,
} from '@modelcontextprotocol/core';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { BackendSleep } from './backendSleep.js';

afterEach(() => vi.useRealTimers());

describe('Backend Sleep lifecycle', () => {
  it.each(['tools/call', 'resources/read', 'tasks/get'] as const)(
    'does not treat server cancellation as completion of %s',
    async (method) => {
      vi.useFakeTimers();
      const release = vi.fn(async () => {});
      const backend = new BackendSleep({ idleTimeoutMs: 30_000, release, wake: async () => {}, isCurrent: () => true });
      backend.ready();
      backend.sent({ id: 'ordinary', method });
      backend.received({ method: 'notifications/cancelled', params: { requestId: 'ordinary' } });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(backend.snapshot().blockers).toEqual(['requests:1']);
      expect(release).not.toHaveBeenCalled();
      backend.stop();
    },
  );

  it('settles only the cancelled listen and preserves uncertainty from reused IDs', () => {
    const backend = new BackendSleep({ release: async () => {}, wake: async () => {}, isCurrent: () => true });
    backend.ready();
    const params = { notifications: { resourceSubscriptions: ['file:///resource'] } };
    backend.sent({ id: 'listen:0', method: 'subscriptions/listen', params });
    backend.sent({ id: 'listen:1', method: 'subscriptions/listen', params });
    backend.sent({ id: 'listen:1', method: 'subscriptions/listen', params });
    backend.received({ method: 'notifications/cancelled', params: { requestId: 'listen:0' } });
    expect(backend.snapshot().blockers).toEqual(['uncertain-completion', 'requests:1']);
    backend.received({ method: 'notifications/cancelled', params: { requestId: 'listen:1' } });
    expect(backend.snapshot().blockers).toEqual(['uncertain-completion']);
    backend.stop();
  });

  it('starts a fresh idle window only after the server confirms modern listen cancellation', async () => {
    vi.useFakeTimers();
    const release = vi.fn(async () => {});
    const backend = new BackendSleep({ idleTimeoutMs: 30_000, release, wake: async () => {}, isCurrent: () => true });
    const id = 'listen:0';
    const filter = { resourceSubscriptions: ['file:///resource'] };
    const cancelled = CancelledNotificationSchema.parse({
      method: 'notifications/cancelled',
      params: { requestId: id },
    });
    backend.ready();
    backend.sent({
      ...SubscriptionsListenRequestSchema.parse({ method: 'subscriptions/listen', params: { notifications: filter } }),
      id,
    });
    backend.received(
      SubscriptionsAcknowledgedNotificationSchema.parse({
        method: 'notifications/subscriptions/acknowledged',
        params: { notifications: filter, _meta: { 'io.modelcontextprotocol/subscriptionId': id } },
      }),
    );
    backend.sent(cancelled);
    backend.received({ method: 'notifications/cancelled', params: { requestId: 'unrelated' } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(backend.snapshot().blockers).toEqual(['requests:1']);
    expect(release).not.toHaveBeenCalled();
    backend.received(cancelled);
    expect(backend.snapshot().blockers).toEqual([]);
    expect(backend.snapshot().lastActivityAt).toBe(Date.now());
    await vi.advanceTimersByTimeAsync(29_999);
    expect(release).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(release).toHaveBeenCalledOnce();
    backend.stop();
  });

  it('starts the idle window at readiness and releases only at the timeout boundary', async () => {
    vi.useFakeTimers();
    const release = vi.fn(async () => {});
    const backend = new BackendSleep({ idleTimeoutMs: 60_000, release, wake: async () => {}, isCurrent: () => true });
    await vi.advanceTimersByTimeAsync(90_000);
    expect(release).not.toHaveBeenCalled();
    backend.ready();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(release).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(backend.snapshot().state).toBe('sleeping');
    backend.stop();
  });
  it('retains upstream work through cancellation until its response arrives', async () => {
    vi.useFakeTimers();
    const release = vi.fn(async () => {});
    const backend = new BackendSleep({ idleTimeoutMs: 30_000, release, wake: async () => {}, isCurrent: () => true });
    backend.ready();
    backend.sent({ id: 1, method: 'tools/call', params: { name: 'work' } });
    backend.sent({ method: 'notifications/cancelled', params: { requestId: 1 } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(release).not.toHaveBeenCalled();
    expect(backend.snapshot().blockers).toContain('requests:1');
    backend.received({ id: 1, result: {} });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(release).toHaveBeenCalledTimes(1);
    backend.stop();
  });

  it('keeps subscriptions and asynchronous tasks busy until explicit completion', async () => {
    vi.useFakeTimers();
    const release = vi.fn(async () => {});
    const backend = new BackendSleep({ idleTimeoutMs: 30_000, release, wake: async () => {}, isCurrent: () => true });
    backend.ready();
    backend.sent({ id: 1, method: 'resources/subscribe', params: { uri: 'file:///a' } });
    backend.received({ id: 1, result: {} });
    backend.sent({ id: 2, method: 'tools/call' });
    backend.received({ id: 2, result: { task: { taskId: 'job', status: 'working' } } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(release).not.toHaveBeenCalled();
    expect(backend.snapshot().blockers).toEqual(['subscriptions:1', 'tasks:1']);
    backend.sent({ id: 3, method: 'resources/unsubscribe', params: { uri: 'file:///a' } });
    backend.received({ id: 3, result: {} });
    backend.received({ method: 'notifications/tasks/status', params: { taskId: 'job', status: 'completed' } });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(release).toHaveBeenCalledTimes(1);
    backend.stop();
  });

  it('shares one wake attempt and leaves cancelled callers independent', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const wake = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const backend = new BackendSleep({ idleTimeoutMs: 30_000, release: async () => {}, wake, isCurrent: () => true });
    backend.ready();
    await vi.advanceTimersByTimeAsync(30_000);
    const caller = new AbortController();
    const first = backend.ensureAwake(caller.signal).catch((error: Error) => error.message);
    const second = backend.ensureAwake();
    caller.abort();
    finish();
    expect(await first).toMatch(/cancelled/);
    await second;
    expect(wake).toHaveBeenCalledTimes(1);
    expect(backend.snapshot().state).toBe('awake');
    backend.stop();
  });

  it('retries failed wake only on a later request after cooldown', async () => {
    vi.useFakeTimers();
    const wake = vi.fn().mockRejectedValueOnce(new Error('startup failed')).mockResolvedValue(undefined);
    const backend = new BackendSleep({ idleTimeoutMs: 30_000, release: async () => {}, wake, isCurrent: () => true });
    backend.ready();
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(backend.ensureAwake()).rejects.toThrow('startup failed');
    await expect(backend.ensureAwake()).rejects.toThrow('cooldown');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(wake).toHaveBeenCalledTimes(1);
    await backend.ensureAwake();
    expect(wake).toHaveBeenCalledTimes(2);
    backend.stop();
  });

  it('does not reset idle time for discovery', async () => {
    vi.useFakeTimers();
    const release = vi.fn(async () => {});
    const backend = new BackendSleep({ idleTimeoutMs: 60_000, release, wake: async () => {}, isCurrent: () => true });
    backend.ready();
    await vi.advanceTimersByTimeAsync(30_000);
    backend.sent({ id: 1, method: 'tools/list' });
    backend.received({ id: 1, result: { tools: [] } });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(release).toHaveBeenCalledTimes(1);
    backend.stop();
  });

  it('does not wake after uncertain release and does not publish a stopped wake', async () => {
    vi.useFakeTimers();
    const wake = vi.fn(async () => {});
    const backend = new BackendSleep({
      idleTimeoutMs: 30_000,
      release: async () => {
        throw new Error('exit not verified');
      },
      wake,
      isCurrent: () => true,
    });
    backend.ready();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(backend.snapshot().state).toBe('release-failed');
    await expect(backend.ensureAwake()).rejects.toThrow(/ownership/);
    expect(wake).not.toHaveBeenCalled();
    backend.stop();
    await expect(backend.ensureAwake()).rejects.toThrow(/removed/);
  });

  it('blocks release when exclusive process ownership cannot be verified', async () => {
    vi.useFakeTimers();
    const release = vi.fn(async () => {});
    const backend = new BackendSleep({
      idleTimeoutMs: 30_000,
      release,
      wake: async () => {},
      isCurrent: () => true,
      ownershipBlocker: () => 'ownership-unverified',
    });
    backend.ready();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(release).not.toHaveBeenCalled();
    expect(backend.snapshot().blockers).toContain('ownership-unverified');
    backend.stop();
  });
  it('keeps dispatch admission busy until the caller releases its reservation', async () => {
    vi.useFakeTimers();
    const release = vi.fn(async () => {});
    const backend = new BackendSleep({ idleTimeoutMs: 30_000, release, wake: async () => {}, isCurrent: () => true });
    backend.ready();
    const finish = backend.reserve();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(release).not.toHaveBeenCalled();
    finish();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(release).toHaveBeenCalledTimes(1);
    backend.stop();
  });

  it('ignores catalog listen streams but retains modern resource streams until their terminal response', async () => {
    vi.useFakeTimers();
    const release = vi.fn(async () => {});
    const backend = new BackendSleep({ idleTimeoutMs: 30_000, release, wake: async () => {}, isCurrent: () => true });
    backend.ready();
    backend.sent({ id: 1, method: 'subscriptions/listen', params: { notifications: { toolsListChanged: true } } });
    backend.sent({
      id: 2,
      method: 'subscriptions/listen',
      params: { notifications: { resourceSubscriptions: ['file:///a'] } },
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(release).not.toHaveBeenCalled();
    backend.received({ id: 2, result: {} });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(release).toHaveBeenCalledTimes(1);
    backend.stop();
  });

  it('lets every caller cancel while the bounded wake finishes independently', async () => {
    vi.useFakeTimers();
    let complete!: () => void;
    const backend = new BackendSleep({
      idleTimeoutMs: 30_000,
      release: async () => {},
      wake: () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
      isCurrent: () => true,
    });
    backend.ready();
    await vi.advanceTimersByTimeAsync(30_000);
    const signal = new AbortController();
    const pending = backend.ensureAwake(signal.signal).catch((error: Error) => error.message);
    signal.abort();
    expect(await pending).toMatch(/cancelled/);
    expect(backend.snapshot().state).toBe('waking');
    complete();
    await vi.advanceTimersByTimeAsync(0);
    expect(backend.snapshot().state).toBe('awake');
    backend.stop();
  });
});
