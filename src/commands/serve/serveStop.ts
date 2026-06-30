import { getConfigDir } from '@src/constants.js';
import { cleanupPidFileIfMatches, isProcessAlive, readPidFile } from '@src/core/server/pidFileManager.js';
import logger from '@src/logger/logger.js';

/**
 * `serve --stop`: stop only the runtime in the selected Runtime Scope.
 *
 * Discovery uses the pure PID reader plus a liveness check (not the readiness
 * probe — stopping should work even for an alive-but-not-ready runtime). The
 * signal targets exactly the PID recorded for this scope, so runtimes in other
 * config directories are never affected.
 */

export interface WaitForExitOptions {
  timeoutMs?: number;
  intervalMs?: number;
  isAlive?: (pid: number) => boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Poll until the process is gone or the timeout elapses. Returns true if it exited. */
export async function waitForProcessExit(pid: number, options: WaitForExitOptions = {}): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 10000;
  const intervalMs = options.intervalMs ?? 200;
  const isAlive = options.isAlive ?? isProcessAlive;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  const start = now();
  while (now() - start < timeoutMs) {
    if (!isAlive(pid)) {
      return true;
    }
    await sleep(intervalMs);
  }
  return !isAlive(pid);
}

/** Signals this command sends to a runtime process. */
type StopSignal = 'SIGTERM' | 'SIGKILL';

export interface RunStopDeps {
  readInfo?: typeof readPidFile;
  isAlive?: (pid: number) => boolean;
  kill?: (pid: number, signal: StopSignal) => void;
  /** Delete the PID file only if it still records the stopped PID. */
  cleanup?: (configDir: string, expectedPid: number) => boolean;
  waitForExit?: typeof waitForProcessExit;
  /** Graceful wait before escalating to SIGKILL. */
  gracefulTimeoutMs?: number;
}

function defaultKill(pid: number, signal: StopSignal): void {
  process.kill(pid, signal);
}

/**
 * Stop the scoped runtime. Sets `process.exitCode` and returns.
 */
export async function runServeStop(configDirOption?: string, deps: RunStopDeps = {}): Promise<void> {
  const configDir = getConfigDir(configDirOption);
  const readInfo = deps.readInfo ?? readPidFile;
  const isAlive = deps.isAlive ?? isProcessAlive;
  const kill = deps.kill ?? defaultKill;
  const cleanup = deps.cleanup ?? cleanupPidFileIfMatches;
  const waitForExit = deps.waitForExit ?? waitForProcessExit;
  const gracefulTimeoutMs = deps.gracefulTimeoutMs ?? 10000;

  const info = readInfo(configDir);

  if (!info) {
    process.stdout.write(`No runtime is running in this Runtime Scope: ${configDir}\n`);
    process.exitCode = 0;
    return;
  }

  // Stale dead-process PID file: clean it up and report cleanly.
  if (!isAlive(info.pid)) {
    if (cleanup(configDir, info.pid)) {
      process.stdout.write(
        `No running runtime in this Runtime Scope; removed a stale PID file (was PID ${info.pid}).\n`,
      );
    } else {
      process.stderr.write(
        `No running runtime in this Runtime Scope, but the stale PID file could not be removed ` +
          `(${getConfigDir(configDirOption)}). Remove it manually.\n`,
      );
    }
    process.exitCode = 0;
    return;
  }

  // Graceful termination, then escalate to SIGKILL if it does not exit in time.
  try {
    kill(info.pid, 'SIGTERM');
  } catch (error) {
    logger.warn(`Failed to send SIGTERM to PID ${info.pid}: ${error}`);
  }

  let exited = await waitForExit(info.pid, { timeoutMs: gracefulTimeoutMs, isAlive });
  if (!exited) {
    logger.warn(`Runtime (PID ${info.pid}) did not exit after SIGTERM; escalating to SIGKILL`);
    try {
      kill(info.pid, 'SIGKILL');
    } catch (error) {
      logger.warn(`Failed to send SIGKILL to PID ${info.pid}: ${error}`);
    }
    exited = await waitForExit(info.pid, { timeoutMs: 2000, isAlive });
  }

  if (exited) {
    // The runtime removes its own PID file on graceful shutdown; clean up in
    // case it was force-killed before it could. Match on PID so a runtime that
    // restarted in this scope (rare, but possible) is not clobbered.
    cleanup(configDir, info.pid);
    process.stdout.write(`Stopped runtime in Runtime Scope ${configDir} (PID ${info.pid}).\n`);
    process.exitCode = 0;
    return;
  }

  process.stderr.write(`Error: failed to stop runtime (PID ${info.pid}) in Runtime Scope ${configDir}.\n`);
  process.exitCode = 1;
}
