import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { readBackgroundSupervisorState } from '@src/core/server/backgroundRuntimeSupervisorState.js';
import { getPidFilePath, isProcessAlive, readPidFile } from '@src/core/server/pidFileManager.js';
import logger from '@src/logger/logger.js';

import { z } from 'zod';

const OWNERSHIP_DIR_NAME = 'runtime.owner';
const STOP_LOCK_NAME = 'runtime.stop';
const OWNER_RECORD_NAME = 'owner.json';
const STOP_LOCK_RECORD_NAME = 'lock.json';
const CLAIM_ATTEMPTS = 8;

export type RuntimeScopeClaimantKind = 'foreground-http' | 'foreground-stdio' | 'background-supervisor';

export interface RuntimeScopeOwnershipRecord {
  version: 1;
  pid: number;
  claimId: string;
  kind: RuntimeScopeClaimantKind;
  claimedAt: string;
}

export interface RuntimeScopeOwnership {
  record: RuntimeScopeOwnershipRecord;
  release: () => void;
}

export interface RuntimeScopeStopLock {
  release: () => void;
}

export interface RuntimeScopeClaimant {
  kind: RuntimeScopeClaimantKind;
  pid?: number;
}

export type RuntimeScopeOwnershipFailureReason = 'owned' | 'ambiguous';

export class RuntimeScopeOwnedError extends Error {
  constructor(
    public readonly ownerPath: string,
    public readonly reason: RuntimeScopeOwnershipFailureReason,
    public readonly owner: RuntimeScopeOwnershipRecord | null,
    detail?: string,
  ) {
    const ownerDescription = owner ? ` by ${owner.kind} (PID: ${owner.pid})` : '';
    super(`Runtime Scope is already owned${ownerDescription}${detail ? `: ${detail}` : ''}`);
    this.name = 'RuntimeScopeOwnedError';
  }
}

const runtimeScopeOwnershipRecordSchema = z.object({
  version: z.literal(1),
  pid: z.number().int().positive(),
  claimId: z.string().min(1),
  kind: z.enum(['foreground-http', 'foreground-stdio', 'background-supervisor']),
  claimedAt: z.string().datetime(),
}) satisfies z.ZodType<RuntimeScopeOwnershipRecord>;

const runtimeScopeStopLockSchema = z.object({
  version: z.literal(1),
  operationId: z.string().min(1),
  ownerClaimId: z.string().min(1),
  pid: z.number().int().positive(),
  acquiredAt: z.string().datetime(),
});

interface OwnershipDependencies {
  processAlive?: (pid: number) => boolean;
  createClaimId?: () => string;
  now?: () => Date;
}

interface ObservedOwnership {
  record: RuntimeScopeOwnershipRecord;
  recordPath: string;
  interruptedReclaim: boolean;
}

type RuntimeScopeStopLockRecord = z.infer<typeof runtimeScopeStopLockSchema>;

interface ObservedStopLock {
  record: RuntimeScopeStopLockRecord;
  recordPath: string;
  interruptedRelease: boolean;
}

export function getRuntimeScopeOwnershipPath(configDir: string): string {
  return path.join(configDir, OWNERSHIP_DIR_NAME);
}

export function getRuntimeScopeStopLockPath(configDir: string): string {
  return path.join(configDir, STOP_LOCK_NAME);
}

/**
 * Atomically claims one Runtime Scope before runtime setup or transport binding.
 * The complete candidate directory is renamed into the absent canonical path;
 * a creator crash cannot expose partial canonical metadata.
 */
