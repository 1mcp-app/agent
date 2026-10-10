import { PreparationAdapterRegistry } from './adapterRegistry.js';
import type {
  BackendPolicy,
  BackendPreparationAdapter,
  BackendReadiness,
  PreparationAction,
  PreparationAdmission,
  PreparationFailure,
  PreparationOptions,
  PreparationRecoveryHint,
  PreparationResult,
  PreparationStatus,
  PreparationTarget,
  ProjectPreparationPreferences,
} from './contracts.js';
import {
  BackendPolicySchema,
  BackendReadyReadinessSchema,
  PreparationFailureSchema,
  preparationKey,
  PreparationOptionsSchema,
  PreparationTargetSchema,
} from './policy.js';
import { PreparationScheduler } from './scheduler.js';

interface PreparationJob {
  status: PreparationStatus;
  readonly adapter: BackendPreparationAdapter;
  readonly policy: BackendPolicy;
  readonly controller: AbortController;
  readonly listeners: Set<() => void>;
  settling: boolean;
  retrying: boolean;
  readonly completion: Promise<void>;
  readonly complete: () => void;
}

export class BackendPreparationService {
  readonly options: PreparationOptions;
  readonly scheduler: PreparationScheduler;
  private readonly jobs = new Map<string, PreparationJob>();
  private readonly identities = new Map<string, string>();
  private sequence = 0;
  private shuttingDown = false;

  constructor(
    private readonly registry: PreparationAdapterRegistry,
    options: Partial<PreparationOptions> = {},
  ) {
    this.options = PreparationOptionsSchema.parse(options);
    this.scheduler = new PreparationScheduler(this.options.concurrency, this.options.queueCapacity);
  }

  async inspect(target: PreparationTarget, operation: string): Promise<BackendReadiness> {
    const resolved = PreparationTargetSchema.parse(target);
    const adapter = this.registry.get(resolved.backendName);
    if (!adapter) return this.unsupported(resolved.backendName);
    return this.probe(adapter, resolved, operation, this.options.requestWaitMs);
  }

  /** Recovery only reconciles native evidence. A persisted running flag never starts or kills work. */
  async recover(
    target: PreparationTarget,
    operation: string,
    advisory: PreparationRecoveryHint,
    options: { readonly waitMs?: number; readonly signal?: AbortSignal } = {},
  ): Promise<BackendReadiness> {
    const resolved = PreparationTargetSchema.parse(target);
    const adapter = this.registry.get(resolved.backendName);
    if (!adapter) return this.unsupported(resolved.backendName);
    if (!adapter.reconcile)
      return {
        state: 'conflict',
        instructions:
          'Native ownership reconciliation is unavailable; inspect prerequisites before explicit preparation.',
      };
    const waitMs = PreparationOptionsSchema.shape.requestWaitMs.parse(options.waitMs ?? this.options.requestWaitMs);
    return this.readReadiness(
      (signal) => adapter.reconcile!(resolved, operation, advisory, { signal }),
      (error) => adapter.classifyFailure(error),
      waitMs,
      options.signal,
    );
  }

  async prepare(
    target: PreparationTarget,
    operation: string,
    policy: BackendPolicy,
    action?: PreparationAction,
  ): Promise<PreparationResult> {
    if (this.shuttingDown) return this.shutdownResult();
    const resolved = Object.freeze(PreparationTargetSchema.parse(target));
    const authority = BackendPolicySchema.parse(policy);
    const active = this.activeJob(resolved, authority, action);
    if (active) return { state: 'job', status: this.snapshot(active) };
    const adapter = this.registry.get(resolved.backendName);
    if (!adapter) return this.unsupported(resolved.backendName);
    const readiness = await this.probe(adapter, resolved, operation, this.options.requestWaitMs);
    return this.prepareInspected(resolved, operation, authority, adapter, readiness, action);
  }

