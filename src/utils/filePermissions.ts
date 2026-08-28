import fs from 'fs';
import { chmod, open, stat } from 'node:fs/promises';
import path from 'path';

import logger from '@src/logger/logger.js';

/**
 * Thrown when a credential-bearing file or directory is readable/writable by
 * group/others and the self-heal chmod was denied, or when the credential is
 * owned by a different uid than the running process. Read-side strictModes
 * (OpenSSH model): heal-then-consume, fail closed when the heal is rejected.
 * The message redacts the absolute path to a single directory name so logs
 * can be shared without leaking user layouts; the public fields carry the
 * same redaction so structured-log serialization cannot leak paths either.
 */
export class InsecureFilePermissionsError extends Error {
  public readonly filePath: string;
  public readonly actualMode: number;

  constructor(filePath: string, actualMode: number, reason?: string) {
    super(
      reason ??
        `Refusing to read ${path.basename(path.dirname(filePath))} data: file permissions ` +
          `0${(actualMode & 0o777).toString(8)} are too open (group/other bits must be 0)`,
    );
    this.name = 'InsecureFilePermissionsError';
    this.filePath = path.basename(path.dirname(filePath));
    this.actualMode = actualMode & 0o777;
  }
}

/** Refuse credentials not owned by the current process uid (OpenSSH foreign-owner rule). */
function foreignOwnershipError(filePath: string, mode: number): InsecureFilePermissionsError {
  return new InsecureFilePermissionsError(
    filePath,
    mode,
    `Refusing to read ${path.basename(path.dirname(filePath))} data: file is owned by a different user`,
  );
}

function logFileHealed(filePath: string, mode: number): void {
  logger.warn(
    `Self-healed insecure 0${(mode & 0o777).toString(8)} permissions to 0600 on ${path.basename(path.dirname(filePath))} data file`,
  );
}

/**
 * Filesystems that cannot represent POSIX modes (FAT/exFAT/FUSE/CIFS volumes)
 * report fictitious modes and reject chmod with capability errors. Degrade
 * with a warn there (same policy as upstream hardenPermissionsSafely) so the
 * OAuth stack keeps working on such volumes; real denials (EACCES/EPERM)
 * still fail closed.
 */
const CAPABILITY_ERROR_CODES = new Set(['ENOTSUP', 'EOPNOTSUPP', 'EINVAL', 'ENOSYS']);

function isCapabilityError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && CAPABILITY_ERROR_CODES.has(code);
}

function logHealDegraded(filePath: string, code: string): void {
  logger.warn(
    `chmod unsupported on ${path.basename(path.dirname(filePath))} volume (${code}) — filesystem lacks POSIX modes, degrading`,
  );
}

/**
 * Read-side strictModes (OpenSSH sshkey_perm_ok semantic) on an already-open
 * fd, so the permission check cannot be swapped out between stat and read
 * (no TOCTOU). Legacy files from before the AUTH-07 fix self-heal: a
 * group/other-open file is chmod'ed to 0o600 in place; only when that heal
 * fails do we refuse to consume the credential. Windows ACLs do not map to
 * fs.stat modes, so the check is skipped there.
 */
export function enforceOwnerOnlyFilePermissions(fd: number, filePath: string): void {
  if (process.platform === 'win32') {
    return;
  }
  const st = fs.fstatSync(fd);
  if (process.geteuid && st.uid !== process.geteuid()) {
    throw foreignOwnershipError(filePath, st.mode);
  }
  const mode = st.mode;
  if ((mode & 0o077) === 0) {
    return;
  }
  try {
    fs.fchmodSync(fd, 0o600);
    logFileHealed(filePath, mode);
  } catch (error) {
    if (isCapabilityError(error)) {
      logHealDegraded(filePath, String((error as { code?: unknown }).code));
      return;
    }
    throw new InsecureFilePermissionsError(filePath, mode);
  }
}

/**
 * Directory leg of strictModes: a storage dir writable/readable by group or
 * others allows filename enumeration and file replacement. The write side
 * already hardens the dir (chmod 0700 at creation); the read side repels
 * downgrade by checking the same invariant before consuming data.
 */
export function assertOwnerOnlyDirPermissions(dirPath: string): void {
  if (process.platform === 'win32') {
    return;
  }
  const st = fs.statSync(dirPath);
  if (process.geteuid && st.uid !== process.geteuid()) {
    throw foreignOwnershipError(dirPath, st.mode);
  }
  const mode = st.mode;
  if ((mode & 0o077) === 0) {
    return;
  }
  try {
    fs.chmodSync(dirPath, 0o700);
    logger.warn('Self-healed insecure storage directory permissions to 0700');
  } catch (error) {
    if (isCapabilityError(error)) {
      logHealDegraded(dirPath, String((error as { code?: unknown }).code));
      return;
    }
    throw new InsecureFilePermissionsError(dirPath, mode);
  }
}

/** Async twin of assertOwnerOnlyDirPermissions. */
export async function assertOwnerOnlyDirPermissionsAsync(dirPath: string): Promise<void> {
  if (process.platform === 'win32') {
    return;
  }
  const st = await stat(dirPath);
  if (process.geteuid && st.uid !== process.geteuid()) {
    throw foreignOwnershipError(dirPath, st.mode);
  }
  const mode = st.mode;
  if ((mode & 0o077) === 0) {
    return;
  }
  try {
    await chmod(dirPath, 0o700);
    logger.warn('Self-healed insecure storage directory permissions to 0700');
  } catch (error) {
    if (isCapabilityError(error)) {
      logHealDegraded(dirPath, String((error as { code?: unknown }).code));
      return;
    }
    throw new InsecureFilePermissionsError(dirPath, mode);
  }
}

/**
 * Read a credential file with full read-side strictModes on one open handle:
 * dir 0700 check, open → stat → heal (handle.chmod) → read, no TOCTOU window.
 * Heal-then-consume: legacy group/other-open files are healed to 0600; only a
 * denied heal refuses the read with InsecureFilePermissionsError.
 */
export async function readCredentialFile(filePath: string, storageDir: string): Promise<string> {
  await assertOwnerOnlyDirPermissionsAsync(storageDir);
  const handle = await open(filePath, 'r');
  try {
    if (process.platform !== 'win32') {
      const st = await handle.stat();
      if (process.geteuid && st.uid !== process.geteuid()) {
        throw foreignOwnershipError(filePath, st.mode);
      }
      const mode = st.mode;
      if ((mode & 0o077) !== 0) {
        try {
          await handle.chmod(0o600);
          logFileHealed(filePath, mode);
        } catch (error) {
          if (isCapabilityError(error)) {
            logHealDegraded(filePath, String((error as { code?: unknown }).code));
          } else {
            throw new InsecureFilePermissionsError(filePath, mode);
          }
        }
      }
    }
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}
