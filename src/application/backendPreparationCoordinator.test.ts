import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ConfigManager } from '@src/config/configManager.js';
import type { MCPServerParams } from '@src/core/types/transport.js';
import type { BackendPreparationAdapter, BackendReadiness } from '@src/domains/backend-preparation/contracts.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BackendPreparationCoordinator,
  type PreparationGrant,
  type PublicPreparationStatus,
} from './backendPreparationCoordinator.js';

vi.mock('@src/config/configManager.js', () => ({ ConfigManager: { getInstance: vi.fn() } }));

const directories: string[] = [];
const coordinators: BackendPreparationCoordinator[] = [];
const required: BackendReadiness = {
  state: 'required',
  action: 'initialize',
  instructions: 'Initialize this checkout',
  evidence: { freshness: 'unknown', coverage: 'unknown', detail: 'uninitialized' },
};
const ready: BackendReadiness = {
  state: 'ready',
  evidence: { freshness: 'current', coverage: 'complete', detail: 'verified' },
};
const config: MCPServerParams = {
  command: 'fixture',
  template: {},
  tags: ['allowed'],
  preparation: {
    adapter: 'codegraph',
    executable: '/installed/codegraph',
    expectedVersion: '1.6.2',
    allowedActions: ['initialize', 'sync'],
  },
};

async function fixture(
  adapter?: BackendPreparationAdapter,
  overrides: Partial<MCPServerParams> = {},
  options: { maxRecords?: number } = {},
  onReady?: (target: import('@src/domains/backend-preparation/contracts.js').PreparationTarget) => Promise<void>,
) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'preparation-runtime-'));
  directories.push(directory);
  const checkout = path.join(directory, 'checkout');
  await fs.mkdir(checkout);
  vi.mocked(ConfigManager.getInstance).mockReturnValue({
    loadDeclaredServerConfigs: () => ({
      staticServers: {},
      templateServers: { codegraph: { ...config, ...overrides } },
      errors: [],
    }),
  } as never);
  const prepare = vi.fn(async () => undefined);
  const fallback: BackendPreparationAdapter = {
    inspect: vi.fn(async () => required),
    prepare,
    classifyFailure: () => ({
      code: 'native_failure',
      message: 'Native failure',
      retryable: false,
      instructions: 'Repair prerequisite, then retry',
    }),
    reconcile: vi.fn(async () => required),
  };
  const native = adapter ?? fallback;
  const coordinator = new BackendPreparationCoordinator({
    adapterFactory: () => native,
    storagePath: path.join(directory, 'runtime'),
    options: { requestWaitMs: 50, executionDeadlineMs: 200, ...options },
    onReady,
  });
  coordinators.push(coordinator);
  const resolve = (owner = 'owner', checkoutPath = checkout, filterConfig = { tagFilterMode: 'none' as const }) =>
    coordinator.resolveGrant({ backendName: 'codegraph', checkoutPath, owner, filterConfig });
  return { coordinator, resolve, native, prepare, checkout, directory };
}

async function job(
  coordinator: BackendPreparationCoordinator,
  grant: PreparationGrant,
): Promise<PublicPreparationStatus> {
  const result = (await coordinator.control(grant, { action: 'prepare' })) as {
    state: string;
    status: PublicPreparationStatus;
  };
  expect(result.state).toBe('job');
  return result.status;
}