export function claimRuntimeScope(
  configDir: string,
  claimant: RuntimeScopeClaimant,
  dependencies: OwnershipDependencies = {},
): RuntimeScopeOwnership {
  const ownerDir = getRuntimeScopeOwnershipPath(configDir);
  const processAlive = dependencies.processAlive ?? isProcessAlive;
  const record: RuntimeScopeOwnershipRecord = {
    version: 1,
    pid: claimant.pid ?? process.pid,
    claimId: (dependencies.createClaimId ?? randomUUID)(),
    kind: claimant.kind,
    claimedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
  };

  fs.mkdirSync(configDir, { recursive: true });
  const candidateDir = `${ownerDir}.${record.claimId}.candidate`;
  writeOwnershipCandidate(candidateDir, record);

  try {
    for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1) {
      assertNoActiveStopLock(configDir, processAlive);
      try {
        fs.renameSync(candidateDir, ownerDir);
      } catch (error) {
        if (!isOwnershipExistsError(error)) {
          throw new RuntimeScopeOwnedError(ownerDir, 'ambiguous', null, errorMessage(error));
        }

        const existing = inspectRuntimeScopeOwnership(configDir);
        if (!existing) {
          continue;
        }
        if (processAlive(existing.record.pid)) {
          throw new RuntimeScopeOwnedError(ownerDir, 'owned', existing.record);
        }
        if (!reclaimObservedOwnership(configDir, existing, processAlive)) {
          continue;
        }
        continue;
      }

      try {
        assertNoActiveStopLock(configDir, processAlive);
      } catch (error) {
        releaseRuntimeScopeOwnership(configDir, record);
        throw error;
      }

      let released = false;
      return {
        record,
        release: () => {
          if (released) {
            return;
          }
          released = true;
          releaseRuntimeScopeOwnership(configDir, record);
        },
      };
    }

    throw new RuntimeScopeOwnedError(ownerDir, 'ambiguous', null, 'ownership changed during claim');
  } finally {
    removeCandidateDirectoryIfPresent(candidateDir);
  }
}

/** Serializes stop metadata cleanup against ordinary claims and workers. */
export function acquireRuntimeScopeStopLock(
  configDir: string,
  expectedOwner: Pick<RuntimeScopeOwnershipRecord, 'claimId' | 'pid'>,
  dependencies: OwnershipDependencies = {},
): RuntimeScopeStopLock {
  const processAlive = dependencies.processAlive ?? isProcessAlive;
  const stopLockPath = getRuntimeScopeStopLockPath(configDir);
  const lockRecord = {
    version: 1 as const,
    operationId: (dependencies.createClaimId ?? randomUUID)(),
    ownerClaimId: expectedOwner.claimId,
    pid: process.pid,
    acquiredAt: (dependencies.now ?? (() => new Date()))().toISOString(),
  };

  fs.mkdirSync(configDir, { recursive: true });
  const candidateDir = `${stopLockPath}.${lockRecord.operationId}.candidate`;
  writeStopLockCandidate(candidateDir, lockRecord);

  try {
    for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1) {
      assertNoActiveStopLock(configDir, processAlive);
      try {
        fs.renameSync(candidateDir, stopLockPath);
      } catch (error) {
        if (isOwnershipExistsError(error)) continue;
        throw new RuntimeScopeOwnedError(stopLockPath, 'ambiguous', null, errorMessage(error));
      }

      let observed: ObservedOwnership;
      try {
        const current = inspectRuntimeScopeOwnership(configDir);
        if (current?.record.claimId !== expectedOwner.claimId || current.record.pid !== expectedOwner.pid) {
          throw new RuntimeScopeOwnedError(
            stopLockPath,
            'ambiguous',
            current?.record ?? null,
            'ownership changed while acquiring stop lock',
          );
        }
        observed = current;
      } catch (error) {
        rollbackPublishedStopLock(configDir, lockRecord.operationId, error);
      }

      let released = false;
      return {
        release: () => {
          if (released) return;
          released = true;
          if (!removeStopLockIfMatches(configDir, lockRecord.operationId)) {
            throw new RuntimeScopeOwnedError(
              stopLockPath,
              'ambiguous',
              observed.record,
              'stop lock changed before release',
            );
          }
        },
      };
    }
    throw new RuntimeScopeOwnedError(stopLockPath, 'ambiguous', null, 'stop lock changed during acquisition');
  } finally {
    removeCandidateDirectoryIfPresent(candidateDir);
  }
}

/**
 * Guarded stale cleanup for discovery/status paths. It applies the same
 * supervisor orphan checks as startup and removes only the observed generation.
 */
export function reclaimStaleRuntimeScopeOwnership(
  configDir: string,
  expected: Pick<RuntimeScopeOwnershipRecord, 'claimId' | 'pid'>,
  processAlive: (pid: number) => boolean = isProcessAlive,
): boolean {
  const observed = inspectRuntimeScopeOwnership(configDir);
  if (
    !observed ||
    observed.record.claimId !== expected.claimId ||
    observed.record.pid !== expected.pid ||
    processAlive(observed.record.pid)
  ) {
    return false;
  }
  return reclaimObservedOwnership(configDir, observed, processAlive);
}