  private prepareInspected(
    resolved: PreparationTarget,
    operation: string,
    authority: BackendPolicy,
    adapter: BackendPreparationAdapter,
    readiness: BackendReadiness,
    action?: PreparationAction,
    replacement?: PreparationJob,
  ): PreparationResult {
    if (this.shuttingDown) return this.shutdownResult();
    const active = this.activeJob(resolved, authority, action);
    if (active) return { state: 'job', status: this.snapshot(active) };
    if (readiness.state === 'conflict') return readiness;
    if (readiness.state === 'unsupported') return readiness;
    if (readiness.state === 'ready') {
      if (!action) {
        this.clearResolvedFailure(resolved, operation, authority, readiness);
        return { state: 'ready', readiness };
      }
    }
    const selected = action ?? (readiness.state === 'required' ? readiness.action : undefined);
    if (!selected) return { state: 'forbidden', instructions: 'No permitted preparation action was selected.' };
    if (!authority.allowedActions.includes(selected))
      return { state: 'forbidden', instructions: `Runtime policy does not permit ${selected}.` };
    const key = `${preparationKey(resolved, authority, this.options)}:${selected}`;
    // Another compatible inspection may have admitted a job while this inspection was pending.
    const failed = action ? undefined : this.failedJob(resolved, authority);
    if (failed) return { state: 'job', status: this.snapshot(failed) };
    const admitted = this.findJob(key);
    if (admitted && admitted !== replacement && admitted.status.state !== 'ready')
      return { state: 'job', status: this.snapshot(admitted) };
    if (admitted && admitted !== replacement) this.identities.delete(key);
    if (!replacement) this.releaseCompletedRecords();
    if (this.jobs.size - (replacement ? 1 : 0) >= this.options.maxRecords)
      return {
        state: 'busy',
        instructions: 'Preparation status capacity reached; use a new runtime after reconciling retained operations.',
      };
    let complete!: () => void;
    const completion = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const job: PreparationJob = {
      status: {
        id: `preparation-${++this.sequence}`,
        target: resolved,
        operation,
        action: selected,
        state: 'queued',
        attempt: 1,
        executionDeadlineMs: authority.executionDeadlineMs ?? this.options.executionDeadlineMs,
        readiness,
      },
      adapter,
      policy: authority,
      controller: new AbortController(),
      listeners: new Set(),
      settling: false,
      retrying: false,
      completion,
      complete,
    };
    if (
      !this.scheduler.schedule(job.status.id, async () => {
        try {
          await this.execute(job);
        } finally {
          job.complete();
        }
      })
    ) {
      return { state: 'busy', instructions: 'Preparation queue is full; submit a new request later.' };
    }
    if (replacement) this.removeRecord(replacement);
    this.jobs.set(job.status.id, job);
    this.identities.set(key, job.status.id);
    return { state: 'job', status: this.snapshot(job) };
  }

  /** Never receives an operation callback, so pending calls cannot be queued or replayed. */
  async admit(
    target: PreparationTarget,
    operation: string,
    policy: BackendPolicy,
    preferences: ProjectPreparationPreferences,
    options: { readonly waitMs?: number; readonly signal?: AbortSignal } = {},
  ): Promise<PreparationAdmission> {
    if (this.shuttingDown) return this.shutdownResult();
    const resolved = Object.freeze(PreparationTargetSchema.parse(target));
    const authority = BackendPolicySchema.parse(policy);
    const waitMs = PreparationOptionsSchema.shape.requestWaitMs.parse(options.waitMs ?? this.options.requestWaitMs);
    const expiresAt = Date.now() + waitMs;
    const remaining = (): number => Math.max(0, expiresAt - Date.now());
    const active = this.activeJob(resolved, authority);
    let result: PreparationResult;
    if (active) {
      result = { state: 'job', status: this.snapshot(active) };
    } else {
      const adapter = this.registry.get(resolved.backendName);
      if (!adapter) return this.unsupported(resolved.backendName);
      const readiness = await this.probe(adapter, resolved, operation, remaining(), options.signal);
      const joined = this.activeJob(resolved, authority);
      if (joined) result = { state: 'job', status: this.snapshot(joined) };
      else {
        if (readiness.state === 'ready') {
          this.clearResolvedFailure(resolved, operation, authority, readiness);
          return { state: 'ready', readiness };
        }
        if (readiness.state === 'unsupported') return readiness;
        if (readiness.state === 'conflict') return readiness;
        if (!preferences[resolved.backendName]?.enabled)
          return { state: 'disabled', instructions: readiness.instructions };
        result = this.prepareInspected(resolved, operation, authority, adapter, readiness);
      }
    }
    if (result.state !== 'job') return result;
    const status = await this.wait(result.status.id, { waitMs: remaining(), signal: options.signal });
    if (!status) throw new Error('Preparation job disappeared');
    if (status.state === 'ready') {
      // Readiness for one operation never proves readiness for a different operation.
      const adapter = this.registry.get(resolved.backendName)!;
      const current = await this.probe(adapter, resolved, operation, remaining(), options.signal);
      if (current.state === 'ready') {
        this.clearResolvedFailure(resolved, operation, authority, current);
        return { state: 'ready', readiness: current };
      }
      if (current.state === 'unsupported') return current;
      if (current.state === 'conflict') return current;
      if (!preferences[resolved.backendName]?.enabled) return { state: 'disabled', instructions: current.instructions };
      return this.prepareInspected(resolved, operation, authority, adapter, current);
    }
    if (status.state === 'failed') return { state: 'job', status };
    if (status.state === 'cancelled') return { state: 'job', status };
    return {
      state: 'pending',
      status,
      operationExecuted: false,
      operationQueued: false,
      instructions: `Preparation ${status.id} is ${status.state}. Check status or wait, then submit the original operation again; it has not executed and will not be replayed.`,
    };
  }

