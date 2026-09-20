import { AsyncLocalStorage } from 'node:async_hooks';

import { z } from 'zod';

export const admissionSnapshotSchema = z.object({
  closed: z.boolean(),
  active: z.number().int().nonnegative(),
  committed: z.boolean(),
});
export type AdmissionSnapshot = z.infer<typeof admissionSnapshotSchema>;

export class RuntimeDrainingError extends Error {
  readonly code = -32004;
  readonly data = { retryable: true, reason: 'runtime_draining' };
  constructor() {
    super('Runtime is draining for replacement; retry after it resumes or the replacement activates.');
  }
}

/** Admission and increment are synchronous. Nested dispatch retains its root until all work settles. */
export class RuntimeAdmission {
  private closed = false;
  private committed = false;
  private active = 0;
  private readonly context = new AsyncLocalStorage<{ pending: number; release: () => void }>();
  private readonly listeners = new Set<(snapshot: AdmissionSnapshot) => void>();

  snapshot(): AdmissionSnapshot {
    return { closed: this.closed, active: this.active, committed: this.committed };
  }

  subscribe(listener: (snapshot: AdmissionSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const listener of this.listeners) listener(this.snapshot());
  }

  begin(): () => void {
    if (this.closed) throw new RuntimeDrainingError();
    this.active++;
    this.changed();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.changed();
    };
  }

  /** Retain only an existing admitted root; transport observers never admit background work. */
  retain(): (() => void) | undefined {
    const root = this.context.getStore();
    if (!root || root.pending === 0) return undefined;
    root.pending++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      root.pending--;
      if (root.pending === 0) root.release();
    };
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    const inherited = this.context.getStore();
    const root = inherited && inherited.pending > 0 ? inherited : { pending: 0, release: this.begin() };
    root.pending++;
    try {
      return await this.context.run(root, work);
    } finally {
      root.pending--;
      if (root.pending === 0) root.release();
    }
  }

  close(): AdmissionSnapshot {
    this.closed = true;
    this.changed();
    return this.snapshot();
  }

  resume(): void {
    if (this.committed) throw new Error('Committed admission cannot resume');
    this.closed = false;
    this.changed();
  }

  commit(): AdmissionSnapshot {
    if (!this.closed || this.active !== 0) throw new Error('Runtime is not drained');
    this.committed = true;
    this.changed();
    return this.snapshot();
  }
}

export const runtimeAdmission = new RuntimeAdmission();

export function withRuntimeAdmission<T, Args extends readonly unknown[]>(
  work: (...args: Args) => Promise<T>,
): (...args: Args) => Promise<T> {
  return (...args) => runtimeAdmission.run(() => work(...args));
}

export interface ReplacementDrainStatus {
  operationId: string;
  digest: string;
  state: 'preparing' | 'draining' | 'drained' | 'committing' | 'aborted';
  deadlineUnixMs: number;
  active: number;
}

export interface ReplacementDrainPorts {
  close(): Promise<AdmissionSnapshot>;
  resume(): Promise<void>;
  commit(): Promise<AdmissionSnapshot>;
}

/** The supervisor owns this state; worker acknowledgements are supplied over its private IPC channel. */
export class RuntimeReplacementDrain {
  private operation?: ReplacementDrainStatus;
  private readonly history = new Map<string, ReplacementDrainStatus>();
  private timer?: ReturnType<typeof setTimeout>;
  private snapshot?: AdmissionSnapshot;
  private resuming?: Promise<void>;
  private closing?: Promise<AdmissionSnapshot>;
  private commitment?: Promise<AdmissionSnapshot>;

  constructor(private readonly ports: ReplacementDrainPorts) {}

