import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { AdminMutationAvailability } from './runtimeScopeAdminLock.js';

const ADMIN_STATE_DIR = 'admin';
const JOURNAL_VERSION = 1;
const DEFAULT_COMPLETED_RETENTION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_AUDIT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_IN_FLIGHT_WAIT_MS = 100;

type AdminOperationOrigin = 'browser' | 'cli';

export interface AdminOperationContext {
  actor: {
    type: 'admin_account' | 'admin_session';
    accountId: string;
    sessionId?: string;
  };
  origin: AdminOperationOrigin;
  target: AdminOperationTarget;
  runtimeIdentity: {
    runtimeScopeId: string;
    runtimeVersion?: string;
  };
  request: {
    requestId: string;
    jsonMode?: boolean;
  };
  idempotencyKey?: string;
  requestFingerprint?: string;
  deadline?: string;
  confirmationFacts?: Record<string, unknown>;
}

export interface AdminOperationTarget {
  type: string;
  id?: string;
}

export interface AdminConfirmationRequirement {
  code: string;
  expected?: string | boolean | number;
  target?: AdminOperationTarget;
}

export interface AdminAuditFact {
  timestamp: string;
  operationId: string;
  operationName: string;
  result: 'completed' | 'failed';
  actor: { type: 'admin_account' | 'admin_session'; accountIdHash: string; sessionIdHash?: string };
  origin: AdminOperationOrigin;
  target: AdminOperationTarget;
  request: { requestId: string };
  confirmationFacts?: Record<string, unknown>;
}

interface AdminOperationServiceOptions {
  runtimeScopeId: string;
  storageDir: string;
  mutationAvailability?: AdminMutationAvailability;
  now?: () => Date;
  completedRetentionMs?: number;
  auditRetentionMs?: number;
  inFlightWaitMs?: number;
  createOperationId?: () => string;
}

interface ExecuteMutationInput<T> {
  context: AdminOperationContext;
  operationName: string;
  confirmationRequirements?: AdminConfirmationRequirement[];
  run: (context: AdminOperationContext) => Promise<T>;
}

interface ExecuteReadOnlyInput<T> {
  context: AdminOperationContext;
  operationName: string;
  run: (context: AdminOperationContext) => Promise<T>;
}

interface RecentAuditOptions {
  limit?: number;
}

export type AdminOperationResult<T = unknown> =
  | {
      ok: true;
      status: 'completed';
      operationId: string;
      operationName: string;
      result: T;
      replayed: boolean;
    }
  | AdminOperationRecoveryResult;

export type AdminOperationRecoveryResult =
  | {
      ok: false;
      status: 'idempotency_key_required';
      code: 'idempotency_key_required';
      retryable: false;
      operationName: string;
    }
  | {
      ok: false;
      status: 'idempotency_conflict';
      code: 'idempotency_conflict';
      retryable: false;
      operationName: string;
    }
  | {
      ok: false;
      status: 'operation_in_progress';
      code: 'operation_in_progress';
      retryable: true;
      operationName: string;
      retryAfterMs: number;
    }
  | {
      ok: false;
      status: 'operation_state_unknown';
      code: 'operation_state_unknown';
      retryable: false;
      operationName: string;
      target: AdminOperationTarget;
      reservedAt: string;
      recovery: 'inspect_current_state_and_retry_with_new_idempotency_key';
    }
  | {
      ok: false;
      status: 'mutation_confirmation_required';
      code: 'mutation_confirmation_required';
      retryable: false;
      operationName: string;
      confirmationRequirements: AdminConfirmationRequirement[];
    }
  | {
      ok: false;
      status: 'mutation_failed';
      code: 'mutation_failed';
      retryable: false;
      operationName: string;
      error: string;
    }
  | {
      ok: false;
      status: 'admin_operation_journal_unavailable';
      code: 'admin_operation_journal_unavailable';
      retryable: false;
      operationName: string;
    }
  | {
      ok: false;
      status: 'runtime_scope_mismatch';
      code: 'runtime_scope_mismatch';
      retryable: false;
      operationName: string;
    }
  | {
      ok: false;
      status: 'runtime_scope_locked';
      code: 'runtime_scope_locked';
      retryable: true;
      operationName: string;
      reason: 'writer_lock_unavailable';
    };

