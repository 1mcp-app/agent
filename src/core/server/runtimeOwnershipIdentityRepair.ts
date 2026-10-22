import path from 'node:path';

import { readPidFile, writePidFile } from '@src/core/server/pidFileManager.js';
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
}

type RepairOutcome = 'repaired' | 'ownership-changed' | 'retry';

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
      });
      return;
    }
    timer = setTimeout(run, delays[attempt]);
    timer.unref?.();
  };

  const run = (): void => {
    if (cancelled) return;
    attempt += 1;
    const acquisition = acquireIdentity(options.pid);
    logger.debug('runtimeScopeOwnership.identity.repair.attempt', {
      attempts: attempt,
      elapsedMs: Date.now() - startedAt,
    });
    if (!acquisition.identity) {
      scheduleNext();
      return;
    }
    const outcome = repairOnce(options, acquisition.identity);
    if (outcome === 'ownership-changed') {
      stop();
      return;
    }
    if (outcome === 'retry') {
      scheduleNext();
      return;
    }
    logger.info('runtimeScopeOwnership.identity.repaired', {
      attempts: attempt,
      elapsedMs: Date.now() - startedAt,
    });
    stop();
  };

  scheduleNext();
  return stop;
}

function repairOnce(options: RuntimeOwnershipIdentityRepairOptions, identity: ProcessIdentity): RepairOutcome {
  const owner = readRuntimeScopeOwnership(options.runtimeScope);
  if (!owner || owner.pid !== options.pid || owner.claimId !== options.claimId) {
    return 'ownership-changed';
  }
  try {
    const updated = updateRuntimeScopeOwnershipIdentity(
      options.runtimeScope,
      { pid: options.pid, claimId: options.claimId },
      identity,
    );
    if (!updated) return 'ownership-changed';
    repairPidFile(options, identity);
    return 'repaired';
  } catch (error) {
    logger.warn('runtimeScopeOwnership.identity.repair.failed', { error: error });
    return 'retry';
  }
}

function repairPidFile(options: RuntimeOwnershipIdentityRepairOptions, identity: ProcessIdentity): void {
  let info;
  try {
    info = readPidFile(options.runtimeScope);
  } catch {
    return;
  }
  if (!info || info.pid !== options.pid || info.ownerClaimId) return;
  if (path.resolve(info.configDir) !== path.resolve(options.runtimeScope)) return;
  writePidFile(options.runtimeScope, { ...info, processIdentity: identity, identityEvidence: undefined });
}
