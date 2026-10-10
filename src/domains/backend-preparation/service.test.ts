import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PreparationAdapterRegistry } from './adapterRegistry.js';
import type { BackendPolicy, BackendPreparationAdapter, BackendReadiness, PreparationTarget } from './contracts.js';
import { BackendPolicySchema, PreparationOptionsSchema } from './policy.js';
import { BackendPreparationService } from './service.js';

const target: PreparationTarget = {
  checkoutRoot: '/canonical/worktree',
  backendName: 'graph',
  backendIdentity: 'graph-v1',
  configurationKey: 'config-a',
};
const policy: BackendPolicy = { allowedActions: ['initialize', 'sync'] };
const ready: Extract<BackendReadiness, { state: 'ready' }> = {
  state: 'ready',
  evidence: { freshness: 'current', coverage: 'complete', detail: 'Native target-specific proof' },
};
const required: BackendReadiness = {
  state: 'required',
  action: 'initialize',
  evidence: { freshness: 'unknown', coverage: 'unknown', detail: 'Missing index' },
  instructions: 'Initialize the selected checkout.',
};

class FakeAdapter implements BackendPreparationAdapter {
  reconcile?: BackendPreparationAdapter['reconcile'];
  readiness = new Map<string, BackendReadiness>();
  calls: { target: PreparationTarget; signal: AbortSignal; finish: () => void; fail: (error: unknown) => void }[] = [];
  failures: unknown[] = [];
  inspections = 0;
  cooperate = true;
  key(selected: PreparationTarget): string {
    return `${selected.checkoutRoot}:${selected.configurationKey}`;
  }
  async inspect(selected: PreparationTarget): Promise<BackendReadiness> {
    this.inspections++;
    return this.readiness.get(this.key(selected)) ?? required;
  }
  async prepare(selected: PreparationTarget, _action: string, { signal }: { signal: AbortSignal }): Promise<void> {
    const failure = this.failures.shift();
    if (failure) throw failure;
    return new Promise<void>((resolve, reject) => {
      this.calls.push({
        target: selected,
        signal,
        finish: () => {
          this.readiness.set(this.key(selected), ready);
          resolve();
        },
        fail: reject,
      });
      signal.addEventListener(
        'abort',
        () => {
          if (this.cooperate) reject(new Error('Aborted owned preparation'));
        },
        { once: true },
      );
    });
  }
  classifyFailure(error: unknown) {
    return {
      code: 'native_failure',
      message: String(error),
      retryable: error === 'transient',
      instructions: 'Fix the native prerequisite, then explicitly retry.',
    };
  }
}

function setup(options: ConstructorParameters<typeof BackendPreparationService>[1] = {}) {
  const adapter = new FakeAdapter();
  const registry = new PreparationAdapterRegistry();
  registry.register('graph', adapter);
  return { adapter, registry, service: new BackendPreparationService(registry, options) };
}

async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