type IdempotencyState = 'in_flight' | 'completed' | 'failed' | 'state_unknown';

interface IdempotencyEntry {
  state: IdempotencyState;
  scopedKeyHash: string;
  fingerprintHash: string;
  operationId: string;
  operationName: string;
  target: AdminOperationTarget;
  reservedAt: string;
  completedAt?: string;
  result?: unknown;
  error?: string;
}

type JournalRecord =
  | {
      schemaVersion: 1;
      type: 'reserved';
      runtimeScopeId: string;
      timestamp: string;
      operationId: string;
      operationName: string;
      scopedKeyHash: string;
      fingerprintHash: string;
      target: AdminOperationTarget;
      actor: { type: 'admin_account' | 'admin_session'; accountIdHash: string; sessionIdHash?: string };
      origin: AdminOperationOrigin;
      request: { requestId: string; jsonMode?: boolean };
      runtimeIdentity: { runtimeScopeId: string; runtimeVersion?: string };
    }
  | {
      schemaVersion: 1;
      type: 'completed';
      runtimeScopeId: string;
      timestamp: string;
      operationId: string;
      operationName: string;
      scopedKeyHash: string;
      fingerprintHash: string;
      result: unknown;
    }
  | {
      schemaVersion: 1;
      type: 'failed';
      runtimeScopeId: string;
      timestamp: string;
      operationId: string;
      operationName: string;
      scopedKeyHash: string;
      fingerprintHash: string;
      error: string;
    }
  | {
      schemaVersion: 1;
      type: 'state_unknown';
      runtimeScopeId: string;
      timestamp: string;
      operationId: string;
      operationName: string;
      scopedKeyHash: string;
      fingerprintHash: string;
      target: AdminOperationTarget;
      reservedAt: string;
    }
  | {
      schemaVersion: 1;
      type: 'audit';
      runtimeScopeId: string;
      timestamp: string;
      operationId: string;
      operationName: string;
      scopedKeyHash: string;
      result: 'completed' | 'failed';
      actor: { type: 'admin_account' | 'admin_session'; accountIdHash: string; sessionIdHash?: string };
      origin: AdminOperationOrigin;
      target: AdminOperationTarget;
      request: { requestId: string };
      confirmationFacts?: Record<string, unknown>;
    };

interface ActiveMutation {
  promise: Promise<AdminOperationResult<unknown>>;
}

interface RuntimeScopeMutationState {
  mutationQueue: Promise<void>;
  activeMutations: Map<string, ActiveMutation>;
  idempotency: Map<string, IdempotencyEntry>;
  recentAuditFacts: AdminAuditFact[];
  journalUnavailable: boolean;
}

const runtimeScopeMutationStates = new Map<string, RuntimeScopeMutationState>();

export class AdminOperationService {
  private readonly runtimeScopeId: string;
  private readonly storageDir: string;
  private readonly now: () => Date;
  private readonly completedRetentionMs: number;
  private readonly auditRetentionMs: number;
  private readonly inFlightWaitMs: number;
  private readonly createOperationId: () => string;
  private readonly mutationAvailability: AdminMutationAvailability;
  private readonly idempotency: Map<string, IdempotencyEntry>;
  private readonly recentAuditFacts: AdminAuditFact[];
  private readonly mutationState: RuntimeScopeMutationState;

  constructor(options: AdminOperationServiceOptions) {
    this.runtimeScopeId = options.runtimeScopeId;
    this.storageDir = path.join(options.storageDir, ADMIN_STATE_DIR);
    this.now = options.now ?? (() => new Date());
    this.completedRetentionMs = options.completedRetentionMs ?? DEFAULT_COMPLETED_RETENTION_MS;
    this.auditRetentionMs = options.auditRetentionMs ?? DEFAULT_AUDIT_RETENTION_MS;
    this.inFlightWaitMs = options.inFlightWaitMs ?? DEFAULT_IN_FLIGHT_WAIT_MS;
    this.createOperationId = options.createOperationId ?? (() => `op_${randomUUID()}`);
    this.mutationAvailability = options.mutationAvailability ?? { available: true };
    this.mutationState = getRuntimeScopeMutationState(this.storageDir, this.runtimeScopeId);
    this.idempotency = this.mutationState.idempotency;
    this.recentAuditFacts = this.mutationState.recentAuditFacts;

    this.replayJournal();
  }

