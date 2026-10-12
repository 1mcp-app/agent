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
});