function reclaimObservedOwnership(
  configDir: string,
  observed: ObservedOwnership,
  processAlive: (pid: number) => boolean,
): boolean {
  const ownerDir = getRuntimeScopeOwnershipPath(configDir);
  const stopLock = acquireRuntimeScopeStopLock(configDir, observed.record, { processAlive });
  try {
    const current = inspectRuntimeScopeOwnership(configDir);
    if (
      !current ||
      current.record.claimId !== observed.record.claimId ||
      current.record.pid !== observed.record.pid ||
      processAlive(current.record.pid)
    ) {
      return false;
    }
    assertDeadSupervisorIsReclaimable(configDir, ownerDir, current.record, processAlive);
    return removeObservedOwnership(configDir, current);
  } finally {
    stopLock.release();
  }
}

function assertDeadSupervisorIsReclaimable(
  configDir: string,
  ownerPath: string,
  owner: RuntimeScopeOwnershipRecord,
  processAlive: (pid: number) => boolean,
): void {
  if (owner.kind !== 'background-supervisor') {
    return;
  }

  let state;
  try {
    state = readBackgroundSupervisorState(configDir);
  } catch (error) {
    throw new RuntimeScopeOwnedError(
      ownerPath,
      'ambiguous',
      owner,
      `background supervisor state cannot be verified: ${errorMessage(error)}`,
    );
  }
  if (state) {
    if (state.supervisorPid !== owner.pid) {
      throw new RuntimeScopeOwnedError(ownerPath, 'ambiguous', owner, 'ownership and supervisor state disagree');
    }
    if (state.runtimePid !== null && processAlive(state.runtimePid)) {
      throw new RuntimeScopeOwnedError(
        ownerPath,
        'owned',
        owner,
        `orphaned runtime PID ${state.runtimePid} is still alive`,
      );
    }
    if (
      state.runtimePid === null &&
      state.status !== 'restarting' &&
      state.status !== 'crash-loop' &&
      state.status !== 'stopping'
    ) {
      throw new RuntimeScopeOwnedError(
        ownerPath,
        'ambiguous',
        owner,
        `supervisor state ${state.status} may be between worker spawn and state publication`,
      );
    }
  }

  const pidFilePath = getPidFilePath(configDir);
  let runtimeInfo;
  try {
    runtimeInfo = readPidFile(configDir);
  } catch (error) {
    throw new RuntimeScopeOwnedError(
      ownerPath,
      'ambiguous',
      owner,
      `runtime PID metadata is unreadable: ${errorMessage(error)}`,
    );
  }
  if (!runtimeInfo && fs.existsSync(pidFilePath)) {
    throw new RuntimeScopeOwnedError(ownerPath, 'ambiguous', owner, 'runtime PID metadata is malformed');
  }
  if (runtimeInfo && processAlive(runtimeInfo.pid)) {
    throw new RuntimeScopeOwnedError(
      ownerPath,
      'owned',
      owner,
      `orphaned runtime PID ${runtimeInfo.pid} is still alive`,
    );
  }
}

