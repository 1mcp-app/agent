import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CodeGraphPreparationAdapter, requiresCodeGraphPreparation } from './codegraphAdapter.js';
import { CodeGraphPreparationError } from './codegraphProcess.js';
import type { PreparationTarget } from './contracts.js';

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  create: vi.fn(),
  query: vi.fn(),
  start: vi.fn(),
  dispose: vi.fn(),
  generation: 0,
  brokenWatch: false,
}));
vi.mock('./codegraphInstallation.js', () => ({
  VERIFIED_CODEGRAPH_VERSION: '1.6.2',
  resolveCodeGraphInstallation: vi.fn(async () => ({
    nodeExecutable: '/installed/node',
    libraryRoot: '/installed/lib/dist',
    version: '1.6.2',
  })),
}));
vi.mock('./codegraphProcess.js', async (original) => ({
  ...(await original<typeof import('./codegraphProcess.js')>()),
  runCodeGraphWorker: mocks.run,
}));
vi.mock('./codegraphJournal.js', async (original) => ({
  ...(await original<typeof import('./codegraphJournal.js')>()),
  CodeGraphJournal: { create: mocks.create },
}));
vi.mock('./codegraphFreshness.js', () => ({
  CodeGraphFreshness: class {
    async fingerprint() {
      if (mocks.brokenWatch) throw new Error('native watch unavailable');
      return String(mocks.generation);
    }
    close() {}
  },
}));

