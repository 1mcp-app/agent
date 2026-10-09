import fs from 'node:fs';
import path from 'node:path';

import * as processIdentity from '@src/core/server/processIdentity.js';
import * as runtimeFileLock from '@src/core/server/runtimeFileLock.js';
import { writeBackgroundSupervisorState } from '@src/core/server/backgroundRuntimeSupervisorState.js';
import { writePidFile } from '@src/core/server/pidFileManager.js';
import {
  acquireRuntimeScopeStopLock,
  claimRuntimeScope,
  getRuntimeScopeOwnershipPath,
  getRuntimeScopeStopLockPath,
  readRuntimeScopeOwnership,
  reclaimStaleRuntimeScopeOwnership,
  releaseRuntimeScopeOwnership,
  RuntimeScopeOwnedError,
  verifyRuntimeScopeOwnership,
} from '@src/core/server/runtimeScopeOwnership.js';
import logger from '@src/logger/logger.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Runtime Scope ownership', () => {
  const configDir = path.join(process.cwd(), '.tmp-test-runtime-ownership');
  const ownerPath = getRuntimeScopeOwnershipPath(configDir);
  const ownerRecordPath = path.join(ownerPath, 'owner.json');
  const stopLockPath = getRuntimeScopeStopLockPath(configDir);

  function writeOwnerRecord(content: string): void {
    fs.mkdirSync(ownerPath, { recursive: true });
    let value;
    try {
      value = JSON.parse(content);
    } catch {
      /* malformed fixture */
    }
    if (value?.claimId && value?.claimedAt) {
      value.processIdentity ??= processIdentity.readProcessIdentity(process.pid);
      content = JSON.stringify(value);
    }
    fs.writeFileSync(ownerRecordPath, content, 'utf8');
  }

  beforeEach(() => {
    fs.mkdirSync(configDir, { recursive: true });
    // Existing rename/tombstone race tests exercise the identity-only platform path.
    vi.spyOn(runtimeFileLock, 'acquireRuntimeFileLock').mockReturnValue(null);
    const identity = { platform: 'linux' as const, bootId: 'test-boot', pidNamespace: 'pid:[100]', startTime: '123' };
    vi.spyOn(processIdentity, 'readProcessIdentity').mockReturnValue(identity);
    const inspect = processIdentity.inspectProcessIdentity;
    vi.spyOn(processIdentity, 'inspectProcessIdentity').mockImplementation((pid, record, dependencies) =>
      inspect(pid, record, {
        ...dependencies,
        readIdentity: (target) => (target === process.pid ? identity : undefined),
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  function enableFileLocks(): Set<string> {
    const held = new Set<string>();
    vi.mocked(runtimeFileLock.acquireRuntimeFileLock).mockImplementation((file) => {
      if (held.has(file)) throw new Error('filesystem lock is held');
      held.add(file);
      return {
        release: () => {
          held.delete(file);
        },
      };
    });
    return held;
  }

  it('does not steal a flock owner even when identity cannot see its namespace', () => {
    enableFileLocks();
    const owner = claimRuntimeScope(configDir, { kind: 'foreground-http' });
    vi.mocked(processIdentity.inspectProcessIdentity).mockReturnValue('unknown');
    expect(() => claimRuntimeScope(configDir, { kind: 'foreground-http' })).toThrow(/lock is held/);
    expect(readRuntimeScopeOwnership(configDir)?.claimId).toBe(owner.record.claimId);
    owner.release();
  });

  it('reclaims abandoned flock owner and stop records despite reused PID and foreign namespace', () => {
    enableFileLocks();
    const foreignIdentity = { platform: 'linux', bootId: 'test-boot', pidNamespace: 'pid:[foreign]', startTime: '123' };
    writeOwnerRecord(
      JSON.stringify({
        version: 1,
        pid: process.pid,
        claimId: 'old-container',
        kind: 'foreground-http',
        claimedAt: '2026-07-22T00:00:00.000Z',
        coordination: 'flock',
        processIdentity: foreignIdentity,
      }),
    );
    fs.mkdirSync(stopLockPath);
    fs.writeFileSync(
      path.join(stopLockPath, 'lock.json'),
      JSON.stringify({
        version: 1,
        operationId: 'old-stop',
        ownerClaimId: 'old-container',
        pid: process.pid,
        acquiredAt: '2026-07-22T00:00:00.000Z',
        coordination: 'flock',
        processIdentity: foreignIdentity,
      }),
    );
    const replacement = claimRuntimeScope(configDir, { kind: 'foreground-http' });
    expect(replacement.record.coordination).toBe('flock');
    expect(replacement.record.claimId).not.toBe('old-container');
    expect(fs.existsSync(stopLockPath)).toBe(false);
    replacement.release();
  });

  it.each([process.pid, 99999999])(
    'does not reclaim legacy owner PID %s using only liveness or an unrelated flock',
    (pid) => {
      enableFileLocks();
      fs.mkdirSync(ownerPath);
      fs.writeFileSync(
        ownerRecordPath,
        JSON.stringify({
          version: 1,
          pid,
          claimId: 'legacy',
          kind: 'foreground-http',
          claimedAt: '2026-07-22T00:00:00.000Z',
        }),
      );
      expect(() => claimRuntimeScope(configDir, { kind: 'foreground-http' })).toThrow(RuntimeScopeOwnedError);
      expect(readRuntimeScopeOwnership(configDir)?.claimId).toBe('legacy');
    },
  );

  it('cannot reclaim a flock-marked record on a platform without flock evidence', () => {
    writeOwnerRecord(
      JSON.stringify({
        version: 1,
        pid: process.pid,
        claimId: 'foreign',
        kind: 'foreground-http',
        claimedAt: '2026-07-22T00:00:00.000Z',
        coordination: 'flock',
        processIdentity: { platform: 'linux', bootId: 'foreign-boot', pidNamespace: 'pid:[foreign]', startTime: '123' },
      }),
    );
    expect(() => claimRuntimeScope(configDir, { kind: 'foreground-http' })).toThrow(RuntimeScopeOwnedError);
  });

  it('reclaims a different process incarnation with the same PID using identity evidence', () => {
    writeOwnerRecord(
      JSON.stringify({
        version: 1,
        pid: process.pid,
        claimId: 'reused-pid',
        kind: 'foreground-http',
        claimedAt: '2026-07-22T00:00:00.000Z',
        processIdentity: { platform: 'linux', bootId: 'test-boot', pidNamespace: 'pid:[100]', startTime: '122' },
      }),
    );
    const replacement = claimRuntimeScope(configDir, { kind: 'foreground-http' });
    expect(replacement.record.claimId).not.toBe('reused-pid');
    replacement.release();
  });

  it('holds stop serialization even when stop metadata has already been removed', () => {
    enableFileLocks();
    const owner = claimRuntimeScope(configDir, { kind: 'background-supervisor' });
    const lock = acquireRuntimeScopeStopLock(configDir, owner.record);
    fs.rmSync(stopLockPath, { recursive: true });
    expect(() => verifyRuntimeScopeOwnership(configDir, owner.record.claimId, 'background-supervisor')).toThrow(
      /lock is held/,
    );
    owner.release();
    expect(() => claimRuntimeScope(configDir, { kind: 'foreground-http' })).toThrow(/lock is held/);
    lock.release();
    claimRuntimeScope(configDir, { kind: 'foreground-http' }).release();
  });

  it('does not reclaim an abandoned supervisor lock when its worker is in an unobservable namespace', () => {
    enableFileLocks();
    const foreignIdentity = { platform: 'linux', bootId: 'test-boot', pidNamespace: 'pid:[foreign]', startTime: '123' };
    writeOwnerRecord(
      JSON.stringify({
        version: 1,
        pid: 99999999,
        claimId: 'foreign-supervisor',
        kind: 'background-supervisor',
        claimedAt: '2026-07-22T00:00:00.000Z',
        coordination: 'flock',
        processIdentity: foreignIdentity,
      }),
    );
    writeBackgroundSupervisorState(configDir, {
      version: 1,
      status: 'running',
      supervisorPid: 99999999,
      runtimePid: 99999998,
      runtimeIdentity: { platform: 'linux', bootId: 'test-boot', pidNamespace: 'pid:[foreign]', startTime: '456' },
      restartAttempt: 0,
      lastExit: null,
      nextRetryAt: null,
      readyAt: '2026-07-22T00:00:01.000Z',
      updatedAt: '2026-07-22T00:00:01.000Z',
    });
    expect(() => claimRuntimeScope(configDir, { kind: 'foreground-http' })).toThrow(/orphaned runtime/);
    expect(readRuntimeScopeOwnership(configDir)?.claimId).toBe('foreign-supervisor');
  });

  it('keeps legacy stop metadata closed even when its numeric PID is dead', () => {
    enableFileLocks();
    fs.mkdirSync(stopLockPath);
    fs.writeFileSync(
      path.join(stopLockPath, 'lock.json'),
      JSON.stringify({
        version: 1,
        operationId: 'legacy-stop',
        ownerClaimId: 'old',
        pid: 99999999,
        acquiredAt: '2026-07-22T00:00:00.000Z',
      }),
    );
    expect(() => claimRuntimeScope(configDir, { kind: 'foreground-http' })).toThrow(/cannot be verified/);
  });

  it('releases kernel locks after failed candidate publication and permits retry', () => {
    const held = enableFileLocks();
    vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
      throw new Error('write failed');
    });
    expect(() => claimRuntimeScope(configDir, { kind: 'foreground-http' })).toThrow(/write failed/);
    expect(held.size).toBe(0);
    claimRuntimeScope(configDir, { kind: 'foreground-http' }).release();
    expect(held.size).toBe(0);
  });

  it('allows exactly one winner when claims race for an empty scope', async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        Promise.resolve().then(() =>
          claimRuntimeScope(configDir, {
            kind: index === 0 ? 'foreground-http' : 'foreground-stdio',
            pid: process.pid,
          }),
        ),
      ),
    );

    const winners = attempts.filter(
      (attempt): attempt is PromiseFulfilledResult<ReturnType<typeof claimRuntimeScope>> =>
        attempt.status === 'fulfilled',
    );
    const losers = attempts.filter((attempt) => attempt.status === 'rejected');

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(7);
    expect(losers.every((attempt) => attempt.reason instanceof RuntimeScopeOwnedError)).toBe(true);

    winners[0].value.release();
  });

  it('does not expose partial ownership when record creation fails', () => {
    vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
      expect(fs.existsSync(ownerPath)).toBe(false);
      throw new Error('simulated creator crash');
    });

    expect(() => claimRuntimeScope(configDir, { kind: 'foreground-http' })).toThrow('simulated creator crash');
    expect(fs.existsSync(ownerPath)).toBe(false);

    const replacement = claimRuntimeScope(configDir, { kind: 'foreground-http' });
    replacement.release();
  });

  it('warns when an unexpected candidate cleanup error leaves an irrelevant file', () => {
    const originalRmSync = fs.rmSync;
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    vi.spyOn(fs, 'rmSync').mockImplementation(((filePath: fs.PathLike, options?: fs.RmDirOptions) => {
      if (String(filePath).endsWith('.candidate')) {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      }
      return originalRmSync(filePath, options);
    }) as typeof fs.rmSync);

    const owner = claimRuntimeScope(configDir, { kind: 'foreground-http' });

    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/candidate cleanup failed.*\.candidate.*denied/i));
    owner.release();
  });

  it('fails closed when a live process owns the scope', () => {
    const owner = claimRuntimeScope(configDir, { kind: 'foreground-http', pid: process.pid });

    expect(() => claimRuntimeScope(configDir, { kind: 'foreground-stdio', pid: process.pid })).toThrow(
      RuntimeScopeOwnedError,
    );

    owner.release();
  });

  it('blocks claim and worker authorization throughout stop metadata cleanup', () => {
    const owner = claimRuntimeScope(configDir, { kind: 'background-supervisor', pid: 99999991 });
    const processAlive = (pid: number) => pid === process.pid;
    const stopLock = acquireRuntimeScopeStopLock(configDir, owner.record, {
      processAlive,
      createClaimId: () => 'stop-operation',
    });

    expect(fs.existsSync(getRuntimeScopeStopLockPath(configDir))).toBe(true);
    expect(() => claimRuntimeScope(configDir, { kind: 'foreground-http' }, { processAlive })).toThrow(
      expect.objectContaining({ reason: 'ambiguous' }),
    );
    expect(() =>
      verifyRuntimeScopeOwnership(configDir, owner.record.claimId, 'background-supervisor', processAlive),
    ).toThrow(expect.objectContaining({ reason: 'ambiguous' }));
    expect(() => reclaimStaleRuntimeScopeOwnership(configDir, owner.record, processAlive)).toThrow(
      expect.objectContaining({ reason: 'ambiguous' }),
    );

    stopLock.release();
    expect(fs.existsSync(getRuntimeScopeStopLockPath(configDir))).toBe(false);
    const replacement = claimRuntimeScope(configDir, { kind: 'foreground-http' }, { processAlive });
    replacement.release();
  });

  it('rolls back a claim published after stop locking but before owner removal', () => {
    const owner = claimRuntimeScope(configDir, { kind: 'background-supervisor', pid: 99999991 });
    const processAlive = (pid: number) => pid === process.pid;
    const originalRenameSync = fs.renameSync;
    let stopLock: ReturnType<typeof acquireRuntimeScopeStopLock> | undefined;
    let interleaved = false;
    vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (!interleaved && String(source).endsWith('.candidate') && destination === ownerPath) {
        interleaved = true;
        stopLock = acquireRuntimeScopeStopLock(configDir, owner.record, {
          processAlive,
          createClaimId: () => 'stop-operation',
        });
        owner.release();
      }
      return originalRenameSync(source, destination);
    });

    expect(() => claimRuntimeScope(configDir, { kind: 'foreground-http' }, { processAlive })).toThrow(
      expect.objectContaining({ reason: 'ambiguous' }),
    );
    expect(readRuntimeScopeOwnership(configDir)).toBeNull();
    expect(fs.existsSync(getRuntimeScopeStopLockPath(configDir))).toBe(true);

    stopLock?.release();
  });

  it('rolls back a published stop lock when ownership inspection fails', () => {
    const owner = claimRuntimeScope(configDir, { kind: 'background-supervisor' });
    const originalReadFileSync = fs.readFileSync;
    vi.spyOn(fs, 'readFileSync').mockImplementation(((file, ...args: unknown[]) => {
      if (file === ownerRecordPath && fs.existsSync(stopLockPath)) {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      }
      return originalReadFileSync(file, ...(args as []));
    }) as typeof fs.readFileSync);

    expect(() => acquireRuntimeScopeStopLock(configDir, owner.record)).toThrow('denied');
    expect(fs.existsSync(stopLockPath)).toBe(false);

    vi.mocked(fs.readFileSync).mockRestore();
    owner.release();
  });

  it('does not let a stale stop-lock release remove a replacement generation', () => {
    const owner = claimRuntimeScope(configDir, { kind: 'background-supervisor' });
    const oldLock = acquireRuntimeScopeStopLock(configDir, owner.record, {
      createClaimId: () => 'old-stop-operation',
    });
    const originalRmdirSync = fs.rmdirSync;
    let replacement: ReturnType<typeof acquireRuntimeScopeStopLock> | undefined;
    let interleaved = false;
    const rmdirSpy = vi.spyOn(fs, 'rmdirSync').mockImplementation(((directory: fs.PathLike) => {
      if (directory === stopLockPath && !interleaved) {
        interleaved = true;
        originalRmdirSync(directory);
        replacement = acquireRuntimeScopeStopLock(configDir, owner.record, {
          createClaimId: () => 'replacement-stop-operation',
        });
        return;
      }
      return originalRmdirSync(directory);
    }) as typeof fs.rmdirSync);

    oldLock.release();

    expect(fs.existsSync(path.join(stopLockPath, 'lock.json'))).toBe(true);
    rmdirSpy.mockRestore();
    replacement?.release();
    owner.release();
  });

  it.each([
    ['malformed', '{not-json'],
    ['schema-invalid', JSON.stringify({ version: 1, pid: process.pid })],
  ])('fails closed when ownership metadata is %s', (_label, content) => {
    writeOwnerRecord(content);

    expect(() => claimRuntimeScope(configDir, { kind: 'foreground-http' })).toThrow(
      expect.objectContaining({ reason: 'ambiguous' }),
    );
  });

  it('fails closed when ownership metadata is unreadable', () => {
    const originalReadFileSync = fs.readFileSync;
    vi.spyOn(fs, 'readFileSync').mockImplementation(((file, ...args: unknown[]) => {
      if (file === ownerRecordPath) {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      }
      return originalReadFileSync(file, ...(args as []));
    }) as typeof fs.readFileSync);
    writeOwnerRecord('{}');

    expect(() => claimRuntimeScope(configDir, { kind: 'foreground-http' })).toThrow(
      expect.objectContaining({ reason: 'ambiguous' }),
    );
  });

  it('reclaims valid ownership left by a dead process', () => {
    writeOwnerRecord(
      JSON.stringify({
        version: 1,
        pid: 99999999,
        claimId: 'dead-owner',
        kind: 'foreground-http',
        claimedAt: '2026-07-22T00:00:00.000Z',
      }),
    );

    const owner = claimRuntimeScope(configDir, { kind: 'foreground-stdio', pid: process.pid });

    expect(owner.record.pid).toBe(process.pid);
    expect(owner.record.kind).toBe('foreground-stdio');
    expect(owner.record.claimId).not.toBe('dead-owner');

    owner.release();
  });

  it('reclaims valid ownership on Windows when fs.renameSync throws EPERM', () => {
    writeOwnerRecord(
      JSON.stringify({
        version: 1,
        pid: 99999999,
        claimId: 'dead-owner',
        kind: 'foreground-http',
        claimedAt: '2026-07-22T00:00:00.000Z',
      }),
    );

    const originalRenameSync = fs.renameSync;
    let collisionInjected = false;
    vi.spyOn(fs, 'renameSync').mockImplementation(((source: fs.PathLike, destination: fs.PathLike) => {
      // Simulate Windows EPERM directory collision error
      if (!collisionInjected && String(source).endsWith('.candidate') && destination === ownerPath) {
        collisionInjected = true;
        throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
      }
      return originalRenameSync(source, destination);
    }) as typeof fs.renameSync);

    const owner = claimRuntimeScope(configDir, { kind: 'foreground-stdio', pid: process.pid });

    expect(owner.record.pid).toBe(process.pid);
    expect(owner.record.kind).toBe('foreground-stdio');
    expect(owner.record.claimId).not.toBe('dead-owner');

    owner.release();
  });

  it('does not let an ownership release remove a replacement published before directory removal', () => {
    const staleRecord = {
      version: 1 as const,
      pid: 99999999,
      claimId: 'dead-owner',
      kind: 'foreground-http' as const,
      claimedAt: '2026-07-22T00:00:00.000Z',
    };
    writeOwnerRecord(JSON.stringify(staleRecord));
    const originalRenameSync = fs.renameSync;
    let nestedRelease: boolean | undefined;
    let replacement: ReturnType<typeof claimRuntimeScope> | undefined;
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(((
      source: fs.PathLike,
      destination: fs.PathLike,
    ) => {
      originalRenameSync(source, destination);
      if (source === ownerRecordPath) {
        nestedRelease = releaseRuntimeScopeOwnership(configDir, staleRecord);
        replacement = claimRuntimeScope(configDir, {
          kind: 'foreground-http',
          pid: process.pid,
        });
      }
    }) as typeof fs.renameSync);

    expect(releaseRuntimeScopeOwnership(configDir, staleRecord)).toBe(true);
    expect(nestedRelease).toBe(true);
    expect(readRuntimeScopeOwnership(configDir)).toEqual(replacement?.record);
    renameSpy.mockRestore();
    replacement?.release();
  });

  it('does not reclaim a dead supervisor claim while its orphaned worker is alive', () => {
    writeOwnerRecord(
      JSON.stringify({
        version: 1,
        pid: 99999999,
        claimId: 'dead-supervisor',
        kind: 'background-supervisor',
        claimedAt: '2026-07-22T00:00:00.000Z',
      }),
    );
    writeBackgroundSupervisorState(configDir, {
      version: 1,
      status: 'running',
      supervisorPid: 99999999,
      runtimePid: process.pid,
      restartAttempt: 0,
      lastExit: null,
      nextRetryAt: null,
      readyAt: '2026-07-22T00:00:01.000Z',
      updatedAt: '2026-07-22T00:00:01.000Z',
    });

    expect(() => claimRuntimeScope(configDir, { kind: 'foreground-http' })).toThrow(
      expect.objectContaining({ reason: 'owned' }),
    );
    expect(fs.existsSync(ownerPath)).toBe(true);
  });

  it('fails closed during the supervisor spawn-to-state-publication window', () => {
    const ownerRecord = {
      version: 1 as const,
      pid: 99999999,
      claimId: 'dead-supervisor',
      kind: 'background-supervisor' as const,
      claimedAt: '2026-07-22T00:00:00.000Z',
    };
    writeOwnerRecord(JSON.stringify(ownerRecord));
    writeBackgroundSupervisorState(configDir, {
      version: 1,
      status: 'starting',
      supervisorPid: ownerRecord.pid,
      runtimePid: null,
      restartAttempt: 0,
      lastExit: null,
      nextRetryAt: null,
      readyAt: null,
      updatedAt: '2026-07-22T00:00:01.000Z',
    });

    expect(() => claimRuntimeScope(configDir, { kind: 'foreground-http' })).toThrow(
      expect.objectContaining({ reason: 'ambiguous' }),
    );
    expect(() => reclaimStaleRuntimeScopeOwnership(configDir, ownerRecord)).toThrow(
      expect.objectContaining({ reason: 'ambiguous' }),
    );
    expect(fs.existsSync(ownerPath)).toBe(true);
  });

  it.each(['restarting', 'crash-loop', 'stopping'] as const)(
    'reclaims a dead supervisor with safe %s state and no worker',
    (status) => {
      const ownerRecord = {
        version: 1 as const,
        pid: 99999999,
        claimId: `dead-supervisor-${status}`,
        kind: 'background-supervisor' as const,
        claimedAt: '2026-07-22T00:00:00.000Z',
      };
      writeOwnerRecord(JSON.stringify(ownerRecord));
      writeBackgroundSupervisorState(configDir, {
        version: 1,
        status,
        supervisorPid: ownerRecord.pid,
        runtimePid: null,
        restartAttempt: status === 'crash-loop' ? 5 : 1,
        lastExit: null,
        nextRetryAt: status === 'restarting' ? '2026-07-22T00:00:02.000Z' : null,
        readyAt: null,
        updatedAt: '2026-07-22T00:00:01.000Z',
      });

      expect(reclaimStaleRuntimeScopeOwnership(configDir, ownerRecord)).toBe(true);
      expect(fs.existsSync(ownerPath)).toBe(false);
    },
  );

  it('reclaims a dead supervisor when no supervisor state or runtime PID exists', () => {
    const ownerRecord = {
      version: 1 as const,
      pid: 99999999,
      claimId: 'dead-supervisor-before-start',
      kind: 'background-supervisor' as const,
      claimedAt: '2026-07-22T00:00:00.000Z',
    };
    writeOwnerRecord(JSON.stringify(ownerRecord));

    expect(reclaimStaleRuntimeScopeOwnership(configDir, ownerRecord)).toBe(true);
    expect(fs.existsSync(ownerPath)).toBe(false);
  });

  it('does not reclaim a dead supervisor claim when a live PID record exists before state publication', () => {
    writeOwnerRecord(
      JSON.stringify({
        version: 1,
        pid: 99999999,
        claimId: 'dead-supervisor',
        kind: 'background-supervisor',
        claimedAt: '2026-07-22T00:00:00.000Z',
      }),
    );
    writePidFile(configDir, {
      pid: process.pid,
      url: 'http://localhost:3050/mcp',
      port: 3050,
      host: 'localhost',
      transport: 'http',
      startedAt: '2026-07-22T00:00:01.000Z',
      configDir,
    });

    expect(() => claimRuntimeScope(configDir, { kind: 'foreground-http' })).toThrow(
      expect.objectContaining({ reason: 'owned' }),
    );
    expect(fs.existsSync(ownerPath)).toBe(true);
  });

  it('fails closed when dead supervisor ownership has malformed PID metadata', () => {
    writeOwnerRecord(
      JSON.stringify({
        version: 1,
        pid: 99999999,
        claimId: 'dead-supervisor',
        kind: 'background-supervisor',
        claimedAt: '2026-07-22T00:00:00.000Z',
      }),
    );
    fs.writeFileSync(path.join(configDir, 'server.pid'), '{not-json', 'utf8');

    expect(() => claimRuntimeScope(configDir, { kind: 'foreground-http' })).toThrow(
      expect.objectContaining({ reason: 'ambiguous' }),
    );
    expect(fs.existsSync(ownerPath)).toBe(true);
  });

  it('fails closed when dead supervisor ownership conflicts with unreadable state', () => {
    writeOwnerRecord(
      JSON.stringify({
        version: 1,
        pid: 99999999,
        claimId: 'dead-supervisor',
        kind: 'background-supervisor',
        claimedAt: '2026-07-22T00:00:00.000Z',
      }),
    );
    fs.writeFileSync(path.join(configDir, 'background-runtime.json'), '{not-json', 'utf8');

    expect(() => claimRuntimeScope(configDir, { kind: 'foreground-http' })).toThrow(
      expect.objectContaining({ reason: 'ambiguous' }),
    );
    expect(fs.existsSync(ownerPath)).toBe(true);
  });

  it('only releases the matching claim', () => {
    const owner = claimRuntimeScope(configDir, { kind: 'foreground-http', pid: process.pid });
    const replacement = {
      ...owner.record,
      claimId: 'replacement-owner',
    };
    fs.writeFileSync(ownerRecordPath, JSON.stringify(replacement), 'utf8');

    owner.release();

    expect(JSON.parse(fs.readFileSync(ownerRecordPath, 'utf8'))).toEqual(replacement);
  });

  it('allows recovery cleanup only for the observed claim ID and PID', () => {
    const owner = claimRuntimeScope(configDir, { kind: 'background-supervisor', pid: process.pid });

    expect(
      releaseRuntimeScopeOwnership(configDir, {
        claimId: owner.record.claimId,
        pid: process.pid + 1,
      }),
    ).toBe(false);
    expect(fs.existsSync(ownerPath)).toBe(true);
    expect(
      releaseRuntimeScopeOwnership(configDir, {
        claimId: owner.record.claimId,
        pid: owner.record.pid,
      }),
    ).toBe(true);
    expect(fs.existsSync(ownerPath)).toBe(false);
  });

  it('authorizes a supervised worker only for the matching live supervisor claim', () => {
    const owner = claimRuntimeScope(configDir, { kind: 'background-supervisor', pid: process.pid });

    expect(verifyRuntimeScopeOwnership(configDir, owner.record.claimId, 'background-supervisor')).toEqual(owner.record);
    expect(() => verifyRuntimeScopeOwnership(configDir, 'wrong-claim', 'background-supervisor')).toThrow(
      RuntimeScopeOwnedError,
    );

    owner.release();
  });

  it('rejects worker authorization when stop locking interleaves after ownership verification', () => {
    const owner = claimRuntimeScope(configDir, { kind: 'background-supervisor' });
    const originalReadFileSync = fs.readFileSync;
    let stopLock: ReturnType<typeof acquireRuntimeScopeStopLock> | undefined;
    let interleaved = false;
    vi.spyOn(fs, 'readFileSync').mockImplementation(((file, ...args: unknown[]) => {
      const result = originalReadFileSync(file, ...(args as []));
      if (file === ownerRecordPath && !interleaved) {
        interleaved = true;
        stopLock = acquireRuntimeScopeStopLock(configDir, owner.record, {
          createClaimId: () => 'interleaved-stop-operation',
        });
      }
      return result;
    }) as typeof fs.readFileSync);

    expect(() => verifyRuntimeScopeOwnership(configDir, owner.record.claimId, 'background-supervisor')).toThrow(
      expect.objectContaining({ reason: 'ambiguous' }),
    );

    vi.restoreAllMocks();
    stopLock?.release();
    owner.release();
  });
});
