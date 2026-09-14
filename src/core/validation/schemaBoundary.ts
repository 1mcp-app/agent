import { createHash } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';

import { captureJson, SCHEMA_LIMITS, SchemaBoundaryError, type SchemaFailureCode } from './schemaPolicy.js';

export { SCHEMA_LIMITS, SchemaBoundaryError } from './schemaPolicy.js';
export type SchemaProfile = 'tool-input' | 'tool-output' | 'interaction';
export interface SchemaBinding {
  routeKey: string;
  generation: string;
  signal?: AbortSignal;
}
export interface SchemaContract {
  readonly source: Readonly<Record<string, unknown>>;
  readonly digest: string;
  readonly dialect: string;
  readonly profile: SchemaProfile;
  readonly routeKey: string;
  readonly generation: string;
}
export interface SchemaVerdict {
  valid: boolean;
  code?: SchemaFailureCode;
}
interface Job {
  id: number;
  contract: SchemaContract;
  instance?: unknown;
  operation: 'compile' | 'evaluate';
  resolve(value: SchemaVerdict): void;
  reject(error: SchemaBoundaryError): void;
  signal?: AbortSignal;
  abort?: () => void;
  timer?: ReturnType<typeof setTimeout>;
}
interface Slot {
  worker: Worker;
  ready: boolean;
  job?: Job;
}

