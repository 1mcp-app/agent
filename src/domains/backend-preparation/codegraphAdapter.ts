import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { CodeGraphFreshness } from './codegraphFreshness.js';
import {
  type CodeGraphInstallation,
  resolveCodeGraphInstallation,
  VERIFIED_CODEGRAPH_VERSION,
} from './codegraphInstallation.js';
import { CodeGraphJournal, relevantJournalPaths } from './codegraphJournal.js';
import {
  CodeGraphPreparationError,
  NativeCapacity,
  runCodeGraphNativeWork,
  runCodeGraphWorker,
} from './codegraphProcess.js';
import type {
  BackendPreparationAdapter,
  BackendReadiness,
  PreparationAction,
  PreparationFailure,
  PreparationRecoveryHint,
  PreparationTarget,
} from './contracts.js';

const statusSchema = z.object({
  initialized: z.boolean(),
  projectPath: z.string(),
  indexPath: z.string(),
  fileCount: z.number().int().nonnegative().optional(),
  pendingChanges: z
    .object({
      added: z.number().int().nonnegative(),
      modified: z.number().int().nonnegative(),
      removed: z.number().int().nonnegative(),
    })
    .optional(),
  index: z
    .object({
      builtWithVersion: z.string().nullable(),
      builtWithExtractionVersion: z.number().nullable(),
      currentExtractionVersion: z.number(),
      reindexRecommended: z.boolean(),
      state: z.enum(['complete', 'partial', 'indexing', 'failed']).nullable(),
      pendingRefs: z.number().int().nonnegative(),
    })
    .optional(),
});

interface TrackedCheckout {
  readonly freshness: CodeGraphFreshness;
  readonly journal: CodeGraphJournal;
  tail: Promise<void>;
  token?: string;
  fingerprint?: string;
  readiness?: BackendReadiness;
}

interface CheckoutInitialization {
  readonly controller: AbortController;
  readonly promise: Promise<TrackedCheckout>;
  waiters: number;
  settled: boolean;
}

export interface CodeGraphAdapterOptions {
  /** Runtime-owned configuration. No PATH lookup, npx, installation or download. */
  readonly executable: string;
  readonly expectedVersion?: string;
  readonly sourceMonitor?: 'git-fsmonitor';
  readonly inspectionDeadlineMs?: number;
  readonly maximumWatchedCheckouts?: number;
}

export class CodeGraphPreparationAdapter implements BackendPreparationAdapter {
  private readonly checkouts = new Map<string, TrackedCheckout>();
  private readonly initializations = new Map<string, CheckoutInitialization>();
  private readonly nativeCapacity: NativeCapacity;
  private disposed = false;
  private readonly measurements = { inspections: 0, preparations: 0, warmChecks: 0 };

  constructor(private readonly options: CodeGraphAdapterOptions) {
    this.nativeCapacity = new NativeCapacity(Math.max(1, Math.min(4, options.maximumWatchedCheckouts ?? 32)));
  }

