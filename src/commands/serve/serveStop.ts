import { getConfigDir } from '@src/constants.js';
import {
  backgroundLaunchConfigExists,
  cleanupBackgroundLaunchConfig,
} from '@src/core/server/backgroundLaunchConfig.js';
import {
  type BackgroundSupervisorState,
  cleanupBackgroundSupervisorState,
  readBackgroundSupervisorState,
} from '@src/core/server/backgroundRuntimeSupervisor.js';
import {
  cleanupPidFileIfMatches,
  isProcessAlive,
  PidFileReadError,
  readPidFile,
} from '@src/core/server/pidFileManager.js';
import {
  acquireRuntimeScopeStopLock,
  readRuntimeScopeOwnership,
  releaseRuntimeScopeOwnership,
  type RuntimeScopeOwnershipRecord,
  type RuntimeScopeStopLock,
} from '@src/core/server/runtimeScopeOwnership.js';
import logger from '@src/logger/logger.js';

/**
 * `serve --stop`: stop only the runtime in the selected Runtime Scope.
 *
 * Supervised scopes stop the supervisor before its worker so no replacement can
 * race with deliberate shutdown. Foreground scopes stop the PID recorded for
 * this scope. Readiness is irrelevant to both paths.
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
  readSupervisorState?: typeof readBackgroundSupervisorState;
  readOwnership?: typeof readRuntimeScopeOwnership;
  acquireStopLock?: typeof acquireRuntimeScopeStopLock;
  cleanupSupervisorState?: typeof cleanupBackgroundSupervisorState;
  /** Remove only the launch snapshot belonging to the observed supervisor. */
  cleanupLaunchConfig?: (configDir: string, expectedSupervisorPid: number) => boolean;
  /** Guarded release of the matching background-supervisor ownership record. */
  cleanupOwnership?: (configDir: string, expectedSupervisorPid: number) => boolean;
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

