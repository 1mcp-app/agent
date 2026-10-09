import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

export interface RuntimeFileLock {
  release: () => void;
}

/** Linux flock belongs to the shared open file description, including our retained FD. */
export function acquireRuntimeFileLock(lockPath: string): RuntimeFileLock | null {
  if (process.platform !== 'linux') return null;
  // Keep this inode permanently: unlinking it would let contenders lock different files.
  const fd = fs.openSync(lockPath, 'a', 0o600);
  try {
    const result = spawnSync('flock', ['-n', '3'], {
      stdio: ['ignore', 'ignore', 'pipe', fd],
      timeout: 5_000,
    });
    if (result.error || result.status !== 0) {
      throw new Error(
        result.status === 1 && !result.error
          ? 'Runtime Scope filesystem lock is held by another lifecycle operation'
          : `Cannot acquire Runtime Scope filesystem lock; Linux requires a working flock command (${result.error?.message ?? result.stderr?.toString().trim() ?? result.status})`,
      );
    }
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      fs.closeSync(fd);
    },
  };
}