  async inspect(
    target: PreparationTarget,
    _operation: string,
    options?: { signal?: AbortSignal },
  ): Promise<BackendReadiness> {
    let root: string;
    let installation: CodeGraphInstallation;
    try {
      root = await realpath(target.checkoutRoot);
      installation = await this.getInstallation();
      await assertLocalIndex(root);
    } catch (error) {
      return { state: 'unsupported', instructions: failureMessage(error) };
    }
    const conflict = await ownershipConflict(root, true);
    if (conflict) return { state: 'conflict', instructions: conflict };
    let db;
    try {
      db = await lstat(path.join(root, '.codegraph', 'codegraph.db'));
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
        return { state: 'unsupported', instructions: failureMessage(error) };
    }
    if (!db)
      return readinessFromStatus(root, {
        initialized: false,
        projectPath: root,
        indexPath: path.join(root, '.codegraph'),
      });
    try {
      const checkout = await this.track(root, options?.signal);
      return await this.serial(
        checkout,
        () =>
          this.nativeWork(options?.signal, async () => {
            const deadline = Date.now() + (this.options.inspectionDeadlineMs ?? 5_000);
            let before = await checkout.journal.query(checkout.token, options?.signal);
            let fingerprint = await checkout.freshness.fingerprint(options?.signal);
            if (
              checkout.readiness &&
              checkout.token &&
              checkout.fingerprint === fingerprint &&
              relevantJournalPaths(before.paths).length === 0
            ) {
              checkout.token = before.token;
              this.measurements.warmChecks += 1;
              return checkout.readiness;
            }
            checkout.readiness = undefined;
            for (let attempt = 0; attempt < 3; attempt += 1) {
              const remaining = deadline - Date.now();
              if (remaining <= 0) break;
              this.measurements.inspections += 1;
              const raw = await runCodeGraphWorker(installation, root, 'inspect', {
                signal: options?.signal,
                executionDeadlineMs: remaining,
              });
              const readiness = readinessFromStatus(root, statusSchema.parse(raw));
              const after = await checkout.journal.query(before.token, options?.signal);
              const stamp = await checkout.freshness.fingerprint(options?.signal);
              if (stamp === fingerprint && relevantJournalPaths(after.paths).length === 0) {
                checkout.fingerprint = stamp;
                checkout.token = after.token;
                checkout.readiness = readiness;
                return readiness;
              }
              if (readiness.state !== 'ready') return readiness;
              before = after;
              fingerprint = stamp;
            }
            return {
              state: 'required',
              action: 'sync',
              instructions:
                'Checkout or index changed during native validation; inspect again before using source results.',
              evidence: {
                freshness: 'unknown',
                coverage: 'unknown',
                detail: 'Native journal barrier could not establish a stable readiness snapshot.',
              },
            };
          }),
        options?.signal,
      );
    } catch (error) {
      if (error instanceof CodeGraphPreparationError && error.code === 'ownership_conflict')
        return { state: 'conflict', instructions: error.message };
      if (
        error instanceof CodeGraphPreparationError &&
        error.code === 'journal_unavailable' &&
        this.options.sourceMonitor === 'git-fsmonitor'
      ) {
        return {
          state: 'required',
          action: 'sync',
          instructions:
            'Explicitly prepare this checkout to start the authorized native Git source monitor; read-only inspection does not start it.',
          evidence: { freshness: 'unknown', coverage: 'unknown', detail: 'No native source journal is available.' },
        };
      }
      return {
        state: 'unsupported',
        instructions: `CodeGraph readiness could not be verified: ${failureMessage(error)} No source operation was admitted.`,
      };
    }
  }

  async prepare(
    target: PreparationTarget,
    action: PreparationAction,
    options: { signal: AbortSignal; executionDeadlineMs: number },
  ): Promise<void> {
    if (action !== 'initialize' && action !== 'sync')
      throw new CodeGraphPreparationError(
        'unsupported_action',
        `CodeGraph adapter supports initialize and incremental sync. ${action} requires a separately verified explicit backend recovery procedure.`,
      );
    const deadline = Date.now() + options.executionDeadlineMs;
    const timed = new AbortController();
    const abort = () => timed.abort();
    options.signal.addEventListener('abort', abort, { once: true });
    if (options.signal.aborted) abort();
    const timer = setTimeout(abort, options.executionDeadlineMs);
    try {
      const root = await realpath(target.checkoutRoot);
      await assertLocalIndex(root);
      const conflict = await ownershipConflict(root);
      if (conflict) throw new CodeGraphPreparationError('ownership_conflict', conflict);
      const installation = await this.getInstallation();
      const active = await this.track(root, timed.signal);
      await this.serial(
        active,
        async () => {
          let started = false;
          try {
            await this.nativeWork(timed.signal, async () => {
              started = true;
              active.readiness = undefined;
              if (this.options.sourceMonitor === 'git-fsmonitor') await active.journal.start(timed.signal);
              else await active.journal.query(undefined, timed.signal);
              this.measurements.preparations += 1;
              const remaining = deadline - Date.now();
              if (remaining <= 0)
                throw new CodeGraphPreparationError(
                  'deadline_exceeded',
                  'Preparation deadline expired during native journal startup.',
                );
              await runCodeGraphWorker(installation, root, action, {
                signal: timed.signal,
                executionDeadlineMs: remaining,
              });
            });
          } catch (error) {
            if (started) {
              // Finish owned observer cleanup before releasing the checkout
              // gate. Queued turns retain this same tracked entry and may then
              // reopen its observer; shutdown must still reach that new owner.
              active.readiness = undefined;
              active.fingerprint = undefined;
              active.token = undefined;
              await active.journal.dispose();
            }
            throw error;
          }
        },
        timed.signal,
      );
    } catch (error) {
      if (!options.signal.aborted && timed.signal.aborted)
        throw new CodeGraphPreparationError(
          'deadline_exceeded',
          'Owned preparation stopped after its execution deadline.',
        );
      throw error;
    } finally {
      clearTimeout(timer);
      options.signal.removeEventListener('abort', abort);
    }
  }

  async reconcile(
    target: PreparationTarget,
    operation: string,
    _advisory: PreparationRecoveryHint,
    options?: { signal?: AbortSignal },
  ): Promise<BackendReadiness> {
    // Restarted runtimes establish a new native journal baseline and inspect the exact on-disk state.
    // Saved running flags/PIDs never authorize cancellation or lock removal.
    return this.inspect(target, operation, options);
  }

