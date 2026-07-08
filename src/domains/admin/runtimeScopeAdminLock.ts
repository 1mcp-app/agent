import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ADMIN_STATE_DIR = 'admin';

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
}): RuntimeScopeAdminLockResult {
  const filePath = lockFilePath(options.storageDir, options.runtimeScopeId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  let fd: number;
  try {
    fd = fs.openSync(filePath, 'wx', 0o600);
  } catch (error) {
    if (isAlreadyLockedError(error)) {
      return {
        available: false,
        reason: 'writer_lock_unavailable',
      };
    }
    throw error;
  }

  let released = false;
  fs.writeFileSync(
    fd,
    `${JSON.stringify({
      schemaVersion: 1,
      runtimeScopeIdHash: hashRuntimeScopeId(options.runtimeScopeId),
      acquiredAt: (options.now ?? (() => new Date()))().toISOString(),
    })}\n`,
  );
  fs.closeSync(fd);

  return {
    available: true,
    release: () => {
      if (released) {
        return;
      }
      released = true;
      try {
        fs.rmSync(filePath, { force: true });
      } catch {
        // Cleanup is best-effort. A stale lock fails closed on the next serve.
      }
    },
  };
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
