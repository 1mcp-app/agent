import fs from 'node:fs';

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
  getPidFilePath,
  isProcessAlive,
  PidFileReadError,
  readPidFile,
  type ServerPidInfo,
} from '@src/core/server/pidFileManager.js';
import {
  inspectProcessIdentity,
  type ProcessIdentity,
  processIdentityRecoveryMessage,
} from '@src/core/server/processIdentity.js';
import { cleanupRuntimeControlFiles } from '@src/core/server/runtimeControl.js';
import {
  acquireRuntimeScopeStopLock,
  readRuntimeScopeOwnership,
  releaseRuntimeScopeOwnership,
  type RuntimeScopeOwnershipRecord,
  type RuntimeScopeStopLock,
} from '@src/core/server/runtimeScopeOwnership.js';
import logger from '@src/logger/logger.js';

import { stopCooperativeRuntime } from './cooperativeRuntime.js';
import { stopLegacyRuntime } from './legacyRuntimeStop.js';

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
  inspectIdentity?: typeof inspectProcessIdentity;
  readSupervisorState?: typeof readBackgroundSupervisorState;
  readOwnership?: typeof readRuntimeScopeOwnership;
  acquireStopLock?: typeof acquireRuntimeScopeStopLock;
  cleanupSupervisorState?: typeof cleanupBackgroundSupervisorState;
  /** Remove only the launch snapshot belonging to the observed supervisor. */
  cleanupLaunchConfig?: (configDir: string, expectedSupervisorPid: number) => boolean;
  /** Guarded release of the matching background-supervisor ownership record. */
  cleanupOwnership?: (configDir: string, expectedSupervisorPid: number) => boolean;
  readInfo?: typeof readPidFile;
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