  classifyFailure(error: unknown): PreparationFailure {
    const code = error instanceof CodeGraphPreparationError ? error.code : 'backend_failed';
    return {
      code,
      message: failureMessage(error),
      retryable: false,
      instructions:
        code === 'deadline_exceeded'
          ? 'Owned work has stopped. Native locks retained after forced exit require explicit manual ownership reconciliation. Inspect partial coverage, then explicitly retry with a larger execution budget; interrupted indexes may require separately authorized rebuild.'
          : 'Inspect the checkout, installed backend and native ownership. Resolve the reported prerequisite and explicitly retry; no automatic lock break, rebuild, install or download is permitted.',
    };
  }

  getMeasurements(): Readonly<{ inspections: number; preparations: number; warmChecks: number }> {
    return { ...this.measurements };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.nativeCapacity.close();
    const pending = [...this.initializations.values()];
    for (const initialization of pending) initialization.controller.abort();
    await Promise.allSettled(pending.map((initialization) => initialization.promise));
    const checkouts = [...this.checkouts.values()];
    this.checkouts.clear();
    await Promise.all(
      checkouts.map(async (checkout) => {
        await checkout.tail;
        await checkout.journal.dispose();
        checkout.freshness.close();
      }),
    );
  }

  private nativeWork<T>(signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
    return this.nativeCapacity.run(signal, () => runCodeGraphNativeWork(signal, work));
  }

  private getInstallation(): Promise<CodeGraphInstallation> {
    if (this.options.expectedVersion && this.options.expectedVersion !== VERIFIED_CODEGRAPH_VERSION) {
      return Promise.reject(
        new Error(`CodeGraph preparation adapter is verified only for ${VERIFIED_CODEGRAPH_VERSION}.`),
      );
    }
    // Installed bundles can be repaired/upgraded at the same path. Revalidate
    // their exact manifest/version on every admission, including warm checks.
    return resolveCodeGraphInstallation(this.options.executable);
  }

  private async track(root: string, signal?: AbortSignal): Promise<TrackedCheckout> {
    if (this.disposed) throw new CodeGraphPreparationError('cancelled', 'CodeGraph adapter has shut down.');
    if (signal?.aborted) throw new CodeGraphPreparationError('cancelled', 'Readiness caller cancelled.');
    const existing = this.checkouts.get(root);
    if (existing) return existing;
    let initialization = this.initializations.get(root);
    if (!initialization) {
      // Reserve distinct-root capacity synchronously, before any native process
      // or asynchronous initialization. Same-root callers share this reservation.
      if (this.checkouts.size + this.initializations.size >= (this.options.maximumWatchedCheckouts ?? 32))
        throw new Error(
          'Native journal checkout capacity reached; release unused runtime contexts before preparing another checkout.',
        );
      const controller = new AbortController();
      let resolve!: (checkout: TrackedCheckout) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<TrackedCheckout>((success, failure) => {
        resolve = success;
        reject = failure;
      });
      initialization = { controller, promise, waiters: 0, settled: false };
      this.initializations.set(root, initialization);
      const reservation = initialization;
      void this.nativeWork(controller.signal, async () => {
        const journal = await CodeGraphJournal.create(root, controller.signal);
        if (controller.signal.aborted || this.disposed) {
          await journal.dispose();
          throw new CodeGraphPreparationError('cancelled', 'Native journal initialization cancelled.');
        }
        const checkout: TrackedCheckout = {
          freshness: new CodeGraphFreshness(root),
          journal,
          tail: Promise.resolve(),
        };
        this.checkouts.set(root, checkout);
        return checkout;
      }).then(
        (checkout) => {
          reservation.settled = true;
          if (this.initializations.get(root) === reservation) this.initializations.delete(root);
          resolve(checkout);
        },
        (error) => {
          reservation.settled = true;
          if (this.initializations.get(root) === reservation) this.initializations.delete(root);
          reject(error);
        },
      );
    }
    const reservation = initialization;
    reservation.waiters += 1;
    try {
      const checkout = await abortable(reservation.promise, signal);
      if (this.disposed || signal?.aborted)
        throw new CodeGraphPreparationError('cancelled', 'Native journal caller cancelled.');
      return checkout;
    } finally {
      reservation.waiters -= 1;
      if (reservation.waiters === 0 && !reservation.settled) reservation.controller.abort();
    }
  }

  private async serial<T>(checkout: TrackedCheckout, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const prior = checkout.tail;
    let release!: () => void;
    checkout.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await abortable(prior, signal);
    } catch (error) {
      // Cancel only this queued turn. Its gate still follows the predecessor,
      // preventing a later caller from overtaking active native work.
      void prior.then(release);
      throw error;
    }
    try {
      return await work();
    } finally {
      release();
    }
  }
}