describe('backend preparation lifecycle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('validates bounded runtime options and preserves conservative authorization', () => {
    expect(PreparationOptionsSchema.parse({})).toEqual({
      concurrency: 1,
      queueCapacity: 16,
      requestWaitMs: 5000,
      executionDeadlineMs: 120000,
      maxRecords: 1024,
    });
    expect(() => PreparationOptionsSchema.parse({ concurrency: 0 })).toThrow();
    expect(() => PreparationOptionsSchema.parse({ queueCapacity: -1 })).toThrow();
    expect(() => PreparationOptionsSchema.parse({ requestWaitMs: -1 })).toThrow();
    expect(() => BackendPolicySchema.parse({ allowedActions: ['initialize'], transientRetryLimit: 4 })).toThrow();
  });

  it('inspection, disabled preferences, unsupported and forbidden actions never start work', async () => {
    const { service, adapter } = setup();
    expect(await service.inspect(target, 'symbols')).toEqual(required);
    expect(await service.admit(target, 'symbols', policy, {})).toMatchObject({ state: 'disabled' });
    expect(await service.inspect({ ...target, backendName: 'missing' }, 'symbols')).toMatchObject({
      state: 'unsupported',
    });
    expect(await service.prepare(target, 'symbols', { allowedActions: [] })).toMatchObject({ state: 'forbidden' });
    for (const action of ['rebuild', 'install', 'paid'] as const)
      expect(await service.prepare(target, 'symbols', policy, action)).toMatchObject({ state: 'forbidden' });
    expect(adapter.calls).toHaveLength(0);
  });

  it('deduplicates compatible concurrent callers before queue admission', async () => {
    const { service, adapter } = setup({ queueCapacity: 0 });
    const results = await Promise.all(Array.from({ length: 30 }, () => service.prepare(target, 'symbols', policy)));
    expect(new Set(results.map((result) => (result.state === 'job' ? result.status.id : result.state))).size).toBe(1);
    await flush();
    expect(adapter.calls).toHaveLength(1);
    expect(service.scheduler.counts()).toEqual({ active: 1, queued: 0 });
    adapter.calls[0].finish();
    await flush();
  });

  it('bounds default active and queued work, keeping targets and configurations separate', async () => {
    const { service, adapter } = setup();
    for (let index = 0; index < 17; index++) {
      expect(
        await service.prepare({ ...target, checkoutRoot: `/canonical/${index}` }, 'symbols', policy),
      ).toMatchObject({ state: 'job' });
    }
    expect(service.scheduler.counts()).toEqual({ active: 1, queued: 16 });
    expect(await service.prepare({ ...target, configurationKey: 'different' }, 'symbols', policy)).toMatchObject({
      state: 'busy',
    });
    expect(await service.prepare({ ...target, checkoutRoot: '/canonical/16' }, 'symbols', policy)).toMatchObject({
      state: 'job',
    });
    await flush();
    expect(adapter.calls).toHaveLength(1);
  });

  it('honors higher concurrency while incompatible execution policy remains distinct', async () => {
    const { service, adapter } = setup({ concurrency: 2, queueCapacity: 1 });
    await service.prepare(target, 'symbols', policy);
    await service.prepare(target, 'symbols', { ...policy, executionDeadlineMs: 130000 });
    await service.prepare({ ...target, configurationKey: 'config-b' }, 'symbols', policy);
    await flush();
    expect(adapter.calls).toHaveLength(2);
    expect(service.scheduler.counts()).toEqual({ active: 2, queued: 1 });
  });

  it('returns truthful pending within the wait budget without executing or replaying the original operation', async () => {
    const { service, adapter } = setup();
    let operations = 0;
    const admission = service.admit(target, 'symbols', policy, { graph: { enabled: true } });
    await flush();
    await vi.advanceTimersByTimeAsync(4999);
    let completed = false;
    void admission.then(() => {
      completed = true;
    });
    await flush();
    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await admission;
    expect(result).toMatchObject({ state: 'pending', operationExecuted: false, operationQueued: false });
    expect(operations).toBe(0);
    adapter.calls[0].finish();
    await flush();
    expect(operations).toBe(0);
    if ((await service.admit(target, 'symbols', policy, {})).state === 'ready') operations++;
    expect(operations).toBe(1);
  });

  it('wait timeout and disconnect only detach the caller, leaving shared work intact', async () => {
    const { service, adapter } = setup();
    const result = await service.prepare(target, 'symbols', policy);
    if (result.state !== 'job') throw new Error('Expected job');
    await flush();
    const caller = new AbortController();
    const disconnected = service.wait(result.status.id, { waitMs: 1000, signal: caller.signal });
    const waiting = service.wait(result.status.id, { waitMs: 1000 });
    caller.abort();
    expect(await disconnected).toMatchObject({ state: 'running' });
    expect(adapter.calls[0].signal.aborted).toBe(false);
    adapter.calls[0].finish();
    expect(await waiting).toMatchObject({ state: 'ready' });
  });

  it('cancels queued work without touching the active target', async () => {
    const { service, adapter } = setup();
    await service.prepare(target, 'symbols', policy);
    const queued = await service.prepare({ ...target, checkoutRoot: '/canonical/queued' }, 'symbols', policy);
    if (queued.state !== 'job') throw new Error('Expected job');
    expect(service.cancel(queued.status.id)).toMatchObject({ state: 'cancelled' });
    await flush();
    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0].signal.aborted).toBe(false);
    adapter.calls[0].finish();
    await flush();
    expect(adapter.calls).toHaveLength(1);
  });

  it('retains a running cancellation slot until the adapter has stopped owned work', async () => {
    const { service, adapter } = setup();
    adapter.cooperate = false;
    const active = await service.prepare(target, 'symbols', policy);
    await service.prepare({ ...target, checkoutRoot: '/canonical/queued' }, 'symbols', policy);
    if (active.state !== 'job') throw new Error('Expected job');
    await flush();
    expect(service.cancel(active.status.id)).toMatchObject({ state: 'cancelling' });
    await flush();
    expect(service.scheduler.counts()).toEqual({ active: 1, queued: 1 });
    adapter.calls[0].fail(new Error('Stopped'));
    await flush();
    expect(service.status(active.status.id)).toMatchObject({ state: 'cancelled' });
    expect(adapter.calls).toHaveLength(2);
  });

  it('separates queue time from execution deadline and requires a larger explicit retry budget', async () => {
    const { service, adapter } = setup({ executionDeadlineMs: 100 });
    const active = await service.prepare(target, 'symbols', policy);
    const queued = await service.prepare({ ...target, checkoutRoot: '/canonical/queued' }, 'symbols', policy);
    if (active.state !== 'job' || queued.state !== 'job') throw new Error('Expected jobs');
    await flush();
    await vi.advanceTimersByTimeAsync(90);
    adapter.calls[0].finish();
    await flush();
    await vi.advanceTimersByTimeAsync(90);
    expect(service.status(queued.status.id)).toMatchObject({ state: 'running' });
    await vi.advanceTimersByTimeAsync(10);
    expect(service.status(queued.status.id)).toMatchObject({
      state: 'failed',
      failure: { code: 'execution_deadline', retryable: false },
    });
    expect(await service.retry(queued.status.id)).toMatchObject({ state: 'forbidden' });
    expect(await service.prepare({ ...target, checkoutRoot: '/canonical/queued' }, 'symbols', policy)).toMatchObject({
      state: 'job',
      status: { id: queued.status.id, state: 'failed' },
    });
    expect(await service.retry(queued.status.id, { ...policy, executionDeadlineMs: 200 })).toMatchObject({
      state: 'job',
      status: { executionDeadlineMs: 200 },
    });
  });

  it('keeps failures stable, bounds adapter-classified retries, and permits explicit retry', async () => {
    const { service, adapter } = setup();
    adapter.failures = ['transient', 'transient', 'transient'];
    const result = await service.prepare(target, 'symbols', { ...policy, transientRetryLimit: 2 });
    if (result.state !== 'job') throw new Error('Expected job');
    await flush();
    expect(service.status(result.status.id)).toMatchObject({ state: 'failed', attempt: 3 });
    for (let index = 0; index < 5; index++) {
      expect(await service.prepare(target, 'symbols', { ...policy, transientRetryLimit: 2 })).toMatchObject({
        state: 'job',
        status: { id: result.status.id, attempt: 3 },
      });
    }
    expect(adapter.calls).toHaveLength(0);
    expect(await service.retry(result.status.id)).toMatchObject({ state: 'job' });
    await flush();
    expect(adapter.calls).toHaveLength(1);
  });

  it('does not automatically retry permanent failure and verified readiness resolves it', async () => {
    const { service, adapter } = setup();
    adapter.failures = ['missing_binary'];
    const result = await service.prepare(target, 'symbols', { ...policy, transientRetryLimit: 3 });
    if (result.state !== 'job') throw new Error('Expected job');
    await flush();
    expect(service.status(result.status.id)).toMatchObject({ state: 'failed', attempt: 1 });
    adapter.readiness.set(adapter.key(target), ready);
    expect(await service.admit(target, 'symbols', policy, {})).toMatchObject({ state: 'ready' });
  });

  it('keeps unrelated ready targets responsive during preparation and avoids warm indexing', async () => {
    const { service, adapter } = setup();
    const unrelated = { ...target, checkoutRoot: '/canonical/ready' };
    adapter.readiness.set(adapter.key(unrelated), ready);
    await service.prepare(target, 'symbols', policy);
    await flush();
    for (let index = 0; index < 20; index++)
      expect(await service.admit(unrelated, 'symbols', policy, {})).toMatchObject({ state: 'ready' });
    expect(adapter.calls).toHaveLength(1);
  });

  it('rechecks operation-specific coverage after a shared job completes', async () => {
    const { service, adapter } = setup();
    const inspection = adapter.inspect.bind(adapter);
    adapter.inspect = async (selected, operation?: string) =>
      operation === 'full-coverage' ? { ...required, action: 'rebuild' } : inspection(selected);
    const result = await service.prepare(target, 'symbols', policy);
    if (result.state !== 'job') throw new Error('Expected job');
    await flush();
    adapter.calls[0].finish();
    await flush();
    expect(await service.admit(target, 'full-coverage', policy, { graph: { enabled: true } })).toMatchObject({
      state: 'forbidden',
    });
  });

  it('recovery never trusts persisted status to cancel, resume, or break a foreign lock', async () => {
    const { service, registry, adapter } = setup();
    expect(
      await service.recover(target, 'symbols', { previousJobId: 'foreign', previousState: 'running' }),
    ).toMatchObject({ state: 'conflict' });
    const reconcile = vi.fn(async () => ({
      state: 'conflict' as const,
      instructions: 'Foreign native writer owns this checkout.',
    }));
    registry.register('native-lock', {
      ...adapter,
      inspect: adapter.inspect.bind(adapter),
      prepare: adapter.prepare.bind(adapter),
      classifyFailure: adapter.classifyFailure.bind(adapter),
      reconcile,
    });
    expect(
      await service.recover({ ...target, backendName: 'native-lock' }, 'symbols', {
        previousJobId: 'foreign',
        previousState: 'running',
      }),
    ).toMatchObject({ state: 'conflict' });
    expect(reconcile).toHaveBeenCalledOnce();
    expect(adapter.calls).toHaveLength(0);
  });

  it('bounds terminal records without evicting a stable failure', async () => {
    const { service, adapter } = setup({ maxRecords: 1 });
    adapter.failures = ['missing_binary'];
    const result = await service.prepare(target, 'symbols', policy);
    await flush();
    expect(await service.prepare({ ...target, checkoutRoot: '/canonical/other' }, 'symbols', policy)).toMatchObject({
      state: 'busy',
    });
    expect(await service.prepare(target, 'symbols', policy)).toEqual(
      result.state === 'job' ? { state: 'job', status: service.status(result.status.id) } : result,
    );
  });

  it('joins active work before inspecting a native writer conflict', async () => {
    const { service, adapter } = setup();
    const first = await service.prepare(target, 'symbols', policy);
    await flush();
    adapter.readiness.set(adapter.key(target), { state: 'conflict', instructions: 'Own writer active' });
    const probes = adapter.inspections;
    expect(await service.prepare(target, 'symbols', policy)).toMatchObject({ state: 'job' });
    const request = service.admit(target, 'symbols', policy, { graph: { enabled: true } }, { waitMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    expect(await request).toMatchObject({ state: 'pending' });
    expect(adapter.inspections).toBe(probes);
    expect(adapter.calls).toHaveLength(1);
    expect(first.state).toBe('job');
  });

  it('starts a new incremental job when a previously successful sync becomes stale', async () => {
    const { service, adapter } = setup();
    adapter.readiness.set(adapter.key(target), { ...required, action: 'sync' });
    const first = await service.prepare(target, 'symbols', policy);
    await flush();
    adapter.calls[0].finish();
    await flush();
    adapter.readiness.set(adapter.key(target), { ...required, action: 'sync' });
    const second = await service.prepare(target, 'symbols', policy);
    expect(second.state).toBe('job');
    if (first.state !== 'job' || second.state !== 'job') throw new Error('Expected jobs');
    expect(first.status.id).not.toBe(second.status.id);
    await flush();
    expect(adapter.calls).toHaveLength(2);
  });

  it('bounds slow readiness probes within the caller budget without starting work', async () => {
    const { service, adapter } = setup();
    adapter.inspect = () => new Promise(() => {});
    const admission = service.admit(target, 'symbols', policy, { graph: { enabled: true } }, { waitMs: 20 });
    await vi.advanceTimersByTimeAsync(20);
    expect(await admission).toMatchObject({
      state: 'conflict',
      instructions: expect.stringContaining('no backend operation executed'),
    });
    expect(adapter.calls).toHaveLength(0);
  });

  it('charges readiness probe time against the same request waiting budget', async () => {
    const { service, adapter } = setup();
    adapter.inspect = () => new Promise((resolve) => setTimeout(() => resolve(required), 15));
    const admission = service.admit(target, 'symbols', policy, { graph: { enabled: true } }, { waitMs: 20 });
    await vi.advanceTimersByTimeAsync(20);
    expect(await admission).toMatchObject({ state: 'pending', operationExecuted: false, operationQueued: false });
    expect(adapter.calls).toHaveLength(1);
  });

  it('permits explicit retry at bounded record capacity and recycles completed successes', async () => {
    const { service, adapter } = setup({ maxRecords: 1 });
    adapter.failures = ['missing_binary'];
    const first = await service.prepare(target, 'symbols', policy);
    if (first.state !== 'job') throw new Error('Expected job');
    await flush();
    expect(await service.retry(first.status.id)).toMatchObject({ state: 'job' });
    await flush();
    adapter.calls[0].finish();
    await flush();
    expect(await service.prepare({ ...target, checkoutRoot: '/canonical/other' }, 'symbols', policy)).toMatchObject({
      state: 'job',
    });
  });

  it('keeps an automatic failure stable even when interrupted native state suggests another action', async () => {
    const { service, adapter } = setup();
    adapter.failures = ['interrupted'];
    const first = await service.prepare(target, 'symbols', policy);
    await flush();
    adapter.readiness.set(adapter.key(target), { ...required, action: 'sync' });
    const second = await service.prepare(target, 'symbols', policy);
    if (first.state !== 'job' || second.state !== 'job') throw new Error('Expected jobs');
    expect(second.status.id).toBe(first.status.id);
    expect(second.status.state).toBe('failed');
    expect(adapter.calls).toHaveLength(0);
  });

  it('bounds verification after preparation within the execution deadline', async () => {
    const { service, adapter } = setup({ executionDeadlineMs: 20 });
    const first = await service.prepare(target, 'symbols', policy);
    if (first.state !== 'job') throw new Error('Expected job');
    await flush();
    adapter.inspect = () => new Promise(() => {});
    adapter.calls[0].finish();
    await flush();
    await vi.advanceTimersByTimeAsync(20);
    expect(service.status(first.status.id)).toMatchObject({ state: 'failed', failure: { code: 'execution_deadline' } });
    expect(service.scheduler.counts()).toEqual({ active: 0, queued: 0 });
  });

  it('retains retry capacity reservation across a delayed conflicting probe', async () => {
    const { service, adapter } = setup({ maxRecords: 1 });
    adapter.failures = ['missing_binary'];
    const first = await service.prepare(target, 'symbols', policy);
    if (first.state !== 'job') throw new Error('Expected job');
    await flush();
    let resolveRetry!: (readiness: BackendReadiness) => void;
    adapter.inspect = async (selected) =>
      selected.checkoutRoot === target.checkoutRoot
        ? new Promise((resolve) => {
            resolveRetry = resolve;
          })
        : required;
    const retry = service.retry(first.status.id);
    expect(await service.prepare({ ...target, checkoutRoot: '/canonical/other' }, 'symbols', policy)).toMatchObject({
      state: 'busy',
    });
    resolveRetry({ state: 'conflict', instructions: 'Foreign writer' });
    expect(await retry).toMatchObject({ state: 'conflict' });
    expect(service.status(first.status.id)).toMatchObject({ state: 'failed' });
    expect(await service.prepare({ ...target, checkoutRoot: '/canonical/third' }, 'symbols', policy)).toMatchObject({
      state: 'busy',
    });
  });

  it('does not overwrite a compatible live identity admitted while retry inspection waits', async () => {
    const { service, adapter } = setup({ maxRecords: 2 });
    adapter.failures = ['missing_binary'];
    const first = await service.prepare(target, 'symbols', policy);
    if (first.state !== 'job') throw new Error('Expected job');
    await flush();
    const larger = { ...policy, executionDeadlineMs: 130000 };
    let resolveRetry!: (readiness: BackendReadiness) => void;
    let inspection = 0;
    adapter.inspect = async () =>
      ++inspection === 1
        ? new Promise((resolve) => {
            resolveRetry = resolve;
          })
        : required;
    const retry = service.retry(first.status.id, larger);
    const concurrent = await service.prepare(target, 'symbols', larger);
    if (concurrent.state !== 'job') throw new Error('Expected job');
    await flush();
    resolveRetry({ state: 'conflict', instructions: 'Own writer now active' });
    expect(await retry).toMatchObject({ state: 'job', status: { id: concurrent.status.id } });
    expect(await service.prepare(target, 'symbols', larger)).toMatchObject({
      state: 'job',
      status: { id: concurrent.status.id },
    });
    adapter.calls[0].fail(new Error('Stable second failure'));
    await flush();
    expect(await service.prepare(target, 'symbols', larger)).toMatchObject({
      state: 'job',
      status: { id: concurrent.status.id, state: 'failed' },
    });
  });

  it('joins owned work after a racing initial readiness probe reports writer conflict', async () => {
    for (const entrypoint of ['prepare', 'admit'] as const) {
      const { service, adapter } = setup();
      const resolutions: ((readiness: BackendReadiness) => void)[] = [];
      adapter.inspect = () => new Promise((resolve) => resolutions.push(resolve));
      const first = service.prepare(target, 'symbols', policy);
      const second =
        entrypoint === 'prepare'
          ? service.prepare(target, 'symbols', policy)
          : service.admit(target, 'symbols', policy, { graph: { enabled: true } }, { waitMs: 5 });
      resolutions[0](required);
      const admitted = await first;
      if (admitted.state !== 'job') throw new Error('Expected job');
      await flush();
      resolutions[1]({ state: 'conflict', instructions: 'Own writer' });
      await vi.advanceTimersByTimeAsync(5);
      expect(await second).toMatchObject(
        entrypoint === 'prepare'
          ? { state: 'job', status: { id: admitted.status.id } }
          : { state: 'pending', status: { id: admitted.status.id } },
      );
      expect(adapter.calls).toHaveLength(1);
    }
  });

  it('returns the current operation forbidden action after joining a different ready operation', async () => {
    const { service, adapter } = setup();
    const nativeInspect = adapter.inspect.bind(adapter);
    adapter.inspect = async (selected, operation?: string) =>
      operation === 'full-coverage' ? { ...required, action: 'rebuild' } : nativeInspect(selected);
    await service.prepare(target, 'symbols', policy);
    await flush();
    const admission = service.admit(target, 'full-coverage', policy, { graph: { enabled: true } });
    adapter.calls[0].finish();
    expect(await admission).toMatchObject({ state: 'forbidden', instructions: expect.stringContaining('rebuild') });
  });

  it('creates permitted operation-specific preparation after a shared job proves insufficient coverage', async () => {
    const { service, adapter } = setup();
    const authority: BackendPolicy = { allowedActions: ['initialize', 'rebuild'] };
    const nativeInspect = adapter.inspect.bind(adapter);
    adapter.inspect = async (selected, operation?: string) =>
      operation === 'full-coverage' ? { ...required, action: 'rebuild' } : nativeInspect(selected);
    const first = await service.prepare(target, 'symbols', authority);
    await flush();
    const admission = service.admit(target, 'full-coverage', authority, { graph: { enabled: true } });
    adapter.calls[0].finish();
    const second = await admission;
    expect(second).toMatchObject({
      state: 'job',
      status: { operation: 'full-coverage', action: 'rebuild', state: 'queued' },
    });
    if (first.state !== 'job' || second.state !== 'job') throw new Error('Expected jobs');
    expect(second.status.id).not.toBe(first.status.id);
  });

  it('shutdown cancels queued work and awaits owned settlement even after deadline failure', async () => {
    const { service, adapter } = setup({ executionDeadlineMs: 10 });
    adapter.cooperate = false;
    const first = await service.prepare(target, 'symbols', policy);
    const queued = await service.prepare({ ...target, checkoutRoot: '/canonical/queued' }, 'symbols', policy);
    if (first.state !== 'job' || queued.state !== 'job') throw new Error('Expected jobs');
    await flush();
    await vi.advanceTimersByTimeAsync(10);
    expect(service.status(first.status.id)).toMatchObject({ state: 'failed' });
    let stopped = false;
    const shutdown = service.shutdown().then(() => {
      stopped = true;
    });
    await flush();
    expect(stopped).toBe(false);
    expect(service.status(queued.status.id)).toMatchObject({ state: 'cancelled' });
    expect(adapter.calls).toHaveLength(1);
    expect(await service.prepare(target, 'symbols', policy)).toMatchObject({ state: 'busy' });
    adapter.calls[0].fail(new Error('Owned work fully stopped'));
    await shutdown;
    expect(stopped).toBe(true);
    await service.shutdown();
  });

  it('restores only validated stable failures without ownership or automatic retry authority', async () => {
    const { service, adapter } = setup({ maxRecords: 1 });
    const diagnostic = {
      code: 'execution_deadline',
      message: 'Expired before restart',
      retryable: false,
      instructions: 'Explicit larger budget required',
    };
    const restored = service.importFailure(target, 'symbols', policy, 'initialize', diagnostic);
    expect(restored).toMatchObject({ state: 'failed', executionDeadlineMs: 120000 });
    if (!restored) throw new Error('Expected restored failure');
    expect(await service.prepare(target, 'symbols', policy)).toMatchObject({
      state: 'job',
      status: { id: restored.id, state: 'failed' },
    });
    expect(await service.retry(restored.id)).toMatchObject({ state: 'forbidden' });
    expect(
      service.importFailure(
        { ...target, checkoutRoot: '/canonical/other' },
        'symbols',
        policy,
        'initialize',
        diagnostic,
      ),
    ).toBeUndefined();
    expect(() => service.importFailure(target, 'symbols', policy, 'initialize', { ...diagnostic, code: '' })).toThrow();
    expect(adapter.calls).toHaveLength(0);
    await service.shutdown();
  });

  it('does not start automatic follow-up preparation for a disabled caller joining explicit work', async () => {
    const { service, adapter } = setup();
    const authority: BackendPolicy = { allowedActions: ['initialize', 'rebuild'] };
    const nativeInspect = adapter.inspect.bind(adapter);
    adapter.inspect = async (selected, operation?: string) =>
      operation === 'full-coverage' ? { ...required, action: 'rebuild' } : nativeInspect(selected);
    await service.prepare(target, 'symbols', authority);
    await flush();
    const admission = service.admit(target, 'full-coverage', authority, {});
    adapter.calls[0].finish();
    expect(await admission).toMatchObject({ state: 'disabled' });
    await flush();
    expect(adapter.calls).toHaveLength(1);
    expect(service.scheduler.counts()).toEqual({ active: 0, queued: 0 });
  });

  it('preserves the original failure identity when an explicit retry cannot enter the scheduler', async () => {
    const { service, adapter } = setup({ queueCapacity: 0 });
    adapter.failures = ['missing_binary'];
    const original = await service.prepare(target, 'symbols', policy);
    if (original.state !== 'job') throw new Error('Expected job');
    await flush();
    expect(service.status(original.status.id)).toMatchObject({ state: 'failed' });
    await service.prepare({ ...target, checkoutRoot: '/canonical/other' }, 'symbols', policy);
    await flush();
    expect(await service.retry(original.status.id)).toMatchObject({ state: 'busy' });
    adapter.calls[0].finish();
    await flush();
    expect(await service.prepare(target, 'symbols', policy)).toMatchObject({
      state: 'job',
      status: { id: original.status.id, state: 'failed' },
    });
    expect(adapter.calls).toHaveLength(1);
  });

  it('bounds native recovery probing and forwards the owned probe abort signal', async () => {
    const { service, adapter } = setup();
    let probeSignal: AbortSignal | undefined;
    adapter.reconcile = (_selected, _operation, _advisory, options) => {
      probeSignal = options?.signal;
      return new Promise(() => {});
    };
    const recovery = service.recover(
      target,
      'symbols',
      { previousJobId: 'saved-foreign-pid', previousState: 'running' },
      { waitMs: 20 },
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(await recovery).toMatchObject({ state: 'conflict' });
    expect(probeSignal?.aborted).toBe(true);
    expect(adapter.calls).toHaveLength(0);
  });

  it('uses the default request budget for recovery instead of waiting indefinitely', async () => {
    const { service, adapter } = setup();
    adapter.reconcile = () => new Promise(() => {});
    const recovery = service.recover(target, 'symbols', { previousJobId: 'advisory', previousState: 'failed' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await recovery).toMatchObject({ state: 'conflict' });
    expect(adapter.calls).toHaveLength(0);
  });

  it('aborts a disconnected recovery probe without cancelling shared preparation', async () => {
    const { service, adapter } = setup();
    await service.prepare(target, 'symbols', policy);
    await flush();
    let probeSignal: AbortSignal | undefined;
    adapter.reconcile = (_selected, _operation, _advisory, options) => {
      probeSignal = options?.signal;
      return new Promise(() => {});
    };
    const caller = new AbortController();
    const recovery = service.recover(
      target,
      'symbols',
      { previousJobId: 'foreign', previousState: 'running' },
      { signal: caller.signal },
    );
    caller.abort();
    expect(await recovery).toMatchObject({ state: 'conflict' });
    expect(probeSignal?.aborted).toBe(true);
    expect(adapter.calls[0].signal.aborted).toBe(false);
    adapter.calls[0].finish();
    await service.shutdown();
  });

  it('recycles a resolved failure only after current native readiness proves the same operation ready', async () => {
    const { service, adapter } = setup({ maxRecords: 1 });
    adapter.failures = ['missing_binary'];
    const failed = await service.prepare(target, 'symbols', policy);
    if (failed.state !== 'job') throw new Error('Expected job');
    await flush();
    adapter.readiness.set(adapter.key(target), ready);
    expect(await service.admit(target, 'symbols', policy, {})).toMatchObject({ state: 'ready' });
    expect(service.status(failed.status.id)).toBeUndefined();
    expect(await service.prepare({ ...target, checkoutRoot: '/canonical/new' }, 'symbols', policy)).toMatchObject({
      state: 'job',
    });
  });

  it('preserves failed records for other operations, identities, and execution policies', async () => {
    const { service, adapter } = setup({ maxRecords: 2 });
    adapter.failures = ['missing_binary', 'missing_binary'];
    const first = await service.prepare(target, 'symbols', policy);
    await flush();
    const different = { ...policy, executionDeadlineMs: 130000 };
    const second = await service.prepare(target, 'full-coverage', different);
    if (first.state !== 'job' || second.state !== 'job') throw new Error('Expected jobs');
    await flush();
    expect(service.clearResolvedFailure(target, 'full-coverage', policy, ready)).toBe(0);
    expect(service.clearResolvedFailure({ ...target, configurationKey: 'other' }, 'symbols', policy, ready)).toBe(0);
    expect(service.clearResolvedFailure(target, 'symbols', different, ready)).toBe(0);
    expect(service.clearResolvedFailure(target, 'symbols', policy, ready)).toBe(1);
    expect(service.status(first.status.id)).toBeUndefined();
    expect(service.status(second.status.id)).toMatchObject({ state: 'failed' });
  });

  it('never discards a failed job while its owned preparation is still stopping', async () => {
    const { service, adapter } = setup({ executionDeadlineMs: 10 });
    adapter.cooperate = false;
    const result = await service.prepare(target, 'symbols', policy);
    if (result.state !== 'job') throw new Error('Expected job');
    await flush();
    await vi.advanceTimersByTimeAsync(10);
    expect(service.clearResolvedFailure(target, 'symbols', policy, ready)).toBe(0);
    expect(service.status(result.status.id)).toMatchObject({ state: 'failed' });
    adapter.calls[0].finish();
    await flush();
    expect(service.clearResolvedFailure(target, 'symbols', policy, ready)).toBe(1);
  });
});
