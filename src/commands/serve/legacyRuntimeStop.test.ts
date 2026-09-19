import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as processEvidence from '@src/core/server/processEvidence.js';
import type { BackgroundSupervisorState } from '@src/core/server/backgroundRuntimeSupervisorState.js';
import type { ServerPidInfo } from '@src/core/server/pidFileManager.js';
import type { ProcessEvidence } from '@src/core/server/processEvidence.js';
import type { RuntimeScopeOwnershipRecord } from '@src/core/server/runtimeScopeOwnership.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stopLegacyRuntime } from './legacyRuntimeStop.js';

describe('verified legacy shutdown', () => {
  let scope: string;
  let owner: RuntimeScopeOwnershipRecord;
  let state: BackgroundSupervisorState;
  let info: ServerPidInfo;
  let supervisor: ProcessEvidence;
  let worker: ProcessEvidence;
  let processes: Map<number, ProcessEvidence>;
  const write = (name: string, value: unknown) => fs.writeFileSync(path.join(scope, name), JSON.stringify(value));
  beforeEach(() => {
    scope = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-stop-'));
    fs.mkdirSync(path.join(scope, 'runtime.owner'));
    owner = {
      version: 1,
      pid: 41001,
      claimId: 'old-claim',
      kind: 'background-supervisor',
      claimedAt: '2026-09-19T00:00:00.000Z',
    };
    state = {
      version: 1,
      status: 'running',
      supervisorPid: owner.pid,
      runtimePid: 41002,
      restartAttempt: 0,
      lastExit: null,
      nextRetryAt: null,
      readyAt: null,
      updatedAt: owner.claimedAt,
    };
    info = {
      pid: 41002,
      port: 3050,
      host: 'localhost',
      transport: 'http',
      url: 'http://localhost:3050/mcp',
      startedAt: owner.claimedAt,
      configDir: scope,
    };
    supervisor = {
      pid: owner.pid,
      ppid: 1,
      uid: 501,
      realUid: 501,
      executable: '/bin/1mcp',
      argv: ['/bin/1mcp', 'serve'],
      birth: '100',
      context: { platform: 'darwin', bootId: '1.0' },
    };
    worker = { ...supervisor, pid: info.pid, ppid: owner.pid, birth: '101' };
    processes = new Map([
      [supervisor.pid, supervisor],
      [worker.pid, worker],
    ]);
    write('runtime.owner/owner.json', owner);
    write('background-runtime.json', state);
    write('server.pid', info);
    write('background-launch.json', { version: 1, claimId: owner.claimId, appConfig: {} });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(scope, { recursive: true, force: true });
  });
  const deps = () => ({
    verify: () => ({ supervisor, worker }),
    readEvidence: (pid: number) => processes.get(pid),
    exists: (pid: number) => processes.has(pid),
    timeoutMs: 0,
  });

  it('stops supervisor first, allows worker reparenting only afterward and cleans captured generation', async () => {
    const kill = vi.fn((pid: number) => {
      processes.delete(pid);
      if (pid === supervisor.pid) processes.set(worker.pid, { ...worker, ppid: 1 });
    });
    expect(await stopLegacyRuntime(scope, owner, state, info, { ...deps(), kill })).toBe(true);
    expect(kill.mock.calls.map(([pid]) => pid)).toEqual([supervisor.pid, worker.pid]);
    expect(fs.existsSync(path.join(scope, 'runtime.owner'))).toBe(false);
  });
  it('accepts graceful shutdown that removes every lifecycle record', async () => {
    const kill = vi.fn(() => {
      processes.clear();
      for (const name of ['runtime.owner', 'background-runtime.json', 'server.pid', 'background-launch.json'])
        fs.rmSync(path.join(scope, name), { recursive: true });
    });
    expect(await stopLegacyRuntime(scope, owner, state, info, { ...deps(), kill })).toBe(true);
    expect(kill).toHaveBeenCalledTimes(1);
  });
  it('refuses changed worker metadata before any signal', async () => {
    write('background-runtime.json', { ...state, runtimePid: 42000 });
    const kill = vi.fn();
    await expect(stopLegacyRuntime(scope, owner, state, info, { ...deps(), kill })).rejects.toThrow('changed');
    expect(kill).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(scope, 'runtime.owner'))).toBe(true);
  });
  it('never adopts a worker replaced during supervisor shutdown', async () => {
    const kill = vi.fn((pid: number) => {
      processes.delete(pid);
      write('background-runtime.json', { ...state, runtimePid: 42000 });
    });
    await expect(stopLegacyRuntime(scope, owner, state, info, { ...deps(), kill })).rejects.toThrow('changed');
    expect(kill).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(scope, 'server.pid'))).toBe(true);
  });
  it('preserves replacement ownership even when its supervisor PID is the same', async () => {
    const kill = vi.fn((pid: number) => {
      processes.delete(pid);
      write('runtime.owner/owner.json', { ...owner, claimId: 'replacement' });
    });
    await expect(stopLegacyRuntime(scope, owner, state, info, { ...deps(), kill })).rejects.toThrow('changed');
    expect(JSON.parse(fs.readFileSync(path.join(scope, 'runtime.owner/owner.json'), 'utf8')).claimId).toBe(
      'replacement',
    );
    expect(kill).toHaveBeenCalledTimes(1);
  });
  it('does not escalate after process evidence becomes unavailable', async () => {
    const kill = vi.fn((pid: number) => processes.delete(pid));
    await expect(stopLegacyRuntime(scope, owner, state, info, { ...deps(), kill, exists: () => true })).rejects.toThrow(
      'unavailable',
    );
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(supervisor.pid, 'SIGTERM');
  });
  it('escalates only the captured incarnations and handles reparenting after supervisor SIGKILL', async () => {
    const kill = vi.fn((pid: number, signal: string) => {
      if (signal === 'SIGKILL' || pid === worker.pid) processes.delete(pid);
      if (pid === supervisor.pid && signal === 'SIGKILL') processes.set(worker.pid, { ...worker, ppid: 1 });
    });
    expect(await stopLegacyRuntime(scope, owner, state, info, { ...deps(), kill })).toBe(true);
    expect(kill.mock.calls).toEqual([
      [supervisor.pid, 'SIGTERM'],
      [supervisor.pid, 'SIGKILL'],
      [worker.pid, 'SIGTERM'],
    ]);
  });
  it('does not signal a reused worker PID', async () => {
    const kill = vi.fn((pid: number) => {
      processes.delete(pid);
      processes.set(worker.pid, { ...worker, birth: '999', ppid: 1 });
    });
    expect(await stopLegacyRuntime(scope, owner, state, info, { ...deps(), kill })).toBe(true);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(processes.get(worker.pid)?.birth).toBe('999');
  });
  it('keeps launch metadata with a conflicting claim', async () => {
    const kill = vi.fn((pid: number) => {
      processes.delete(pid);
      if (pid === worker.pid) write('background-launch.json', { version: 1, claimId: 'other', appConfig: {} });
    });
    await expect(stopLegacyRuntime(scope, owner, state, info, { ...deps(), kill })).rejects.toThrow('launch');
    expect(JSON.parse(fs.readFileSync(path.join(scope, 'background-launch.json'), 'utf8')).claimId).toBe('other');
    expect(fs.existsSync(path.join(scope, 'runtime.owner'))).toBe(true);
  });
  it('accepts an exit between identity verification and signalling', async () => {
    const kill = vi.fn((pid: number) => {
      processes.delete(pid);
      if (pid === supervisor.pid) processes.set(worker.pid, { ...worker, ppid: 1 });
      throw Object.assign(new Error('process disappeared'), { code: 'ESRCH' });
    });
    expect(await stopLegacyRuntime(scope, owner, state, info, { ...deps(), kill })).toBe(true);
    expect(kill).toHaveBeenCalledTimes(2);
  });

  it('recognizes a positively observed exited zombie without relying on kill-zero', async () => {
    const kill = vi.fn((pid: number) => {
      const previous = processes.get(pid)!;
      processes.set(pid, { ...previous, exited: true, argv: [], executable: '' });
      if (pid === supervisor.pid) processes.set(worker.pid, { ...worker, ppid: 1 });
    });
    expect(await stopLegacyRuntime(scope, owner, state, info, { ...deps(), kill, exists: () => true })).toBe(true);
    expect(kill.mock.calls.map(([pid]) => pid)).toEqual([supervisor.pid, worker.pid]);
  });
  it('waits for transient post-signal uncertainty to settle without escalating', async () => {
    let closing: number | undefined;
    let uncertainReads = 0;
    const readEvidence = (pid: number) => {
      if (pid !== closing) return processes.get(pid);
      uncertainReads++;
      if (uncertainReads === 1) return undefined;
      processes.delete(pid);
      return undefined;
    };
    const kill = vi.fn((pid: number) => {
      closing = pid;
      uncertainReads = 0;
      if (pid === supervisor.pid) processes.set(worker.pid, { ...worker, ppid: 1 });
    });
    expect(await stopLegacyRuntime(scope, owner, state, info, { ...deps(), readEvidence, kill, timeoutMs: 1000 })).toBe(
      true,
    );
    expect(kill.mock.calls.map(([pid]) => pid)).toEqual([supervisor.pid, worker.pid]);
  });

  it('closes the operation reader when initial verification refuses recovery', async () => {
    const close = vi.fn();
    vi.spyOn(processEvidence, 'createProcessEvidenceReader').mockReturnValue({ read: deps().readEvidence, close });
    expect(
      await stopLegacyRuntime(scope, owner, state, info, {
        ...deps(),
        readEvidence: undefined,
        verify: () => undefined,
      }),
    ).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes the operation reader when signalling fails', async () => {
    const close = vi.fn();
    vi.spyOn(processEvidence, 'createProcessEvidenceReader').mockReturnValue({ read: deps().readEvidence, close });
    const kill = () => {
      throw new Error('signal denied');
    };
    await expect(
      stopLegacyRuntime(scope, owner, state, info, { ...deps(), readEvidence: undefined, kill }),
    ).rejects.toThrow('signal denied');
    expect(close).toHaveBeenCalledTimes(1);
  });
});