function readinessFromStatus(root: string, status: z.infer<typeof statusSchema>): BackendReadiness {
  if (status.projectPath !== root || status.indexPath !== path.join(root, '.codegraph')) {
    return {
      state: 'conflict',
      instructions:
        'CodeGraph reported an index belonging to another checkout. Initialize a native checkout-local index; ancestor indexes are not reused.',
    };
  }
  if (!status.initialized) {
    return {
      state: 'required',
      action: 'initialize',
      instructions: 'Enable runtime-authorized CodeGraph initialization for this checkout, then prepare it.',
      evidence: { freshness: 'unknown', coverage: 'unknown', detail: 'No checkout-local database exists.' },
    };
  }
  const index = status.index;
  if (!index || !status.pendingChanges || status.fileCount === undefined) {
    return {
      state: 'unsupported',
      instructions:
        'CodeGraph supplied incomplete readiness metadata; index availability and coverage cannot be established.',
    };
  }
  if (index.reindexRecommended || index.builtWithExtractionVersion !== index.currentExtractionVersion) {
    return {
      state: 'required',
      action: 'rebuild',
      instructions:
        'Extraction format is incompatible or stale. A separately authorized native rebuild is required; incremental sync is insufficient.',
      evidence: {
        freshness: 'stale',
        coverage: 'unknown',
        detail: 'Native extraction/build compatibility check failed.',
      },
    };
  }
  if (index.state !== 'complete') {
    return {
      state: 'required',
      action: 'rebuild',
      instructions: `Native index state is ${index.state ?? 'unmarked'}; source results are blocked. Verify and explicitly recover/rebuild this checkout.`,
      evidence: {
        freshness: 'unknown',
        coverage: 'partial',
        detail: 'Interrupted, partial, failed or unmarked index is not ready.',
      },
    };
  }
  const changes = status.pendingChanges;
  if (changes.added + changes.modified + changes.removed > 0 || index.pendingRefs > 0) {
    return {
      state: 'required',
      action: 'sync',
      instructions: 'Incrementally synchronize this checkout before requesting source results.',
      evidence: {
        freshness: 'stale',
        coverage: index.pendingRefs > 0 ? 'partial' : 'complete',
        detail: `${changes.added} added, ${changes.modified} modified, ${changes.removed} removed; ${index.pendingRefs} unresolved references.`,
      },
    };
  }
  return {
    state: 'ready',
    evidence: {
      freshness: 'current',
      coverage: 'complete',
      detail: `Checkout-local compatible complete CodeGraph index (${status.fileCount} native indexed files), verified pending source/reference counts zero and Git-native source journal cookie barrier held. Coverage follows the backend's supported languages and exclusion configuration.`,
    },
  };
}

async function assertLocalIndex(root: string): Promise<void> {
  for (const name of ['.codegraph', '.codegraph/codegraph.db']) {
    try {
      if ((await lstat(path.join(root, name))).isSymbolicLink()) {
        throw new Error(
          'CodeGraph indexes must be checkout-local; symlinked index directories/databases are unsupported.',
        );
      }
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
}

async function ownershipConflict(root: string, readOnly = false): Promise<string | undefined> {
  for (const name of ['writer.pid', 'rebuild.pid', 'codegraph.lock']) {
    const lockPath = path.join(root, '.codegraph', name);
    try {
      await lstat(lockPath);
      if (readOnly && name === 'writer.pid') {
        const writer = z
          .object({ pid: z.number().int().positive(), ready: z.literal(true) })
          .safeParse(JSON.parse(await readFile(lockPath, 'utf8')));
        if (writer.success && processAlive(writer.data.pid)) continue;
      }
      return `CodeGraph native ownership exists at ${lockPath}. Verify its owner before preparation; this runtime will not break or cancel a foreign/unknown lock.`;
    } catch (error) {
      if (!isMissing(error)) return `Cannot verify CodeGraph ownership at ${lockPath}: ${failureMessage(error)}`;
    }
  }
  return undefined;
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** Verified 1.6.2 query/source tools. Native status is a diagnostic operation;
 * catalog discovery, instructions and unknown names never trigger indexing.
 */
export function requiresCodeGraphPreparation(toolName: string, _arguments?: unknown): boolean {
  return new Set([
    'codegraph_search',
    'codegraph_callers',
    'codegraph_callees',
    'codegraph_impact',
    'codegraph_node',
    'codegraph_explore',
    'codegraph_files',
  ]).has(toolName);
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new CodeGraphPreparationError('cancelled', 'Readiness caller cancelled.'));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new CodeGraphPreparationError('cancelled', 'Readiness caller cancelled.'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