  status(id: string): PreparationStatus | undefined {
    const job = this.jobs.get(id);
    return job ? this.snapshot(job) : undefined;
  }

  async wait(
    id: string,
    options: { readonly waitMs?: number; readonly signal?: AbortSignal } = {},
  ): Promise<PreparationStatus | undefined> {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    const waitMs = PreparationOptionsSchema.shape.requestWaitMs.parse(options.waitMs ?? this.options.requestWaitMs);
    if (this.terminal(job)) return this.snapshot(job);
    if (options.signal?.aborted) return this.snapshot(job);
    if (job.listeners.size >= 1024) return this.snapshot(job);
    await new Promise<void>((resolve) => {
      const finish = (): void => {
        clearTimeout(timer);
        job.listeners.delete(changed);
        options.signal?.removeEventListener('abort', finish);
        resolve();
      };
      const changed = (): void => {
        if (this.terminal(job)) finish();
      };
      const timer = setTimeout(finish, waitMs);
      job.listeners.add(changed);
      options.signal?.addEventListener('abort', finish, { once: true });
    });
    return this.snapshot(job);
  }

  cancel(id: string): PreparationStatus | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    if (this.terminal(job)) return this.snapshot(job);
    if (this.scheduler.cancelQueued(id)) {
      this.update(job, { state: 'cancelled' });
      job.complete();
      return this.snapshot(job);
    }
    this.update(job, { state: 'cancelling' });
    job.controller.abort();
    return this.snapshot(job);
  }

  /** Explicit retry creates a new compatible identity when the execution budget changes. */
  async retry(id: string, policy?: BackendPolicy): Promise<PreparationResult> {
    const job = this.jobs.get(id);
    if (!job) return { state: 'unsupported', instructions: 'Unknown preparation operation.' };
    if (this.shuttingDown) return this.shutdownResult();
    if (job.retrying) return { state: 'busy', instructions: 'Explicit retry inspection is already in progress.' };
    if (job.settling) return { state: 'busy', instructions: 'Owned preparation work has not stopped yet.' };
    if (!this.terminal(job)) return { state: 'job', status: this.snapshot(job) };
    const authority = BackendPolicySchema.parse(policy ?? job.policy);
    const deadline = authority.executionDeadlineMs ?? this.options.executionDeadlineMs;
    if (job.status.failure?.code === 'execution_deadline') {
      if (deadline <= job.status.executionDeadlineMs)
        return {
          state: 'forbidden',
          instructions: 'Execution deadline exhausted; explicitly select a larger execution budget before retrying.',
        };
    }
    if (!authority.allowedActions.includes(job.status.action))
      return { state: 'forbidden', instructions: `Runtime policy does not permit ${job.status.action}.` };
    job.retrying = true;
    try {
      const readiness = await this.probe(
        job.adapter,
        job.status.target,
        job.status.operation,
        this.options.requestWaitMs,
      );
      return this.prepareInspected(
        job.status.target,
        job.status.operation,
        authority,
        job.adapter,
        readiness,
        job.status.action,
        job,
      );
    } finally {
      job.retrying = false;
    }
  }

  /** Stop admission and wait for actual owned work settlement, including expired jobs. */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    const completions: Promise<void>[] = [];
    for (const job of this.jobs.values()) {
      if (job.settling) job.controller.abort();
      if (!this.terminal(job)) this.cancel(job.status.id);
      completions.push(job.completion);
    }
    await Promise.all(completions);
  }

  /** Only restores a validated stable failure; it confers no process ownership or repair authority. */
  importFailure(
    target: PreparationTarget,
    operation: string,
    policy: BackendPolicy,
    action: PreparationAction,
    failure: PreparationFailure,
  ): PreparationStatus | undefined {
    if (this.shuttingDown) return undefined;
    const resolved = Object.freeze(PreparationTargetSchema.parse(target));
    const authority = BackendPolicySchema.parse(policy);
    const diagnostic = PreparationFailureSchema.parse(failure);
    if (!operation) throw new Error('Preparation operation is required');
    if (!authority.allowedActions.includes(action)) return undefined;
    const adapter = this.registry.get(resolved.backendName);
    if (!adapter) return undefined;
    const key = `${preparationKey(resolved, authority, this.options)}:${action}`;
    if (this.findJob(key)) return undefined;
    if (this.activeJob(resolved, authority)) return undefined;
    this.releaseCompletedRecords();
    if (this.jobs.size >= this.options.maxRecords) return undefined;
    const job: PreparationJob = {
      status: {
        id: `preparation-${++this.sequence}`,
        target: resolved,
        operation,
        action,
        state: 'failed',
        attempt: 1,
        executionDeadlineMs: authority.executionDeadlineMs ?? this.options.executionDeadlineMs,
        failure: diagnostic,
      },
      adapter,
      policy: authority,
      controller: new AbortController(),
      listeners: new Set(),
      settling: false,
      retrying: false,
      completion: Promise.resolve(),
      complete: () => {},
    };
    this.jobs.set(job.status.id, job);
    this.identities.set(key, job.status.id);
    return this.snapshot(job);
  }

  /** Caller supplies fresh native evidence; advisory state alone cannot resolve a failure. */
  clearResolvedFailure(
    target: PreparationTarget,
    operation: string,
    policy: BackendPolicy,
    readiness: Extract<BackendReadiness, { state: 'ready' }>,
  ): number {
    const resolved = PreparationTargetSchema.parse(target);
    const authority = BackendPolicySchema.parse(policy);
    BackendReadyReadinessSchema.parse(readiness);
    const base = preparationKey(resolved, authority, this.options);
    let cleared = 0;
    for (const action of authority.allowedActions) {
      const job = this.findJob(`${base}:${action}`);
      if (!job) continue;
      if (job.status.state !== 'failed') continue;
      if (job.status.operation !== operation) continue;
      if (job.settling) continue;
      if (job.retrying) continue;
      this.removeRecord(job);
      cleared++;
    }
    return cleared;
  }

  private removeRecord(job: PreparationJob): void {
    this.jobs.delete(job.status.id);
    for (const [key, id] of this.identities) {
      if (id === job.status.id) this.identities.delete(key);
    }
  }

  private shutdownResult(): { state: 'busy'; instructions: string } {
    return { state: 'busy', instructions: 'Preparation runtime is shutting down; no new work can start.' };
  }

  private async execute(job: PreparationJob): Promise<void> {
    if (job.controller.signal.aborted) {
      this.update(job, { state: 'cancelled' });
      return;
    }
    job.settling = true;
    this.update(job, { state: 'running' });
    const expiresAt = Date.now() + job.status.executionDeadlineMs;
    const deadline = setTimeout(() => {
      this.update(job, {
        state: 'failed',
        failure: {
          code: 'execution_deadline',
          message: 'Preparation execution deadline exhausted.',
          retryable: false,
          instructions: 'Wait for owned work to stop, then explicitly retry with a larger execution budget.',
        },
      });
      job.controller.abort();
    }, job.status.executionDeadlineMs);
    try {
      await this.runAttempts(job);
      if (job.controller.signal.aborted) {
        if (job.status.state !== 'failed') this.update(job, { state: 'cancelled' });
        return;
      }
      const readiness = await this.probe(
        job.adapter,
        job.status.target,
        job.status.operation,
        Math.max(0, expiresAt - Date.now()),
        job.controller.signal,
      );
      if (job.controller.signal.aborted) {
        if (job.status.state !== 'failed') this.update(job, { state: 'cancelled' });
        return;
      }
      if (readiness.state !== 'ready') {
        this.update(job, {
          state: 'failed',
          readiness,
          failure: {
            code: 'not_ready',
            message: 'Preparation completed without verified readiness.',
            retryable: false,
            instructions: readiness.instructions,
          },
        });
        return;
      }
      this.update(job, { state: 'ready', readiness });
    } catch (error) {
      if (job.status.state === 'failed') return;
      if (job.controller.signal.aborted) {
        this.update(job, { state: 'cancelled' });
        return;
      }
      this.update(job, { state: 'failed', failure: job.adapter.classifyFailure(error) });
    } finally {
      clearTimeout(deadline);
      job.settling = false;
    }
  }

  private async runAttempts(job: PreparationJob): Promise<void> {
    const retryLimit = job.policy.transientRetryLimit ?? 0;
    for (let retry = 0; ; retry++) {
      try {
        await job.adapter.prepare(job.status.target, job.status.action, {
          signal: job.controller.signal,
          executionDeadlineMs: job.status.executionDeadlineMs,
        });
        return;
      } catch (error) {
        if (job.controller.signal.aborted) throw error;
        const failure = job.adapter.classifyFailure(error);
        if (!failure.retryable) throw error;
        if (retry >= retryLimit) throw error;
        this.update(job, { attempt: job.status.attempt + 1 });
      }
    }
  }

  private releaseCompletedRecords(): void {
    if (this.jobs.size < this.options.maxRecords) return;
    for (const [id, job] of this.jobs) {
      if (job.settling) continue;
      if (job.retrying) continue;
      if (job.status.state !== 'ready' && job.status.state !== 'cancelled') continue;
      this.jobs.delete(id);
      for (const [key, mappedId] of this.identities) {
        if (mappedId === id) this.identities.delete(key);
      }
      return;
    }
  }

  private failedJob(target: PreparationTarget, policy: BackendPolicy): PreparationJob | undefined {
    const base = preparationKey(target, policy, this.options);
    for (const action of policy.allowedActions) {
      const job = this.findJob(`${base}:${action}`);
      if (job?.status.state === 'failed') return job;
    }
    return undefined;
  }

  private activeJob(
    target: PreparationTarget,
    policy: BackendPolicy,
    action?: PreparationAction,
  ): PreparationJob | undefined {
    const base = preparationKey(target, policy, this.options);
    const actions = action ? [action] : policy.allowedActions;
    for (const selected of actions) {
      const job = this.findJob(`${base}:${selected}`);
      if (job && !this.terminal(job)) return job;
      if (job?.settling) return job;
    }
    return undefined;
  }

  private async probe(
    adapter: BackendPreparationAdapter,
    target: PreparationTarget,
    operation: string,
    waitMs: number,
    signal?: AbortSignal,
  ): Promise<BackendReadiness> {
    return this.readReadiness(
      (signal) => adapter.inspect(target, operation, { signal }),
      (error) => adapter.classifyFailure(error),
      waitMs,
      signal,
    );
  }

  private async readReadiness(
    inspect: (signal: AbortSignal) => Promise<BackendReadiness>,
    classifyFailure: (error: unknown) => PreparationFailure,
    waitMs: number,
    signal?: AbortSignal,
  ): Promise<BackendReadiness> {
    const controller = new AbortController();
    return new Promise<BackendReadiness>((resolve) => {
      let settled = false;
      const finish = (readiness: BackendReadiness): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', stop);
        resolve(readiness);
      };
      const stop = (): void => {
        controller.abort();
        finish({
          state: 'conflict',
          instructions:
            'Readiness inspection did not complete within the caller budget; no backend operation executed. Inspect again before preparing.',
        });
      };
      const timer = setTimeout(stop, waitMs);
      if (signal?.aborted) {
        stop();
        return;
      }
      signal?.addEventListener('abort', stop, { once: true });
      void inspect(controller.signal).then(finish, (error: unknown) => {
        const failure = classifyFailure(error);
        finish({ state: 'conflict', instructions: failure.instructions });
      });
    });
  }

  private findJob(key: string): PreparationJob | undefined {
    const id = this.identities.get(key);
    return id ? this.jobs.get(id) : undefined;
  }

  private snapshot(job: PreparationJob): PreparationStatus {
    return structuredClone(job.status);
  }

  private update(job: PreparationJob, fields: Partial<PreparationStatus>): void {
    job.status = { ...job.status, ...fields };
    for (const listener of job.listeners) listener();
  }

  private terminal(job: PreparationJob): boolean {
    return ['ready', 'failed', 'cancelled'].includes(job.status.state);
  }

  private unsupported(backendName: string): { state: 'unsupported'; instructions: string } {
    return {
      state: 'unsupported',
      instructions: `No preparation adapter is registered for ${backendName}; prepare it using supported native instructions.`,
    };
  }
}
