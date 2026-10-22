import fs from 'node:fs';
import path from 'node:path';

import logger from '@src/logger/logger.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { readPidFile, writePidFile } from './pidFileManager.js';
import { scheduleRuntimeOwnershipIdentityRepair } from './runtimeOwnershipIdentityRepair.js';
import { claimRuntimeScope, readRuntimeScopeOwnership } from './runtimeScopeOwnership.js';

const identity = {
  platform: 'linux' as const,
  bootId: 'boot',
  pidNamespace: 'pid:[1]',
  startTime: '1',
};

function unavailable() {
  return {
    failure: { platform: 'win32' as const, pid: process.pid, elapsedMs: 3000, code: 'ETIMEDOUT' },
  };
}

describe('runtime ownership identity repair', () => {
  const configDir = path.join(process.cwd(), '.tmp-test-identity-repair');

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  function claimDegraded() {
    const owner = claimRuntimeScope(configDir, { kind: 'foreground-http' }, { acquireIdentity: unavailable });
    writePidFile(configDir, {
      pid: owner.record.pid,
      url: 'http://127.0.0.1:3050/mcp',
      port: 3050,
      host: '127.0.0.1',
      transport: 'http',
      startedAt: new Date().toISOString(),
      configDir,
      identityEvidence: owner.record.identityEvidence,
    });
    return owner;
  }

  it('repairs the owner and PID records after the first delay and then stops', async () => {
    vi.useFakeTimers();
    const owner = claimDegraded();
    const acquire = vi.fn(() => ({ identity }));
    const stop = scheduleRuntimeOwnershipIdentityRepair({
      runtimeScope: configDir,
      pid: owner.record.pid,
      claimId: owner.record.claimId,
      acquireIdentity: acquire,
    });

    await vi.advanceTimersByTimeAsync(9_999);
    expect(acquire).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(readRuntimeScopeOwnership(configDir)?.processIdentity).toEqual(identity);
    expect(readRuntimeScopeOwnership(configDir)?.identityEvidence).toBeUndefined();
    expect(readPidFile(configDir)?.processIdentity).toEqual(identity);
    expect(readPidFile(configDir)?.identityEvidence).toBeUndefined();

    await vi.advanceTimersByTimeAsync(120_000);
    expect(acquire).toHaveBeenCalledTimes(1);
    stop();
    owner.release();
  });

  it('never overwrites a replacement ownership generation', async () => {
    vi.useFakeTimers();
    const owner = claimDegraded();
    owner.release();
    const replacement = claimRuntimeScope(
      configDir,
      { kind: 'foreground-http' },
      { acquireIdentity: () => ({ identity }) },
    );
    const stop = scheduleRuntimeOwnershipIdentityRepair({
      runtimeScope: configDir,
      pid: owner.record.pid,
      claimId: owner.record.claimId,
      acquireIdentity: () => ({ identity }),
    });

    await vi.advanceTimersByTimeAsync(10_000);

    expect(readRuntimeScopeOwnership(configDir)?.claimId).toBe(replacement.record.claimId);
    expect(readRuntimeScopeOwnership(configDir)?.processIdentity).toEqual(identity);
    stop();
    replacement.release();
  });

  it('retries after failed acquisition and reports exhaustion after the bounded budget', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    const owner = claimDegraded();
    const acquire = vi.fn(unavailable);
    scheduleRuntimeOwnershipIdentityRepair({
      runtimeScope: configDir,
      pid: owner.record.pid,
      claimId: owner.record.claimId,
      acquireIdentity: acquire,
    });

    await vi.advanceTimersByTimeAsync(200_000);

    expect(acquire).toHaveBeenCalledTimes(5);
    expect(warn).toHaveBeenCalledWith(
      'runtimeScopeOwnership.identity.repair.exhausted',
      expect.objectContaining({ attempts: 5 }),
    );
    expect(readRuntimeScopeOwnership(configDir)?.identityEvidence).toBeDefined();
    owner.release();
  });
});
