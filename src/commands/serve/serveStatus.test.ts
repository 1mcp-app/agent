import fs from 'fs';
import path from 'path';

import {
  formatRuntimeStatusReport,
  getRuntimeStatusReport,
  STATUS_EXIT_CODES,
} from '@src/commands/serve/serveStatus.js';
import type { BackgroundSupervisorState } from '@src/core/server/backgroundRuntimeSupervisorState.js';
import { getPidFilePath, ServerPidInfo, writePidFile } from '@src/core/server/pidFileManager.js';
import type { RuntimeScopeOwnershipRecord } from '@src/core/server/runtimeScopeOwnership.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted so the (hoisted) vi.mock factory below can reference it safely.
const { probeReadinessMock } = vi.hoisted(() => ({ probeReadinessMock: vi.fn() }));

vi.mock('@src/core/server/runtimeLifecycle.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@src/core/server/runtimeLifecycle.js')>();
  return {
    ...actual,
    // Force discovery to use our controllable readiness probe instead of HTTP.
    discoverScopedRuntime: (configDir: string) => actual.discoverScopedRuntime(configDir, probeReadinessMock),
  };
});

describe('serveStatus', () => {
  const testConfigDir = path.join(process.cwd(), '.tmp-test-status');
  const testPidFilePath = getPidFilePath(testConfigDir);

  function baseInfo(overrides: Partial<ServerPidInfo> = {}): ServerPidInfo {
    return {
      pid: process.pid,
      url: 'http://localhost:3050/mcp',
      port: 3050,
      host: 'localhost',
      transport: 'http',
      startedAt: '2026-06-26T00:00:00.000Z',
      configDir: testConfigDir,
      ...overrides,
    };
  }

  beforeEach(() => {
    if (!fs.existsSync(testConfigDir)) {
      fs.mkdirSync(testConfigDir, { recursive: true });
    }
    probeReadinessMock.mockReset();
  });

  afterEach(() => {
    if (fs.existsSync(testPidFilePath)) {
      fs.unlinkSync(testPidFilePath);
    }
    if (fs.existsSync(testConfigDir)) {
      fs.rmdirSync(testConfigDir);
    }
  });

  describe('getRuntimeStatusReport', () => {
    function supervisorState(overrides: Partial<BackgroundSupervisorState> = {}): BackgroundSupervisorState {
      return {
        version: 1,
        status: 'running',
        supervisorPid: 8100,
        runtimePid: process.pid,
        restartAttempt: 0,
        lastExit: null,
        nextRetryAt: null,
        readyAt: '2026-06-26T00:00:01.000Z',
        updatedAt: '2026-06-26T00:00:01.000Z',
        ...overrides,
      };
    }

    function ownership(overrides: Partial<RuntimeScopeOwnershipRecord> = {}): RuntimeScopeOwnershipRecord {
      return {
        version: 1,
        pid: 8200,
        claimId: 'foreground-owner',
        kind: 'foreground-http',
        claimedAt: '2026-06-26T00:00:00.000Z',
        ...overrides,
      };
    }

    it('reports running with full details when alive and ready', async () => {
      writePidFile(testConfigDir, baseInfo({ logFile: '/tmp/server.log' }));
      probeReadinessMock.mockResolvedValue(true);

      const report = await getRuntimeStatusReport(testConfigDir);

      expect(report.status).toBe('running');
      expect(report.info?.pid).toBe(process.pid);
      expect(report.info?.logFile).toBe('/tmp/server.log');
      expect(STATUS_EXIT_CODES[report.status]).toBe(0);

      const text = formatRuntimeStatusReport(report);
      expect(text).toContain('running (ready)');
      expect(text).toContain(`PID: ${process.pid}`);
      expect(text).toContain('URL: http://localhost:3050/mcp');
      expect(text).toContain('Started: 2026-06-26T00:00:00.000Z');
      expect(text).toContain('Log file: /tmp/server.log');
      expect(text).toContain('Readiness (/health/ready): ready');
    });

    it('distinguishes alive-but-not-ready from running', async () => {
      writePidFile(testConfigDir, baseInfo());
      probeReadinessMock.mockResolvedValue(false);

      const report = await getRuntimeStatusReport(testConfigDir);

      expect(report.status).toBe('unreachable');
      expect(report.info?.pid).toBe(process.pid);
      expect(STATUS_EXIT_CODES[report.status]).toBe(4);
      // PID file is retained for an alive-but-not-ready runtime.
      expect(fs.existsSync(testPidFilePath)).toBe(true);

      const text = formatRuntimeStatusReport(report);
      expect(text).toContain('starting (not ready)');
      expect(text).toContain('Readiness (/health/ready): not ready');
    });

    it('reports not-running and removes a stale dead-process PID file', async () => {
      writePidFile(testConfigDir, baseInfo({ pid: 99999999 }));
      probeReadinessMock.mockResolvedValue(true);

      const report = await getRuntimeStatusReport(testConfigDir);

      expect(report.status).toBe('not-running');
      expect(report.info).toBeNull();
      expect(STATUS_EXIT_CODES[report.status]).toBe(3);
      // Dead process → stale PID file deleted.
      expect(fs.existsSync(testPidFilePath)).toBe(false);
      // Readiness is not probed for a dead process.
      expect(probeReadinessMock).not.toHaveBeenCalled();

      expect(formatRuntimeStatusReport(report)).toContain('Status: not running');
    });

    it('reports not-running for an empty scope', async () => {
      const report = await getRuntimeStatusReport(testConfigDir);
      expect(report.status).toBe('not-running');
      expect(report.info).toBeNull();
    });

    it('reports a live foreground owner without PID metadata as occupied and unreachable', async () => {
      const owner = ownership();
      const report = await getRuntimeStatusReport(testConfigDir, {
        readSupervisorState: () => null,
        discoverRuntime: vi.fn().mockResolvedValue({ status: 'not-running', info: null }),
        readOwnership: () => owner,
        isAlive: (pid) => pid === owner.pid,
      });

      expect(report).toMatchObject({ status: 'unreachable', info: null, ownership: owner });
      expect(STATUS_EXIT_CODES[report.status]).toBe(4);
      const text = formatRuntimeStatusReport(report);
      expect(text).toContain('Status: occupied (unreachable)');
      expect(text).toContain('Owner: foreground HTTP');
      expect(text).toContain('Owner PID: 8200 (alive)');
      expect(text).toContain('Runtime metadata: unavailable');
    });

    it('fails closed when canonical ownership is malformed or unreadable', async () => {
      const report = await getRuntimeStatusReport(testConfigDir, {
        readSupervisorState: () => null,
        discoverRuntime: vi.fn().mockResolvedValue({ status: 'not-running', info: null }),
        readOwnership: () => {
          throw new Error('ownership metadata is malformed');
        },
      });

      expect(report).toMatchObject({ status: 'error', info: null, error: 'ownership metadata is malformed' });
      expect(STATUS_EXIT_CODES[report.status]).toBe(2);
    });

    it('guardedly releases a valid dead owner before reporting an empty scope', async () => {
      const owner = ownership({ pid: 99999991 });
      const reclaimOwnership = vi.fn().mockReturnValue(true);
      const report = await getRuntimeStatusReport(testConfigDir, {
        readSupervisorState: () => null,
        discoverRuntime: vi.fn().mockResolvedValue({ status: 'not-running', info: null }),
        readOwnership: () => owner,
        reclaimOwnership,
        isAlive: () => false,
      });

      expect(reclaimOwnership).toHaveBeenCalledWith(testConfigDir, owner, expect.any(Function));
      expect(report).toMatchObject({ status: 'not-running', info: null });
      expect(report.ownership).toBeUndefined();
    });

    it('delegates dead supervisor assessment to guarded ownership reclaim', async () => {
      const owner = ownership({ pid: 99999991, kind: 'background-supervisor' });
      const reclaimOwnership = vi.fn().mockReturnValue(true);
      const report = await getRuntimeStatusReport(testConfigDir, {
        readSupervisorState: () => null,
        discoverRuntime: vi.fn().mockResolvedValue({ status: 'not-running', info: null }),
        readOwnership: () => owner,
        reclaimOwnership,
        isAlive: () => false,
      });

      expect(reclaimOwnership).toHaveBeenCalledWith(testConfigDir, owner, expect.any(Function));
      expect(report).toMatchObject({ status: 'not-running', info: null });
    });

    it('fails closed when guarded ownership reclaim detects an ambiguous supervisor spawn window', async () => {
      const owner = ownership({ pid: 99999991, kind: 'background-supervisor' });
      const report = await getRuntimeStatusReport(testConfigDir, {
        readSupervisorState: () => null,
        discoverRuntime: vi.fn().mockResolvedValue({ status: 'not-running', info: null }),
        readOwnership: () => owner,
        reclaimOwnership: () => {
          throw new Error('supervisor starting state with no published runtime PID is ambiguous');
        },
        isAlive: () => false,
      });

      expect(report).toMatchObject({ status: 'error', info: null });
      expect(report.error).toContain('ambiguous');
      expect(STATUS_EXIT_CODES[report.status]).toBe(2);
    });

    it('reports a replacement owner when guarded stale cleanup loses the race', async () => {
      const stale = ownership({ pid: 99999991, claimId: 'stale-owner' });
      const replacement = ownership({ pid: 8300, claimId: 'replacement-owner', kind: 'foreground-stdio' });
      const readOwnership = vi.fn().mockReturnValueOnce(stale).mockReturnValue(replacement);
      const reclaimOwnership = vi.fn().mockReturnValue(false);

      const report = await getRuntimeStatusReport(testConfigDir, {
        readSupervisorState: () => null,
        discoverRuntime: vi.fn().mockResolvedValue({ status: 'not-running', info: null }),
        readOwnership,
        reclaimOwnership,
        isAlive: (pid) => pid === replacement.pid,
      });

      expect(reclaimOwnership).toHaveBeenCalledWith(testConfigDir, stale, expect.any(Function));
      expect(report).toMatchObject({ status: 'unreachable', ownership: replacement });
      expect(formatRuntimeStatusReport(report)).toContain('Owner: foreground stdio');
    });

    it('reports a pending supervised restart with attempt, exit, and retry details', async () => {
      const state = supervisorState({
        status: 'restarting',
        runtimePid: null,
        restartAttempt: 2,
        lastExit: { at: '2026-06-26T00:01:00.000Z', code: 1, signal: null },
        nextRetryAt: '2026-06-26T00:01:04.000Z',
        readyAt: null,
      });

      const report = await getRuntimeStatusReport(testConfigDir, {
        readSupervisorState: () => state,
        isAlive: (pid) => pid === state.supervisorPid,
        discoverRuntime: vi.fn(),
      });

      expect(report.status).toBe('restarting');
      expect(report.supervisorState).toEqual(state);
      expect(STATUS_EXIT_CODES[report.status]).toBe(5);

      const text = formatRuntimeStatusReport(report);
      expect(text).toContain('Status: restarting');
      expect(text).toContain('Supervisor PID: 8100');
      expect(text).toContain('Runtime PID: none');
      expect(text).toContain('Restart attempt: 2');
      expect(text).toContain('Last exit: code 1 at 2026-06-26T00:01:00.000Z');
      expect(text).toContain('Next retry: 2026-06-26T00:01:04.000Z');
    });

    it('reports a live supervisor without published runtime metadata as unreachable', async () => {
      const state = supervisorState({ status: 'starting', runtimePid: null, readyAt: null });
      const report = await getRuntimeStatusReport(testConfigDir, {
        readSupervisorState: () => state,
        discoverRuntime: vi.fn().mockResolvedValue({ status: 'not-running', info: null }),
        isAlive: (pid) => pid === state.supervisorPid,
      });

      expect(report).toMatchObject({ status: 'unreachable', info: null, supervisorState: state });
      expect(STATUS_EXIT_CODES[report.status]).toBe(4);
      expect(formatRuntimeStatusReport(report)).toContain('Status: unreachable');
    });

    it('includes the discovery error when live supervisor metadata is available', async () => {
      const state = supervisorState();
      const report = await getRuntimeStatusReport(testConfigDir, {
        readSupervisorState: () => state,
        discoverRuntime: vi.fn().mockResolvedValue({
          status: 'error',
          info: null,
          error: 'runtime PID metadata is unreadable',
        }),
        isAlive: (pid) => pid === state.supervisorPid,
      });

      expect(report).toMatchObject({
        status: 'error',
        error: 'runtime PID metadata is unreadable',
        supervisorState: state,
      });
      expect(STATUS_EXIT_CODES[report.status]).toBe(2);
      expect(formatRuntimeStatusReport(report)).toContain('Error: runtime PID metadata is unreadable');
    });

    it('reports an orphan when a dead supervisor missed runtime PID state publication', async () => {
      const state = supervisorState({
        status: 'starting',
        supervisorPid: 99999991,
        runtimePid: null,
        readyAt: null,
      });
      const worker = baseInfo({ pid: process.pid });
      const owner = ownership({
        pid: state.supervisorPid,
        claimId: 'starting-supervisor',
        kind: 'background-supervisor',
      });
      const cleanupSupervisorState = vi.fn();
      const report = await getRuntimeStatusReport(testConfigDir, {
        readSupervisorState: () => state,
        cleanupSupervisorState,
        discoverRuntime: vi.fn().mockResolvedValue({ status: 'running', info: worker }),
        readOwnership: () => owner,
        isAlive: (pid) => pid === worker.pid,
      });

      expect(report).toMatchObject({
        status: 'orphaned',
        info: worker,
        supervisorState: { supervisorPid: state.supervisorPid, runtimePid: worker.pid },
      });
      expect(cleanupSupervisorState).not.toHaveBeenCalled();
      expect(STATUS_EXIT_CODES[report.status]).toBe(7);
    });

    it('reports terminal crash-loop with exit code 6', async () => {
      const state = supervisorState({
        status: 'crash-loop',
        runtimePid: null,
        restartAttempt: 5,
        lastExit: { at: '2026-06-26T00:02:00.000Z', code: null, signal: 'SIGKILL' },
        nextRetryAt: null,
        readyAt: null,
      });

      const report = await getRuntimeStatusReport(testConfigDir, {
        readSupervisorState: () => state,
        isAlive: (pid) => pid === state.supervisorPid,
        discoverRuntime: vi.fn(),
      });

      expect(report.status).toBe('crash-loop');
      expect(STATUS_EXIT_CODES[report.status]).toBe(6);
      const text = formatRuntimeStatusReport(report);
      expect(text).toContain('Status: crash-loop');
      expect(text).toContain('Restart attempt: 5');
      expect(text).toContain('Last exit: signal SIGKILL at 2026-06-26T00:02:00.000Z');
      expect(text).toContain('Next retry: none');
    });

    it('reports orphaned when the supervisor is dead and its runtime remains alive', async () => {
      const state = supervisorState({ supervisorPid: 99999991, runtimePid: 99999992 });

      const report = await getRuntimeStatusReport(testConfigDir, {
        readSupervisorState: () => state,
        isAlive: (pid) => pid === state.runtimePid,
        discoverRuntime: vi.fn(),
      });

      expect(report.status).toBe('orphaned');
      expect(STATUS_EXIT_CODES[report.status]).toBe(7);
      const text = formatRuntimeStatusReport(report);
      expect(text).toContain('Status: orphaned');
      expect(text).toContain('Supervisor PID: 99999991 (not alive)');
      expect(text).toContain('Runtime PID: 99999992 (alive)');
    });

    it('cleans a dead supervisor snapshot and falls back to current runtime discovery', async () => {
      const state = supervisorState({ supervisorPid: 99999991, runtimePid: 99999992 });
      const current = baseInfo({ pid: process.pid });
      const cleanupSupervisorState = vi.fn().mockReturnValue(true);
      const discoverRuntime = vi.fn().mockResolvedValue({ status: 'running', info: current });

      const report = await getRuntimeStatusReport(testConfigDir, {
        readSupervisorState: () => state,
        isAlive: () => false,
        cleanupSupervisorState,
        discoverRuntime,
      });

      expect(cleanupSupervisorState).toHaveBeenCalledWith(testConfigDir, state.supervisorPid);
      expect(discoverRuntime).toHaveBeenCalledWith(testConfigDir);
      expect(report).toMatchObject({ status: 'running', info: current });
      expect(report.supervisorState).toBeUndefined();
    });

    it('keeps dead starting state until guarded ownership reclaim rejects the ambiguous spawn window', async () => {
      const state = supervisorState({
        status: 'starting',
        supervisorPid: 99999991,
        runtimePid: null,
        readyAt: null,
      });
      const owner = ownership({
        pid: state.supervisorPid,
        claimId: 'starting-supervisor',
        kind: 'background-supervisor',
      });
      const cleanupSupervisorState = vi.fn();

      const report = await getRuntimeStatusReport(testConfigDir, {
        readSupervisorState: () => state,
        cleanupSupervisorState,
        discoverRuntime: vi.fn().mockResolvedValue({ status: 'not-running', info: null }),
        readOwnership: () => owner,
        reclaimOwnership: () => {
          throw new Error('supervisor starting state may be between worker spawn and state publication');
        },
        isAlive: () => false,
      });

      expect(report).toMatchObject({ status: 'error', info: null });
      expect(report.error).toContain('between worker spawn and state publication');
      expect(cleanupSupervisorState).not.toHaveBeenCalled();
    });

    it('fails closed when supervisor state is unreadable', async () => {
      const report = await getRuntimeStatusReport(testConfigDir, {
        readSupervisorState: () => {
          throw new Error('state file denied');
        },
        discoverRuntime: vi.fn(),
      });

      expect(report).toMatchObject({ status: 'error', info: null, error: 'state file denied' });
      expect(STATUS_EXIT_CODES[report.status]).toBe(2);
      expect(formatRuntimeStatusReport(report)).toContain('Error: state file denied');
    });
  });
});