function writeOwnershipCandidate(candidateDir: string, record: RuntimeScopeOwnershipRecord): void {
  try {
    fs.mkdirSync(candidateDir, { mode: 0o700 });
    fs.writeFileSync(path.join(candidateDir, OWNER_RECORD_NAME), `${JSON.stringify(record)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    removeCandidateDirectoryIfPresent(candidateDir);
    throw error;
  }
}

/**
 * Verifies that a supervised worker was authorized by the live owner of the
 * selected Runtime Scope. This does not transfer or release ownership.
 */
export function verifyRuntimeScopeOwnership(
  configDir: string,
  claimId: string,
  expectedKind: RuntimeScopeClaimantKind,
  processAlive: (pid: number) => boolean = isProcessAlive,
): RuntimeScopeOwnershipRecord {
  assertNoActiveStopLock(configDir, processAlive);
  const ownerDir = getRuntimeScopeOwnershipPath(configDir);
  const observed = inspectRuntimeScopeOwnership(configDir);
  if (!observed) {
    throw new RuntimeScopeOwnedError(ownerDir, 'ambiguous', null, 'ownership metadata is missing');
  }
  const owner = observed.record;
  if (observed.interruptedReclaim) {
    throw new RuntimeScopeOwnedError(ownerDir, 'ambiguous', owner, 'ownership release is incomplete');
  }
  if (owner.claimId !== claimId || owner.kind !== expectedKind || !processAlive(owner.pid)) {
    throw new RuntimeScopeOwnedError(ownerDir, 'owned', owner, 'supervised worker authorization failed');
  }
  assertNoActiveStopLock(configDir, processAlive);
  return owner;
}

function assertNoActiveStopLock(configDir: string, processAlive: (pid: number) => boolean): void {
  const stopLockPath = getRuntimeScopeStopLockPath(configDir);
  const observed = inspectRuntimeScopeStopLock(configDir);
  if (!observed) return;
  if (processAlive(observed.record.pid)) {
    throw new RuntimeScopeOwnedError(
      stopLockPath,
      'ambiguous',
      null,
      `lifecycle stop is active (PID: ${observed.record.pid})`,
    );
  }
  if (!removeObservedStopLock(configDir, observed)) {
    throw new RuntimeScopeOwnedError(stopLockPath, 'ambiguous', null, 'stop lock changed during stale cleanup');
  }
}

function inspectRuntimeScopeStopLock(configDir: string): ObservedStopLock | null {
  const stopLockDir = getRuntimeScopeStopLockPath(configDir);
  const lockRecordPath = path.join(stopLockDir, STOP_LOCK_RECORD_NAME);
  try {
    return {
      record: readStopLockRecord(lockRecordPath, stopLockDir),
      recordPath: lockRecordPath,
      interruptedRelease: false,
    };
  } catch (error) {
    if (!(error instanceof StopLockRecordMissingError)) throw error;
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(stopLockDir);
  } catch (error) {
    if (isCode(error, 'ENOENT')) return null;
    throw new RuntimeScopeOwnedError(
      stopLockDir,
      'ambiguous',
      null,
      `stop lock directory is unreadable: ${errorMessage(error)}`,
    );
  }

  const tombstones = entries.filter((entry) => /^lock\.[a-f0-9]{64}\.releasing\.json$/.test(entry));
  if (entries.length !== 1 || tombstones.length !== 1) {
    throw new RuntimeScopeOwnedError(
      stopLockDir,
      'ambiguous',
      null,
      'stop lock directory is incomplete or contains unknown files',
    );
  }
  const tombstonePath = path.join(stopLockDir, tombstones[0]);
  const record = readStopLockRecord(tombstonePath, stopLockDir);
  if (tombstones[0] !== stopLockTombstoneName(record.operationId)) {
    throw new RuntimeScopeOwnedError(stopLockDir, 'ambiguous', null, 'stop lock tombstone generation does not match');
  }
  return { record, recordPath: tombstonePath, interruptedRelease: true };
}

function readStopLockRecord(recordPath: string, stopLockDir: string): RuntimeScopeStopLockRecord {
  let content: string;
  try {
    content = fs.readFileSync(recordPath, 'utf8');
  } catch (error) {
    if (isCode(error, 'ENOENT')) throw new StopLockRecordMissingError();
    throw new RuntimeScopeOwnedError(stopLockDir, 'ambiguous', null, `stop lock is unreadable: ${errorMessage(error)}`);
  }
  try {
    return runtimeScopeStopLockSchema.parse(JSON.parse(content));
  } catch (error) {
    throw new RuntimeScopeOwnedError(stopLockDir, 'ambiguous', null, `stop lock is invalid: ${errorMessage(error)}`);
  }
}

function removeStopLockIfMatches(configDir: string, expectedOperationId: string): boolean {
  const observed = inspectRuntimeScopeStopLock(configDir);
  if (!observed) return true;
  if (observed.record.operationId !== expectedOperationId) return false;
  return removeObservedStopLock(configDir, observed);
}

function removeObservedStopLock(configDir: string, observed: ObservedStopLock): boolean {
  const stopLockDir = getRuntimeScopeStopLockPath(configDir);
  const tombstonePath = path.join(stopLockDir, stopLockTombstoneName(observed.record.operationId));

  if (!observed.interruptedRelease) {
    try {
      fs.renameSync(observed.recordPath, tombstonePath);
    } catch (error) {
      if (isCode(error, 'ENOENT') || isCode(error, 'EEXIST')) return false;
      throw new RuntimeScopeOwnedError(
        stopLockDir,
        'ambiguous',
        null,
        `stop lock removal failed: ${errorMessage(error)}`,
      );
    }
  }

  try {
    fs.unlinkSync(tombstonePath);
  } catch (error) {
    if (!isCode(error, 'ENOENT')) {
      throw new RuntimeScopeOwnedError(
        stopLockDir,
        'ambiguous',
        null,
        `stop lock tombstone cleanup failed: ${errorMessage(error)}`,
      );
    }
  }

  try {
    fs.rmdirSync(stopLockDir);
    return true;
  } catch (error) {
    if (isCode(error, 'ENOENT')) return true;
    if (isCode(error, 'ENOTEMPTY') || isCode(error, 'EEXIST')) {
      const replacement = inspectRuntimeScopeStopLock(configDir);
      if (replacement && !replacement.interruptedRelease) return true;
      throw new RuntimeScopeOwnedError(stopLockDir, 'ambiguous', null, 'stop lock directory changed during cleanup');
    }
    throw new RuntimeScopeOwnedError(
      stopLockDir,
      'ambiguous',
      null,
      `stop lock directory cleanup failed: ${errorMessage(error)}`,
    );
  }
}

function writeStopLockCandidate(candidateDir: string, record: RuntimeScopeStopLockRecord): void {
  try {
    fs.mkdirSync(candidateDir, { mode: 0o700 });
    fs.writeFileSync(path.join(candidateDir, STOP_LOCK_RECORD_NAME), `${JSON.stringify(record)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    removeCandidateDirectoryIfPresent(candidateDir);
    throw error;
  }
}

function rollbackPublishedStopLock(configDir: string, operationId: string, originalError: unknown): never {
  try {
    if (!removeStopLockIfMatches(configDir, operationId)) {
      throw new Error('published stop lock generation changed');
    }
  } catch (rollbackError) {
    throw new RuntimeScopeOwnedError(
      getRuntimeScopeStopLockPath(configDir),
      'ambiguous',
      null,
      `${errorMessage(originalError)}; stop lock rollback failed: ${errorMessage(rollbackError)}`,
    );
  }
  throw originalError;
}

function stopLockTombstoneName(operationId: string): string {
  const generation = createHash('sha256').update(operationId).digest('hex');
  return `lock.${generation}.releasing.json`;
}

/** Strictly reads the canonical owner record for lifecycle recovery commands. */
export function readRuntimeScopeOwnership(configDir: string): RuntimeScopeOwnershipRecord | null {
  return inspectRuntimeScopeOwnership(configDir)?.record ?? null;
}

/**
 * Releases only the owner observed by a lifecycle recovery command. Both PID
 * and claim ID must still match so a replacement owner is never removed.
 */
export function releaseRuntimeScopeOwnership(
  configDir: string,
  expected: Pick<RuntimeScopeOwnershipRecord, 'claimId' | 'pid'>,
): boolean {
  const observed = inspectRuntimeScopeOwnership(configDir);
  if (!observed || observed.record.claimId !== expected.claimId || observed.record.pid !== expected.pid) {
    return false;
  }
  return removeObservedOwnership(configDir, observed);
}

function inspectRuntimeScopeOwnership(configDir: string): ObservedOwnership | null {
  const ownerDir = getRuntimeScopeOwnershipPath(configDir);
  const ownerRecordPath = path.join(ownerDir, OWNER_RECORD_NAME);
  try {
    return {
      record: readOwnershipRecord(ownerRecordPath, ownerDir),
      recordPath: ownerRecordPath,
      interruptedReclaim: false,
    };
  } catch (error) {
    if (!(error instanceof OwnershipRecordMissingError)) {
      throw error;
    }
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(ownerDir);
  } catch (error) {
    if (isCode(error, 'ENOENT')) {
      return null;
    }
    throw new RuntimeScopeOwnedError(
      ownerDir,
      'ambiguous',
      null,
      `ownership directory is unreadable: ${errorMessage(error)}`,
    );
  }

  const tombstones = entries.filter((entry) => /^owner\.[a-f0-9]{64}\.reclaiming\.json$/.test(entry));
  if (entries.length !== 1 || tombstones.length !== 1) {
    throw new RuntimeScopeOwnedError(
      ownerDir,
      'ambiguous',
      null,
      'ownership directory is incomplete or contains unknown files',
    );
  }
  const tombstonePath = path.join(ownerDir, tombstones[0]);
  const record = readOwnershipRecord(tombstonePath, ownerDir);
  if (tombstones[0] !== reclaimTombstoneName(record.claimId)) {
    throw new RuntimeScopeOwnedError(ownerDir, 'ambiguous', record, 'ownership tombstone generation does not match');
  }
  return {
    record,
    recordPath: tombstonePath,
    interruptedReclaim: true,
  };
}

function readOwnershipRecord(recordPath: string, ownerDir: string): RuntimeScopeOwnershipRecord {
  let content: string;
  try {
    content = fs.readFileSync(recordPath, 'utf8');
  } catch (error) {
    if (isCode(error, 'ENOENT')) {
      throw new OwnershipRecordMissingError();
    }
    throw new RuntimeScopeOwnedError(
      ownerDir,
      'ambiguous',
      null,
      `ownership metadata is unreadable: ${errorMessage(error)}`,
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new RuntimeScopeOwnedError(ownerDir, 'ambiguous', null, 'ownership metadata is malformed');
  }
  const parsed = runtimeScopeOwnershipRecordSchema.safeParse(value);
  if (!parsed.success) {
    throw new RuntimeScopeOwnedError(ownerDir, 'ambiguous', null, 'ownership metadata is invalid');
  }
  return parsed.data;
}

function removeObservedOwnership(configDir: string, observed: ObservedOwnership): boolean {
  const ownerDir = getRuntimeScopeOwnershipPath(configDir);
  const tombstonePath = path.join(ownerDir, reclaimTombstoneName(observed.record.claimId));

  if (!observed.interruptedReclaim) {
    try {
      fs.renameSync(observed.recordPath, tombstonePath);
    } catch (error) {
      if (isCode(error, 'ENOENT') || isCode(error, 'EEXIST')) {
        return false;
      }
      throw new RuntimeScopeOwnedError(
        ownerDir,
        'ambiguous',
        observed.record,
        `ownership removal failed: ${errorMessage(error)}`,
      );
    }
  }

  try {
    fs.unlinkSync(tombstonePath);
  } catch (error) {
    if (!isCode(error, 'ENOENT')) {
      throw new RuntimeScopeOwnedError(
        ownerDir,
        'ambiguous',
        observed.record,
        `ownership tombstone cleanup failed: ${errorMessage(error)}`,
      );
    }
  }

  try {
    fs.rmdirSync(ownerDir);
    return true;
  } catch (error) {
    if (isCode(error, 'ENOENT')) {
      return true;
    }
    if (isCode(error, 'ENOTEMPTY') || isCode(error, 'EEXIST')) {
      const replacement = inspectRuntimeScopeOwnership(configDir);
      if (replacement && !replacement.interruptedReclaim) {
        // A replacement generation published after the tombstone was removed.
        return true;
      }
      throw new RuntimeScopeOwnedError(
        ownerDir,
        'ambiguous',
        observed.record,
        'ownership directory changed during cleanup',
      );
    }
    throw new RuntimeScopeOwnedError(
      ownerDir,
      'ambiguous',
      observed.record,
      `ownership directory cleanup failed: ${errorMessage(error)}`,
    );
  }
}

function reclaimTombstoneName(claimId: string): string {
  const generation = createHash('sha256').update(claimId).digest('hex');
  return `owner.${generation}.reclaiming.json`;
}

function removeCandidateDirectoryIfPresent(candidateDir: string): void {
  try {
    fs.rmSync(candidateDir, { recursive: true });
  } catch (error) {
    if (!isCode(error, 'ENOENT')) {
      logger.warn(`Runtime ownership candidate cleanup failed (${candidateDir}): ${errorMessage(error)}`);
    }
  }
}

function isOwnershipExistsError(error: unknown): boolean {
  return isCode(error, 'EEXIST') || isCode(error, 'ENOTEMPTY');
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && (error as { code?: unknown }).code === code;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class OwnershipRecordMissingError extends Error {}
class StopLockRecordMissingError extends Error {}
