import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendStdioSupervisor, type BackendSupervisionSnapshot } from './backendStdioSupervisor.js';

// Mirrors ClientManager.applyBackendSupervisionState(): the gateway clears a
// backend's capabilities/instructions while it is restarting or crash-looping,
// and preserves them once it is connected. The 'connected' branch deliberately
// does NOT re-populate them — they are restored by the recovery's activate()
// step. We replicate this here so the supervisor ordering fix can be asserted
// end-to-end without pulling in ClientManager.
interface GatewayConnection {
  status: 'connected' | 'restarting' | 'crash-loop';
  capabilities?: { tools?: Record<string, unknown> };
  instructions?: string;
}

function applyGatewaySupervision(conn: GatewayConnection, snapshot: BackendSupervisionSnapshot): void {
  if (snapshot.state === 'restarting' || snapshot.state === 'crash-loop') {
    conn.status = snapshot.state;
    conn.capabilities = undefined;
    // Instructions are aggregated from backends; static backends drop them on
    // restart so stale instructions are not served (see clientManager.ts).
    if (snapshot.backendId.startsWith('static:')) {
      conn.instructions = undefined;
    }
  } else if (snapshot.state === 'connected') {
    conn.status = 'connected';
  }
}

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

  it('preserves capabilities and instructions across a manual restart (#547)', async () => {
    const conn: GatewayConnection = { status: 'connected', capabilities: { tools: {} }, instructions: 'initial' };
    let activateCalls = 0;
    let supervisor!: BackendStdioSupervisor;
    const recover = vi.fn().mockImplementation(async () => ({
      pid: 7001,
      activate: () => {
        activateCalls += 1;
        // Production activate() swaps in the recovered client, restoring its
        // capabilities/instructions, then re-applies supervision state with the
        // CURRENT supervisor state.
        conn.capabilities = { tools: {} };
        conn.instructions = 'recovered';
        applyGatewaySupervision(conn, supervisor.snapshot());
      },
      dispose: vi.fn(),
    }));
    supervisor = new BackendStdioSupervisor({
      backendId: 'static:demo',
      policy: { restartOnExit: true },
      recover,
      onStateChange: (snapshot) => applyGatewaySupervision(conn, snapshot),
    });

    expect(conn.capabilities).toBeDefined();
    expect(conn.instructions).toBe('initial');

    await supervisor.restartNow();

    expect(recover).toHaveBeenCalledTimes(1);
    expect(activateCalls).toBe(1);
    // The gateway must still see the backend's capabilities and instructions
    // after recovery. The #547 regression was that activate() ran while the
    // state was still 'restarting', so the gateway cleared them.
    expect(conn.status).toBe('connected');
    expect(conn.capabilities).toBeDefined();
    expect(conn.instructions).toBe('recovered');
  });

  it('preserves capabilities and instructions after an automatic crash recovery (#547)', async () => {
    const conn: GatewayConnection = { status: 'connected', capabilities: { tools: {} }, instructions: 'initial' };
    let activateCalls = 0;
    let supervisor!: BackendStdioSupervisor;
    const recover = vi.fn().mockImplementation(async () => ({
      pid: 7002,
      activate: () => {
        activateCalls += 1;
        conn.capabilities = { tools: {} };
        conn.instructions = 'recovered';
        applyGatewaySupervision(conn, supervisor.snapshot());
      },
      dispose: vi.fn(),
    }));
    supervisor = new BackendStdioSupervisor({
      backendId: 'static:demo',
      policy: { restartOnExit: true, restartDelay: 10 },
      recover,
      onStateChange: (snapshot) => applyGatewaySupervision(conn, snapshot),
    });

    // Simulate the stdio child process exiting unexpectedly.
    supervisor.handleUnexpectedExit({ code: 1, signal: null, pid: 5000 });
    // While restarting, the gateway hides the backend's tools/instructions.
    expect(conn.status).toBe('restarting');
    expect(conn.capabilities).toBeUndefined();
    expect(conn.instructions).toBeUndefined();

    await vi.advanceTimersByTimeAsync(10);

    expect(recover).toHaveBeenCalledTimes(1);
    expect(activateCalls).toBe(1);
    expect(conn.status).toBe('connected');
    expect(conn.capabilities).toBeDefined();
    expect(conn.instructions).toBe('recovered');
  });

  it('replaces stale metadata when recovery returns changed or absent replacement data (#547)', async () => {
    const conn: GatewayConnection = {
      status: 'connected',
      capabilities: { tools: { v: 1 } },
      instructions: 'stale',
    };
    let supervisor!: BackendStdioSupervisor;
    const recover = vi.fn().mockImplementation(async () => ({
      pid: 8001,
      // The recovered backend reports DIFFERENT capabilities and ABSENT
      // instructions — the gateway must reflect the new values, not retain the
      // stale ones.
      activate: () => {
        conn.capabilities = { tools: { v: 2 } };
        conn.instructions = undefined;
        applyGatewaySupervision(conn, supervisor.snapshot());
      },
      dispose: vi.fn(),
    }));
    supervisor = new BackendStdioSupervisor({
      backendId: 'static:demo',
      policy: { restartOnExit: true },
      recover,
      onStateChange: (snapshot) => applyGatewaySupervision(conn, snapshot),
    });

    await supervisor.restartNow();

    expect(conn.capabilities).toEqual({ tools: { v: 2 } });
    expect(conn.instructions).toBeUndefined();
    expect(supervisor.snapshot().currentPid).toBe(8001);
  });
});
