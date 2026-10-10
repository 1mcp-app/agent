import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { codeGraphEnvironment } from './codegraphEnvironment.js';
import type { CodeGraphInstallation } from './codegraphInstallation.js';
import { CODEGRAPH_WORKER_SOURCE } from './codegraphWorker.js';

export class CodeGraphPreparationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface CodeGraphProcessOptions {
  readonly signal?: AbortSignal;
  readonly executionDeadlineMs: number;
  readonly terminationGraceMs?: number;
  readonly environment?: Record<string, string | undefined>;
}

/** Waits for close, including cancellation/escalation; never kills saved PIDs.
 * Normal native release occurs in the live worker. Post-exit path ownership
 * cannot be atomically established, so even apparently owned locks remain. */
export async function runCodeGraphWorker(
  installation: CodeGraphInstallation,
  checkoutRoot: string,
  action: string,
  options: CodeGraphProcessOptions,
): Promise<unknown> {
  if (options.signal?.aborted)
    throw new CodeGraphPreparationError(
      'cancelled',
      'CodeGraph preparation cancelled. If forced exit left native locks, explicitly reconcile their ownership; no post-exit lock removal is attempted.',
    );
  const claimId = randomUUID();
  let stopped = false;
  return await new Promise<unknown>((resolve, reject) => {
    const child = spawn(
      installation.nodeExecutable,
      [
        '--liftoff-only',
        '--disable-warning=ExperimentalWarning',
        '-e',
        CODEGRAPH_WORKER_SOURCE,
        installation.libraryRoot,
        checkoutRoot,
        action,
        claimId,
      ],
      {
        cwd: checkoutRoot,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: options.environment ?? codeGraphEnvironment(),
      },
    );
    let output = '';
    let diagnostic = '';
    let failure: CodeGraphPreparationError | undefined;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const stop = (reason: CodeGraphPreparationError) => {
      if (failure) return;
      failure = reason;
      signalOwned('SIGTERM');
      escalation = setTimeout(() => signalOwned('SIGKILL'), options.terminationGraceMs ?? 2_000);
    };
    const signalOwned = (signal: 'SIGTERM' | 'SIGKILL') => {
      if (stopped || !child.pid) return;
      try {
        if (process.platform === 'win32') child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch {
        // Exit may have raced the signal; only close establishes completion.
      }
    };
    const onAbort = () =>
      stop(
        new CodeGraphPreparationError(
          'cancelled',
          'CodeGraph preparation cancelled. If forced exit left native locks, explicitly reconcile their ownership; no post-exit lock removal is attempted.',
        ),
      );
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    const deadline = setTimeout(
      () =>
        stop(
          new CodeGraphPreparationError(
            'deadline_exceeded',
            'CodeGraph preparation exceeded its execution deadline. Locks retained after forced exit require explicit manual ownership reconciliation; this runtime never removes them.',
          ),
        ),
      options.executionDeadlineMs,
    );
    child.stdout.on('data', (data: Buffer) => {
      output = (output + data.toString()).slice(-1_048_577);
      if (output.length > 1_048_576)
        stop(new CodeGraphPreparationError('output_limit', 'CodeGraph output exceeded the bounded capture limit.'));
    });
    child.stderr.on('data', (data: Buffer) => {
      diagnostic = (diagnostic + data.toString()).slice(-8_192);
    });
    child.once('error', (error) => {
      failure = new CodeGraphPreparationError('unavailable', error.message);
    });
    child.once('close', (code) => {
      stopped = true;
      clearTimeout(deadline);
      if (escalation) clearTimeout(escalation);
      options.signal?.removeEventListener('abort', onAbort);
      if (failure) return reject(failure);
      const line = output
        .split('\n')
        .reverse()
        .find((item) => item.startsWith('1MCP_CODEGRAPH_RESULT '));
      if (!line)
        return reject(
          new CodeGraphPreparationError(
            'backend_failed',
            `CodeGraph returned no readiness evidence (exit ${code}): ${diagnostic}`,
          ),
        );
      try {
        const result = z
          .object({ error: z.object({ code: z.string(), message: z.string() }).optional() })
          .passthrough()
          .parse(JSON.parse(line.slice('1MCP_CODEGRAPH_RESULT '.length)));
        if (result.error)
          return reject(new CodeGraphPreparationError(String(result.error.code), String(result.error.message)));
        if (code !== 0)
          return reject(new CodeGraphPreparationError('backend_failed', `CodeGraph exited ${code}: ${diagnostic}`));
        resolve(result);
      } catch {
        reject(new CodeGraphPreparationError('invalid_evidence', 'CodeGraph returned invalid JSON evidence.'));
      }
    });
  });
}

interface CapacityWaiter {
  readonly signal?: AbortSignal;
  readonly abort: () => void;
  readonly grant: () => void;
}

/** Bound native work, including Git discovery, cold probes and pure metadata.
 * Aborted queued callers never start a process after their response completes.
 */
export class NativeCapacity {
  private closed = false;
  private active = 0;
  private readonly waiting: CapacityWaiter[] = [];
  constructor(private readonly limit: number) {}

  async run<T>(signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
    const release = await this.acquire(signal);
    try {
      if (signal?.aborted) throw new CodeGraphPreparationError('cancelled', 'Queued native work cancelled.');
      return await work();
    } finally {
      release();
    }
  }

  close(): void {
    this.closed = true;
    for (const waiter of [...this.waiting]) waiter.abort();
  }

  private acquire(signal?: AbortSignal): Promise<() => void> {
    if (this.closed)
      return Promise.reject(new CodeGraphPreparationError('cancelled', 'Native capacity has shut down.'));
    if (signal?.aborted)
      return Promise.reject(new CodeGraphPreparationError('cancelled', 'Queued native work cancelled.'));
    return new Promise((resolve, reject) => {
      const waiter: CapacityWaiter = {
        signal,
        abort: () => {
          const index = this.waiting.indexOf(waiter);
          if (index >= 0) this.waiting.splice(index, 1);
          signal?.removeEventListener('abort', waiter.abort);
          reject(new CodeGraphPreparationError('cancelled', 'Queued native work cancelled.'));
        },
        grant: () => {
          signal?.removeEventListener('abort', waiter.abort);
          this.active += 1;
          resolve(() => {
            this.active -= 1;
            const next = this.waiting.shift();
            if (next) next.grant();
          });
        },
      };
      if (this.active < this.limit) {
        waiter.grant();
        return;
      }
      this.waiting.push(waiter);
      signal?.addEventListener('abort', waiter.abort, { once: true });
    });
  }
}

const sharedNativeCapacity = new NativeCapacity(4);

/** One process-wide gate for every adapter admission and metadata snapshot.
 * Runtime-local shutdown never closes a gate used by another runtime owner. */
export function runCodeGraphNativeWork<T>(signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
  return sharedNativeCapacity.run(signal, work);
}