  async executeReadOnly<T>(input: ExecuteReadOnlyInput<T>): Promise<AdminOperationResult<T>> {
    const result = await input.run(input.context);
    return {
      ok: true,
      status: 'completed',
      operationId: this.createOperationId(),
      operationName: input.operationName,
      result,
      replayed: false,
    };
  }

  getRecentAuditFacts(options: RecentAuditOptions = {}): AdminAuditFact[] {
    const limit = Math.max(0, options.limit ?? this.recentAuditFacts.length);
    if (limit === 0) {
      return [];
    }
    return this.recentAuditFacts.slice(-limit).map((fact) => ({
      ...fact,
      actor: { ...fact.actor },
      target: { ...fact.target },
      request: { ...fact.request },
      confirmationFacts: fact.confirmationFacts ? { ...fact.confirmationFacts } : undefined,
    }));
  }

  async executeMutation<T>(input: ExecuteMutationInput<T>): Promise<AdminOperationResult<T>> {
    if (input.context.runtimeIdentity.runtimeScopeId !== this.runtimeScopeId) {
      return {
        ok: false,
        status: 'runtime_scope_mismatch',
        code: 'runtime_scope_mismatch',
        retryable: false,
        operationName: input.operationName,
      };
    }

    if (!this.mutationAvailability.available) {
      return {
        ok: false,
        status: 'runtime_scope_locked',
        code: 'runtime_scope_locked',
        retryable: true,
        operationName: input.operationName,
        reason: 'writer_lock_unavailable',
      };
    }

    if (this.mutationState.journalUnavailable) {
      return this.journalUnavailableResult(input.operationName);
    }

    const idempotencyKey = input.context.idempotencyKey?.trim();
    const requestFingerprint = input.context.requestFingerprint?.trim();
    if (!idempotencyKey || !requestFingerprint) {
      return {
        ok: false,
        status: 'idempotency_key_required',
        code: 'idempotency_key_required',
        retryable: false,
        operationName: input.operationName,
      };
    }

    const scopedKeyHash = this.scopedKeyHash(input.context, input.operationName, idempotencyKey);
    const fingerprintHash = hashSecret(requestFingerprint);
    let existing = this.idempotency.get(scopedKeyHash);

    if (existing && this.isExpiredTerminal(existing)) {
      this.idempotency.delete(scopedKeyHash);
      existing = undefined;
    }

    if (existing && existing.fingerprintHash !== fingerprintHash) {
      return {
        ok: false,
        status: 'idempotency_conflict',
        code: 'idempotency_conflict',
        retryable: false,
        operationName: input.operationName,
      };
    }

    if (existing?.state === 'completed' && !this.isExpired(existing.completedAt ?? existing.reservedAt)) {
      return {
        ok: true,
        status: 'completed',
        operationId: existing.operationId,
        operationName: input.operationName,
        result: existing.result as T,
        replayed: true,
      };
    }

    if (existing?.state === 'failed' && !this.isExpired(existing.completedAt ?? existing.reservedAt)) {
      return {
        ok: false,
        status: 'mutation_failed',
        code: 'mutation_failed',
        retryable: false,
        operationName: existing.operationName,
        error: existing.error ?? 'Admin operation failed',
      };
    }

    if (existing?.state === 'state_unknown') {
      return this.stateUnknownResult(existing);
    }

    if (existing?.state === 'in_flight') {
      return (await this.waitForActiveMutation(scopedKeyHash, input.operationName)) as AdminOperationResult<T>;
    }

    const confirmationResult = this.validateConfirmations(input);
    if (confirmationResult) {
      return confirmationResult;
    }

    const operationId = this.createOperationId();
    const reservedAt = this.now().toISOString();
    const entry: IdempotencyEntry = {
      state: 'in_flight',
      scopedKeyHash,
      fingerprintHash,
      operationId,
      operationName: input.operationName,
      target: sanitizeTarget(input.context.target),
      reservedAt,
    };
    try {
      this.appendJournalRecord(this.reservedRecord(input.context, input.operationName, entry));
    } catch {
      this.idempotency.delete(scopedKeyHash);
      this.mutationState.journalUnavailable = true;
      return this.journalUnavailableResult(input.operationName);
    }
    this.idempotency.set(scopedKeyHash, entry);

    const activePromise = this.enqueueMutation(async () => this.runReservedMutation(input, entry));
    this.mutationState.activeMutations.set(scopedKeyHash, {
      promise: activePromise as Promise<AdminOperationResult<unknown>>,
    });
    activePromise.finally(() => {
      this.mutationState.activeMutations.delete(scopedKeyHash);
    });

    return (await activePromise) as AdminOperationResult<T>;
  }

