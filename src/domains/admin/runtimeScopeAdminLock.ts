import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { isProcessAlive } from '@src/core/server/pidFileManager.js';
import logger from '@src/logger/logger.js';

import { z } from 'zod';

const ADMIN_STATE_DIR = 'admin';
const LOCK_ACQUIRE_ATTEMPTS = 3;

interface RuntimeScopeAdminLockRecord {
  schemaVersion: 2;
  runtimeScopeIdHash: string;
  acquiredAt: string;
  pid: number;
  ownerToken: string;
}

const runtimeScopeAdminLockRecordSchema = z.object({
  schemaVersion: z.literal(2),
  runtimeScopeIdHash: z.string().min(1),
  acquiredAt: z.string().datetime(),
  pid: z.number().int().positive(),
  ownerToken: z.string().min(1),
}) satisfies z.ZodType<RuntimeScopeAdminLockRecord>;

export type AdminMutationUnavailableReason =
  'writer_lock_unavailable' | 'setup_required' | 'mutation_service_unavailable';

export interface AdminMutationAvailability {
  available: boolean;
  reason?: AdminMutationUnavailableReason;
}

export interface RuntimeScopeAdminLockHandle {
  available: true;
  release: () => void;
}

export type RuntimeScopeAdminLockResult =
  | RuntimeScopeAdminLockHandle
  | {
      available: false;
      reason: 'writer_lock_unavailable';
    };

export function tryAcquireRuntimeScopeAdminLock(options: {
  runtimeScopeId: string;
  storageDir: string;
  now?: () => Date;
  pid?: number;
  processAlive?: (pid: number) => boolean;
  createOwnerToken?: () => string;
}): RuntimeScopeAdminLockResult {
  const filePath = lockFilePath(options.storageDir, options.runtimeScopeId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const runtimeScopeIdHash = hashRuntimeScopeId(options.runtimeScopeId);
  const processAlive = options.processAlive ?? isProcessAlive;
  const ownerToken = (options.createOwnerToken ?? randomUUID)();
  const record: RuntimeScopeAdminLockRecord = {
    schemaVersion: 2,
    runtimeScopeIdHash,
    acquiredAt: (options.now ?? (() => new Date()))().toISOString(),
    pid: options.pid ?? process.pid,
    ownerToken,
  };

  for (let attempt = 0; attempt < LOCK_ACQUIRE_ATTEMPTS; attempt += 1) {
    let fd: number;
    try {
      fd = fs.openSync(filePath, 'wx', 0o600);
    } catch (error) {
      if (!isAlreadyLockedError(error)) {
        throw error;
      }

      const existing = readLockRecord(filePath);
      if (!existing || existing.runtimeScopeIdHash !== runtimeScopeIdHash) {
        logUnverifiableLock(filePath);
        return unavailableLockResult();
      }
      if (processAlive(existing.pid)) {
        return unavailableLockResult();
      }
      if (!removeLockOwnedBy(filePath, existing.ownerToken)) {
        continue;
      }
      continue;
    }

    try {
      fs.writeFileSync(fd, `${JSON.stringify(record)}\n`);
      fs.closeSync(fd);
    } catch (error) {
      try {
        fs.closeSync(fd);
      } catch {
        // The descriptor may already be closed.
      }
      fs.rmSync(filePath, { force: true });
      throw error;
    }

    let released = false;
    return {
      available: true,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        removeLockOwnedBy(filePath, ownerToken);
      },
    };
  }

  return unavailableLockResult();
}

function unavailableLockResult(): RuntimeScopeAdminLockResult {
  return {
    available: false,
    reason: 'writer_lock_unavailable',
  };
}

function readLockRecord(filePath: string): RuntimeScopeAdminLockRecord | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    const result = runtimeScopeAdminLockRecordSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function removeLockOwnedBy(filePath: string, ownerToken: string): boolean {
  const current = readLockRecord(filePath);
  if (!current || current.ownerToken !== ownerToken) {
    return false;
  }
  try {
    fs.rmSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function logUnverifiableLock(filePath: string): void {
  logger.warn(
    `Runtime Scope Admin Lock is legacy, corrupt, or unreadable: ${filePath}. ` +
      'Stop every runtime for this scope, verify that no 1mcp process owns it, then remove this lock file manually.',
  );
}

function lockFilePath(storageDir: string, runtimeScopeId: string): string {
  return path.join(
    storageDir,
    ADMIN_STATE_DIR,
    `runtime-scope-admin-${hashRuntimeScopeId(runtimeScopeId).slice(0, 24)}.lock`,
  );
}

function hashRuntimeScopeId(runtimeScopeId: string): string {
  return createHash('sha256').update(runtimeScopeId).digest('base64url');
}

function isAlreadyLockedError(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'EEXIST',
  );
}
