import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type AdminOperationContext, AdminOperationService } from './adminOperationService.js';

describe('AdminOperationService', () => {
  let storageDir: string;
  let currentTime: Date;

  beforeEach(() => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-operation-'));
    currentTime = new Date('2026-07-07T00:00:00.000Z');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  function createService(
    options: { runtimeScopeId?: string; retentionMs?: number; auditRetentionMs?: number; inFlightWaitMs?: number } = {},
  ) {
    return new AdminOperationService({
      runtimeScopeId: options.runtimeScopeId ?? 'scope_a',
      storageDir,
      now: () => currentTime,
      completedRetentionMs: options.retentionMs ?? 24 * 60 * 60 * 1000,
      auditRetentionMs: options.auditRetentionMs,
      inFlightWaitMs: options.inFlightWaitMs ?? 5,
      createOperationId: () => `op_${currentTime.getTime()}`,
    });
  }

  function context(overrides: Partial<AdminOperationContext> = {}): AdminOperationContext {
    return {
      actor: { type: 'admin_session', accountId: 'acct_1', sessionId: 'sess_1' },
      origin: 'cli',
      target: { type: 'configured_server', id: 'server_a' },
      runtimeIdentity: { runtimeScopeId: 'scope_a', runtimeVersion: '0.34.0' },
      request: { requestId: 'req_1', jsonMode: true },
      idempotencyKey: 'idem_1',
      requestFingerprint: 'fingerprint_a',
      deadline: new Date(currentTime.getTime() + 1000).toISOString(),
      confirmationFacts: {},
      ...overrides,
    };
  }

  it('replays a completed mutation for the same idempotency key and request fingerprint', async () => {
    const service = createService();
    let executionCount = 0;

    const first = await service.executeMutation({
      context: context(),
      operationName: 'enableConfiguredServer',
      run: async () => {
        executionCount += 1;
        return { enabled: true, sequence: executionCount };
      },
    });
    const replay = await service.executeMutation({
      context: context(),
      operationName: 'enableConfiguredServer',
      run: async () => {
        executionCount += 1;
        return { enabled: false, sequence: executionCount };
      },
    });

    expect(first).toMatchObject({ ok: true, status: 'completed', replayed: false });
    expect(replay).toMatchObject({
      ok: true,
      status: 'completed',
      replayed: true,
      result: { enabled: true, sequence: 1 },
    });
    expect(executionCount).toBe(1);
    expect(readJournalRecords()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'reserved', operationName: 'enableConfiguredServer' }),
        expect.objectContaining({ type: 'completed', operationName: 'enableConfiguredServer' }),
        expect.objectContaining({ type: 'audit', operationName: 'enableConfiguredServer' }),
      ]),
    );
  });

  it('conflicts when the same idempotency key is reused with a different fingerprint', async () => {
    const service = createService();
    await service.executeMutation({
      context: context(),
      operationName: 'disableConfiguredServer',
      run: async () => ({ disabled: true }),
    });

    const conflict = await service.executeMutation({
      context: context({ requestFingerprint: 'fingerprint_b' }),
      operationName: 'disableConfiguredServer',
      run: async () => ({ disabled: false }),
    });

    expect(conflict).toMatchObject({
      ok: false,
      status: 'idempotency_conflict',
      code: 'idempotency_conflict',
      retryable: false,
    });
  });

  it('fails mutations closed without reserving idempotency when the runtime scope admin lock is unavailable', async () => {
    const service = new AdminOperationService({
      runtimeScopeId: 'scope_a',
      storageDir,
      now: () => currentTime,
      createOperationId: () => `op_${currentTime.getTime()}`,
      mutationAvailability: {
        available: false,
        reason: 'writer_lock_unavailable',
      },
    });
    let executionCount = 0;

    const result = await service.executeMutation({
      context: context(),
      operationName: 'enableConfiguredServer',
      run: async () => {
        executionCount += 1;
        return { enabled: true };
      },
    });

    expect(result).toEqual({
      ok: false,
      status: 'runtime_scope_locked',
      code: 'runtime_scope_locked',
      retryable: true,
      operationName: 'enableConfiguredServer',
      reason: 'writer_lock_unavailable',
    });
    expect(executionCount).toBe(0);
    expect(fs.existsSync(journalPath())).toBe(false);
  });

  it('replays a failed terminal mutation for the same idempotency key and request fingerprint', async () => {
    const service = createService();
    let executionCount = 0;

    const first = await service.executeMutation({
      context: context(),
      operationName: 'disableConfiguredServer',
      run: async () => {
        executionCount += 1;
        throw new Error('config validation failed');
      },
    });
    const replay = await service.executeMutation({
      context: context(),
      operationName: 'disableConfiguredServer',
      run: async () => {
        executionCount += 1;
        return { disabled: true };
      },
    });

    expect(first).toMatchObject({
      ok: false,
      status: 'mutation_failed',
      code: 'mutation_failed',
      error: 'config validation failed',
    });
    expect(replay).toMatchObject({
      ok: false,
      status: 'mutation_failed',
      code: 'mutation_failed',
      error: 'config validation failed',
    });
    expect(executionCount).toBe(1);
  });

  it('returns operation_in_progress for a same-key retry while the original mutation is still running', async () => {
    const service = createService({ inFlightWaitMs: 1 });
    let releaseOriginal!: () => void;
    const originalStarted = new Promise<void>((resolve) => {
      releaseOriginal = resolve;
    });
    let finishOriginal!: () => void;
    const finishOriginalPromise = new Promise<void>((resolve) => {
      finishOriginal = resolve;
    });

    const original = service.executeMutation({
      context: context(),
      operationName: 'enableConfiguredServer',
      run: async () => {
        releaseOriginal();
        await finishOriginalPromise;
        return { enabled: true };
      },
    });
    await originalStarted;

    const retry = await service.executeMutation({
      context: context({ deadline: new Date(currentTime.getTime() + 1).toISOString() }),
      operationName: 'enableConfiguredServer',
      run: async () => ({ enabled: false }),
    });

    expect(retry).toMatchObject({
      ok: false,
      status: 'operation_in_progress',
      code: 'operation_in_progress',
      retryable: true,
    });

    finishOriginal();
    await expect(original).resolves.toMatchObject({ ok: true, result: { enabled: true } });
  });

  it('returns operation_in_progress for a same-key retry from a second service instance while the original mutation is still running', async () => {
    const firstService = createService({ inFlightWaitMs: 1 });
    const secondService = createService({ inFlightWaitMs: 1 });
    let executionCount = 0;
    let originalStarted!: () => void;
    const originalStartedPromise = new Promise<void>((resolve) => {
      originalStarted = resolve;
    });
    let finishOriginal!: () => void;
    const finishOriginalPromise = new Promise<void>((resolve) => {
      finishOriginal = resolve;
    });

    const original = firstService.executeMutation({
      context: context(),
      operationName: 'enableConfiguredServer',
      run: async () => {
        executionCount += 1;
        originalStarted();
        await finishOriginalPromise;
        return { enabled: true };
      },
    });
    await originalStartedPromise;

    const retry = secondService.executeMutation({
      context: context(),
      operationName: 'enableConfiguredServer',
      run: async () => {
        executionCount += 1;
        return { enabled: false };
      },
    });

    try {
      const retryResult = await Promise.race([retry, wait(20).then(() => 'timed_out' as const)]);
      expect(retryResult).toMatchObject({
        ok: false,
        status: 'operation_in_progress',
        code: 'operation_in_progress',
        retryable: true,
      });
      expect(executionCount).toBe(1);
    } finally {
      finishOriginal();
      await Promise.allSettled([original, retry]);
    }
  });

  it('replays a completed same-key mutation from a second already-constructed service instance', async () => {
    const firstService = createService();
    const secondService = createService();
    let executionCount = 0;

    const first = await firstService.executeMutation({
      context: context(),
      operationName: 'enableConfiguredServer',
      run: async () => {
        executionCount += 1;
        return { enabled: true, sequence: executionCount };
      },
    });
    const replay = await secondService.executeMutation({
      context: context(),
      operationName: 'enableConfiguredServer',
      run: async () => {
        executionCount += 1;
        return { enabled: false, sequence: executionCount };
      },
    });

    expect(first).toMatchObject({ ok: true, status: 'completed', replayed: false });
    expect(replay).toMatchObject({
      ok: true,
      status: 'completed',
      replayed: true,
      result: { enabled: true, sequence: 1 },
    });
    expect(executionCount).toBe(1);
  });

  it('conflicts on a same-key different-fingerprint retry from a second already-constructed service instance', async () => {
    const firstService = createService();
    const secondService = createService();
    let executionCount = 0;

    await firstService.executeMutation({
      context: context(),
      operationName: 'disableConfiguredServer',
      run: async () => {
        executionCount += 1;
        return { disabled: true };
      },
    });

    const conflict = await secondService.executeMutation({
      context: context({ requestFingerprint: 'fingerprint_b' }),
      operationName: 'disableConfiguredServer',
      run: async () => {
        executionCount += 1;
        return { disabled: false };
      },
    });

    expect(conflict).toMatchObject({
      ok: false,
      status: 'idempotency_conflict',
      code: 'idempotency_conflict',
      retryable: false,
    });
    expect(executionCount).toBe(1);
  });

  it('does not share idempotency admission across different Runtime Scopes', async () => {
    const scopeAService = createService();
    const scopeBService = createService({ runtimeScopeId: 'scope_b' });
    let executionCount = 0;

    await scopeAService.executeMutation({
      context: context(),
      operationName: 'enableConfiguredServer',
      run: async () => {
        executionCount += 1;
        return { scope: 'a' };
      },
    });

    const scopeBResult = await scopeBService.executeMutation({
      context: context({ runtimeIdentity: { runtimeScopeId: 'scope_b', runtimeVersion: '0.34.0' } }),
      operationName: 'enableConfiguredServer',
      run: async () => {
        executionCount += 1;
        return { scope: 'b' };
      },
    });

    expect(scopeBResult).toMatchObject({ ok: true, status: 'completed', replayed: false, result: { scope: 'b' } });
    expect(executionCount).toBe(2);
  });

  it('returns operation_state_unknown after startup replays a stale in-flight reservation', async () => {
    const service = createService();
    const original = await service.executeMutation({
      context: context({ idempotencyKey: 'seed', requestFingerprint: 'seed_fingerprint' }),
      operationName: 'seedJournal',
      run: async () => ({ seeded: true }),
    });
    expect(original).toMatchObject({ ok: true });

    const records = readJournalRecords();
    const reserved = records.find((record) => record.type === 'reserved');
    expect(reserved).toBeDefined();
    const staleReservation = {
      ...reserved,
      operationId: 'op_stale',
      operationName: 'disableConfiguredServer',
      scopedKeyHash: records[0].scopedKeyHash,
      fingerprintHash: records[0].fingerprintHash,
      target: { type: 'configured_server', id: 'server_a' },
    };
    fs.writeFileSync(journalPath(), `${JSON.stringify(staleReservation)}\n`, { mode: 0o600 });

    const restarted = createService();
    const retry = await restarted.executeMutation({
      context: context({ idempotencyKey: 'seed', requestFingerprint: 'seed_fingerprint' }),
      operationName: 'seedJournal',
      run: async () => ({ disabled: false }),
    });

    expect(retry).toMatchObject({
      ok: false,
      status: 'operation_state_unknown',
      code: 'operation_state_unknown',
      retryable: false,
      target: { type: 'configured_server', id: 'server_a' },
    });
    expect(readJournalRecords()).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'state_unknown' })]));
  });

  it('returns machine-readable confirmation requirements before reserving a dangerous mutation', async () => {
    const service = createService();
    let executionCount = 0;

    const result = await service.executeMutation({
      context: context(),
      operationName: 'disableConfiguredServer',
      confirmationRequirements: [
        { code: 'confirm_operation', expected: 'disableConfiguredServer' },
        { code: 'confirm_target', expected: 'server_a' },
      ],
      run: async () => {
        executionCount += 1;
        return { disabled: true };
      },
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'mutation_confirmation_required',
      code: 'mutation_confirmation_required',
      retryable: false,
      confirmationRequirements: [
        { code: 'confirm_operation', expected: 'disableConfiguredServer' },
        { code: 'confirm_target', expected: 'server_a' },
      ],
    });
    expect(executionCount).toBe(0);
    expect(fs.existsSync(journalPath())).toBe(false);
  });

  it('replays a completed dangerous mutation without requiring confirmation facts again', async () => {
    const service = createService();
    let executionCount = 0;

    await service.executeMutation({
      context: context({
        confirmationFacts: {
          confirm_operation: 'disableConfiguredServer',
          confirm_target: 'server_a',
        },
      }),
      operationName: 'disableConfiguredServer',
      confirmationRequirements: [
        { code: 'confirm_operation', expected: 'disableConfiguredServer' },
        { code: 'confirm_target', expected: 'server_a' },
      ],
      run: async () => {
        executionCount += 1;
        return { disabled: true };
      },
    });

    const replay = await service.executeMutation({
      context: context(),
      operationName: 'disableConfiguredServer',
      confirmationRequirements: [
        { code: 'confirm_operation', expected: 'disableConfiguredServer' },
        { code: 'confirm_target', expected: 'server_a' },
      ],
      run: async () => {
        executionCount += 1;
        return { disabled: false };
      },
    });

    expect(replay).toMatchObject({
      ok: true,
      status: 'completed',
      replayed: true,
      result: { disabled: true },
    });
    expect(executionCount).toBe(1);
  });

  it('returns idempotency_conflict for a dangerous mutation retry with the same key and different fingerprint', async () => {
    const service = createService();
    await service.executeMutation({
      context: context({
        confirmationFacts: {
          confirm_operation: 'disableConfiguredServer',
          confirm_target: 'server_a',
        },
      }),
      operationName: 'disableConfiguredServer',
      confirmationRequirements: [
        { code: 'confirm_operation', expected: 'disableConfiguredServer' },
        { code: 'confirm_target', expected: 'server_a' },
      ],
      run: async () => ({ disabled: true }),
    });

    const conflict = await service.executeMutation({
      context: context({ requestFingerprint: 'fingerprint_b' }),
      operationName: 'disableConfiguredServer',
      confirmationRequirements: [
        { code: 'confirm_operation', expected: 'disableConfiguredServer' },
        { code: 'confirm_target', expected: 'server_a' },
      ],
      run: async () => ({ disabled: false }),
    });

    expect(conflict).toMatchObject({
      ok: false,
      status: 'idempotency_conflict',
      code: 'idempotency_conflict',
      retryable: false,
    });
  });

  it('serializes mutations per Runtime Scope while read-only operations stay concurrent', async () => {
    const service = createService();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = service.executeMutation({
      context: context({ idempotencyKey: 'idem_first', requestFingerprint: 'fingerprint_first' }),
      operationName: 'enableConfiguredServer',
      run: async () => {
        events.push('first:start');
        await firstMayFinish;
        events.push('first:end');
        return { enabled: true };
      },
    });
    await waitUntil(() => events.includes('first:start'));

    const second = service.executeMutation({
      context: context({ idempotencyKey: 'idem_second', requestFingerprint: 'fingerprint_second' }),
      operationName: 'disableConfiguredServer',
      run: async () => {
        events.push('second:start');
        return { disabled: true };
      },
    });
    const readOnly = await service.executeReadOnly({
      context: context({ idempotencyKey: undefined, requestFingerprint: undefined }),
      operationName: 'inspectConfiguredServers',
      run: async () => {
        events.push('read:start');
        return { count: 2 };
      },
    });

    expect(readOnly).toMatchObject({ ok: true, status: 'completed', result: { count: 2 } });
    expect(events).toEqual(['first:start', 'read:start']);

    releaseFirst();
    await Promise.all([first, second]);

    expect(events).toEqual(['first:start', 'read:start', 'first:end', 'second:start']);
  });

  it('serializes mutations for the same Runtime Scope across service instances', async () => {
    const firstService = createService();
    const secondService = createService();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = firstService.executeMutation({
      context: context({ idempotencyKey: 'idem_first', requestFingerprint: 'fingerprint_first' }),
      operationName: 'enableConfiguredServer',
      run: async () => {
        events.push('first:start');
        await firstMayFinish;
        events.push('first:end');
        return { enabled: true };
      },
    });
    await waitUntil(() => events.includes('first:start'));

    const second = secondService.executeMutation({
      context: context({ idempotencyKey: 'idem_second', requestFingerprint: 'fingerprint_second' }),
      operationName: 'disableConfiguredServer',
      run: async () => {
        events.push('second:start');
        return { disabled: true };
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(events).toEqual(['first:start']);

    releaseFirst();
    await Promise.all([first, second]);

    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('does not replay completed idempotency records after bounded retention expires', async () => {
    const service = createService({ retentionMs: 100 });
    let executionCount = 0;

    await service.executeMutation({
      context: context(),
      operationName: 'enableConfiguredServer',
      run: async () => {
        executionCount += 1;
        return { sequence: executionCount };
      },
    });

    currentTime = new Date('2026-07-07T00:00:01.000Z');
    const restarted = createService({ retentionMs: 100 });
    const result = await restarted.executeMutation({
      context: context(),
      operationName: 'enableConfiguredServer',
      run: async () => {
        executionCount += 1;
        return { sequence: executionCount };
      },
    });

    expect(result).toMatchObject({ ok: true, replayed: false, result: { sequence: 2 } });
    expect(executionCount).toBe(2);
  });

  it('does not conflict with an expired terminal record when the reused key has a different fingerprint', async () => {
    const service = createService({ retentionMs: 100 });
    let executionCount = 0;

    await service.executeMutation({
      context: context(),
      operationName: 'enableConfiguredServer',
      run: async () => {
        executionCount += 1;
        return { sequence: executionCount };
      },
    });

    currentTime = new Date('2026-07-07T00:00:01.000Z');
    const result = await service.executeMutation({
      context: context({ requestFingerprint: 'fingerprint_b' }),
      operationName: 'enableConfiguredServer',
      run: async () => {
        executionCount += 1;
        return { sequence: executionCount };
      },
    });

    expect(result).toMatchObject({ ok: true, replayed: false, result: { sequence: 2 } });
    expect(executionCount).toBe(2);
  });

  it('replays sanitized audit records into a compact recent audit index', async () => {
    const service = createService();

    await service.executeMutation({
      context: context({
        confirmationFacts: {
          confirm_operation: 'disableConfiguredServer',
          confirm_target: 'server_a',
          unsafe_details: { rawPath: '/tmp/secret-config.json' },
        },
      }),
      operationName: 'disableConfiguredServer',
      confirmationRequirements: [
        { code: 'confirm_operation', expected: 'disableConfiguredServer' },
        { code: 'confirm_target', expected: 'server_a' },
      ],
      run: async () => ({ disabled: true }),
    });

    const restarted = createService();
    const auditFacts = restarted.getRecentAuditFacts({ limit: 5 });

    expect(auditFacts).toEqual([
      expect.objectContaining({
        operationName: 'disableConfiguredServer',
        result: 'completed',
        actor: expect.objectContaining({ type: 'admin_session', accountIdHash: expect.any(String) }),
        origin: 'cli',
        target: { type: 'configured_server', id: 'server_a' },
        request: { requestId: 'req_1' },
        confirmationFacts: {
          confirm_operation: 'disableConfiguredServer',
          confirm_target: 'server_a',
        },
      }),
    ]);
    expect(JSON.stringify(auditFacts)).not.toContain('acct_1');
    expect(JSON.stringify(auditFacts)).not.toContain('sess_1');
    expect(JSON.stringify(auditFacts)).not.toContain('/tmp/secret-config.json');
  });

  it('returns no audit facts when recent audit limit is zero', async () => {
    const service = createService();
    await service.executeMutation({
      context: context(),
      operationName: 'enableConfiguredServer',
      run: async () => ({ enabled: true }),
    });

    expect(service.getRecentAuditFacts({ limit: 0 })).toEqual([]);
  });

  it('compacts expired terminal and audit records on startup while preserving unresolved state_unknown records', async () => {
    const service = createService({ retentionMs: 100, auditRetentionMs: 100 });
    await service.executeMutation({
      context: context(),
      operationName: 'enableConfiguredServer',
      run: async () => ({ enabled: true }),
    });
    const unresolvedAt = '2026-07-07T00:00:01.000Z';
    fs.appendFileSync(
      journalPath(),
      `${JSON.stringify({
        schemaVersion: 1,
        type: 'state_unknown',
        runtimeScopeId: 'scope_a',
        timestamp: unresolvedAt,
        operationId: 'op_unknown',
        operationName: 'disableConfiguredServer',
        scopedKeyHash: 'unknown_key_hash',
        fingerprintHash: 'unknown_fingerprint_hash',
        target: { type: 'configured_server', id: 'server_b' },
        reservedAt: unresolvedAt,
      })}\n`,
    );

    currentTime = new Date(unresolvedAt);
    const restarted = createService({ retentionMs: 100, auditRetentionMs: 100 });
    const records = readJournalRecords();

    expect(restarted.getRecentAuditFacts({ limit: 10 })).toEqual([]);
    expect(records).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'state_unknown', operationId: 'op_unknown' })]),
    );
    expect(records).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: 'completed' })]));
    expect(records).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: 'audit' })]));
  });

  it('keeps replayed admission state usable when best-effort compaction fails', async () => {
    const service = createService({ auditRetentionMs: 100 });
    let executionCount = 0;
    await service.executeMutation({
      context: context(),
      operationName: 'enableConfiguredServer',
      run: async () => {
        executionCount += 1;
        return { enabled: true, sequence: executionCount };
      },
    });
    fs.appendFileSync(
      journalPath(),
      `${JSON.stringify({
        schemaVersion: 1,
        type: 'audit',
        runtimeScopeId: 'scope_a',
        timestamp: '2026-07-06T00:00:00.000Z',
        operationId: 'op_old_audit',
        operationName: 'oldAudit',
        scopedKeyHash: 'old_audit_key_hash',
        result: 'completed',
        actor: { type: 'admin_session', accountIdHash: 'account_hash', sessionIdHash: 'session_hash' },
        origin: 'cli',
        target: { type: 'configured_server', id: 'server_old' },
        request: { requestId: 'req_old' },
      })}\n`,
    );

    currentTime = new Date('2026-07-07T00:00:01.000Z');
    vi.spyOn(fs, 'renameSync').mockImplementation((() => {
      throw new Error('compact rename failed');
    }) as typeof fs.renameSync);

    const restarted = createService({ auditRetentionMs: 100 });
    const replay = await restarted.executeMutation({
      context: context(),
      operationName: 'enableConfiguredServer',
      run: async () => {
        executionCount += 1;
        return { enabled: false, sequence: executionCount };
      },
    });

    expect(replay).toMatchObject({
      ok: true,
      status: 'completed',
      replayed: true,
      result: { enabled: true, sequence: 1 },
    });
    expect(executionCount).toBe(1);

    vi.restoreAllMocks();
    const mutation = await restarted.executeMutation({
      context: context({ idempotencyKey: 'idem_2', requestFingerprint: 'fingerprint_2' }),
      operationName: 'disableConfiguredServer',
      run: async () => ({ disabled: true }),
    });

    expect(mutation).toMatchObject({ ok: true, status: 'completed', replayed: false });
  });

  it('compacts old state_unknown records after audit retention while retaining recent unresolved records', async () => {
    const service = createService({ auditRetentionMs: 100 });
    await service.executeMutation({
      context: context(),
      operationName: 'enableConfiguredServer',
      run: async () => ({ enabled: true }),
    });
    fs.appendFileSync(
      journalPath(),
      `${JSON.stringify({
        schemaVersion: 1,
        type: 'state_unknown',
        runtimeScopeId: 'scope_a',
        timestamp: '2026-07-06T00:00:00.000Z',
        operationId: 'op_old_unknown',
        operationName: 'disableConfiguredServer',
        scopedKeyHash: 'old_unknown_key_hash',
        fingerprintHash: 'old_unknown_fingerprint_hash',
        target: { type: 'configured_server', id: 'server_old' },
        reservedAt: '2026-07-06T00:00:00.000Z',
      })}\n${JSON.stringify({
        schemaVersion: 1,
        type: 'state_unknown',
        runtimeScopeId: 'scope_a',
        timestamp: currentTime.toISOString(),
        operationId: 'op_recent_unknown',
        operationName: 'disableConfiguredServer',
        scopedKeyHash: 'recent_unknown_key_hash',
        fingerprintHash: 'recent_unknown_fingerprint_hash',
        target: { type: 'configured_server', id: 'server_recent' },
        reservedAt: currentTime.toISOString(),
      })}\n`,
    );

    createService({ auditRetentionMs: 100 });
    const records = readJournalRecords();

    expect(records).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'state_unknown', operationId: 'op_recent_unknown' })]),
    );
    expect(records).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'state_unknown', operationId: 'op_old_unknown' })]),
    );
  });

  it('returns operation_state_unknown instead of mutation_failed when audit persistence fails after run succeeds', async () => {
    const service = createService();
    failJournalWriteOn(3, 'audit write failed');
    let executionCount = 0;

    const result = await service.executeMutation({
      context: context(),
      operationName: 'enableConfiguredServer',
      run: async () => {
        executionCount += 1;
        return { enabled: true };
      },
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'operation_state_unknown',
      code: 'operation_state_unknown',
      retryable: false,
    });
    expect(executionCount).toBe(1);
    expect(readJournalRecords()).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'state_unknown' })]));
    expect(readJournalRecords()).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: 'failed' })]));
  });

  it('fails mutation admission closed and rolls back reservation state when reservation persistence fails', async () => {
    const service = createService();
    failJournalWriteOn(1, 'reservation write failed');
    let executionCount = 0;

    await expect(
      service.executeMutation({
        context: context(),
        operationName: 'enableConfiguredServer',
        run: async () => {
          executionCount += 1;
          return { enabled: true };
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: 'admin_operation_journal_unavailable',
      code: 'admin_operation_journal_unavailable',
      retryable: false,
    });
    expect(executionCount).toBe(0);
  });

  it('keeps read-only operations available but fails mutation admission closed when the journal is corrupt', async () => {
    const service = createService();
    await service.executeMutation({
      context: context(),
      operationName: 'enableConfiguredServer',
      run: async () => ({ enabled: true }),
    });
    fs.appendFileSync(journalPath(), 'not-json\n');

    let executionCount = 0;
    const restarted = createService();
    const readOnly = await restarted.executeReadOnly({
      context: context({ idempotencyKey: undefined, requestFingerprint: undefined }),
      operationName: 'inspectConfiguredServers',
      run: async () => ({ count: 1 }),
    });
    const mutation = await restarted.executeMutation({
      context: context({ idempotencyKey: 'idem_2', requestFingerprint: 'fingerprint_2' }),
      operationName: 'disableConfiguredServer',
      run: async () => {
        executionCount += 1;
        return { disabled: true };
      },
    });

    expect(readOnly).toMatchObject({ ok: true, result: { count: 1 } });
    expect(mutation).toMatchObject({
      ok: false,
      status: 'admin_operation_journal_unavailable',
      code: 'admin_operation_journal_unavailable',
      retryable: false,
    });
    expect(executionCount).toBe(0);
  });

  it('dry-runs with mutation admission checks but without idempotency or journal writes', async () => {
    const service = createService();
    let executionCount = 0;

    const mismatch = await service.executeDryRun({
      context: context({
        runtimeIdentity: { runtimeScopeId: 'scope_b', runtimeVersion: '0.34.0' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      operationName: 'enableConfiguredServer',
      run: async () => {
        executionCount += 1;
        return { mode: 'dry_run' };
      },
    });
    const failedPreview = await service.executeDryRun({
      context: context({ idempotencyKey: undefined, requestFingerprint: undefined }),
      operationName: 'enableConfiguredServer',
      run: async () => {
        executionCount += 1;
        throw new Error('planned config validation failed');
      },
    });

    expect(mismatch).toMatchObject({
      ok: false,
      status: 'runtime_scope_mismatch',
      code: 'runtime_scope_mismatch',
    });
    expect(failedPreview).toMatchObject({
      ok: false,
      status: 'mutation_failed',
      code: 'mutation_failed',
      error: 'planned config validation failed',
    });
    expect(executionCount).toBe(1);
    expect(fs.existsSync(journalPath())).toBe(false);
  });

  it('rejects mutation contexts whose runtime identity does not match the service Runtime Scope', async () => {
    const service = createService();
    let executionCount = 0;

    const result = await service.executeMutation({
      context: context({ runtimeIdentity: { runtimeScopeId: 'scope_b', runtimeVersion: '0.34.0' } }),
      operationName: 'enableConfiguredServer',
      run: async () => {
        executionCount += 1;
        return { enabled: true };
      },
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'runtime_scope_mismatch',
      code: 'runtime_scope_mismatch',
      retryable: false,
      operationName: 'enableConfiguredServer',
    });
    expect(executionCount).toBe(0);
    expect(fs.existsSync(journalPath())).toBe(false);
  });

  function journalPath(): string {
    const adminDir = path.join(storageDir, 'admin');
    if (!fs.existsSync(adminDir)) {
      return path.join(adminDir, 'missing.jsonl');
    }
    const entries = fs.readdirSync(adminDir).filter((entry) => entry.endsWith('.jsonl'));
    expect(entries.join('\n')).not.toContain('scope_a');
    return path.join(adminDir, entries[0]);
  }

  function readJournalRecords(): Array<Record<string, unknown>> {
    const filePath = journalPath();
    expect((fs.statSync(filePath).mode & 0o777).toString(8)).toBe('600');
    return fs
      .readFileSync(filePath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  function failJournalWriteOn(writeAttempt: number, message: string): void {
    let writeCount = 0;
    const originalWriteSync = fs.writeSync;
    vi.spyOn(fs, 'writeSync').mockImplementation(((...args: Parameters<typeof fs.writeSync>) => {
      writeCount += 1;
      if (writeCount === writeAttempt) {
        throw new Error(message);
      }
      return Reflect.apply(originalWriteSync, fs, args) as number;
    }) as typeof fs.writeSync);
  }
});

async function waitUntil(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 1000) {
      throw new Error('Timed out waiting for predicate');
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