  async prepare(operationId: string, digest: string, timeoutMs = 30_000): Promise<ReplacementDrainStatus> {
    if (!operationId || !digest || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error('Invalid replacement preparation');
    }
    if (this.history.has(operationId)) {
      this.match(operationId, digest);
      return this.status(operationId);
    }
    if (this.operation && this.operation.state !== 'aborted') throw new Error('Replacement already in progress');
    if (this.closing) await this.closing.catch(() => undefined);
    if (this.resuming) await this.resuming;
    // Recheck after awaiting a previous resume: a competing prepare may have won.
    if (this.operation && this.operation.state !== 'aborted') throw new Error('Replacement already in progress');
    if (this.history.size >= 128) throw new Error('Replacement operation capacity reached; restart the runtime');
    const operation: ReplacementDrainStatus = {
      operationId,
      digest,
      state: 'preparing',
      deadlineUnixMs: Date.now() + timeoutMs,
      active: 0,
    };
    this.operation = operation;
    this.history.set(operationId, operation);
    this.snapshot = undefined;
    this.timer = setTimeout(() => this.abort(operation), timeoutMs);
    this.timer.unref?.();
    try {
      this.closing = this.ports.close();
      const snapshot = await this.closing;
      if (operation.state === 'aborted' || Date.now() >= operation.deadlineUnixMs) {
        this.abort(operation);
        // A late close acknowledgement may arrive after the deadline's resume.
        this.resuming = this.ports.resume();
        await this.resuming;
      } else {
        this.update(snapshot);
      }
    } catch (error) {
      this.abort(operation);
      throw error;
    }
    return { ...operation };
  }

  /** Called only after observing the particular worker exit, before allowing a respawn. */
  workerExited(): boolean {
    this.snapshot = undefined;
    const operation = this.operation;
    if (!operation) return false;
    if (operation.state === 'committing') return true;
    this.abort(operation);
    return false;
  }

  update(snapshot: AdmissionSnapshot): void {
    this.snapshot = admissionSnapshotSchema.parse(snapshot);
    const operation = this.operation;
    if (!operation || operation.state === 'aborted' || operation.state === 'committing') return;
    if (Date.now() >= operation.deadlineUnixMs) {
      this.abort(operation);
      return;
    }
    operation.active = snapshot.active;
    operation.state = snapshot.closed && snapshot.active === 0 ? 'drained' : 'draining';
  }

  status(operationId: string): ReplacementDrainStatus {
    const operation = this.match(operationId);
    if (operation.state !== 'committing' && Date.now() >= operation.deadlineUnixMs) this.abort(operation);
    return { ...operation };
  }

  async commit(operationId: string, digest: string): Promise<ReplacementDrainStatus> {
    const operation = this.match(operationId, digest);
    if (operation.state === 'committing') {
      await this.commitment;
      return { ...operation };
    }
    this.status(operationId);
    if (operation.state !== 'drained' || !this.snapshot?.closed || this.snapshot.active !== 0) {
      throw new Error('Replacement operation is not drained');
    }
    // The irreversible decision and expiry exclusion happen in one synchronous turn.
    operation.state = 'committing';
    clearTimeout(this.timer);
    this.commitment = this.ports.commit().then((snapshot) => {
      const confirmed = admissionSnapshotSchema.parse(snapshot);
      if (!confirmed.closed || !confirmed.committed || confirmed.active !== 0) {
        throw new Error('Worker did not confirm replacement commit; ownership must be retained');
      }
      return confirmed;
    });
    await this.commitment;
    return { ...operation };
  }

  private match(operationId: string, digest?: string): ReplacementDrainStatus {
    const operation = this.history.get(operationId);
    if (!operation) throw new Error('Unknown replacement operation');
    if (digest !== undefined && operation.digest !== digest) throw new Error('Replacement digest mismatch');
    return operation;
  }

  private abort(operation: ReplacementDrainStatus): void {
    if (this.operation !== operation || operation.state === 'committing' || operation.state === 'aborted') return;
    operation.state = 'aborted';
    clearTimeout(this.timer);
    // Keep a failed resume as a rejected barrier; a new prepare must not hide loss of worker control.
    this.resuming = this.ports.resume();
    void this.resuming.catch(() => undefined);
  }
}
