import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendStdioSupervisor, type BackendSupervisionSnapshot } from './backendStdioSupervisor.js';

describe('BackendStdioSupervisor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-23T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses five default attempts with bounded exponential backoff', async () => {
    const recover = vi.fn().mockRejectedValue(new Error('still down'));
    const snapshots: BackendSupervisionSnapshot[] = [];
    const supervisor = new BackendStdioSupervisor({
      backendId: 'static:demo',
      policy: { restartOnExit: true },
      recover,
      onStateChange: (snapshot) => snapshots.push(snapshot),
    });

    supervisor.handleUnexpectedExit({ code: 17, signal: null, pid: 4242 });

    expect(supervisor.snapshot()).toMatchObject({
      state: 'restarting',
      attempt: 1,
      limit: 5,
      nextRetryAt: new Date('2026-07-23T00:00:01.000Z'),
      lastExit: { code: 17, signal: null, pid: 4242 },
    });

    for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000]) {
      await vi.advanceTimersByTimeAsync(delay);
    }

    expect(recover).toHaveBeenCalledTimes(5);
    expect(supervisor.snapshot()).toMatchObject({
      state: 'crash-loop',
      attempt: 5,
      limit: 5,
      nextRetryAt: null,
    });
    expect(snapshots.some((snapshot) => snapshot.state === 'crash-loop')).toBe(true);
  });

  it('treats maxRestarts zero as unlimited', async () => {
    const recover = vi.fn().mockRejectedValue(new Error('still down'));
    const supervisor = new BackendStdioSupervisor({
      backendId: 'static:demo',
      policy: { restartOnExit: true, maxRestarts: 0, restartDelay: 10 },
      recover,
    });

    supervisor.handleUnexpectedExit({ code: null, signal: 'SIGKILL' });
    for (const delay of [10, 20, 40, 80, 160, 160, 160]) {
      await vi.advanceTimersByTimeAsync(delay);
    }

    expect(recover).toHaveBeenCalledTimes(7);
    expect(supervisor.snapshot()).toMatchObject({ state: 'restarting', attempt: 8, limit: null });
  });

  it('resets the consecutive attempt counter after five stable minutes', async () => {
    const recover = vi.fn().mockResolvedValue({ pid: 9001 });
    const supervisor = new BackendStdioSupervisor({
      backendId: 'template:demo:abc',
      policy: { restartOnExit: true, maxRestarts: 2, restartDelay: 10 },
      recover,
    });

    supervisor.handleUnexpectedExit({ code: 1, signal: null });
    await vi.advanceTimersByTimeAsync(10);
    expect(supervisor.snapshot()).toMatchObject({ state: 'connected', attempt: 1, currentPid: 9001 });

    await vi.advanceTimersByTimeAsync(5 * 60 * 1_000);
    expect(supervisor.snapshot()).toMatchObject({ state: 'connected', attempt: 0, currentPid: 9001 });

    supervisor.handleUnexpectedExit({ code: 2, signal: null, pid: 9001 });
    expect(supervisor.snapshot()).toMatchObject({ state: 'restarting', attempt: 1 });
  });

  it('manual recovery resets the budget and starts immediately from crash-loop', async () => {
    const recover = vi.fn().mockRejectedValueOnce(new Error('automatic failed')).mockResolvedValueOnce({ pid: 9002 });
    const supervisor = new BackendStdioSupervisor({
      backendId: 'static:demo',
      policy: { restartOnExit: true, maxRestarts: 1, restartDelay: 10 },
      recover,
    });

    supervisor.handleUnexpectedExit({ code: 1, signal: null });
    await vi.advanceTimersByTimeAsync(10);
    expect(supervisor.snapshot().state).toBe('crash-loop');

    await supervisor.restartNow();

    expect(recover).toHaveBeenCalledTimes(2);
    expect(supervisor.snapshot()).toMatchObject({ state: 'connected', attempt: 0, currentPid: 9002 });
  });

  it('rejects an immediate manual recovery failure while preserving the scheduled automatic retry', async () => {
    const failure = new Error('manual recovery failed');
    const recover = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce({ pid: 9003 });
    const supervisor = new BackendStdioSupervisor({
      backendId: 'static:demo',
      policy: { restartOnExit: true, maxRestarts: 2, restartDelay: 25 },
      recover,
    });

    await expect(supervisor.restartNow()).rejects.toBe(failure);
    expect(supervisor.snapshot()).toMatchObject({
      state: 'restarting',
      attempt: 1,
      nextRetryAt: new Date('2026-07-23T00:00:00.025Z'),
      lastError: failure,
    });

    await vi.advanceTimersByTimeAsync(25);

    expect(recover).toHaveBeenCalledTimes(2);
    expect(supervisor.snapshot()).toMatchObject({ state: 'connected', attempt: 1, currentPid: 9003 });
  });

  it('cancels pending and in-progress recovery without allowing stale completion', async () => {
    let completeDisposal!: () => void;
    const disposal = new Promise<void>((resolve) => {
      completeDisposal = resolve;
    });
    const dispose = vi.fn(() => disposal);
    let completeRecovery: ((value: { pid: number; dispose: () => void }) => void) | undefined;
    const recover = vi.fn(
      (_signal: AbortSignal) =>
        new Promise<{ pid: number; dispose: () => void }>((resolve) => {
          completeRecovery = resolve;
        }),
    );
    const supervisor = new BackendStdioSupervisor({
      backendId: 'template:demo:abc',
      policy: { restartOnExit: true, restartDelay: 10 },
      recover,
    });

    supervisor.handleUnexpectedExit({ code: 1, signal: null });
    await vi.advanceTimersByTimeAsync(10);
    expect(recover).toHaveBeenCalledTimes(1);

    let stopResolved = false;
    const stopPromise = supervisor.stop().then(() => {
      stopResolved = true;
    });
    await Promise.resolve();

    expect(stopResolved).toBe(false);

    completeRecovery?.({ pid: 9999, dispose });
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));

    expect(stopResolved).toBe(false);

    completeDisposal();
    await stopPromise;

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(stopResolved).toBe(true);
    expect(supervisor.snapshot()).toMatchObject({ state: 'stopped', currentPid: null, nextRetryAt: null });
  });
});
