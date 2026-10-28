import fs from 'node:fs';
import path from 'node:path';

import { getPidFilePath, readPidFile, writePidFile } from '@src/core/server/pidFileManager.js';
import { acquireProcessIdentity, type ProcessIdentity } from '@src/core/server/processIdentity.js';
import {
  readRuntimeScopeOwnership,
  updateRuntimeScopeOwnershipIdentity,
} from '@src/core/server/runtimeScopeOwnership.js';
import logger from '@src/logger/logger.js';

/** Delayed first attempt, then bounded exponential backoff; success stops the loop. */
export const DEFAULT_IDENTITY_REPAIR_DELAYS_MS = [10_000, 20_000, 40_000, 60_000, 60_000] as const;

export interface RuntimeOwnershipIdentityRepairOptions {
  runtimeScope: string;
  pid: number;
  claimId: string;
  delaysMs?: readonly number[];
  acquireIdentity?: typeof acquireProcessIdentity;
  readPidFile?: typeof readPidFile;
  writePidFile?: typeof writePidFile;
}

export type PidRepairOutcome = 'repaired' | 'skipped' | 'retry' | 'ownership-changed' | 'unsafe';
type PidOutcomeOrNotAttempted = PidRepairOutcome | 'not-attempted';
type RepairOutcome = 'repaired' | 'ownership-changed' | 'retry' | 'unsafe';

interface RepairAttemptResult {
  outcome: RepairOutcome;
  pidOutcome: PidOutcomeOrNotAttempted;
}

/**
 * Repairs one degraded ownership generation once the claiming process can read
 * its own birth evidence. The record's pid+claimId must still match, so a
 * released, reclaimed, or replaced generation is never overwritten.
 */
export function scheduleRuntimeOwnershipIdentityRepair(options: RuntimeOwnershipIdentityRepairOptions): () => void {
  const delays = options.delaysMs ?? DEFAULT_IDENTITY_REPAIR_DELAYS_MS;
  const acquireIdentity = options.acquireIdentity ?? acquireProcessIdentity;
  const startedAt = Date.now();
  let attempt = 0;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastPidOutcome: PidOutcomeOrNotAttempted = 'not-attempted';

  const stop = (): void => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };

  const scheduleNext = (): void => {
    if (cancelled) return;
    if (attempt >= delays.length) {
      logger.warn('runtimeScopeOwnership.identity.repair.exhausted', {
        attempts: attempt,
        elapsedMs: Date.now() - startedAt,
        pid_outcome: lastPidOutcome,
      });
      return;
    }
    timer = setTimeout(run, delays[attempt]);
    timer.unref?.();
  };

  const run = (): void => {
    if (cancelled) return;
    try {
      attempt += 1;
      const acquisition = acquireIdentity(options.pid);
      logger.debug('runtimeScopeOwnership.identity.repair.attempt', {
        attempts: attempt,
        elapsedMs: Date.now() - startedAt,
      });
      if (!acquisition.identity) {
        lastPidOutcome = 'not-attempted';
        scheduleNext();
        return;
      }
      const result = repairOnce(options, acquisition.identity);
      lastPidOutcome = result.pidOutcome;
      if (result.outcome === 'ownership-changed') {
        stop();
        return;
      }
      if (result.outcome === 'retry') {
        scheduleNext();
        return;
      }
      if (result.outcome === 'unsafe') {
        logger.warn('runtimeScopeOwnership.identity.repair.unsafe', {
          attempts: attempt,
          elapsedMs: Date.now() - startedAt,
          pid_outcome: lastPidOutcome,
        });
        stop();
        return;
      }
      logger.info('runtimeScopeOwnership.identity.repaired', {
        attempts: attempt,
        elapsedMs: Date.now() - startedAt,
        pid_outcome: lastPidOutcome,
      });
      stop();
    } catch (error) {
      // A timer callback must never become an uncaught exception.
      logger.warn('runtimeScopeOwnership.identity.repair.failed', { error: error });
      stop();
    }
  };

  scheduleNext();
  return stop;
}

function repairOnce(options: RuntimeOwnershipIdentityRepairOptions, identity: ProcessIdentity): RepairAttemptResult {
  let owner;
  try {
    owner = readRuntimeScopeOwnership(options.runtimeScope);
  } catch (error) {
    // Unreadable/invalid ownership metadata cannot be safely repaired.
    logger.warn('runtimeScopeOwnership.identity.repair.failed', { error: error });
    return { outcome: 'unsafe', pidOutcome: 'not-attempted' };
  }
  if (!owner || owner.pid !== options.pid || owner.claimId !== options.claimId) {
    return { outcome: 'ownership-changed', pidOutcome: 'not-attempted' };
  }
  try {
    const updated = updateRuntimeScopeOwnershipIdentity(
      options.runtimeScope,
      { pid: options.pid, claimId: options.claimId },
      identity,
    );
    if (!updated) return { outcome: 'ownership-changed', pidOutcome: 'not-attempted' };
  } catch (error) {
    logger.warn('runtimeScopeOwnership.identity.repair.failed', { error: error });
    return { outcome: 'retry', pidOutcome: 'not-attempted' };
  }

  const pidOutcome = repairPidFile(options, identity);
  if (pidOutcome === 'retry') return { outcome: 'retry', pidOutcome };
  if (pidOutcome === 'ownership-changed') return { outcome: 'ownership-changed', pidOutcome };
  if (pidOutcome === 'unsafe') return { outcome: 'unsafe', pidOutcome };
  return { outcome: 'repaired', pidOutcome };
}

/**
 * Repairs the derived PID record. The owner record is authoritative; a
 * transient PID read/write failure is retried, a changed generation stops the
 * loop, and unreadable-but-present metadata is reported as unsafe instead of
 * being overwritten blindly.
 */
function repairPidFile(options: RuntimeOwnershipIdentityRepairOptions, identity: ProcessIdentity): PidRepairOutcome {
  const readPid = options.readPidFile ?? readPidFile;
  const writePid = options.writePidFile ?? writePidFile;
  let info;
  try {
    info = readPid(options.runtimeScope);
  } catch (error) {
    logger.warn('runtimeScopeOwnership.identity.repair.failed', { error: error });
    return 'retry';
  }
  if (!info) {
    // Missing is fine (no discovery cache); present but unparseable must not be
    // overwritten because ownership of that record cannot be verified.
    return fs.existsSync(getPidFilePath(options.runtimeScope)) ? 'unsafe' : 'skipped';
  }
  if (info.pid !== options.pid || path.resolve(info.configDir) !== path.resolve(options.runtimeScope)) {
    return 'ownership-changed';
  }
  if (info.ownerClaimId) return 'skipped';
  try {
    writePid(options.runtimeScope, { ...info, processIdentity: identity, identityEvidence: undefined });
    return 'repaired';
  } catch (error) {
    logger.warn('runtimeScopeOwnership.identity.repair.failed', { error: error });
    return 'retry';
  }
}
