import fs from 'node:fs';
import path from 'node:path';

import { runServeStop, waitForProcessExit } from '@src/commands/serve/serveStop.js';
import { getBackgroundLaunchConfigPath, writeBackgroundLaunchConfig } from '@src/core/server/backgroundLaunchConfig.js';
import { PidFileReadError, type ServerPidInfo } from '@src/core/server/pidFileManager.js';
import { claimRuntimeScope, getRuntimeScopeOwnershipPath } from '@src/core/server/runtimeScopeOwnership.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('waitForProcessExit', () => {
  it('returns true once the process is gone', async () => {
    let alive = true;
    const result = await waitForProcessExit(123, {
      isAlive: () => alive,
      sleep: async () => {
        alive = false;
      },
    });
    expect(result).toBe(true);
  });

  it('returns false when the process never exits within the timeout', async () => {
    let clock = 0;
    const result = await waitForProcessExit(123, {
      isAlive: () => true,
      timeoutMs: 500,
      intervalMs: 100,
      now: () => clock,
      sleep: async () => {
        clock += 100;
      },
    });
    expect(result).toBe(false);
  });
});

describe('runServeStop', () => {
  const tempScope = path.join(process.cwd(), '.tmp-serve-stop-stale-launch');
  let stdout: string;
  let stderr: string;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  const info = (overrides: Partial<ServerPidInfo> = {}): ServerPidInfo => ({
    pid: 4321,
    url: 'http://localhost:3050/mcp',
    port: 3050,
    host: 'localhost',
    transport: 'http',
    startedAt: '2026-06-26T00:00:00.000Z',
    configDir: '/scope',
    ...overrides,
  });
  const backgroundOwner = (supervisorPid: number) => ({
    version: 1 as const,
    pid: supervisorPid,
    claimId: `claim-${supervisorPid}`,
    kind: 'background-supervisor' as const,
    claimedAt: '2026-06-26T00:00:00.000Z',
  });
  const acquireStopLock = () => ({ release: vi.fn() });

  beforeEach(() => {
    stdout = '';
    stderr = '';
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      stdout += String(chunk);
      return true;
    });
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
      stderr += String(chunk);
      return true;
    });
    process.exitCode = undefined;
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    process.exitCode = undefined;
    fs.rmSync(tempScope, { recursive: true, force: true });
  });

  it('reports cleanly when nothing is running', async () => {
    const kill = vi.fn();
    const cleanup = vi.fn();
    await runServeStop('/scope', { readInfo: () => null, kill, cleanup });

    expect(kill).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
    expect(stdout).toContain('No runtime is running');
  });

  it('fails closed when the scoped PID file cannot be read', async () => {
    const kill = vi.fn();
    const cleanup = vi.fn();
    await runServeStop('/scope', {
      readInfo: () => {
        throw new PidFileReadError('/scope/server.pid', Object.assign(new Error('denied'), { code: 'EACCES' }));
      },
      kill,
      cleanup,
    });

    expect(kill).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('cannot inspect Runtime Scope');
  });

  it('removes a stale PID file for a dead process without signaling', async () => {
    const kill = vi.fn();
    const cleanup = vi.fn().mockReturnValue(true);
    await runServeStop('/scope', {
      readInfo: () => info({ pid: 99999999 }),
      isAlive: () => false,
      kill,
      cleanup,
    });

    expect(kill).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledWith('/scope', 99999999);
    expect(process.exitCode).toBe(0);
    expect(stdout).toContain('stale PID file');
  });

  it('warns when a stale PID file cannot be removed', async () => {
    const cleanup = vi.fn().mockReturnValue(false);
    await runServeStop('/scope', {
      readInfo: () => info({ pid: 99999999 }),
      isAlive: () => false,
      kill: vi.fn(),
      cleanup,
    });

    expect(process.exitCode).toBe(0);
    expect(stderr).toContain('could not be removed');
  });

  it('gracefully terminates a live runtime and cleans up', async () => {
    const kill = vi.fn();
    const cleanup = vi.fn().mockReturnValue(true);
    const waitForExit = vi.fn().mockResolvedValue(true);

    await runServeStop('/scope', {
      readInfo: () => info({ pid: 4321 }),
      isAlive: () => true,
      kill,
      cleanup,
      waitForExit,
    });

    expect(kill).toHaveBeenCalledWith(4321, 'SIGTERM');
    expect(kill).toHaveBeenCalledTimes(1); // no SIGKILL escalation needed
    expect(cleanup).toHaveBeenCalledWith('/scope', 4321);
    expect(process.exitCode).toBe(0);
    expect(stdout).toContain('Stopped runtime');
  });

  it('escalates to SIGKILL when SIGTERM does not stop the runtime', async () => {
    const kill = vi.fn();
    const cleanup = vi.fn().mockReturnValue(true);
    // First wait (after SIGTERM) fails, second wait (after SIGKILL) succeeds.
    const waitForExit = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await runServeStop('/scope', {
      readInfo: () => info({ pid: 4321 }),
      isAlive: () => true,
      kill,
      cleanup,
      waitForExit,
    });

    expect(kill).toHaveBeenNthCalledWith(1, 4321, 'SIGTERM');
    expect(kill).toHaveBeenNthCalledWith(2, 4321, 'SIGKILL');
    expect(cleanup).toHaveBeenCalledWith('/scope', 4321);
    expect(process.exitCode).toBe(0);
  });

  it('exits non-zero when the runtime cannot be stopped', async () => {
    const kill = vi.fn();
    const cleanup = vi.fn().mockReturnValue(true);
    const waitForExit = vi.fn().mockResolvedValue(false);

    await runServeStop('/scope', {
      readInfo: () => info({ pid: 4321 }),
      isAlive: () => true,
      kill,
      cleanup,
      waitForExit,
    });

    expect(cleanup).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('failed to stop runtime');
  });

  it('continues past a SIGTERM failure and still escalates/cleans up', async () => {
    // process.kill can throw (ESRCH/EPERM); the command must not crash.
    const kill = vi.fn().mockImplementationOnce(() => {
      throw new Error('ESRCH');
    });
    const cleanup = vi.fn().mockReturnValue(true);
    const waitForExit = vi.fn().mockResolvedValue(true);

    await runServeStop('/scope', {
      readInfo: () => info({ pid: 4321 }),
      isAlive: () => true,
      kill,
      cleanup,
      waitForExit,
    });

    expect(process.exitCode).toBe(0);
    expect(stdout).toContain('Stopped runtime');
  });

  it('stops a live supervisor to cancel a pending restart and releases its lifecycle state', async () => {
    const kill = vi.fn();
    const cleanupSupervisorState = vi.fn().mockReturnValue(true);
    const cleanupOwnership = vi.fn().mockReturnValue(true);
    const readInfo = vi.fn();
    const state = {
      version: 1 as const,
      status: 'restarting' as const,
      supervisorPid: 8100,
      runtimePid: null,
      restartAttempt: 2,
      lastExit: { at: '2026-06-26T00:01:00.000Z', code: 1, signal: null },
      nextRetryAt: '2026-06-26T00:01:04.000Z',
      readyAt: null,
      updatedAt: '2026-06-26T00:01:00.000Z',
    };

    await runServeStop('/scope', {
      readSupervisorState: () => state,
      readOwnership: () => backgroundOwner(state.supervisorPid),
      acquireStopLock,
      readInfo,
      isAlive: (pid) => pid === state.supervisorPid,
      kill,
      waitForExit: vi.fn().mockResolvedValue(true),
      cleanupLaunchConfig: vi.fn().mockReturnValue(true),
      cleanupSupervisorState,
      cleanupOwnership,
    });

    expect(kill).toHaveBeenCalledWith(8100, 'SIGTERM');
    expect(kill).toHaveBeenCalledTimes(1);
    expect(cleanupSupervisorState).toHaveBeenCalledWith('/scope', 8100);
    expect(cleanupOwnership).toHaveBeenCalledWith('/scope', 8100);
    expect(process.exitCode).toBe(0);
    expect(stdout).toContain('Stopped supervised background runtime');
  });

  it.each(['launch', 'state'] as const)(
    'retains ownership when %s metadata cleanup cannot be verified',
    async (failure) => {
      const state = {
        version: 1 as const,
        status: 'crash-loop' as const,
        supervisorPid: 8100,
        runtimePid: null,
        restartAttempt: 5,
        lastExit: null,
        nextRetryAt: null,
        readyAt: null,
        updatedAt: '2026-06-26T00:01:00.000Z',
      };
      const cleanupLaunchConfig = vi.fn().mockReturnValue(failure !== 'launch');
      const cleanupSupervisorState = vi.fn().mockReturnValue(failure !== 'state');
      const cleanupOwnership = vi.fn().mockReturnValue(true);

      await runServeStop('/scope', {
        readSupervisorState: () => state,
        readOwnership: () => backgroundOwner(state.supervisorPid),
        acquireStopLock,
        readInfo: () => null,
        isAlive: (pid) => pid === state.supervisorPid,
        kill: vi.fn(),
        waitForExit: vi.fn().mockResolvedValue(true),
        cleanupLaunchConfig,
        cleanupSupervisorState,
        cleanupOwnership,
      });

      expect(process.exitCode).toBe(1);
      expect(cleanupOwnership).not.toHaveBeenCalled();
      if (failure === 'launch') expect(cleanupSupervisorState).not.toHaveBeenCalled();
    },
  );

  it('recovers an orphaned worker and releases its dead supervisor ownership', async () => {
    const kill = vi.fn();
    const cleanupOrder: string[] = [];
    const cleanupLaunchConfig = vi.fn(() => {
      cleanupOrder.push('launch-config');
      return true;
    });
    const cleanupSupervisorState = vi.fn(() => {
      cleanupOrder.push('state');
      return true;
    });
    const cleanupOwnership = vi.fn(() => {
      cleanupOrder.push('ownership');
      return true;
    });
    const state = {
      version: 1 as const,
      status: 'running' as const,
      supervisorPid: 99999991,
      runtimePid: 99999992,
      restartAttempt: 1,
      lastExit: null,
      nextRetryAt: null,
      readyAt: '2026-06-26T00:00:01.000Z',
      updatedAt: '2026-06-26T00:01:00.000Z',
    };

    await runServeStop('/scope', {
      readSupervisorState: () => state,
      readOwnership: () => backgroundOwner(state.supervisorPid),
      acquireStopLock,
      readInfo: vi.fn(),
      isAlive: (pid) => pid === state.runtimePid,
      kill,
      waitForExit: vi.fn().mockResolvedValue(true),
      cleanupLaunchConfig,
      cleanupSupervisorState,
      cleanupOwnership,
    });

    expect(kill).toHaveBeenCalledWith(99999992, 'SIGTERM');
    expect(kill).not.toHaveBeenCalledWith(99999991, expect.anything());
    expect(cleanupSupervisorState).toHaveBeenCalledWith('/scope', 99999991);
    expect(cleanupOwnership).toHaveBeenCalledWith('/scope', 99999991);
    expect(cleanupOrder).toEqual(['launch-config', 'state', 'ownership']);
    expect(process.exitCode).toBe(0);
    expect(stdout).toContain('Recovered orphaned runtime');
  });

  it('stops a worker spawned while a pending restart is being cancelled', async () => {
    let supervisorAlive = true;
    let runtimeAlive = true;
    const initialState = {
      version: 1 as const,
      status: 'restarting' as const,
      supervisorPid: 8100,
      runtimePid: null,
      restartAttempt: 2,
      lastExit: { at: '2026-06-26T00:01:00.000Z', code: 1, signal: null },
      nextRetryAt: '2026-06-26T00:01:04.000Z',
      readyAt: null,
      updatedAt: '2026-06-26T00:01:00.000Z',
    };
    const stoppingState = { ...initialState, status: 'stopping' as const, runtimePid: 8200, nextRetryAt: null };
    const readSupervisorState = vi.fn().mockReturnValueOnce(initialState).mockReturnValue(stoppingState);
    const kill = vi.fn();
    const waitForExit = vi.fn(async (pid: number) => {
      if (pid === initialState.supervisorPid) supervisorAlive = false;
      if (pid === stoppingState.runtimePid) runtimeAlive = false;
      return true;
    });

    await runServeStop('/scope', {
      readSupervisorState,
      readOwnership: () => backgroundOwner(initialState.supervisorPid),
      acquireStopLock,
      readInfo: vi.fn(),
      isAlive: (pid) => (pid === initialState.supervisorPid ? supervisorAlive : pid === 8200 && runtimeAlive),
      kill,
      waitForExit,
      cleanupLaunchConfig: vi.fn().mockReturnValue(true),
      cleanupSupervisorState: vi.fn().mockReturnValue(true),
      cleanupOwnership: vi.fn().mockReturnValue(true),
      cleanup: vi.fn().mockReturnValue(true),
    });

    expect(kill.mock.calls).toEqual([
      [8100, 'SIGTERM'],
      [8200, 'SIGTERM'],
    ]);
    expect(readSupervisorState).toHaveBeenCalledTimes(2);
    expect(process.exitCode).toBe(0);
  });

  it('discards stale supervisor state before stopping the current foreground owner', async () => {
    const staleState = {
      version: 1 as const,
      status: 'running' as const,
      supervisorPid: 99999991,
      runtimePid: 99999992,
      restartAttempt: 1,
      lastExit: null,
      nextRetryAt: null,
      readyAt: null,
      updatedAt: '2026-06-26T00:01:00.000Z',
    };
    const current = info({ pid: 4321 });
    const cleanupSupervisorState = vi.fn().mockReturnValue(true);
    const kill = vi.fn();

    await runServeStop('/scope', {
      readSupervisorState: () => staleState,
      readOwnership: () => ({
        version: 1,
        pid: current.pid,
        claimId: 'foreground-current',
        kind: 'foreground-http',
        claimedAt: '2026-06-26T00:02:00.000Z',
      }),
      readInfo: () => current,
      isAlive: (pid) => pid === current.pid,
      kill,
      waitForExit: vi.fn().mockResolvedValue(true),
      cleanupSupervisorState,
      cleanup: vi.fn().mockReturnValue(true),
    });

    expect(cleanupSupervisorState).toHaveBeenCalledWith('/scope', staleState.supervisorPid);
    expect(kill).toHaveBeenCalledWith(current.pid, 'SIGTERM');
    expect(kill).not.toHaveBeenCalledWith(staleState.runtimePid, expect.anything());
    expect(process.exitCode).toBe(0);
    expect(stdout).toContain('Stopped runtime');
  });

  it('stops a background owner that publishes a worker before bootstrap state exists', async () => {
    const supervisorPid = 8100;
    const workerPid = 8200;
    let supervisorAlive = true;
    let workerAlive = true;
    const kill = vi.fn();
    const waitForExit = vi.fn(async (pid: number) => {
      if (pid === supervisorPid) supervisorAlive = false;
      if (pid === workerPid) workerAlive = false;
      return true;
    });

    await runServeStop('/scope', {
      readSupervisorState: () => null,
      readOwnership: () => backgroundOwner(supervisorPid),
      acquireStopLock,
      readInfo: () => info({ pid: workerPid }),
      isAlive: (pid) => (pid === supervisorPid ? supervisorAlive : pid === workerPid && workerAlive),
      kill,
      waitForExit,
      cleanupLaunchConfig: vi.fn().mockReturnValue(true),
      cleanupSupervisorState: vi.fn().mockReturnValue(true),
      cleanupOwnership: vi.fn().mockReturnValue(true),
      cleanup: vi.fn().mockReturnValue(true),
    });

    expect(kill.mock.calls).toEqual([
      [supervisorPid, 'SIGTERM'],
      [workerPid, 'SIGTERM'],
    ]);
    expect(process.exitCode).toBe(0);
    expect(stdout).toContain('Stopped supervised background runtime');
  });

  it('stops a replacement background owner after discarding stale prior state', async () => {
    const oldState = {
      version: 1 as const,
      status: 'running' as const,
      supervisorPid: 99999991,
      runtimePid: 99999992,
      restartAttempt: 1,
      lastExit: null,
      nextRetryAt: null,
      readyAt: null,
      updatedAt: '2026-06-26T00:01:00.000Z',
    };
    const replacementSupervisorPid = 8300;
    const replacementWorkerPid = 8400;
    let supervisorAlive = true;
    let workerAlive = true;
    const kill = vi.fn();
    const waitForExit = vi.fn(async (pid: number) => {
      if (pid === replacementSupervisorPid) supervisorAlive = false;
      if (pid === replacementWorkerPid) workerAlive = false;
      return true;
    });
    const cleanupSupervisorState = vi.fn().mockReturnValue(true);

    await runServeStop('/scope', {
      readSupervisorState: vi.fn().mockReturnValueOnce(oldState).mockReturnValue(null),
      readOwnership: () => backgroundOwner(replacementSupervisorPid),
      acquireStopLock,
      readInfo: () => info({ pid: replacementWorkerPid }),
      isAlive: (pid) =>
        pid === replacementSupervisorPid ? supervisorAlive : pid === replacementWorkerPid && workerAlive,
      kill,
      waitForExit,
      cleanupLaunchConfig: vi.fn().mockReturnValue(true),
      cleanupSupervisorState,
      cleanupOwnership: vi.fn().mockReturnValue(true),
      cleanup: vi.fn().mockReturnValue(true),
    });

    expect(cleanupSupervisorState).toHaveBeenCalledWith('/scope', oldState.supervisorPid);
    expect(kill.mock.calls).toEqual([
      [replacementSupervisorPid, 'SIGTERM'],
      [replacementWorkerPid, 'SIGTERM'],
    ]);
    expect(process.exitCode).toBe(0);
  });

  it('removes a prior-generation launch snapshot while stopping its replacement owner', async () => {
    const replacementSupervisorPid = 8300;
    const replacementOwner = claimRuntimeScope(
      tempScope,
      { kind: 'background-supervisor', pid: replacementSupervisorPid },
      { processAlive: () => false, createClaimId: () => 'replacement-owner' },
    );
    writeBackgroundLaunchConfig(tempScope, 'prior-owner', { port: 4050 });
    const oldState = {
      version: 1 as const,
      status: 'running' as const,
      supervisorPid: 99999991,
      runtimePid: 99999992,
      restartAttempt: 1,
      lastExit: null,
      nextRetryAt: null,
      readyAt: null,
      updatedAt: '2026-06-26T00:01:00.000Z',
    };
    let supervisorAlive = true;

    await runServeStop(tempScope, {
      readSupervisorState: vi.fn().mockReturnValueOnce(oldState).mockReturnValue(null),
      cleanupSupervisorState: vi.fn().mockReturnValue(true),
      readInfo: () => null,
      isAlive: (pid) => pid === replacementSupervisorPid && supervisorAlive,
      kill: vi.fn(),
      waitForExit: vi.fn(async () => {
        supervisorAlive = false;
        return true;
      }),
    });

    expect(process.exitCode).toBe(0);
    expect(fs.existsSync(getBackgroundLaunchConfigPath(tempScope))).toBe(false);
    expect(fs.existsSync(getRuntimeScopeOwnershipPath(tempScope))).toBe(false);
    expect(replacementOwner.record.claimId).toBe('replacement-owner');
  });
});
