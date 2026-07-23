export type BackendSupervisionState = 'connected' | 'restarting' | 'crash-loop' | 'stopped';

export interface BackendSupervisionPolicy {
  restartOnExit: boolean;
  maxRestarts?: number;
  restartDelay?: number;
}

export interface BackendExitFacts {
  code: number | null;
  signal: string | null;
  pid?: number | null;
  at?: Date;
}

export interface BackendSupervisionSnapshot {
  backendId: string;
  state: BackendSupervisionState;
  attempt: number;
  limit: number | null;
  nextRetryAt: Date | null;
  lastExit: (Required<Omit<BackendExitFacts, 'pid' | 'at'>> & { pid: number | null; at: Date }) | null;
  lastError: Error | null;
  currentPid: number | null;
}

export interface BackendRecoveryResult {
  pid?: number | null;
  activate?: () => void;
  dispose?: () => void | Promise<void>;
}

export interface BackendStdioSupervisorOptions {
  backendId: string;
  policy: BackendSupervisionPolicy;
  recover: (signal: AbortSignal) => Promise<BackendRecoveryResult>;
  onStateChange?: (snapshot: BackendSupervisionSnapshot) => void;
  stablePeriodMs?: number;
  initialPid?: number | null;
  now?: () => Date;
}

const DEFAULT_MAX_RESTARTS = 5;
const DEFAULT_RESTART_DELAY_MS = 1_000;
const DEFAULT_STABLE_PERIOD_MS = 5 * 60 * 1_000;

export class BackendStdioSupervisor {
  private readonly backendId: string;
  private readonly policy: BackendSupervisionPolicy;
  private readonly recover: BackendStdioSupervisorOptions['recover'];
  private readonly onStateChange?: BackendStdioSupervisorOptions['onStateChange'];
  private readonly stablePeriodMs: number;
  private readonly now: () => Date;
  private readonly limit: number | null;

  private state: BackendSupervisionState = 'connected';
  private attempt = 0;
  private nextRetryAt: Date | null = null;
  private lastExit: BackendSupervisionSnapshot['lastExit'] = null;
  private lastError: Error | null = null;
  private currentPid: number | null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryController: AbortController | null = null;
  private activeRecoveries = new Set<Promise<void>>();
  private generation = 0;

  constructor(options: BackendStdioSupervisorOptions) {
    this.backendId = options.backendId;
    this.policy = options.policy;
    this.recover = options.recover;
    this.onStateChange = options.onStateChange;
    this.stablePeriodMs = options.stablePeriodMs ?? DEFAULT_STABLE_PERIOD_MS;
    this.now = options.now ?? (() => new Date());
    this.limit = options.policy.maxRestarts === 0 ? null : (options.policy.maxRestarts ?? DEFAULT_MAX_RESTARTS);
    this.currentPid = options.initialPid ?? null;
  }

  public snapshot(): BackendSupervisionSnapshot {
    return {
      backendId: this.backendId,
      state: this.state,
      attempt: this.attempt,
      limit: this.limit,
      nextRetryAt: this.nextRetryAt ? new Date(this.nextRetryAt) : null,
      lastExit: this.lastExit ? { ...this.lastExit, at: new Date(this.lastExit.at) } : null,
      lastError: this.lastError,
      currentPid: this.currentPid,
    };
  }

  public handleUnexpectedExit(exit: BackendExitFacts): void {
    if (this.state === 'stopped' || !this.policy.restartOnExit) {
      return;
    }

    const generation = this.beginNewOperation();
    this.currentPid = null;
    this.lastExit = {
      code: exit.code,
      signal: exit.signal,
      pid: exit.pid ?? null,
      at: exit.at ? new Date(exit.at) : this.now(),
    };
    this.lastError = null;
    this.scheduleNextAttempt(generation);
  }