/** Fixed workers and a single bounded FIFO. No affinity or replicated coordinator cache. */
export class SchemaBoundary {
  private readonly slots = new Set<Slot>();
  private readonly terminations = new Set<Promise<number>>();
  private readonly queue: Job[] = [];
  private readonly contracts = new WeakSet<SchemaContract>();
  private nextId = 0;
  private closing = false;
  private replacementAfter = 0;
  private replacementTimer?: ReturnType<typeof setTimeout>;
  constructor(private readonly workerCount = Math.min(4, Math.max(1, availableParallelism() - 1))) {
    if (!Number.isInteger(workerCount) || workerCount < 1 || workerCount > 4)
      throw new Error('Invalid schema worker count');
  }
  async admit(
    schema: unknown,
    binding: SchemaBinding & { profile?: SchemaProfile; sourceRevision?: string },
  ): Promise<SchemaContract> {
    const captured = captureJson(schema, true);
    if (!captured.value || typeof captured.value !== 'object' || Array.isArray(captured.value))
      throw new SchemaBoundaryError('schema_invalid');
    const source = captured.value as Record<string, unknown>;
    const profile = binding.profile ?? 'interaction';
    if (profile === 'tool-input' && source.type !== 'object') throw new SchemaBoundaryError('schema_invalid');
    let dialect = binding.sourceRevision && binding.sourceRevision < '2025-11-25' ? 'draft-07' : '2020-12';
    if (source.$schema !== undefined) {
      if (typeof source.$schema !== 'string') throw new SchemaBoundaryError('schema_unsupported_dialect');
      const match = /^https?:\/\/json-schema\.org\/(?:draft\/(2020-12|2019-09)|(draft-07|draft-06))\/schema#?$/.exec(
        source.$schema,
      );
      if (!match) throw new SchemaBoundaryError('schema_unsupported_dialect');
      dialect = match[1] ?? match[2];
    }
    const contract = Object.freeze({
      source,
      dialect,
      profile,
      digest: createHash('sha256').update(captured.json).digest('hex'),
      routeKey: binding.routeKey,
      generation: binding.generation,
    });
    await this.run(contract, 'compile', undefined, binding.signal);
    this.contracts.add(contract);
    return contract;
  }
  async evaluate(
    contract: SchemaContract,
    instance: unknown,
    binding: SchemaBinding & { mode?: 'mandatory' | 'report-only' },
  ): Promise<SchemaVerdict> {
    if (
      !this.contracts.has(contract) ||
      contract.routeKey !== binding.routeKey ||
      contract.generation !== binding.generation
    )
      throw new SchemaBoundaryError('schema_invalid');
    const phase = contract.profile === 'tool-output' ? 'output' : 'input';
    let captured: ReturnType<typeof captureJson>;
    try {
      captured = captureJson(instance, false, phase === 'output');
    } catch (error) {
      throw new SchemaBoundaryError(error instanceof SchemaBoundaryError ? error.code : 'schema_invalid', false, phase);
    }
    const verdict = await this.run(contract, 'evaluate', captured.value, binding.signal);
    if (verdict.valid) return verdict;
    const code = contract.profile === 'tool-output' ? 'schema_output_invalid' : 'schema_input_invalid';
    if (binding.mode !== 'report-only') throw new SchemaBoundaryError(code, false, phase);
    return { valid: false, code };
  }
  private run(
    contract: SchemaContract,
    operation: Job['operation'],
    instance?: unknown,
    signal?: AbortSignal,
  ): Promise<SchemaVerdict> {
    if (this.closing || signal?.aborted || this.queue.length >= SCHEMA_LIMITS.queue)
      return Promise.reject(new SchemaBoundaryError('schema_evaluation_unavailable', true));
    return new Promise((resolve, reject) => {
      const job: Job = { id: ++this.nextId, contract, operation, instance, resolve, reject, signal };
      job.abort = () => {
        const slot = [...this.slots].find((item) => item.job === job);
        if (slot) this.remove(slot, 'schema_evaluation_unavailable');
        else {
          const index = this.queue.indexOf(job);
          if (index >= 0) this.queue.splice(index, 1);
          this.finish(job, 'schema_evaluation_unavailable');
        }
      };
      signal?.addEventListener('abort', job.abort, { once: true });
      // Queue waiting is bounded independently of hostile worker execution.
      job.timer = setTimeout(job.abort, SCHEMA_LIMITS.shutdownMs);
      this.queue.push(job);
      this.schedule();
    });
  }
  private schedule(): void {
    if (!this.closing && this.queue.length && this.slots.size + this.terminations.size < this.workerCount) {
      if (Date.now() >= this.replacementAfter)
        while (this.slots.size + this.terminations.size < this.workerCount) {
          try {
            this.spawn();
          } catch {
            this.replacementAfter = Date.now() + 1000;
            for (const job of this.queue.splice(0)) this.finish(job, 'schema_evaluation_unavailable');
            break;
          }
        }
      else if (!this.replacementTimer)
        this.replacementTimer = setTimeout(() => {
          this.replacementTimer = undefined;
          this.schedule();
        }, this.replacementAfter - Date.now());
    }
    for (const slot of this.slots) {
      if (!slot.ready || slot.job || !this.queue.length) continue;
      const job = this.queue.shift()!;
      clearTimeout(job.timer);
      slot.job = job;
      slot.worker.ref();
      job.timer = setTimeout(() => this.remove(slot, 'schema_evaluation_timeout'), SCHEMA_LIMITS.compileMs);
      try {
        slot.worker.postMessage({
          id: job.id,
          operation: job.operation,
          schema: job.contract.source,
          dialect: job.contract.dialect,
          instance: job.instance,
          limits: SCHEMA_LIMITS,
        });
      } catch {
        this.remove(slot, 'schema_evaluation_unavailable');
      }
    }
  }
  private spawn(): void {
    const workerUrl = new URL(
      import.meta.url.endsWith('.ts') ? './schemaWorker.ts' : './schemaWorker.js',
      import.meta.url,
    );
    const embedded = (globalThis as typeof globalThis & { __1MCP_SCHEMA_WORKER_SOURCE__?: string })
      .__1MCP_SCHEMA_WORKER_SOURCE__;
    const worker = new Worker(embedded ?? workerUrl, {
      ...(embedded ? { eval: true } : {}),
      resourceLimits: { maxOldGenerationSizeMb: SCHEMA_LIMITS.heapMb, stackSizeMb: SCHEMA_LIMITS.stackMb },
    });
    const slot: Slot = { worker, ready: false };
    this.slots.add(slot);
    const startup = setTimeout(() => this.remove(slot, 'schema_evaluation_unavailable'), SCHEMA_LIMITS.shutdownMs);
    worker.on(
      'message',
      (message: { ready?: boolean; id?: number; compiled?: boolean; valid?: boolean; error?: SchemaFailureCode }) => {
        if (message.ready) {
          clearTimeout(startup);
          slot.ready = true;
          worker.unref();
          this.schedule();
          return;
        }
        const job = slot.job;
        if (!job || message.id !== job.id) return;
        if (message.compiled) {
          clearTimeout(job.timer);
          job.timer = setTimeout(() => this.remove(slot, 'schema_evaluation_timeout'), SCHEMA_LIMITS.evaluateMs);
          return;
        }
        slot.job = undefined;
        this.finish(job, message.error, { valid: message.valid === true });
        worker.unref();
        this.schedule();
      },
    );
    worker.on('error', () => {
      clearTimeout(startup);
      this.remove(slot, 'schema_evaluation_unavailable');
    });
    worker.on('exit', () => {
      clearTimeout(startup);
      this.remove(slot, 'schema_evaluation_unavailable');
    });
  }
  private finish(job: Job, error?: SchemaFailureCode, verdict?: SchemaVerdict): void {
    clearTimeout(job.timer);
    if (job.abort) job.signal?.removeEventListener('abort', job.abort);
    if (error) {
      let phase: SchemaBoundaryError['phase'] = 'admission';
      if (job.operation !== 'compile') {
        phase = job.contract.profile === 'tool-output' ? 'output' : 'input';
      }
      job.reject(
        new SchemaBoundaryError(
          error,
          error === 'schema_evaluation_unavailable' || error === 'schema_evaluation_timeout',
          phase,
        ),
      );
    } else job.resolve(verdict!);
  }
  private remove(slot: Slot, code: SchemaFailureCode): void {
    if (!this.slots.delete(slot)) return;
    if (slot.job) this.finish(slot.job, code);
    const termination = slot.worker.terminate();
    this.terminations.add(termination);
    void termination.finally(() => {
      this.terminations.delete(termination);
      this.schedule();
    });
    // At most one replacement wave per second, including controlled hostile timeouts.
    this.replacementAfter = Date.now() + 1000;
    this.schedule();
  }
  async shutdown(): Promise<void> {
    this.closing = true;
    clearTimeout(this.replacementTimer);
    for (const job of this.queue.splice(0)) this.finish(job, 'schema_evaluation_unavailable');
    const drainUntil = Date.now() + SCHEMA_LIMITS.shutdownMs;
    while ([...this.slots].some((slot) => slot.job) && Date.now() < drainUntil)
      await new Promise((resolve) => setTimeout(resolve, 10));
    const slots = [...this.slots];
    this.slots.clear();
    for (const slot of slots) if (slot.job) this.finish(slot.job, 'schema_evaluation_unavailable');
    await Promise.all([...slots.map((slot) => slot.worker.terminate()), ...this.terminations]);
  }
}
export let schemaBoundary = new SchemaBoundary();
export async function shutdownSchemaBoundary(): Promise<void> {
  const current = schemaBoundary;
  await current.shutdown();
  if (schemaBoundary === current) schemaBoundary = new SchemaBoundary();
}
