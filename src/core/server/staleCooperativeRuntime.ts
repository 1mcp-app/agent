import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import { cleanupBackgroundLaunchConfig } from './backgroundLaunchConfig.js';
import {
  type BackgroundSupervisorState,
  cleanupBackgroundSupervisorState,
  readBackgroundSupervisorState,
} from './backgroundRuntimeSupervisorState.js';
import { cleanupPidFileIfMatches, getPidFilePath, readPidFile, type ServerPidInfo } from './pidFileManager.js';
import { cleanupRuntimeControlFiles } from './runtimeControl.js';
import {
  acquireRuntimeScopeStopLock,
  readRuntimeScopeOwnership,
  releaseRuntimeScopeOwnership,
  type RuntimeScopeOwnershipRecord,
} from './runtimeScopeOwnership.js';

export interface StaleCooperativeRuntime {
  owner: RuntimeScopeOwnershipRecord;
  supervisor: BackgroundSupervisorState | null;
  runtime: ServerPidInfo | null;
}

/** Read-only evidence for explicit restart recovery; a failed control probe alone is insufficient. */
export function readStaleCooperativeRuntime(
  configDir: string,
  expectedClaimId?: string,
): StaleCooperativeRuntime | null {
  const owner = readRuntimeScopeOwnership(configDir);
  if (!owner?.cooperative) return null;
  if (owner.kind !== 'background-supervisor') return null;
  if (expectedClaimId !== undefined && owner.claimId !== expectedClaimId) return null;
  if (owner.processIdentity) return null;

  const supervisor = readBackgroundSupervisorState(configDir);
  if (supervisor) {
    if (supervisor.supervisorPid !== owner.pid) return null;
    if (supervisor.claimId !== undefined && supervisor.claimId !== owner.claimId) return null;
    if (supervisor.supervisorIdentity || supervisor.runtimeIdentity) return null;
  }
  const runtime = readPidFile(configDir);
  if (!runtime && fs.existsSync(getPidFilePath(configDir))) return null;
  if (runtime) {
    if (runtime.ownerClaimId !== owner.claimId) return null;
    if (runtime.processIdentity) return null;
    if (fs.realpathSync(runtime.configDir) !== fs.realpathSync(configDir)) return null;
    if (supervisor?.runtimePid !== null && supervisor?.runtimePid !== undefined) {
      if (runtime.pid !== supervisor.runtimePid) return null;
    }
  }

  if (!processIsAbsent(owner.pid)) return null;
  if (supervisor?.runtimePid && !processIsAbsent(supervisor.runtimePid)) return null;
  if (runtime && !processIsAbsent(runtime.pid)) return null;
  return { owner, supervisor, runtime };
}

function processIsAbsent(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    // Permission failures and other inspection errors never establish absence.
    return error instanceof Error && 'code' in error && error.code === 'ESRCH';
  }
}

/** Retire only the observed, absent generation while holding the existing lifecycle stop lock. */
export function retireStaleCooperativeRuntime(configDir: string, expected: StaleCooperativeRuntime): void {
  const lock = acquireRuntimeScopeStopLock(configDir, expected.owner, { cooperative: true });
  try {
    const current = readStaleCooperativeRuntime(configDir, expected.owner.claimId);
    if (!current || !isDeepStrictEqual(current, expected)) {
      throw new Error('Runtime ownership or process evidence changed before stale recovery; metadata retained');
    }
    if (!cleanupRuntimeControlFiles(configDir, expected.owner.claimId)) {
      throw new Error('Runtime control metadata changed or could not be removed; ownership retained');
    }
    if (expected.runtime && !cleanupPidFileIfMatches(configDir, expected.runtime)) {
      throw new Error('Runtime PID metadata could not be removed; ownership retained');
    }
    if (!cleanupBackgroundLaunchConfig(configDir, expected.owner.claimId)) {
      throw new Error('Runtime launch metadata changed; ownership retained');
    }
    if (expected.supervisor) {
      if (!cleanupBackgroundSupervisorState(configDir, expected.owner.pid, expected.supervisor.claimId)) {
        throw new Error('Runtime supervisor metadata changed; ownership retained');
      }
    }
    if (!releaseRuntimeScopeOwnership(configDir, expected.owner)) {
      throw new Error('Runtime ownership changed before stale recovery completed');
    }
  } finally {
    lock.release();
  }
}
