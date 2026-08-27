import fs from 'fs';
import { chmod, open, stat } from 'node:fs/promises';
import path from 'path';

import logger from '@src/logger/logger.js';

/**
 * Thrown when a credential-bearing file or directory is readable/writable by
 * group/others and the self-heal chmod was denied. Read-side strictModes
 * (OpenSSH model): heal-then-consume, fail closed when the heal is rejected.
 */
export class InsecureFilePermissionsError extends Error {
  public readonly filePath: string;
  public readonly actualMode: number;

  constructor(filePath: string, actualMode: number) {
    super(
      `Refusing to read ${path.basename(path.dirname(filePath))} data: file permissions ` +
        `0${(actualMode & 0o777).toString(8)} are too open (group/other bits must be 0)`,
    );
    this.name = 'InsecureFilePermissionsError';
    this.filePath = filePath;
    this.actualMode = actualMode & 0o777;
  }
}

function logFileHealed(filePath: string, mode: number): void {
  logger.warn(
    `Self-healed insecure 0${(mode & 0o777).toString(8)} permissions to 0600 on ${path.basename(path.dirname(filePath))} data file`,
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
  const mode = fs.fstatSync(fd).mode;
  if ((mode & 0o077) === 0) {
    return;
  }
  try {
    fs.fchmodSync(fd, 0o600);
    logFileHealed(filePath, mode);
  } catch {
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
  const mode = fs.statSync(dirPath).mode;
  if ((mode & 0o077) === 0) {
    return;
  }
  try {
    fs.chmodSync(dirPath, 0o700);
    logger.warn('Self-healed insecure storage directory permissions to 0700');
  } catch {
    throw new InsecureFilePermissionsError(dirPath, mode);
  }
}

/** Async twin of assertOwnerOnlyDirPermissions. */
export async function assertOwnerOnlyDirPermissionsAsync(dirPath: string): Promise<void> {
  if (process.platform === 'win32') {
    return;
  }
  const mode = (await stat(dirPath)).mode;
  if ((mode & 0o077) === 0) {
    return;
  }
  try {
    await chmod(dirPath, 0o700);
    logger.warn('Self-healed insecure storage directory permissions to 0700');
  } catch {
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
      const mode = (await handle.stat()).mode;
      if ((mode & 0o077) !== 0) {
        try {
          await handle.chmod(0o600);
          logFileHealed(filePath, mode);
        } catch {
          throw new InsecureFilePermissionsError(filePath, mode);
        }
      }
    }
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}