function failStop(message: string): void {
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cleanupSupervisorOwnership(configDir: string, expectedSupervisorPid: number): boolean {
  const owner = readRuntimeScopeOwnership(configDir);
  if (!owner) {
    return true;
  }
  if (owner.kind !== 'background-supervisor' || owner.pid !== expectedSupervisorPid) {
    return false;
  }
  return releaseRuntimeScopeOwnership(configDir, owner);
}

function cleanupSupervisorLaunchConfig(configDir: string, expectedSupervisorPid: number): boolean {
  const owner = readRuntimeScopeOwnership(configDir);
  if (!owner) {
    return !backgroundLaunchConfigExists(configDir);
  }
  if (owner.kind !== 'background-supervisor' || owner.pid !== expectedSupervisorPid) {
    return false;
  }
  return cleanupBackgroundLaunchConfig(configDir, owner.claimId, { removeStaleGeneration: true });
}

function bootstrapSupervisorState(supervisorPid: number): BackgroundSupervisorState {
  const now = new Date().toISOString();
  return {
    version: 1,
    status: 'starting',
    supervisorPid,
    runtimePid: null,
    restartAttempt: 0,
    lastExit: null,
    nextRetryAt: null,
    readyAt: null,
    updatedAt: now,
  };
}

/**
 * Stop the scoped runtime. Sets `process.exitCode` and returns.
 */
export async function runServeStop(configDirOption?: string, deps: RunStopDeps = {}): Promise<void> {
  const configDir = getConfigDir(configDirOption);
  const readSupervisorState = deps.readSupervisorState ?? readBackgroundSupervisorState;
  const readOwnership = deps.readOwnership ?? readRuntimeScopeOwnership;
  const acquireStopLock = deps.acquireStopLock ?? acquireRuntimeScopeStopLock;
  const cleanupSupervisorState = deps.cleanupSupervisorState ?? cleanupBackgroundSupervisorState;
  const cleanupLaunchConfig = deps.cleanupLaunchConfig ?? cleanupSupervisorLaunchConfig;
  const cleanupOwnership = deps.cleanupOwnership ?? cleanupSupervisorOwnership;
  const readInfo = deps.readInfo ?? readPidFile;
  const isAlive = deps.isAlive ?? isProcessAlive;
  const kill = deps.kill ?? defaultKill;
  const cleanup = deps.cleanup ?? cleanupPidFileIfMatches;
  const waitForExit = deps.waitForExit ?? waitForProcessExit;
  const gracefulTimeoutMs = deps.gracefulTimeoutMs ?? 10000;

  let supervisorState: BackgroundSupervisorState | null;
  try {
    supervisorState = readSupervisorState(configDir);
  } catch (error) {
    failStop(`cannot inspect Background Runtime Supervisor in Runtime Scope ${configDir}: ${errorMessage(error)}`);
    return;
  }

  let owner: RuntimeScopeOwnershipRecord | null;
  try {
    owner = readOwnership(configDir);
  } catch (error) {
    failStop(`cannot verify lifecycle ownership in Runtime Scope ${configDir}: ${errorMessage(error)}`);
    return;
  }

  if (!supervisorState && owner?.kind === 'background-supervisor') {
    supervisorState = bootstrapSupervisorState(owner.pid);
  }

  if (supervisorState) {
    const stateMatchesOwner = owner?.kind === 'background-supervisor' && owner.pid === supervisorState.supervisorPid;
    if (!stateMatchesOwner) {
      const staleProcessStillAlive =
        isAlive(supervisorState.supervisorPid) ||
        (supervisorState.runtimePid !== null && isAlive(supervisorState.runtimePid));
      if (staleProcessStillAlive) {
        failStop(`supervisor state does not match Runtime Scope ownership in ${configDir}; refusing ambiguous stop.`);
        return;
      }
      try {
        if (!cleanupSupervisorState(configDir, supervisorState.supervisorPid)) {
          failStop(`stale supervisor state changed before cleanup in Runtime Scope ${configDir}.`);
          return;
        }
      } catch (error) {
        failStop(`stale supervisor state could not be removed in Runtime Scope ${configDir}: ${errorMessage(error)}`);
        return;
      }
      supervisorState = owner?.kind === 'background-supervisor' ? bootstrapSupervisorState(owner.pid) : null;
    }
  }

  if (supervisorState) {
    if (owner?.kind !== 'background-supervisor' || owner.pid !== supervisorState.supervisorPid) {
      failStop(`supervisor state does not match Runtime Scope ownership in ${configDir}; refusing ambiguous stop.`);
      return;
    }

    let stopLock: RuntimeScopeStopLock;
    try {
      stopLock = acquireStopLock(configDir, owner);
    } catch (error) {
      failStop(`cannot lock lifecycle cleanup in Runtime Scope ${configDir}: ${errorMessage(error)}`);
      return;
    }

    try {
      const supervisorWasAlive = isAlive(supervisorState.supervisorPid);
      const runtimeWasAlive = supervisorState.runtimePid !== null && isAlive(supervisorState.runtimePid);
      const terminateOptions = { kill, waitForExit, isAlive, gracefulTimeoutMs };

      if (
        supervisorWasAlive &&
        !(await terminateProcess(supervisorState.supervisorPid, 'supervisor', terminateOptions))
      ) {
        failStop(
          `failed to stop Background Runtime Supervisor (PID ${supervisorState.supervisorPid}) in Runtime Scope ${configDir}.`,
        );
        return;
      }

      let runtimePid = supervisorState.runtimePid;
      if (supervisorWasAlive) {
        try {
          const finalState = readSupervisorState(configDir);
          if (finalState?.supervisorPid === supervisorState.supervisorPid) {
            runtimePid = finalState.runtimePid ?? runtimePid;
          }
        } catch (error) {
          failStop(
            `supervisor stopped, but its final runtime state could not be read in Runtime Scope ${configDir}: ${errorMessage(error)}`,
          );
          return;
        }
      }

      // The supervisor can exit immediately after signaling its worker. If its
      // final state has already disappeared, the PID file is the recovery source.
      if (runtimePid === null) {
        try {
          runtimePid = readInfo(configDir)?.pid ?? null;
        } catch (error) {
          failStop(
            `supervisor stopped, but its runtime PID could not be recovered in Runtime Scope ${configDir}: ${errorMessage(error)}`,
          );
          return;
        }
      }

      // Only touch the worker after its supervisor has gone. This ordering is
      // what prevents an in-flight retry policy from replacing a deliberately
      // stopped worker.
      if (
        runtimePid !== null &&
        isAlive(runtimePid) &&
        !(await terminateProcess(runtimePid, 'runtime', terminateOptions))
      ) {
        failStop(`failed to stop supervised runtime (PID ${runtimePid}) in Runtime Scope ${configDir}.`);
        return;
      }

      if (runtimePid !== null) {
        cleanup(configDir, runtimePid);
      }

      try {
        if (!cleanupLaunchConfig(configDir, supervisorState.supervisorPid)) {
          failStop(`runtime stopped, but launch configuration changed before cleanup in Runtime Scope ${configDir}.`);
          return;
        }
        if (
          !cleanupSupervisorState(configDir, supervisorState.supervisorPid) &&
          readSupervisorState(configDir) !== null
        ) {
          failStop(`runtime stopped, but supervisor state changed before cleanup in Runtime Scope ${configDir}.`);
          return;
        }
        if (!cleanupOwnership(configDir, supervisorState.supervisorPid)) {
          failStop(`runtime stopped, but lifecycle ownership changed before cleanup in Runtime Scope ${configDir}.`);
          return;
        }
      } catch (error) {
        failStop(
          `runtime stopped, but lifecycle ownership could not be released in Runtime Scope ${configDir}: ${errorMessage(error)}`,
        );
        return;
      }

      const orphaned = !supervisorWasAlive && runtimeWasAlive;
      process.stdout.write(
        orphaned
          ? `Recovered orphaned runtime in Runtime Scope ${configDir} (runtime PID ${runtimePid}).\n`
          : `Stopped supervised background runtime in Runtime Scope ${configDir} ` +
              `(supervisor PID ${supervisorState.supervisorPid}).\n`,
      );
      process.exitCode = 0;
      return;
    } finally {
      stopLock.release();
    }
  }

  let info;
  try {
    info = readInfo(configDir);
  } catch (error) {
    if (error instanceof PidFileReadError) {
      failStop(`cannot inspect Runtime Scope ${configDir}: ${error.message}`);
      return;
    }
    throw error;
  }

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
          `(${configDir}). Remove it manually.\n`,
      );
    }
    process.exitCode = 0;
    return;
  }

  const exited = await terminateProcess(info.pid, 'Runtime', {
    kill,
    waitForExit,
    isAlive,
    gracefulTimeoutMs,
  });

  if (exited) {
    // The runtime removes its own PID file on graceful shutdown; clean up in
    // case it was force-killed before it could. Match on PID so a runtime that
    // restarted in this scope (rare, but possible) is not clobbered.
    cleanup(configDir, info.pid);
    process.stdout.write(`Stopped runtime in Runtime Scope ${configDir} (PID ${info.pid}).\n`);
    process.exitCode = 0;
    return;
  }

  failStop(`failed to stop runtime (PID ${info.pid}) in Runtime Scope ${configDir}.`);
}

interface TerminateProcessOptions {
  kill: (pid: number, signal: StopSignal) => void;
  waitForExit: typeof waitForProcessExit;
  isAlive: (pid: number) => boolean;
  gracefulTimeoutMs: number;
}

async function terminateProcess(pid: number, label: string, options: TerminateProcessOptions): Promise<boolean> {
  try {
    options.kill(pid, 'SIGTERM');
  } catch (error) {
    logger.warn(`Failed to send SIGTERM to ${label} PID ${pid}: ${error}`);
  }

  let exited = await options.waitForExit(pid, {
    timeoutMs: options.gracefulTimeoutMs,
    isAlive: options.isAlive,
  });
  if (exited) {
    return true;
  }

  logger.warn(`${label} (PID ${pid}) did not exit after SIGTERM; escalating to SIGKILL`);
  try {
    options.kill(pid, 'SIGKILL');
  } catch (error) {
    logger.warn(`Failed to send SIGKILL to ${label} PID ${pid}: ${error}`);
  }
  return options.waitForExit(pid, { timeoutMs: 2000, isAlive: options.isAlive });
}