function runtimeMetadataMatches(info: ServerPidInfo | null, pid: number | null, identity?: ProcessIdentity): boolean {
  return !info || (info.pid === pid && JSON.stringify(info.processIdentity) === JSON.stringify(identity));
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
  try {
    if (await stopCooperativeRuntime(configDir)) return;
  } catch (error) {
    failStop(errorMessage(error));
    return;
  }
  const readSupervisorState = deps.readSupervisorState ?? readBackgroundSupervisorState;
  const readOwnership = deps.readOwnership ?? readRuntimeScopeOwnership;
  const acquireStopLock = deps.acquireStopLock ?? acquireRuntimeScopeStopLock;
  const cleanupSupervisorState = deps.cleanupSupervisorState ?? cleanupBackgroundSupervisorState;
  const cleanupLaunchConfig = deps.cleanupLaunchConfig ?? cleanupSupervisorLaunchConfig;
  const cleanupOwnership = deps.cleanupOwnership ?? cleanupSupervisorOwnership;
  const observedPidRecords = new Map<number, NonNullable<ReturnType<typeof readPidFile>>>();
  const expectedWorkerIdentities = new Map<number, ProcessIdentity>();
  const readInfo: typeof readPidFile = (scope) => {
    const info = (deps.readInfo ?? readPidFile)(scope);
    if (!info && fs.existsSync(getPidFilePath(scope))) {
      throw new PidFileReadError(getPidFilePath(scope), new Error('runtime PID metadata is malformed'));
    }
    if (info) observedPidRecords.set(info.pid, info);
    return info;
  };
  const kill = deps.kill ?? defaultKill;
  const inspectIdentity = deps.inspectIdentity ?? inspectProcessIdentity;
  const cleanup =
    deps.cleanup ??
    ((scope: string, pid: number) => {
      const observed = observedPidRecords.get(pid);
      if (observed) return cleanupPidFileIfMatches(scope, observed);
      const current = readPidFile(scope);
      if (!current) return !fs.existsSync(getPidFilePath(scope));
      const expectedIdentity = expectedWorkerIdentities.get(pid);
      if (
        current.pid !== pid ||
        !expectedIdentity ||
        JSON.stringify(current.processIdentity) !== JSON.stringify(expectedIdentity)
      )
        return false;
      return cleanupPidFileIfMatches(scope, current);
    });
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
        inspectIdentity(supervisorState.supervisorPid, supervisorState.supervisorIdentity) !== 'dead' ||
        (supervisorState.runtimePid !== null &&
          inspectIdentity(supervisorState.runtimePid, supervisorState.runtimeIdentity) !== 'dead');
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
      let initialInfo: ServerPidInfo | null;
      try {
        initialInfo = readInfo(configDir);
        if (
          supervisorState.runtimePid !== null &&
          !runtimeMetadataMatches(initialInfo, supervisorState.runtimePid, supervisorState.runtimeIdentity)
        ) {
          throw new Error('runtime PID metadata conflicts with supervisor state');
        }
        if (
          owner.processIdentity &&
          supervisorState.supervisorIdentity &&
          JSON.stringify(owner.processIdentity) !== JSON.stringify(supervisorState.supervisorIdentity)
        ) {
          throw new Error('supervisor identity conflicts with Runtime Scope ownership');
        }
      } catch (error) {
        failStop(`cannot inspect runtime PID metadata in Runtime Scope ${configDir}: ${errorMessage(error)}`);
        return;
      }
      const supervisorIdentity = owner.processIdentity ?? supervisorState.supervisorIdentity;
      const supervisorStatus = inspectIdentity(supervisorState.supervisorPid, supervisorIdentity);
      const workerPid = supervisorState.runtimePid ?? initialInfo?.pid ?? null;
      const workerIdentity =
        supervisorState.runtimePid === null ? initialInfo?.processIdentity : supervisorState.runtimeIdentity;
      const workerStatus = workerPid === null ? 'dead' : inspectIdentity(workerPid, workerIdentity);
      if (supervisorStatus === 'unknown' || workerStatus === 'unknown') {
        if (
          !owner.processIdentity &&
          !supervisorState.supervisorIdentity &&
          !supervisorState.runtimeIdentity &&
          !initialInfo?.processIdentity
        ) {
          try {
            if (await stopLegacyRuntime(configDir, owner, supervisorState, initialInfo)) {
              process.stdout.write(`Stopped verified legacy background runtime in Runtime Scope ${configDir}.\n`);
              process.exitCode = 0;
              return;
            }
          } catch (error) {
            failStop(`legacy runtime recovery aborted: ${errorMessage(error)}`);
            return;
          }
        }
        if (
          owner.cooperative &&
          !isProcessAlive(supervisorState.supervisorPid) &&
          (workerPid === null || !isProcessAlive(workerPid))
        ) {
          try {
            if (workerPid !== null && initialInfo) {
              if (!cleanup(configDir, workerPid)) throw new Error('runtime PID metadata could not be safely removed');
            }
            if (!cleanupLaunchConfig(configDir, supervisorState.supervisorPid)) {
              throw new Error('launch configuration changed before cleanup');
            }
            if (
              !cleanupSupervisorState(configDir, supervisorState.supervisorPid) &&
              readSupervisorState(configDir) !== null
            ) {
              throw new Error('supervisor state changed before cleanup');
            }
            if (!cleanupRuntimeControlFiles(configDir, owner.claimId)) {
              throw new Error('runtime control files could not be safely removed');
            }
            if (!cleanupOwnership(configDir, supervisorState.supervisorPid)) {
              throw new Error('lifecycle ownership changed before cleanup');
            }
            process.stdout.write(
              `Recovered stale cooperative runtime in Runtime Scope ${configDir} ` +
                `(supervisor PID ${supervisorState.supervisorPid}).\n`,
            );
            process.exitCode = 0;
            return;
          } catch (error) {
            failStop(`cooperative runtime recovery failed in Runtime Scope ${configDir}: ${errorMessage(error)}`);
            return;
          }
        }
        if (owner.cooperative) {
          failStop(
            'Runtime control is unreachable. Preserve ownership metadata and use the original CLI or service manager for explicit recovery.',
          );
          return;
        }
        const pid = supervisorStatus === 'unknown' ? supervisorState.supervisorPid : workerPid!;
        const identity = supervisorStatus === 'unknown' ? supervisorIdentity : workerIdentity;
        failStop(processIdentityRecoveryMessage(pid, identity));

        return;
      }
      const supervisorWasAlive = supervisorStatus === 'alive';
      const runtimeWasAlive = workerStatus === 'alive';
      const terminateOptions = { kill, waitForExit, gracefulTimeoutMs, inspectIdentity };

      if (
        supervisorWasAlive &&
        !(await terminateProcess(supervisorState.supervisorPid, 'supervisor', {
          ...terminateOptions,
          identity: supervisorIdentity,
        }))
      ) {
        failStop(
          `failed to stop Background Runtime Supervisor (PID ${supervisorState.supervisorPid}) in Runtime Scope ${configDir}.`,
        );
        return;
      }

      let runtimePid = supervisorState.runtimePid;
      let runtimeIdentity = supervisorState.runtimeIdentity;
      if (supervisorWasAlive) {
        try {
          const finalState = readSupervisorState(configDir);
          if (finalState?.supervisorPid === supervisorState.supervisorPid) {
            if (finalState.runtimePid !== null) {
              runtimePid = finalState.runtimePid;
              runtimeIdentity = finalState.runtimeIdentity;
            }
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
          const recoveredInfo = readInfo(configDir);
          runtimePid = recoveredInfo?.pid ?? null;
          runtimeIdentity = recoveredInfo?.processIdentity;
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
        !(await terminateProcess(runtimePid, 'runtime', { ...terminateOptions, identity: runtimeIdentity }))
      ) {
        failStop(`failed to stop supervised runtime (PID ${runtimePid}) in Runtime Scope ${configDir}.`);
        return;
      }

      try {
        const finalInfo = readInfo(configDir);
        if (!runtimeMetadataMatches(finalInfo, runtimePid, runtimeIdentity)) {
          throw new Error('runtime PID metadata changed to a different process incarnation');
        }
        if (runtimePid !== null) {
          if (runtimeIdentity) expectedWorkerIdentities.set(runtimePid, runtimeIdentity);
          if (!cleanup(configDir, runtimePid)) throw new Error('runtime PID metadata could not be safely removed');
        }
      } catch (error) {
        failStop(
          `runtime stopped, but PID metadata must be retained in Runtime Scope ${configDir}: ${errorMessage(error)}`,
        );
        return;
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
    if (fs.existsSync(getPidFilePath(configDir))) {
      failStop(`runtime PID metadata is malformed in Runtime Scope ${configDir}; refusing ambiguous stop.`);
      return;
    }
    process.stdout.write(`No runtime is running in this Runtime Scope: ${configDir}\n`);
    process.exitCode = 0;
    return;
  }

  // Stale dead-process PID file: clean it up and report cleanly.
  const identityStatus = inspectIdentity(info.pid, info.processIdentity);
  if (identityStatus === 'unknown') {
    failStop(processIdentityRecoveryMessage(info.pid, info.processIdentity));
    return;
  }
  if (identityStatus === 'dead') {
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
    identity: info.processIdentity,
    inspectIdentity,
    kill,
    waitForExit,
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
  identity?: ProcessIdentity;
  inspectIdentity: typeof inspectProcessIdentity;
  kill: (pid: number, signal: StopSignal) => void;
  waitForExit: typeof waitForProcessExit;
  gracefulTimeoutMs: number;
}

async function terminateProcess(pid: number, label: string, options: TerminateProcessOptions): Promise<boolean> {
  const beforeTerm = options.inspectIdentity(pid, options.identity);
  if (beforeTerm !== 'alive') return beforeTerm === 'dead';
  const sameProcessAlive = () => options.inspectIdentity(pid, options.identity) !== 'dead';
  try {
    options.kill(pid, 'SIGTERM');
  } catch (error) {
    logger.warn(`Failed to send SIGTERM to ${label} PID ${pid}: ${error}`);
  }

  let exited = await options.waitForExit(pid, {
    timeoutMs: options.gracefulTimeoutMs,
    isAlive: sameProcessAlive,
  });
  if (exited) {
    return true;
  }

  const beforeKill = options.inspectIdentity(pid, options.identity);
  if (beforeKill !== 'alive') return beforeKill === 'dead';
  logger.warn(`${label} (PID ${pid}) did not exit after SIGTERM; escalating to SIGKILL`);
  try {
    options.kill(pid, 'SIGKILL');
  } catch (error) {
    logger.warn(`Failed to send SIGKILL to ${label} PID ${pid}: ${error}`);
  }
  return options.waitForExit(pid, { timeoutMs: 2000, isAlive: sameProcessAlive });
}
