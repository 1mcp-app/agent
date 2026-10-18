import { describe, expect, it } from 'vitest';

import { PreparationAdapterRegistry } from './adapterRegistry.js';
import type { BackendPreparationAdapter, BackendReadiness, PreparationTarget } from './contracts.js';
import { BackendPreparationService } from './service.js';

const target: PreparationTarget = {
  checkoutRoot: '/checkout',
  backendName: 'fixture',
  backendIdentity: 'instance',
  configurationKey: 'config',
};
const required: BackendReadiness = {
  state: 'required',
  action: 'initialize',
  instructions: 'Initialize.',
  evidence: { freshness: 'unknown', coverage: 'unknown', detail: 'Missing.' },
};
const ready: BackendReadiness = {
  state: 'ready',
  evidence: { freshness: 'current', coverage: 'complete', detail: 'Verified.' },
};
const failure = (error: unknown) => ({
  code: 'fixture',
  message: String(error),
  retryable: false,
  instructions: 'Inspect fixture.',
});
function service(adapter: BackendPreparationAdapter) {
  const registry = new PreparationAdapterRegistry();
  registry.register('fixture', adapter);
  return new BackendPreparationService(registry);
}
describe('configured preparation jobs', () => {
  it.each(['failed', 'cancelled', 'execution_deadline'] as const)(
    'explicit retry admits a newly required action after %s while preserving the terminal record',
    async (outcome) => {
      const calls: string[] = [];
      let started!: () => void;
      const running = new Promise<void>((resolve) => (started = resolve));
      const jobs = service({
        inspect: async () => {
          if (calls.length === 0) return required;
          return calls.includes('sync') ? ready : { ...required, action: 'sync' };
        },
        prepare: async (_target, action, options) => {
          calls.push(action);
          if (action === 'sync') return;
          started();
          if (outcome === 'failed') throw new Error('Terminal command failure');
          await new Promise<void>((resolve) =>
            options.signal.addEventListener('abort', () => resolve(), { once: true }),
          );
        },
        classifyFailure: failure,
      });
      const policy = { allowedActions: ['initialize', 'sync'] as const, executionDeadlineMs: 50 };
      const first = await jobs.prepare(target, 'symbols', { ...policy, allowedActions: [...policy.allowedActions] });
      if (first.state !== 'job') throw new Error('Expected first job');
      await running;
      if (outcome === 'cancelled') jobs.cancel(first.status.id);
      const terminal = await jobs.wait(first.status.id);
      // A deadline reports its terminal state before the owned adapter settles.
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(terminal?.state).toBe(outcome === 'cancelled' ? 'cancelled' : 'failed');
      if (outcome === 'execution_deadline') {
        expect(await jobs.retry(first.status.id, { allowedActions: ['sync'], executionDeadlineMs: 50 })).toMatchObject({
          state: 'forbidden',
          instructions: expect.stringContaining('larger execution budget'),
        });
      }
      expect(
        await jobs.retry(first.status.id, { allowedActions: ['initialize'], executionDeadlineMs: 100 }),
      ).toMatchObject({
        state: 'forbidden',
        instructions: expect.stringContaining('sync'),
      });
      const next = await jobs.retry(first.status.id, { allowedActions: ['sync'], executionDeadlineMs: 100 });
      if (next.state !== 'job') throw new Error(`Expected new sync job, received ${next.state}`);
      expect(next.status.id).not.toBe(first.status.id);
      expect(await jobs.wait(next.status.id)).toMatchObject({ state: 'ready', action: 'sync' });
      expect(jobs.status(first.status.id)).toEqual(terminal);
      expect(calls).toEqual(['initialize', 'sync']);
      await jobs.shutdown();
    },
  );
  it('returns pending job immediately even when the action completes before admission returns', async () => {
    let completed = false;
    const jobs = service({
      inspect: async () => (completed ? ready : required),
      prepare: async () => {
        completed = true;
      },
      classifyFailure: failure,
    });
    const result = await jobs.admit(
      target,
      'symbols',
      { allowedActions: ['initialize'] },
      { fixture: { enabled: true } },
    );
    expect(result).toMatchObject({
      state: 'pending',
      operationExecuted: false,
      operationQueued: false,
      status: { id: expect.any(String) },
    });
    await jobs.shutdown();
  });
  it('completes one action as not ready when a fresh postprobe requires another action, retaining that terminal result', async () => {
    let calls = 0;
    const jobs = service({
      inspect: async () => (calls ? { ...required, action: 'sync' } : required),
      prepare: async () => {
        calls++;
      },
      classifyFailure: failure,
    });
    const result = await jobs.prepare(target, 'symbols', { allowedActions: ['initialize', 'sync'] });
    if (result.state !== 'job') throw new Error('Expected job');
    expect(await jobs.wait(result.status.id)).toMatchObject({
      state: 'not_ready',
      readiness: { state: 'required', action: 'sync' },
      failure: { code: 'further_action_required' },
    });
    expect(await jobs.prepare(target, 'symbols', { allowedActions: ['initialize', 'sync'] })).toMatchObject({
      state: 'job',
      status: { id: result.status.id, state: 'not_ready' },
    });
    expect(calls).toBe(1);
    expect(
      await jobs.admit(target, 'symbols', { allowedActions: ['initialize', 'sync'] }, { fixture: { enabled: true } }),
    ).toMatchObject({ state: 'job', status: { id: result.status.id, state: 'not_ready' } });
    await jobs.shutdown();
  });
  it('keeps readiness and job identity specific to each requested operation', async () => {
    const jobs = service({ inspect: async () => required, prepare: async () => {}, classifyFailure: failure });
    const first = await jobs.prepare(target, 'symbols', { allowedActions: ['initialize'] });
    if (first.state !== 'job') throw new Error('Expected job');
    await jobs.wait(first.status.id);
    const second = await jobs.prepare(target, 'references', { allowedActions: ['initialize'] });
    if (second.state !== 'job') throw new Error('Expected job');
    expect(second.status.id).not.toBe(first.status.id);
    expect(second.status.operation).toBe('references');
    await jobs.shutdown();
  });
  it('reads explicit progress without launching preparation and exposes job elapsed time', async () => {
    let actions = 0;
    const jobs = service({
      inspect: async () => required,
      prepare: async () => {
        actions++;
      },
      progress: async () => ({ completed: 3, total: 7, unit: 'files' }),
      classifyFailure: failure,
    });
    expect(await jobs.inspectProgress(target, 'symbols')).toEqual({ completed: 3, total: 7, unit: 'files' });
    expect(actions).toBe(0);
    const result = await jobs.prepare(target, 'symbols', { allowedActions: ['initialize'] });
    if (result.state !== 'job') throw new Error('Expected job');
    expect(await jobs.wait(result.status.id)).toMatchObject({ elapsedMs: expect.any(Number) });
    await jobs.shutdown();
  });
  it('explicit retry admits one newly required authorized action and retains the previous not-ready job', async () => {
    const calls: string[] = [];
    const jobs = service({
      inspect: async () => {
        if (calls.length === 0) return required;
        if (calls.length === 1) return { ...required, action: 'sync' };
        return ready;
      },
      prepare: async (_target, action) => {
        calls.push(action);
      },
      classifyFailure: failure,
    });
    const first = await jobs.prepare(target, 'symbols', { allowedActions: ['initialize', 'sync'] });
    if (first.state !== 'job') throw new Error('Expected job');
    await jobs.wait(first.status.id);
    expect(calls).toEqual(['initialize']);
    expect(await jobs.retry(first.status.id, { allowedActions: ['initialize'] })).toMatchObject({
      state: 'forbidden',
      instructions: expect.stringContaining('sync'),
    });
    expect(jobs.status(first.status.id)).toMatchObject({ state: 'not_ready', action: 'initialize' });
    const next = await jobs.retry(first.status.id, { allowedActions: ['sync'] });
    if (next.state !== 'job') throw new Error('Expected next job');
    expect(next.status.id).not.toBe(first.status.id);
    expect(await jobs.wait(next.status.id)).toMatchObject({ state: 'ready', action: 'sync' });
    expect(jobs.status(first.status.id)).toMatchObject({ state: 'not_ready', action: 'initialize' });
    expect(calls).toEqual(['initialize', 'sync']);
    await jobs.shutdown();
  });
});
