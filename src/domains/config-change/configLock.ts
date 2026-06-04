import path from 'path';

export type ReleaseConfigLock = () => void;

interface ConfigLockState {
  locked: boolean;
  waiters: Array<() => void>;
}

export class ConfigLockTimeoutError extends Error {}

export const DEFAULT_LOCK_TIMEOUT_MS = 5000;

const configLocks = new Map<string, ConfigLockState>();

export function acquireConfigLock(configPath: string, timeoutMs: number): Promise<ReleaseConfigLock> {
  const lockKey = path.resolve(configPath);
  const state = getConfigLockState(lockKey);
  if (!state.locked) {
    state.locked = true;
    return Promise.resolve(() => releaseConfigLock(lockKey, state));
  }

  return new Promise((resolve, reject) => {
    let completed = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const waiter = () => {
      if (completed) {
        return;
      }
      completed = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      state.locked = true;
      resolve(() => releaseConfigLock(lockKey, state));
    };

    timeout = setTimeout(() => {
      if (completed) {
        return;
      }
      completed = true;
      const index = state.waiters.indexOf(waiter);
      if (index >= 0) {
        state.waiters.splice(index, 1);
      }
      reject(new ConfigLockTimeoutError(`Timed out waiting for config lock: ${configPath}`));
    }, timeoutMs);

    state.waiters.push(waiter);
  });
}

function getConfigLockState(lockKey: string): ConfigLockState {
  const existing = configLocks.get(lockKey);
  if (existing) {
    return existing;
  }

  const state: ConfigLockState = {
    locked: false,
    waiters: [],
  };
  configLocks.set(lockKey, state);
  return state;
}

function releaseConfigLock(lockKey: string, state: ConfigLockState): void {
  const nextWaiter = state.waiters.shift();
  if (nextWaiter) {
    nextWaiter();
    return;
  }

  state.locked = false;
  configLocks.delete(lockKey);
}