afterEach(async () => {
  await Promise.all(coordinators.splice(0).map((coordinator) => coordinator.shutdown()));
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe('runtime preparation controls', () => {
  it.each(['control', 'automatic', 'retry'] as const)(
    'rejects current backend revocation after a stalled %s native inspection before mutation',
    async (surface) => {
      let release!: (readiness: BackendReadiness) => void;
      let entered!: () => void;
      const inspecting = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let deferInspection = surface !== 'retry';
      const prepare = vi.fn(async () => {
        throw new Error('Stable prerequisite failure');
      });
      const adapter: BackendPreparationAdapter = {
        inspect: async () => {
          if (!deferInspection) return required;
          entered();
          return new Promise<BackendReadiness>((resolve) => {
            release = resolve;
          });
        },
        prepare,
        classifyFailure: () => ({
          code: 'native_failure',
          message: 'Failure',
          retryable: false,
          instructions: 'Retry explicitly',
        }),
      };
      const overrides: Partial<MCPServerParams> = {};
      const f = await fixture(adapter, overrides);
      await fs.writeFile(
        path.join(f.checkout, '.1mcprc'),
        JSON.stringify({ preparation: { codegraph: { enabled: true } } }),
      );
      const grant = await f.resolve();
      let id: string | undefined;
      if (surface === 'retry') {
        const original = await job(f.coordinator, grant);
        id = original.id;
        expect(await f.coordinator.control(grant, { action: 'wait', id, waitMs: 100 })).toMatchObject({
          state: 'failed',
        });
        prepare.mockClear();
        deferInspection = true;
      }
      const pending =
        surface === 'automatic'
          ? f.coordinator.admit(grant, 'query')
          : f.coordinator.control(grant, { action: surface === 'retry' ? 'retry' : 'prepare', id });
      const rejected = expect(pending).rejects.toThrow();
      await inspecting;
      overrides.disabled = true;
      release(required);
      await rejected;
      expect(prepare).not.toHaveBeenCalled();
      expect(f.coordinator.service.scheduler.counts()).toEqual({ active: 0, queued: 0 });
      if (id)
        expect(await f.coordinator.control(grant, { action: 'status', id })).toMatchObject({ state: 'failed', id });
    },
  );
  it('coalesces and awaits exact-job catalog refresh before reporting ready to waiting callers', async () => {
    let state: BackendReadiness = required;
    let release!: () => void;
    const refresh = new Promise<void>((resolve) => {
      release = resolve;
    });
    const onReady = vi.fn(async () => refresh);
    const f = await fixture(
      {
        inspect: async () => state,
        prepare: async () => {
          state = ready;
        },
        classifyFailure: () => {
          throw new Error('not used');
        },
      },
      {},
      {},
      onReady,
    );
    const grant = await f.resolve();
    const started = await job(f.coordinator, grant);
    let finished = false;
    const wait = f.coordinator.control(grant, { action: 'wait', id: started.id, waitMs: 100 }).then((result) => {
      finished = true;
      return result;
    });
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledOnce());
    const status = f.coordinator.control(grant, { action: 'status', id: started.id });
    expect(finished).toBe(false);
    release();
    expect(await wait).toMatchObject({ state: 'ready' });
    expect(await status).toMatchObject({ state: 'ready' });
    expect(onReady).toHaveBeenCalledOnce();
    expect(onReady).toHaveBeenCalledWith(grant.target);
  });
  it('inspects without preparation and reports unsupported absent runtime opt-in', async () => {
    const { coordinator, resolve, prepare } = await fixture(undefined, { preparation: undefined });
    expect(await coordinator.control(await resolve(), { action: 'status' })).toMatchObject({ state: 'unsupported' });
    expect(prepare).not.toHaveBeenCalled();
  });

  it.each(['inspect', 'status'] as const)(
    'skips native I/O for disconnected or zero-budget no-id %s',
    async (action) => {
      const inspect = vi.fn(async () => ready);
      const prepare = vi.fn(async () => undefined);
      const { coordinator, resolve } = await fixture({
        inspect,
        prepare,
        classifyFailure: () => {
          throw new Error('not used');
        },
      });
      const grant = await resolve();
      const controller = new AbortController();
      controller.abort();
      expect(await coordinator.control(grant, { action, signal: controller.signal })).toMatchObject({
        state: 'unknown',
        reason: 'caller_disconnected',
      });
      expect(await coordinator.control(grant, { action, waitMs: 0 })).toMatchObject({
        state: 'unknown',
        reason: 'inspection_timeout',
      });
      expect(inspect).not.toHaveBeenCalled();
      expect(prepare).not.toHaveBeenCalled();
    },
  );

  it('bounds a no-saved no-id status probe to the remaining caller budget', async () => {
    const inspect = vi.fn<BackendPreparationAdapter['inspect']>(async () => {
      await new Promise((resolve) => setTimeout(resolve, 35));
      return ready;
    });
    const { coordinator, resolve } = await fixture({
      inspect,
      prepare: async () => undefined,
      classifyFailure: () => {
        throw new Error('not used');
      },
    });
    const grant = await resolve();
    vi.useFakeTimers();
    try {
      const result = coordinator.control(grant, { action: 'status', waitMs: 10 });
      await vi.advanceTimersByTimeAsync(10);
      expect(await result).toMatchObject({ state: 'unknown', reason: 'inspection_timeout' });
      expect(inspect).toHaveBeenCalledTimes(1);
      const options = inspect.mock.calls[0]?.[2] as { signal: AbortSignal } | undefined;
      expect(options?.signal.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(50);
    } finally {
      vi.useRealTimers();
    }
  });

  it('explicit preparation uses runtime permission independently of automatic project opt-in', async () => {
    let state: BackendReadiness = required;
    const prepare = vi.fn(async () => {
      state = ready;
    });
    const { coordinator, resolve } = await fixture({
      inspect: async () => state,
      prepare,
      classifyFailure: () => {
        throw new Error('not used');
      },
    });
    const grant = await resolve();
    expect(grant.preferences).toEqual({});
    const started = await job(coordinator, grant);
    expect(started.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(started.target).toEqual({ checkoutRoot: grant.target.checkoutRoot, backendName: 'codegraph' });
    expect(await coordinator.control(grant, { action: 'wait', id: started.id, waitMs: 100 })).toMatchObject({
      state: 'ready',
    });
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('rechecks native readiness for no-id status while retaining historical id status', async () => {
    let state: BackendReadiness = required;
    const inspect = vi.fn(async () => state);
    const { coordinator, resolve } = await fixture({
      inspect,
      prepare: async () => {
        state = ready;
      },
      classifyFailure: () => {
        throw new Error('not used');
      },
    });
    const grant = await resolve();
    const started = await job(coordinator, grant);
    await coordinator.control(grant, { action: 'wait', id: started.id, waitMs: 100 });
    state = { ...required, action: 'sync' };
    inspect.mockClear();
    expect(await coordinator.control(grant, { action: 'status', id: started.id })).toMatchObject({
      state: 'ready',
      operation: 'query',
    });
    expect(inspect).not.toHaveBeenCalled();
    expect(await coordinator.control(grant, { action: 'status', operation: 'other' })).toMatchObject({
      state: 'required',
      action: 'sync',
    });
    expect(inspect).toHaveBeenCalledExactlyOnceWith(grant.target, 'other', expect.anything());
  });

  it('project opt-in cannot grant a runtime-forbidden action', async () => {
    const { coordinator, resolve, prepare, checkout } = await fixture(undefined, {
      preparation: { ...config.preparation!, allowedActions: [] },
    });
    await fs.writeFile(
      path.join(checkout, '.1mcprc'),
      JSON.stringify({ preparation: { codegraph: { enabled: true } } }),
    );
    expect(await coordinator.control(await resolve(), { action: 'prepare' })).toMatchObject({ state: 'forbidden' });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('rejects an excluded offline backend before reading a checkout or creating an adapter', async () => {
    const { resolve } = await fixture();
    await expect(
      resolve('owner', '/does/not/exist', { tagFilterMode: 'simple-or', tags: ['excluded'] } as never),
    ).rejects.toThrow('Backend is unavailable');
  });

  it('lets an explicit single-checkout selector replace its project default', async () => {
    const { resolve, checkout } = await fixture();
    await fs.writeFile(path.join(checkout, '.1mcprc'), JSON.stringify({ tags: ['frontend'] }));
    await expect(
      resolve('owner', checkout, { tagFilterMode: 'simple-or', tags: ['allowed'] } as never),
    ).resolves.toMatchObject({ target: { backendName: 'codegraph' } });
  });

  it('retains project defaults when the effective tags come only from authorization', async () => {
    const { resolve, checkout } = await fixture();
    await fs.writeFile(path.join(checkout, '.1mcprc'), JSON.stringify({ tags: ['frontend'] }));
    await expect(
      resolve('owner', checkout, {
        tagFilterMode: 'simple-or',
        projectFilterMode: 'none',
        tags: ['allowed'],
      } as never),
    ).rejects.toThrow('Backend is unavailable for this checkout');
  });

  it('keeps authorization restrictions when a project selector is explicit', async () => {
    const { resolve, checkout } = await fixture();
    await fs.writeFile(path.join(checkout, '.1mcprc'), JSON.stringify({ tags: ['allowed'] }));
    await expect(
      resolve('owner', checkout, { tagFilterMode: 'simple-or', tags: ['excluded'] } as never),
    ).rejects.toThrow('Backend is unavailable');
  });

  it('rejects guessed job ids from another owner or checkout', async () => {
    const { coordinator, resolve, directory } = await fixture();
    const owner = await resolve();
    const started = await job(coordinator, owner);
    const other = await resolve('other-owner');
    await expect(coordinator.control(other, { action: 'cancel', id: started.id })).rejects.toThrow(
      'Unknown preparation operation',
    );
    const secondCheckout = path.join(directory, 'second');
    await fs.mkdir(secondCheckout);
    const second = await resolve('owner', secondCheckout);
    await expect(coordinator.control(second, { action: 'status', id: started.id })).rejects.toThrow(
      'Unknown preparation operation',
    );
  });

  it('deduplicates compatible grants while issuing separate owner-bound public handles', async () => {
    let release!: () => void;
    const prepare = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const adapter: BackendPreparationAdapter = {
      inspect: async () => required,
      prepare,
      classifyFailure: () => ({ code: 'test', message: 'Test', retryable: false, instructions: 'Retry explicitly' }),
    };
    const { coordinator, resolve } = await fixture(adapter);
    const first = await job(coordinator, await resolve('first'));
    const second = await job(coordinator, await resolve('second'));
    expect(first.id).not.toBe(second.id);
    expect(prepare).toHaveBeenCalledTimes(1);
    release();
  });

  it('recycles successful operations and advisory storage across ordinary checkout jobs', async () => {
    const prepared = new Set<string>();
    const adapter: BackendPreparationAdapter = {
      inspect: async (target) => (prepared.has(target.checkoutRoot) ? ready : required),
      prepare: async (target) => {
        prepared.add(target.checkoutRoot);
      },
      classifyFailure: () => {
        throw new Error('not used');
      },
    };
    const { coordinator, resolve, directory } = await fixture(adapter, {}, { maxRecords: 1 });
    for (let index = 0; index < 6; index++) {
      const checkout = path.join(directory, `checkout-${index}`);
      await fs.mkdir(checkout);
      const grant = await resolve('owner', checkout);
      const started = await job(coordinator, grant);
      expect(await coordinator.control(grant, { action: 'wait', id: started.id, waitMs: 100 })).toMatchObject({
        state: 'ready',
      });
    }
    expect(prepared.size).toBe(6);
    expect(JSON.parse(await fs.readFile(path.join(directory, 'runtime/backend-preparation.json'), 'utf8'))).toEqual([]);
  });

  it('allows ready checkouts through full failure storage and blocks only a new preparation', async () => {
    let readyCheckout: string | undefined;
    const prepare = vi.fn(async () => {
      throw new Error('stable failure');
    });
    const { coordinator, resolve, directory, native } = await fixture(
      {
        inspect: async (target) => (target.checkoutRoot === readyCheckout ? ready : required),
        prepare,
        classifyFailure: () => ({
          code: 'missing',
          message: 'missing',
          retryable: false,
          instructions: 'retry explicitly',
        }),
      },
      {},
      { maxRecords: 1 },
    );
    const failedGrant = await resolve();
    const started = await job(coordinator, failedGrant);
    await coordinator.control(failedGrant, { action: 'wait', id: started.id, waitMs: 100 });
    await coordinator.shutdown();
    const restarted = new BackendPreparationCoordinator({
      adapterFactory: () => native,
      storagePath: path.join(directory, 'runtime'),
      options: { maxRecords: 1, requestWaitMs: 50, executionDeadlineMs: 200 },
    });
    coordinators.push(restarted);
    const resolveRestarted = (checkoutPath: string) =>
      restarted.resolveGrant({
        backendName: 'codegraph',
        checkoutPath,
        owner: 'owner',
        filterConfig: { tagFilterMode: 'none' },
      });
    readyCheckout = path.join(directory, 'ready-checkout');
    await fs.mkdir(readyCheckout);
    readyCheckout = await fs.realpath(readyCheckout);
    const grant = await resolveRestarted(readyCheckout);
    expect(await restarted.admit(grant, 'query')).toMatchObject({ state: 'ready' });
    expect(await restarted.control(grant, { action: 'prepare' })).toMatchObject({ state: 'ready' });
    const unprepared = path.join(directory, 'unprepared-checkout');
    await fs.mkdir(unprepared);
    await fs.writeFile(
      path.join(unprepared, '.1mcprc'),
      JSON.stringify({ preparation: { codegraph: { enabled: true } } }),
    );
    const needed = await resolveRestarted(unprepared);
    await expect(restarted.admit(needed, 'query')).rejects.toThrow('Preparation recovery storage is full');
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('retains a stable failure when only another operation has verified readiness', async () => {
    const native: BackendPreparationAdapter = {
      inspect: async (_target, operation) => (operation === 'other' ? ready : required),
      reconcile: async (_target, operation) => (operation === 'other' ? ready : required),
      prepare: async () => {
        throw new Error('stable failure');
      },
      classifyFailure: () => ({
        code: 'missing',
        message: 'missing',
        retryable: false,
        instructions: 'retry explicitly',
      }),
    };
    const { coordinator, resolve, directory } = await fixture(native);
    const grant = await resolve();
    const started = await job(coordinator, grant);
    await coordinator.control(grant, { action: 'wait', id: started.id, waitMs: 100 });
    expect(await coordinator.control(grant, { action: 'inspect', operation: 'other' })).toMatchObject({
      state: 'ready',
    });
    expect(await coordinator.admit(grant, 'other')).toMatchObject({ state: 'ready' });
    expect(
      JSON.parse(await fs.readFile(path.join(directory, 'runtime/backend-preparation.json'), 'utf8')),
    ).toMatchObject([{ operation: 'query', state: 'failed' }]);
  });

  it('uses one total control budget across recovery and a preparation probe', async () => {
    let slow = false;
    const delay = async () => {
      if (slow) await new Promise((resolve) => setTimeout(resolve, 35));
      return required;
    };
    const prepare = vi.fn(async () => {
      throw new Error('stable failure');
    });
    const native: BackendPreparationAdapter = {
      inspect: delay,
      reconcile: delay,
      prepare,
      classifyFailure: () => ({
        code: 'missing',
        message: 'missing',
        retryable: false,
        instructions: 'retry explicitly',
      }),
    };
    const { coordinator, resolve, directory } = await fixture(native);
    const grant = await resolve();
    const started = await job(coordinator, grant);
    await coordinator.control(grant, { action: 'wait', id: started.id, waitMs: 100 });
    await coordinator.shutdown();
    const file = path.join(directory, 'runtime/backend-preparation.json');
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    saved[0].state = 'running';
    delete saved[0].failure;
    await fs.writeFile(file, JSON.stringify(saved));
    const restarted = new BackendPreparationCoordinator({
      adapterFactory: () => native,
      storagePath: path.join(directory, 'runtime'),
      options: { requestWaitMs: 50, executionDeadlineMs: 200 },
    });
    coordinators.push(restarted);
    const refreshed = await restarted.resolveGrant({
      backendName: 'codegraph',
      checkoutPath: grant.target.checkoutRoot,
      owner: grant.owner,
      filterConfig: { tagFilterMode: 'none' },
    });
    slow = true;
    vi.useFakeTimers();
    try {
      const result = restarted.control(refreshed, { action: 'prepare' });
      await vi.advanceTimersByTimeAsync(50);
      expect(await result).toMatchObject({ state: 'unknown', reason: 'inspection_timeout' });
      expect(prepare).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(50);
    } finally {
      vi.useRealTimers();
    }
  });

  it('awaits adapter disposal only after owned preparation settles at shutdown', async () => {
    const events: string[] = [];
    const adapter = {
      inspect: async () => required,
      prepare: async (_target: unknown, _action: unknown, { signal }: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) =>
          signal.addEventListener(
            'abort',
            () => {
              events.push('settled');
              resolve();
            },
            { once: true },
          ),
        );
      },
      classifyFailure: () => {
        throw new Error('not used');
      },
      dispose: async () => {
        await Promise.resolve();
        events.push('disposed');
      },
    };
    const { coordinator, resolve } = await fixture(adapter);
    await job(coordinator, await resolve());
    await coordinator.shutdown();
    await coordinator.shutdown();
    expect(events).toEqual(['settled', 'disposed']);
  });

  it('persists stable failure, reconciles without preparing after restart, and permits explicit retry', async () => {
    const prepare = vi.fn(async () => {
      throw new Error('Missing prerequisite');
    });
    const native: BackendPreparationAdapter = {
      inspect: async () => required,
      prepare,
      classifyFailure: () => ({
        code: 'prerequisite_missing',
        message: 'Missing prerequisite',
        retryable: false,
        instructions: 'Correct prerequisite and retry',
      }),
      reconcile: vi.fn(async () => required),
    };
    const { coordinator, resolve, directory } = await fixture(native);
    const grant = await resolve();
    const started = await job(coordinator, grant);
    await coordinator.control(grant, { action: 'wait', id: started.id, waitMs: 100 });
    await coordinator.shutdown();
    const restarted = new BackendPreparationCoordinator({
      adapterFactory: () => native,
      storagePath: path.join(directory, 'runtime'),
      options: { requestWaitMs: 50, executionDeadlineMs: 200 },
    });
    coordinators.push(restarted);
    const refreshed = await restarted.resolveGrant({
      backendName: 'codegraph',
      checkoutPath: grant.target.checkoutRoot,
      owner: grant.owner,
      filterConfig: { tagFilterMode: 'none' },
    });
    const status = await restarted.control(refreshed, { action: 'status' });
    expect(status).toMatchObject({
      state: 'job',
      status: { state: 'failed', failure: { code: 'prerequisite_missing' } },
    });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(native.reconcile).toHaveBeenCalledTimes(1);
    await restarted.control(refreshed, { action: 'retry' });
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it('clears a saved failure only after verified native readiness', async () => {
    let state: BackendReadiness = required;
    const native: BackendPreparationAdapter = {
      inspect: async () => state,
      prepare: async () => {
        throw new Error('failed');
      },
      classifyFailure: () => ({ code: 'failed', message: 'Failed', retryable: false, instructions: 'Retry' }),
      reconcile: async () => state,
    };
    const { coordinator, resolve, directory } = await fixture(native);
    const grant = await resolve();
    const started = await job(coordinator, grant);
    await coordinator.control(grant, { action: 'wait', id: started.id, waitMs: 100 });
    await coordinator.shutdown();
    state = ready;
    const restarted = new BackendPreparationCoordinator({
      adapterFactory: () => native,
      storagePath: path.join(directory, 'runtime'),
      options: { requestWaitMs: 50, executionDeadlineMs: 200 },
    });
    coordinators.push(restarted);
    const refreshed = await restarted.resolveGrant({
      backendName: 'codegraph',
      checkoutPath: grant.target.checkoutRoot,
      owner: grant.owner,
      filterConfig: { tagFilterMode: 'none' },
    });
    expect(await restarted.control(refreshed, { action: 'status' })).toMatchObject({ state: 'ready' });
  });
});
