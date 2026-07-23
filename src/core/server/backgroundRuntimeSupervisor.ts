import { spawn, type SpawnOptions } from 'child_process';

import {
  type BackgroundRuntimeExit,
  type BackgroundRuntimeSignal,
  type BackgroundSupervisorState,
  writeBackgroundSupervisorState,
} from '@src/core/server/backgroundRuntimeSupervisorState.js';

export * from '@src/core/server/backgroundRuntimeSupervisorState.js';

export const BACKGROUND_RESTART_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000] as const;
export const BACKGROUND_STABLE_RESET_MS = 5 * 60 * 1_000;

export interface SupervisedRuntimeWorker {
  readonly pid?: number;
  on(event: 'error', listener: (error: Error) => void): this | void;
  once(event: 'close', listener: (code: number | null, signal: BackgroundRuntimeSignal | null) => void): this | void;
  kill(signal?: BackgroundRuntimeSignal): unknown;
}

export interface BackgroundSupervisorEvent {
  at: string;
  event:
    | 'runtime-spawned'
    | 'runtime-ready'
    | 'runtime-unreachable'
    | 'runtime-exit'
    | 'restart-scheduled'
    | 'restart-counter-reset'
    | 'runtime-recovered'
    | 'retry-exhausted'
    | 'supervisor-stopping';
  supervisorPid: number;
  runtimePid?: number;
  restartAttempt?: number;
  delayMs?: number;
  exit?: BackgroundRuntimeExit;
}

export interface BackgroundSupervisorOptions {
  configDir: string;
  workerCommand: string;
  /** Immutable effective invocation reused verbatim for every replacement. */
  workerArgs: readonly string[];
  supervisorPid?: number;
}

export interface BackgroundSupervisorDependencies {
  spawnWorker?: (command: string, args: readonly string[], options: SpawnOptions) => SupervisedRuntimeWorker;
  waitForReady: (worker: SupervisedRuntimeWorker) => Promise<boolean>;
  writeState?: (state: BackgroundSupervisorState) => void;
  appendEvent?: (event: BackgroundSupervisorEvent) => void;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  waitBeforeReadinessRetry?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => Date;
  waitForStop?: () => Promise<void>;
}

interface WorkerExitOutcome {
  kind: 'exit';
  exit: BackgroundRuntimeExit;
}

interface StopOutcome {
  kind: 'stop';
}