  public async restartNow(): Promise<void> {
    if (this.state === 'stopped') {
      throw new Error(`Backend ${this.backendId} is stopped`);
    }

    const generation = this.beginNewOperation();
    this.attempt = 0;
    this.currentPid = null;
    this.lastError = null;
    this.state = 'restarting';
    this.nextRetryAt = this.now();
    this.publish();
    await this.startRecovery(generation, true);
  }

  public async stop(): Promise<void> {
    this.beginNewOperation();
    this.state = 'stopped';
    this.currentPid = null;
    this.nextRetryAt = null;
    this.publish();
    await Promise.allSettled(Array.from(this.activeRecoveries));
  }

  private beginNewOperation(): number {
    this.generation += 1;
    this.clearTimer('retry');
    this.clearTimer('stable');
    this.recoveryController?.abort();
    this.recoveryController = null;
    return this.generation;
  }

  private scheduleNextAttempt(generation: number): void {
    if (generation !== this.generation || this.state === 'stopped') {
      return;
    }

    const nextAttempt = this.attempt + 1;
    if (this.limit !== null && nextAttempt > this.limit) {
      this.state = 'crash-loop';
      this.nextRetryAt = null;
      this.publish();
      return;
    }

    this.attempt = nextAttempt;
    const initialDelay = this.policy.restartDelay ?? DEFAULT_RESTART_DELAY_MS;
    const delay = initialDelay * 2 ** Math.min(nextAttempt - 1, 4);
    this.state = 'restarting';
    this.nextRetryAt = new Date(this.now().getTime() + delay);
    this.publish();

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.startRecovery(generation, false);
    }, delay);
    this.retryTimer.unref?.();
  }

  private startRecovery(generation: number, manual: boolean): Promise<void> {
    const recovery = this.runRecovery(generation, manual);
    this.activeRecoveries.add(recovery);
    void recovery.then(
      () => this.activeRecoveries.delete(recovery),
      () => this.activeRecoveries.delete(recovery),
    );
    return recovery;
  }

  private async runRecovery(generation: number, manual: boolean): Promise<void> {
    if (generation !== this.generation || this.state === 'stopped') {
      return;
    }

    const controller = new AbortController();
    this.recoveryController = controller;
    this.nextRetryAt = null;
    this.publish();

    try {
      const result = await this.recover(controller.signal);
      if (this.isRecoveryStale(generation, controller)) {
        await result.dispose?.();
        return;
      }

      result.activate?.();
      if (this.isRecoveryStale(generation, controller)) {
        await result.dispose?.();
        return;
      }

      this.recoveryController = null;
      this.state = 'connected';
      this.currentPid = result.pid ?? null;
      this.lastError = null;
      if (manual) {
        this.attempt = 0;
      }
      this.publish();
      this.scheduleStableReset(generation);
    } catch (error) {
      if (this.isRecoveryStale(generation, controller)) {
        return;
      }

      this.recoveryController = null;
      const recoveryError = error instanceof Error ? error : new Error(String(error));
      this.lastError = recoveryError;
      this.scheduleNextAttempt(generation);
      if (manual) {
        throw recoveryError;
      }
    }
  }

  private scheduleStableReset(generation: number): void {
    this.clearTimer('stable');
    this.stableTimer = setTimeout(() => {
      this.stableTimer = null;
      if (generation !== this.generation || this.state !== 'connected') {
        return;
      }
      this.attempt = 0;
      this.publish();
    }, this.stablePeriodMs);
    this.stableTimer.unref?.();
  }

  private isRecoveryStale(generation: number, controller: AbortController): boolean {
    return generation !== this.generation || controller.signal.aborted || this.state === 'stopped';
  }

  private clearTimer(kind: 'retry' | 'stable'): void {
    const timer = kind === 'retry' ? this.retryTimer : this.stableTimer;
    if (timer) {
      clearTimeout(timer);
      if (kind === 'retry') {
        this.retryTimer = null;
      } else {
        this.stableTimer = null;
      }
    }
  }

  private publish(): void {
    this.onStateChange?.(this.snapshot());
  }
}
