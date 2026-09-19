import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import { cleanupBackgroundLaunchConfig } from '@src/core/server/backgroundLaunchConfig.js';
import {
  type BackgroundSupervisorState,
  cleanupBackgroundSupervisorState,
  readBackgroundSupervisorState,
} from '@src/core/server/backgroundRuntimeSupervisorState.js';
import { processEvidenceMatches, verifyLegacyRuntimeOwner } from '@src/core/server/legacyRuntimeRecovery.js';
import {
  cleanupPidFileIfMatches,
  getPidFilePath,
  readPidFile,
  type ServerPidInfo,
} from '@src/core/server/pidFileManager.js';
import { type ProcessEvidence, readProcessEvidence } from '@src/core/server/processEvidence.js';
import {
  readRuntimeScopeOwnership,
  releaseRuntimeScopeOwnership,
  type RuntimeScopeOwnershipRecord,
} from '@src/core/server/runtimeScopeOwnership.js';

interface LegacyStopDependencies {
  verify?: typeof verifyLegacyRuntimeOwner;
  readEvidence?: typeof readProcessEvidence;
  kill?: (pid: number, signal: 'SIGTERM' | 'SIGKILL') => void;
  exists?: (pid: number) => boolean;
  timeoutMs?: number;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
  }
}

/** Called only by explicit stop/restart while its Runtime Scope stop lock is held. */
export async function stopLegacyRuntime(
  configDir: string,
  owner: RuntimeScopeOwnershipRecord,
  state: BackgroundSupervisorState,
  info: ServerPidInfo | null,
  dependencies: LegacyStopDependencies = {},
): Promise<boolean> {
  const readEvidence = dependencies.readEvidence ?? readProcessEvidence;
  const pair = (dependencies.verify ?? verifyLegacyRuntimeOwner)(configDir, owner, state, info, { readEvidence });
  if (!pair || !info) return false;
  const kill = dependencies.kill ?? ((pid, signal) => process.kill(pid, signal));
  const exists = dependencies.exists ?? processExists;

  const checkMetadata = (allowMissing: boolean): void => {
    const currentOwner = readRuntimeScopeOwnership(configDir);
    const currentState = readBackgroundSupervisorState(configDir);
    const currentInfo = readPidFile(configDir);
    if (
      (!allowMissing && (!currentOwner || !currentState || !currentInfo)) ||
      (currentOwner && !isDeepStrictEqual(currentOwner, owner)) ||
      (currentState &&
        (currentState.supervisorPid !== owner.pid ||
          (currentState.runtimePid !== null && currentState.runtimePid !== info.pid) ||
          currentState.supervisorIdentity ||
          currentState.runtimeIdentity)) ||
      (currentInfo && !isDeepStrictEqual(currentInfo, info)) ||
      (!currentInfo && fs.existsSync(getPidFilePath(configDir)))
    ) {
      throw new Error('Legacy runtime ownership or worker changed; metadata retained and restart aborted');
    }
  };

  const status = (expected: ProcessEvidence, allowReparent: boolean): 'alive' | 'dead' | 'unknown' => {
    const observed = readEvidence(expected.pid);
    if (!observed) return exists(expected.pid) ? 'unknown' : 'dead';
    if (observed.exited) {
      // A zombie has already exited; Linux no longer exposes its mount namespace.
      const sameContext =
        observed.context.platform === expected.context.platform &&
        observed.context.bootId === expected.context.bootId &&
        (observed.context.platform !== 'linux' ||
          (expected.context.platform === 'linux' && observed.context.pidNamespace === expected.context.pidNamespace));
      return sameContext ? 'dead' : 'unknown';
    }
    if (!isDeepStrictEqual(observed.context, expected.context)) return 'unknown';
    if (observed.birth !== expected.birth) return 'dead';
    // Parent changes are expected only after the verified supervisor has exited.
    return processEvidenceMatches(expected, allowReparent ? { ...observed, ppid: expected.ppid } : observed)
      ? 'alive'
      : 'unknown';
  };

  const wait = async (expected: ProcessEvidence, allowReparent: boolean, timeout: number): Promise<boolean> => {
    const deadline = Date.now() + timeout;
    do {
      const current = status(expected, allowReparent);
      if (current === 'dead') return true;
      if (current === 'unknown')
        throw new Error('Legacy process evidence became unavailable or changed; refusing further signals');
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    return status(expected, allowReparent) === 'dead';
  };

  const terminate = async (expected: ProcessEvidence, supervisorExited: boolean): Promise<void> => {
    for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
      checkMetadata(supervisorExited || signal === 'SIGKILL');
      const current = status(expected, supervisorExited);
      if (current === 'dead') return;
      if (current !== 'alive') throw new Error('Cannot revalidate legacy process before signalling');
      if (!supervisorExited && signal === 'SIGTERM' && status(pair.worker, false) !== 'alive') {
        throw new Error('Legacy worker changed before supervisor shutdown');
      }
      try {
        kill(expected.pid, signal);
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ESRCH' &&
          status(expected, supervisorExited) === 'dead'
        )
          return;
        throw error;
      }
      if (await wait(expected, supervisorExited, signal === 'SIGTERM' ? (dependencies.timeoutMs ?? 10000) : 2000))
        return;
    }
    throw new Error('Legacy process did not exit; restart aborted');
  };

  checkMetadata(false);
  await terminate(pair.supervisor, false);
  checkMetadata(true);
  await terminate(pair.worker, true);
  checkMetadata(true);
  if (!cleanupPidFileIfMatches(configDir, info)) throw new Error('Cannot clean verified legacy PID metadata');
  checkMetadata(true);
  if (!cleanupBackgroundLaunchConfig(configDir, owner.claimId)) throw new Error('Legacy launch configuration changed');
  checkMetadata(true);
  if (!cleanupBackgroundSupervisorState(configDir, owner.pid) && readBackgroundSupervisorState(configDir)) {
    throw new Error('Legacy supervisor metadata changed');
  }
  checkMetadata(true);
  if (readRuntimeScopeOwnership(configDir) && !releaseRuntimeScopeOwnership(configDir, owner)) {
    throw new Error('Legacy ownership changed before release');
  }
  checkMetadata(true);
  return true;
}