function defaultWaitForStop(): Promise<void> {
  return new Promise((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
    process.once('SIGHUP', resolve);
  });
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function cloneState(state: BackgroundSupervisorState): BackgroundSupervisorState {
  return {
    ...state,
    lastExit: state.lastExit ? { ...state.lastExit } : null,
  };
}

/**
 * Run one persistent Background Runtime Supervisor until deliberate stop.
 * The worker is never restarted because of readiness alone; only an observed
 * process exit consumes an attempt.
 */
export async function runBackgroundRuntimeSupervisor(
  options: BackgroundSupervisorOptions,
  dependencies: BackgroundSupervisorDependencies,
): Promise<void> {
  const supervisorPid = options.supervisorPid ?? process.pid;
  const now = dependencies.now ?? (() => new Date());
  const sleep = dependencies.sleep ?? defaultSleep;
  const waitBeforeReadinessRetry = dependencies.waitBeforeReadinessRetry ?? defaultSleep;
  const waitForStop = dependencies.waitForStop ?? defaultWaitForStop;
  const stopPromise = waitForStop().then<StopOutcome>(() => ({ kind: 'stop' }));
  const spawnWorker =
    dependencies.spawnWorker ??
    ((command: string, args: readonly string[], spawnOptions: SpawnOptions) =>
      spawn(command, [...args], spawnOptions) as unknown as SupervisedRuntimeWorker);
  const writeState =
    dependencies.writeState ??
    ((snapshot: BackgroundSupervisorState) => writeBackgroundSupervisorState(options.configDir, snapshot));
  const appendEvent = dependencies.appendEvent ?? (() => {});
  const workerArgs = Object.freeze([...options.workerArgs]);

  const state: BackgroundSupervisorState = {
    version: 1,
    status: 'starting',
    supervisorPid,
    runtimePid: null,
    restartAttempt: 0,
    lastExit: null,
    nextRetryAt: null,
    readyAt: null,
    updatedAt: now().toISOString(),
  };
  let activeWorker: SupervisedRuntimeWorker | undefined;
  let activeExitPromise: Promise<WorkerExitOutcome> | undefined;

  const persist = (updates: Partial<BackgroundSupervisorState>): void => {
    Object.assign(state, updates, { updatedAt: now().toISOString() });
    writeState(cloneState(state));
  };
  const record = (event: Omit<BackgroundSupervisorEvent, 'at' | 'supervisorPid'>): void => {
    appendEvent({ ...event, at: now().toISOString(), supervisorPid });
  };

  try {
    persist({ status: 'starting' });

    for (;;) {
      const worker = spawnWorker(options.workerCommand, workerArgs, { stdio: 'ignore' });
      let workerErrorMessage: string | undefined;
      worker.on('error', (error) => {
        workerErrorMessage = error.message;
      });
      // An error does not prove termination; close is the authoritative signal
      // that it is safe to account for the exit and consider a replacement.
      const exitPromise = new Promise<WorkerExitOutcome>((resolve) => {
        worker.once('close', (code, signal) => {
          resolve({
            kind: 'exit',
            exit: {
              at: now().toISOString(),
              code,
              signal,
              ...(workerErrorMessage ? { error: workerErrorMessage } : {}),
            },
          });
        });
      });
      if (!worker.pid) {
        throw new Error('Background Runtime Supervisor failed to spawn a runtime worker');
      }
      activeWorker = worker;
      activeExitPromise = exitPromise;
      void exitPromise.then(() => {
        if (activeWorker === worker) {
          activeWorker = undefined;
          activeExitPromise = undefined;
        }
      });
      const runtimePid = worker.pid;
      persist({ status: 'starting', runtimePid, nextRetryAt: null, readyAt: null });
      record({ event: 'runtime-spawned', runtimePid, restartAttempt: state.restartAttempt });

      const stopWorker = async (): Promise<void> => {
        persist({ status: 'stopping', nextRetryAt: null });
        record({ event: 'supervisor-stopping', runtimePid });
        worker.kill('SIGTERM');
        await exitPromise;
      };

      const readiness = dependencies.waitForReady(worker).then((ready) => ({ kind: 'readiness' as const, ready }));
      const startupOutcome = await Promise.race([readiness, exitPromise, stopPromise]);
      if (startupOutcome.kind === 'stop') {
        await stopWorker();
        return;
      }
      let exitOutcome: WorkerExitOutcome | undefined;
      if (startupOutcome.kind === 'readiness') {
        let ready = startupOutcome.ready;
        if (!ready) {
          persist({ status: 'running', readyAt: null });
          record({ event: 'runtime-unreachable', runtimePid, restartAttempt: state.restartAttempt });
        }
        while (!ready && !exitOutcome) {
          const retryReadinessTimer = new AbortController();
          const retryOutcome = await Promise.race([
            waitBeforeReadinessRetry(250, retryReadinessTimer.signal).then(() => ({
              kind: 'retry-readiness' as const,
            })),
            exitPromise,
            stopPromise,
          ]);
          if (retryOutcome.kind === 'stop') {
            retryReadinessTimer.abort();
            await stopWorker();
            return;
          }
          if (retryOutcome.kind === 'exit') {
            retryReadinessTimer.abort();
            exitOutcome = retryOutcome;
            break;
          }
          const observation = await Promise.race([
            dependencies.waitForReady(worker).then((isReady) => ({ kind: 'readiness' as const, ready: isReady })),
            exitPromise,
            stopPromise,
          ]);
          if (observation.kind === 'stop') {
            await stopWorker();
            return;
          }
          if (observation.kind === 'exit') {
            exitOutcome = observation;
            break;
          }
          ready = observation.ready;
        }
        if (ready) {
          persist({ status: 'running', readyAt: now().toISOString() });
          record({ event: 'runtime-ready', runtimePid, restartAttempt: state.restartAttempt });
        }
        if (!exitOutcome && ready && state.restartAttempt > 0) {
          record({ event: 'runtime-recovered', runtimePid, restartAttempt: state.restartAttempt });
          const stableTimer = new AbortController();
          const stableOutcome = await Promise.race([
            sleep(BACKGROUND_STABLE_RESET_MS, stableTimer.signal).then(() => ({ kind: 'stable' as const })),
            exitPromise,
            stopPromise,
          ]);
          if (stableOutcome.kind === 'stop') {
            stableTimer.abort();
            await stopWorker();
            return;
          }
          if (stableOutcome.kind === 'stable') {
            persist({ restartAttempt: 0 });
            record({ event: 'restart-counter-reset', runtimePid, restartAttempt: 0 });
            const settledOutcome = await Promise.race([exitPromise, stopPromise]);
            if (settledOutcome.kind === 'stop') {
              await stopWorker();
              return;
            }
            exitOutcome = settledOutcome;
          } else {
            stableTimer.abort();
            exitOutcome = stableOutcome;
          }
        } else if (!exitOutcome) {
          const runningOutcome = await Promise.race([exitPromise, stopPromise]);
          if (runningOutcome.kind === 'stop') {
            await stopWorker();
            return;
          }
          exitOutcome = runningOutcome;
        }
      } else {
        exitOutcome = startupOutcome;
      }

      if (!exitOutcome) {
        throw new Error('Background Runtime Supervisor lost the worker exit outcome');
      }
      const exit = exitOutcome.exit;
      persist({ runtimePid: null, lastExit: exit, nextRetryAt: null, readyAt: null });
      record({ event: 'runtime-exit', runtimePid, restartAttempt: state.restartAttempt, exit });

      if (state.restartAttempt >= BACKGROUND_RESTART_DELAYS_MS.length) {
        persist({ status: 'crash-loop', runtimePid: null, nextRetryAt: null });
        record({ event: 'retry-exhausted', restartAttempt: state.restartAttempt, exit });
        await stopPromise;
        persist({ status: 'stopping' });
        record({ event: 'supervisor-stopping' });
        return;
      }

      const restartAttempt = state.restartAttempt + 1;
      const delayMs = BACKGROUND_RESTART_DELAYS_MS[restartAttempt - 1];
      const nextRetryAt = new Date(now().getTime() + delayMs).toISOString();
      persist({ status: 'restarting', restartAttempt, nextRetryAt });
      record({ event: 'restart-scheduled', restartAttempt, delayMs, exit });

      const retryTimer = new AbortController();
      const delayOutcome = await Promise.race([
        sleep(delayMs, retryTimer.signal).then(() => ({ kind: 'delay' as const })),
        stopPromise,
      ]);
      if (delayOutcome.kind === 'stop') {
        retryTimer.abort();
        persist({ status: 'stopping', nextRetryAt: null });
        record({ event: 'supervisor-stopping' });
        return;
      }
    }
  } catch (error) {
    if (activeWorker && activeExitPromise) {
      try {
        activeWorker.kill('SIGTERM');
      } catch {
        // Keep ownership held until the tracked worker's exit can be observed.
      }
      await activeExitPromise;
    }
    throw error;
  }
}