describe('CodeGraphPreparationAdapter', () => {
  let root: string;
  let target: PreparationTarget;
  let adapter: CodeGraphPreparationAdapter;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codegraph-adapter-unit-')));
    target = { checkoutRoot: root, backendName: 'codegraph', backendIdentity: 'native', configurationKey: 'one' };
    adapter = new CodeGraphPreparationAdapter({ executable: '/installed/codegraph' });
    mocks.generation = 0;
    mocks.brokenWatch = false;
    mocks.run.mockReset();
    mocks.create.mockReset().mockResolvedValue({ query: mocks.query, start: mocks.start, dispose: mocks.dispose });
    mocks.query.mockReset().mockResolvedValue({ token: 'builtin:unit:1', paths: [] });
    mocks.start.mockReset().mockResolvedValue(undefined);
    mocks.dispose.mockReset().mockResolvedValue(undefined);
    await mkdir(path.join(root, '.codegraph'), { recursive: true });
    await writeFile(path.join(root, '.codegraph', 'codegraph.db'), 'fixture');
  });

  afterEach(async () => {
    await adapter.dispose();
    await rm(root, { recursive: true, force: true });
  });

  function status() {
    return {
      initialized: true,
      projectPath: root,
      indexPath: path.join(root, '.codegraph'),
      fileCount: 3,
      pendingChanges: { added: 0, modified: 0, removed: 0 },
      index: {
        builtWithVersion: '1.6.2',
        builtWithExtractionVersion: 7,
        currentExtractionVersion: 7,
        reindexRecommended: false,
        state: 'complete',
        pendingRefs: 0,
      },
    };
  }

  it('requires initialization only for an absent checkout-local database', async () => {
    await rm(path.join(root, '.codegraph', 'codegraph.db'));
    mocks.run.mockResolvedValue({ initialized: false, projectPath: root, indexPath: path.join(root, '.codegraph') });
    expect(await adapter.inspect(target, 'explore')).toMatchObject({
      state: 'required',
      action: 'initialize',
      evidence: { freshness: 'unknown', coverage: 'unknown' },
    });
  });

  it('reuses native journal barrier evidence without scanning/indexing again', async () => {
    mocks.run.mockResolvedValue(status());
    expect((await adapter.inspect(target, 'explore')).state).toBe('ready');
    expect((await adapter.inspect(target, 'explore')).state).toBe('ready');
    expect(adapter.getMeasurements()).toEqual({ inspections: 1, preparations: 0, warmChecks: 1 });
    mocks.generation += 1;
    mocks.run.mockResolvedValue({ ...status(), pendingChanges: { added: 0, modified: 1, removed: 0 } });
    expect(await adapter.inspect(target, 'explore')).toMatchObject({
      state: 'required',
      action: 'sync',
      evidence: { freshness: 'stale' },
    });
    expect(mocks.run).toHaveBeenCalledTimes(2);
  });

  it.each(['partial', 'failed', 'indexing', null])('blocks incomplete native state %s', async (state) => {
    const evidence = status();
    mocks.run.mockResolvedValue({ ...evidence, index: { ...evidence.index, state } });
    expect(await adapter.inspect(target, 'explore')).toMatchObject({
      state: 'required',
      action: 'rebuild',
      evidence: { coverage: 'partial' },
    });
  });

  it('blocks incompatible extraction formats and pending references', async () => {
    const evidence = status();
    mocks.run.mockResolvedValue({ ...evidence, index: { ...evidence.index, builtWithExtractionVersion: 6 } });
    expect(await adapter.inspect(target, 'explore')).toMatchObject({ state: 'required', action: 'rebuild' });
    mocks.generation += 1;
    mocks.run.mockResolvedValue({ ...evidence, index: { ...evidence.index, pendingRefs: 2 } });
    expect(await adapter.inspect(target, 'explore')).toMatchObject({
      state: 'required',
      action: 'sync',
      evidence: { coverage: 'partial' },
    });
  });

  it('never uses ancestor/foreign checkout evidence or a symlinked index', async () => {
    mocks.run.mockResolvedValue({ ...status(), projectPath: path.dirname(root) });
    expect((await adapter.inspect(target, 'explore')).state).toBe('conflict');
    await rm(path.join(root, '.codegraph'), { recursive: true });
    await symlink(os.tmpdir(), path.join(root, '.codegraph'), 'dir');
    expect(await adapter.inspect(target, 'explore')).toMatchObject({ state: 'unsupported' });
  });

  it('fails closed when continuous source observation is unavailable', async () => {
    mocks.brokenWatch = true;
    expect((await adapter.inspect(target, 'explore')).state).toBe('unsupported');
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('invalidates immediate source additions and native journal reset even when metadata is unchanged', async () => {
    mocks.run.mockResolvedValue(status());
    await adapter.inspect(target, 'explore');
    mocks.query.mockResolvedValueOnce({ token: 'builtin:unit:2', paths: ['src/new.ts'] });
    mocks.run.mockResolvedValue({ ...status(), pendingChanges: { added: 1, modified: 0, removed: 0 } });
    expect(await adapter.inspect(target, 'explore')).toMatchObject({ state: 'required', action: 'sync' });
    mocks.query.mockResolvedValueOnce({ token: 'builtin:reset:0', paths: ['/'] });
    await adapter.inspect(target, 'explore');
    expect(mocks.run).toHaveBeenCalledTimes(3);
  });

  it('does not cache a probe that races source changes', async () => {
    mocks.run.mockImplementation(async () => {
      mocks.generation += 1;
      return status();
    });
    expect(await adapter.inspect(target, 'explore')).toMatchObject({
      state: 'required',
      evidence: { freshness: 'unknown' },
    });
    mocks.run.mockResolvedValue(status());
    await adapter.inspect(target, 'explore');
    expect(mocks.run).toHaveBeenCalledTimes(4);
  });

  it('does not break live, dead or malformed native ownership', async () => {
    await mkdir(path.join(root, '.codegraph'), { recursive: true });
    const ownerPath = path.join(root, '.codegraph', 'writer.pid');
    await writeFile(ownerPath, 'unknown owner');
    expect(
      (await adapter.reconcile(target, 'explore', { previousJobId: 'saved', previousState: 'running' })).state,
    ).toBe('conflict');
    await expect(
      adapter.prepare(target, 'initialize', { signal: new AbortController().signal, executionDeadlineMs: 100 }),
    ).rejects.toMatchObject({ code: 'ownership_conflict' });
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('may inspect a ready live native watcher, but cannot start a second writer', async () => {
    await mkdir(path.join(root, '.codegraph'), { recursive: true });
    await writeFile(
      path.join(root, '.codegraph', 'writer.pid'),
      JSON.stringify({ pid: process.pid, mode: 'direct', ready: true }),
    );
    mocks.run.mockResolvedValue(status());
    expect((await adapter.inspect(target, 'explore')).state).toBe('ready');
    await expect(
      adapter.prepare(target, 'sync', { signal: new AbortController().signal, executionDeadlineMs: 100 }),
    ).rejects.toMatchObject({ code: 'ownership_conflict' });
  });

  it('shares one reserved initialization across a same-checkout burst and preserves another waiter when one aborts', async () => {
    adapter = new CodeGraphPreparationAdapter({ executable: '/installed/codegraph', maximumWatchedCheckouts: 1 });
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.create.mockImplementation(async () => {
      await ready;
      return { query: mocks.query, start: mocks.start, dispose: mocks.dispose };
    });
    mocks.run.mockResolvedValue(status());
    const cancelled = new AbortController();
    const calls = Array.from({ length: 12 }, (_, i) =>
      adapter.inspect(target, 'explore', i === 0 ? { signal: cancelled.signal } : undefined),
    );
    await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    cancelled.abort();
    expect((await calls[0]).state).toBe('unsupported');
    expect(mocks.create.mock.calls[0][1].aborted).toBe(false);
    release();
    expect((await Promise.all(calls.slice(1))).every((result) => result.state === 'ready')).toBe(true);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });

  it('reserves distinct-checkout capacity before starting asynchronous native discovery', async () => {
    adapter = new CodeGraphPreparationAdapter({ executable: '/installed/codegraph', maximumWatchedCheckouts: 1 });
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.create.mockImplementation(async () => {
      await ready;
      return { query: mocks.query, start: mocks.start, dispose: mocks.dispose };
    });
    mocks.run.mockImplementation(async (_installation, checkoutRoot) => ({
      ...status(),
      projectPath: checkoutRoot,
      indexPath: path.join(checkoutRoot, '.codegraph'),
    }));
    const others: string[] = [];
    try {
      for (let i = 0; i < 11; i += 1) {
        const other = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codegraph-capacity-')));
        others.push(other);
        await mkdir(path.join(other, '.codegraph'));
        await writeFile(path.join(other, '.codegraph', 'codegraph.db'), 'fixture');
      }
      const calls = [root, ...others].map((checkoutRoot) => adapter.inspect({ ...target, checkoutRoot }, 'explore'));
      await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
      release();
      const results = await Promise.all(calls);
      expect(results.filter((result) => result.state === 'ready')).toHaveLength(1);
      expect(results.filter((result) => result.state === 'unsupported')).toHaveLength(11);
      expect(mocks.create).toHaveBeenCalledTimes(1);
    } finally {
      await Promise.all(others.map((other) => rm(other, { recursive: true, force: true })));
    }
  });

  it('cancels an abandoned shared initialization and never starts queued native work', async () => {
    adapter = new CodeGraphPreparationAdapter({ executable: '/installed/codegraph', maximumWatchedCheckouts: 1 });
    mocks.create.mockImplementation(
      (_root, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true }),
        ),
    );
    const controller = new AbortController();
    const call = adapter.inspect(target, 'explore', { signal: controller.signal });
    await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    controller.abort();
    expect((await call).state).toBe('unsupported');
    await vi.waitFor(() => expect(mocks.create.mock.calls[0][1].aborted).toBe(true));
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('bounds native discovery and cold probes across distinct roots and skips cancelled queued callers', async () => {
    adapter = new CodeGraphPreparationAdapter({ executable: '/installed/codegraph', maximumWatchedCheckouts: 12 });
    const roots: string[] = [];
    let active = 0;
    let peak = 0;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.create.mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await blocked;
      active -= 1;
      return { query: mocks.query, start: mocks.start, dispose: mocks.dispose };
    });
    mocks.run.mockImplementation(async (_installation, checkoutRoot) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active -= 1;
      return { ...status(), projectPath: checkoutRoot, indexPath: path.join(checkoutRoot, '.codegraph') };
    });
    try {
      for (let i = 0; i < 11; i += 1) {
        const other = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codegraph-native-limit-')));
        roots.push(other);
        await mkdir(path.join(other, '.codegraph'));
        await writeFile(path.join(other, '.codegraph', 'codegraph.db'), 'fixture');
      }
      const controllers = [root, ...roots].map(() => new AbortController());
      const calls = [root, ...roots].map((checkoutRoot, i) =>
        adapter.inspect({ ...target, checkoutRoot }, 'explore', { signal: controllers[i].signal }),
      );
      await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(4));
      const initialized = new Set(mocks.create.mock.calls.map((args) => args[0]));
      const cancelled = [root, ...roots].findIndex((checkoutRoot) => !initialized.has(checkoutRoot));
      controllers[cancelled].abort();
      expect((await calls[cancelled]).state).toBe('unsupported');
      release();
      const results = await Promise.all(calls);
      expect(results.filter((result) => result.state === 'ready')).toHaveLength(11);
      expect(mocks.create).toHaveBeenCalledTimes(11);
      expect(peak).toBeLessThanOrEqual(4);
    } finally {
      release();
      await Promise.all(roots.map((other) => rm(other, { recursive: true, force: true })));
    }
  });

  it('cancels a same-checkout queued probe promptly without overtaking the active probe', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.run.mockImplementationOnce(async () => {
      await blocked;
      return status();
    });
    const first = adapter.inspect(target, 'explore');
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
    const controller = new AbortController();
    const second = adapter.inspect(target, 'explore', { signal: controller.signal });
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();
    expect((await second).state).toBe('unsupported');
    expect(mocks.run).toHaveBeenCalledTimes(1);
    release();
    expect((await first).state).toBe('ready');
  });

  it('drains pending initialization on shutdown and rejects later probes without native startup', async () => {
    mocks.create.mockImplementation(
      (_root, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true }),
        ),
    );
    const probe = adapter.inspect(target, 'explore');
    await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    await adapter.dispose();
    expect((await probe).state).toBe('unsupported');
    expect((await adapter.inspect(target, 'explore')).state).toBe('unsupported');
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('retains an owned observer for disposal when preparation fails before ownership admission', async () => {
    mocks.run.mockResolvedValue(status());
    await adapter.inspect(target, 'explore');
    await writeFile(path.join(root, '.codegraph', 'writer.pid'), 'foreign owner');
    await expect(
      adapter.prepare(target, 'sync', { signal: new AbortController().signal, executionDeadlineMs: 1000 }),
    ).rejects.toMatchObject({ code: 'ownership_conflict' });
    expect(mocks.dispose).not.toHaveBeenCalled();
    await adapter.dispose();
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });

  it('serializes failed preparation cleanup before a queued waiter reopens its tracked observer', async () => {
    adapter = new CodeGraphPreparationAdapter({ executable: '/installed/codegraph', sourceMonitor: 'git-fsmonitor' });
    let releaseCleanup!: () => void;
    let cleanupEntered!: () => void;
    const pendingCleanup = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      cleanupEntered = resolve;
    });
    let owned = false;
    mocks.start.mockImplementation(async () => {
      owned = true;
    });
    mocks.dispose.mockImplementationOnce(async () => {
      owned = false;
      cleanupEntered();
      await pendingCleanup;
    });
    mocks.dispose.mockImplementation(async () => {
      owned = false;
    });
    mocks.run.mockRejectedValueOnce(new Error('First preparation failed')).mockResolvedValue({ prepared: true });
    const options = { signal: new AbortController().signal, executionDeadlineMs: 5_000 };
    const first = adapter.prepare(target, 'sync', options).then(
      () => undefined,
      (error) => error,
    );
    await entered;
    const second = adapter.prepare({ ...target, configurationKey: 'two' }, 'sync', options);
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(mocks.start).toHaveBeenCalledTimes(1);
      expect(mocks.run).toHaveBeenCalledTimes(1);
      expect(owned).toBe(false);
      releaseCleanup();
      expect(await first).toMatchObject({ message: 'First preparation failed' });
      await second;
      expect(mocks.create).toHaveBeenCalledTimes(1);
      expect(mocks.start).toHaveBeenCalledTimes(2);
      expect(owned).toBe(true);
      await adapter.dispose();
      expect(mocks.dispose).toHaveBeenCalledTimes(2);
      expect(owned).toBe(false);
    } finally {
      releaseCleanup();
      await Promise.allSettled([first, second]);
    }
  });

  it('detaches a cancelled waiter during failure cleanup without stopping the next observer owner', async () => {
    adapter = new CodeGraphPreparationAdapter({ executable: '/installed/codegraph', sourceMonitor: 'git-fsmonitor' });
    let releaseCleanup!: () => void;
    let cleanupEntered!: () => void;
    const pendingCleanup = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      cleanupEntered = resolve;
    });
    mocks.dispose.mockImplementationOnce(async () => {
      cleanupEntered();
      await pendingCleanup;
    });
    mocks.run.mockRejectedValueOnce(new Error('First preparation failed')).mockResolvedValue({ prepared: true });
    const options = { signal: new AbortController().signal, executionDeadlineMs: 5_000 };
    const first = adapter.prepare(target, 'sync', options).then(
      () => undefined,
      (error) => error,
    );
    await entered;
    const controller = new AbortController();
    const cancelled = adapter.prepare(target, 'sync', { ...options, signal: controller.signal });
    const cancellation = expect(cancelled).rejects.toMatchObject({ code: 'cancelled' });
    controller.abort();
    const next = adapter.prepare(target, 'sync', options);
    try {
      await cancellation;
      expect(mocks.start).toHaveBeenCalledTimes(1);
      expect(mocks.dispose).toHaveBeenCalledTimes(1);
      releaseCleanup();
      await first;
      await next;
      expect(mocks.start).toHaveBeenCalledTimes(2);
      await adapter.dispose();
      expect(mocks.dispose).toHaveBeenCalledTimes(2);
    } finally {
      releaseCleanup();
      await Promise.allSettled([first, cancelled, next]);
    }
  });

  it('passes probe cancellation and preparation budgets, and invalidates warm readiness', async () => {
    const signal = new AbortController().signal;
    mocks.run.mockResolvedValue(status());
    await adapter.inspect(target, 'explore', { signal });
    expect(mocks.run).toHaveBeenLastCalledWith(expect.anything(), root, 'inspect', expect.objectContaining({ signal }));
    await adapter.prepare(target, 'sync', { signal, executionDeadlineMs: 123 });
    expect(mocks.run).toHaveBeenLastCalledWith(
      expect.anything(),
      root,
      'sync',
      expect.objectContaining({ executionDeadlineMs: expect.any(Number), signal: expect.any(AbortSignal) }),
    );
    await adapter.inspect(target, 'explore');
    expect(mocks.run).toHaveBeenCalledTimes(3);
  });

  it('keeps unsupported costly actions explicit and failures nonretryable', async () => {
    await expect(
      adapter.prepare(target, 'rebuild', { signal: new AbortController().signal, executionDeadlineMs: 100 }),
    ).rejects.toMatchObject({ code: 'unsupported_action' });
    expect(adapter.classifyFailure(new CodeGraphPreparationError('deadline_exceeded', 'over budget'))).toMatchObject({
      retryable: false,
      code: 'deadline_exceeded',
    });
    expect(mocks.run).not.toHaveBeenCalled();
  });
});

it('prepares only pinned native source operations, never diagnostics or discovery', () => {
  expect(requiresCodeGraphPreparation('codegraph_explore', { query: 'x' })).toBe(true);
  expect(requiresCodeGraphPreparation('codegraph_files')).toBe(true);
  expect(requiresCodeGraphPreparation('codegraph_status')).toBe(false);
  expect(requiresCodeGraphPreparation('tools/list')).toBe(false);
  expect(requiresCodeGraphPreparation('instructions')).toBe(false);
  expect(requiresCodeGraphPreparation('unrelated_tool')).toBe(false);
});