  private async runReservedMutation<T>(
    input: ExecuteMutationInput<T>,
    entry: IdempotencyEntry,
  ): Promise<AdminOperationResult<T>> {
    let result: T;
    try {
      result = await input.run(input.context);
    } catch (error) {
      return this.recordMutationFailure(input, entry, error);
    }

    const completedAt = this.now().toISOString();
    const completedEntry: IdempotencyEntry = {
      ...entry,
      state: 'completed',
      completedAt,
      result,
    };
    try {
      this.appendJournalRecord({
        schemaVersion: JOURNAL_VERSION,
        type: 'completed',
        runtimeScopeId: this.runtimeScopeId,
        timestamp: completedAt,
        operationId: entry.operationId,
        operationName: entry.operationName,
        scopedKeyHash: entry.scopedKeyHash,
        fingerprintHash: entry.fingerprintHash,
        result,
      });
      this.appendAuditRecord(input.context, entry, 'completed');
      this.idempotency.set(entry.scopedKeyHash, completedEntry);
      return {
        ok: true,
        status: 'completed',
        operationId: entry.operationId,
        operationName: entry.operationName,
        result,
        replayed: false,
      };
    } catch {
      return this.markStateUnknownResult(entry);
    }
  }

  private recordMutationFailure<T>(
    input: ExecuteMutationInput<T>,
    entry: IdempotencyEntry,
    error: unknown,
  ): AdminOperationResult<T> {
    const failedAt = this.now().toISOString();
    const message = error instanceof Error ? error.message : 'Admin operation failed';
    try {
      this.appendJournalRecord({
        schemaVersion: JOURNAL_VERSION,
        type: 'failed',
        runtimeScopeId: this.runtimeScopeId,
        timestamp: failedAt,
        operationId: entry.operationId,
        operationName: entry.operationName,
        scopedKeyHash: entry.scopedKeyHash,
        fingerprintHash: entry.fingerprintHash,
        error: message,
      });
      this.appendAuditRecord(input.context, entry, 'failed');
      this.idempotency.set(entry.scopedKeyHash, {
        ...entry,
        state: 'failed',
        completedAt: failedAt,
        error: message,
      });
    } catch {
      this.mutationState.journalUnavailable = true;
      return this.journalUnavailableResult(entry.operationName);
    }
    return {
      ok: false,
      status: 'mutation_failed',
      code: 'mutation_failed',
      retryable: false,
      operationName: entry.operationName,
      error: message,
    };
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationState.mutationQueue.then(operation, operation);
    this.mutationState.mutationQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async waitForActiveMutation(scopedKeyHash: string, operationName: string): Promise<AdminOperationResult> {
    const active = this.mutationState.activeMutations.get(scopedKeyHash);
    if (!active) {
      const entry = this.idempotency.get(scopedKeyHash);
      return entry ? this.markStateUnknownResult(entry) : this.operationInProgress(operationName);
    }

    const timeoutMs = this.retryWaitMs();
    const timeout = new Promise<AdminOperationResult>((resolve) => {
      setTimeout(() => resolve(this.operationInProgress(operationName, timeoutMs)), timeoutMs);
    });
    return Promise.race([active.promise, timeout]);
  }

  private retryWaitMs(): number {
    return Math.max(1, this.inFlightWaitMs);
  }

  private operationInProgress(operationName: string, retryAfterMs = this.retryWaitMs()): AdminOperationRecoveryResult {
    return {
      ok: false,
      status: 'operation_in_progress',
      code: 'operation_in_progress',
      retryable: true,
      operationName,
      retryAfterMs,
    };
  }

  private journalUnavailableResult(operationName: string): AdminOperationRecoveryResult {
    return {
      ok: false,
      status: 'admin_operation_journal_unavailable',
      code: 'admin_operation_journal_unavailable',
      retryable: false,
      operationName,
    };
  }

  private validateConfirmations(input: ExecuteMutationInput<unknown>): AdminOperationRecoveryResult | null {
    if (!input.confirmationRequirements?.length) {
      return null;
    }

    const facts = input.context.confirmationFacts ?? {};
    const missing = input.confirmationRequirements.filter((requirement) => {
      const actual = facts[requirement.code];
      return requirement.expected === undefined ? actual !== true : actual !== requirement.expected;
    });

    if (missing.length === 0) {
      return null;
    }

    return {
      ok: false,
      status: 'mutation_confirmation_required',
      code: 'mutation_confirmation_required',
      retryable: false,
      operationName: input.operationName,
      confirmationRequirements: input.confirmationRequirements.map((requirement) => ({ ...requirement })),
    };
  }

  private replayJournal(): void {
    const filePath = this.journalFilePath();
    if (!fs.existsSync(filePath)) {
      return;
    }

    try {
      const records = this.readJournalRecords(filePath);
      this.idempotency.clear();
      this.recentAuditFacts.length = 0;
      this.mutationState.journalUnavailable = false;

      for (const record of records) {
        this.applyJournalRecord(record);
      }

      for (const entry of Array.from(this.idempotency.values())) {
        if (entry.state === 'in_flight' && !this.mutationState.activeMutations.has(entry.scopedKeyHash)) {
          this.markStateUnknown(entry);
        }
      }
    } catch {
      this.idempotency.clear();
      this.recentAuditFacts.length = 0;
      this.mutationState.journalUnavailable = true;
      return;
    }

    try {
      this.compactJournal();
    } catch {
      // Compaction is cleanup only; replayed admission/audit state remains authoritative.
    }
  }

  private applyJournalRecord(record: JournalRecord): void {
    if (record.schemaVersion !== JOURNAL_VERSION || record.runtimeScopeId !== this.runtimeScopeId) {
      return;
    }

    if (record.type === 'reserved') {
      this.idempotency.set(record.scopedKeyHash, {
        state: 'in_flight',
        scopedKeyHash: record.scopedKeyHash,
        fingerprintHash: record.fingerprintHash,
        operationId: record.operationId,
        operationName: record.operationName,
        target: record.target,
        reservedAt: record.timestamp,
      });
      return;
    }

    if (record.type === 'completed') {
      if (this.isExpired(record.timestamp)) {
        this.idempotency.delete(record.scopedKeyHash);
        return;
      }
      this.idempotency.set(record.scopedKeyHash, {
        ...this.entryFromRecord(record),
        state: 'completed',
        completedAt: record.timestamp,
        result: record.result,
      });
      return;
    }

    if (record.type === 'failed') {
      if (this.isExpired(record.timestamp)) {
        this.idempotency.delete(record.scopedKeyHash);
        return;
      }
      this.idempotency.set(record.scopedKeyHash, {
        ...this.entryFromRecord(record),
        state: 'failed',
        completedAt: record.timestamp,
        error: record.error,
      });
      return;
    }

    if (record.type === 'state_unknown') {
      if (this.isAuditExpired(record.timestamp)) {
        this.idempotency.delete(record.scopedKeyHash);
        return;
      }
      this.idempotency.set(record.scopedKeyHash, {
        state: 'state_unknown',
        scopedKeyHash: record.scopedKeyHash,
        fingerprintHash: record.fingerprintHash,
        operationId: record.operationId,
        operationName: record.operationName,
        target: record.target,
        reservedAt: record.reservedAt,
      });
      return;
    }

    if (record.type === 'audit') {
      if (this.isAuditExpired(record.timestamp)) {
        return;
      }
      this.recentAuditFacts.push(auditFactFromRecord(record));
    }
  }

  private entryFromRecord(
    record: Extract<JournalRecord, { type: 'completed' | 'failed' }>,
  ): Omit<IdempotencyEntry, 'state'> {
    const existing = this.idempotency.get(record.scopedKeyHash);
    return {
      scopedKeyHash: record.scopedKeyHash,
      fingerprintHash: record.fingerprintHash,
      operationId: record.operationId,
      operationName: record.operationName,
      target: existing?.target ?? { type: 'unknown' },
      reservedAt: existing?.reservedAt ?? record.timestamp,
    };
  }

  private markStateUnknown(entry: IdempotencyEntry): IdempotencyEntry {
    const unknownEntry: IdempotencyEntry = {
      ...entry,
      state: 'state_unknown',
    };
    this.appendJournalRecord({
      schemaVersion: JOURNAL_VERSION,
      type: 'state_unknown',
      runtimeScopeId: this.runtimeScopeId,
      timestamp: this.now().toISOString(),
      operationId: entry.operationId,
      operationName: entry.operationName,
      scopedKeyHash: entry.scopedKeyHash,
      fingerprintHash: entry.fingerprintHash,
      target: entry.target,
      reservedAt: entry.reservedAt,
    });
    this.idempotency.set(entry.scopedKeyHash, unknownEntry);
    return unknownEntry;
  }

  private markStateUnknownResult(entry: IdempotencyEntry): AdminOperationRecoveryResult {
    try {
      return this.stateUnknownResult(this.markStateUnknown(entry));
    } catch {
      this.mutationState.journalUnavailable = true;
      this.idempotency.set(entry.scopedKeyHash, {
        ...entry,
        state: 'state_unknown',
      });
      return this.journalUnavailableResult(entry.operationName);
    }
  }

  private stateUnknownResult(entry: IdempotencyEntry): AdminOperationRecoveryResult {
    return {
      ok: false,
      status: 'operation_state_unknown',
      code: 'operation_state_unknown',
      retryable: false,
      operationName: entry.operationName,
      target: entry.target,
      reservedAt: entry.reservedAt,
      recovery: 'inspect_current_state_and_retry_with_new_idempotency_key',
    };
  }

  private reservedRecord(
    context: AdminOperationContext,
    operationName: string,
    entry: IdempotencyEntry,
  ): JournalRecord {
    return {
      schemaVersion: JOURNAL_VERSION,
      type: 'reserved',
      runtimeScopeId: this.runtimeScopeId,
      timestamp: entry.reservedAt,
      operationId: entry.operationId,
      operationName,
      scopedKeyHash: entry.scopedKeyHash,
      fingerprintHash: entry.fingerprintHash,
      target: entry.target,
      actor: sanitizeActor(context.actor),
      origin: context.origin,
      request: sanitizeRequest(context.request),
      runtimeIdentity: sanitizeRuntimeIdentity(context.runtimeIdentity),
    };
  }

  private appendAuditRecord(
    context: AdminOperationContext,
    entry: IdempotencyEntry,
    result: 'completed' | 'failed',
  ): void {
    const fact: AdminAuditFact = {
      timestamp: this.now().toISOString(),
      operationId: entry.operationId,
      operationName: entry.operationName,
      result,
      actor: sanitizeActor(context.actor),
      origin: context.origin,
      target: entry.target,
      request: { requestId: context.request.requestId },
      confirmationFacts: sanitizeConfirmationFacts(context.confirmationFacts),
    };

    this.appendJournalRecord({
      schemaVersion: JOURNAL_VERSION,
      type: 'audit',
      runtimeScopeId: this.runtimeScopeId,
      timestamp: fact.timestamp,
      operationId: fact.operationId,
      operationName: fact.operationName,
      scopedKeyHash: entry.scopedKeyHash,
      result: fact.result,
      actor: fact.actor,
      origin: fact.origin,
      target: fact.target,
      request: fact.request,
      confirmationFacts: fact.confirmationFacts,
    });
    this.recentAuditFacts.push(fact);
  }

  private appendJournalRecord(record: JournalRecord): void {
    fs.mkdirSync(this.storageDir, { recursive: true });
    const filePath = this.journalFilePath();
    const fd = fs.openSync(filePath, 'a', 0o600);
    try {
      fs.chmodSync(filePath, 0o600);
      fs.writeSync(fd, `${JSON.stringify(record)}\n`, undefined, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }

  private scopedKeyHash(context: AdminOperationContext, operationName: string, idempotencyKey: string): string {
    return hashSecret(
      JSON.stringify({
        runtimeScopeId: this.runtimeScopeId,
        actorType: context.actor.type,
        accountId: context.actor.accountId,
        sessionId: context.actor.sessionId,
        operationName,
        idempotencyKey,
      }),
    );
  }

  private isExpired(timestamp: string): boolean {
    return this.now().getTime() - new Date(timestamp).getTime() > this.completedRetentionMs;
  }

  private isAuditExpired(timestamp: string): boolean {
    return this.now().getTime() - new Date(timestamp).getTime() > this.auditRetentionMs;
  }

  private isExpiredTerminal(entry: IdempotencyEntry): boolean {
    return (
      (entry.state === 'completed' || entry.state === 'failed') && this.isExpired(entry.completedAt ?? entry.reservedAt)
    );
  }

  private compactJournal(): void {
    const filePath = this.journalFilePath();
    if (!fs.existsSync(filePath)) {
      return;
    }

    const records = this.readJournalRecords(filePath);
    const retained = records.filter((record) => this.shouldRetainJournalRecord(record));
    if (retained.length === records.length) {
      return;
    }

    const tempPath = `${filePath}.${process.pid}.compact.tmp`;
    const content = retained.length > 0 ? `${retained.map((record) => JSON.stringify(record)).join('\n')}\n` : '';
    fs.writeFileSync(tempPath, content, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempPath, filePath);
    fs.chmodSync(filePath, 0o600);
  }

  private shouldRetainJournalRecord(record: JournalRecord): boolean {
    if (record.type === 'state_unknown') {
      return !this.isAuditExpired(record.timestamp);
    }
    if (record.type === 'audit') {
      return !this.isAuditExpired(record.timestamp);
    }
    if (record.type === 'completed' || record.type === 'failed') {
      return !this.isExpired(record.timestamp);
    }

    const entry = this.idempotency.get(record.scopedKeyHash);
    return Boolean(entry && !this.isExpiredTerminal(entry));
  }

  private readJournalRecords(filePath: string): JournalRecord[] {
    return fs
      .readFileSync(filePath, 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as JournalRecord);
  }

  private journalFilePath(): string {
    return path.join(this.storageDir, `admin-operations-${hashSecret(this.runtimeScopeId).slice(0, 24)}.jsonl`);
  }
}

function sanitizeActor(
  actor: AdminOperationContext['actor'],
): Extract<JournalRecord, { type: 'reserved' | 'audit' }>['actor'] {
  return {
    type: actor.type,
    accountIdHash: hashSecret(actor.accountId),
    sessionIdHash: actor.sessionId ? hashSecret(actor.sessionId) : undefined,
  };
}

function sanitizeTarget(target: AdminOperationTarget): AdminOperationTarget {
  return {
    type: target.type,
    id: target.id,
  };
}

function sanitizeRequest(request: AdminOperationContext['request']): { requestId: string; jsonMode?: boolean } {
  return {
    requestId: request.requestId,
    jsonMode: request.jsonMode,
  };
}

function sanitizeRuntimeIdentity(
  runtimeIdentity: AdminOperationContext['runtimeIdentity'],
): Extract<JournalRecord, { type: 'reserved' }>['runtimeIdentity'] {
  return {
    runtimeScopeId: runtimeIdentity.runtimeScopeId,
    runtimeVersion: runtimeIdentity.runtimeVersion,
  };
}

function sanitizeConfirmationFacts(facts: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!facts || Object.keys(facts).length === 0) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(facts).filter(([, value]) => ['string', 'boolean', 'number'].includes(typeof value)),
  );
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url');
}

function auditFactFromRecord(record: Extract<JournalRecord, { type: 'audit' }>): AdminAuditFact {
  return {
    timestamp: record.timestamp,
    operationId: record.operationId,
    operationName: record.operationName,
    result: record.result,
    actor: { ...record.actor },
    origin: record.origin,
    target: { ...record.target },
    request: { ...record.request },
    confirmationFacts: record.confirmationFacts ? { ...record.confirmationFacts } : undefined,
  };
}

function getRuntimeScopeMutationState(storageDir: string, runtimeScopeId: string): RuntimeScopeMutationState {
  const key = `${storageDir}\0${runtimeScopeId}`;
  const existing = runtimeScopeMutationStates.get(key);
  if (existing) {
    return existing;
  }

  const state: RuntimeScopeMutationState = {
    mutationQueue: Promise.resolve(),
    activeMutations: new Map(),
    idempotency: new Map(),
    recentAuditFacts: [],
    journalUnavailable: false,
  };
  runtimeScopeMutationStates.set(key, state);
  return state;
}
