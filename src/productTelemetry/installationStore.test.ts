import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { InstallationStore } from './installationStore.js';

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'product-store-'));
  roots.push(root);
  const notice = vi.fn();
  const store = new InstallationStore(path.join(root, 'installation'), {
    notice,
    now: () => Date.parse('2026-10-27T10:12:34Z'),
  });
  return { root, store, notice };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('installation controls and admission', () => {
  it('status and explicit controls never create an identity; disabled admission is inert', async () => {
    const { root, store } = await fixture();
    expect(await store.status()).toMatchObject({ preference: 'default', identityPresent: false, queuedSummaries: 0 });
    await expect(stat(path.join(root, 'installation'))).rejects.toThrow();
    await store.control('disable');
    expect(await store.admit()).toBeUndefined();
    await store.control('reset');
    expect(await store.status()).toMatchObject({ preference: 'disabled', identityPresent: false });
    await store.control('enable');
    expect(await store.status()).toMatchObject({ preference: 'enabled', identityPresent: false });
  });
  it('concurrent starts share one private identity and healthy notice', async () => {
    const { root, store, notice } = await fixture();
    const tickets = await Promise.all(Array.from({ length: 8 }, () => store.admit()));
    expect(tickets.every(Boolean)).toBe(true);
    expect(new Set(tickets.map((t) => t?.installationId)).size).toBe(1);
    expect(notice).toHaveBeenCalledTimes(1);
    if (process.platform !== 'win32') {
      expect((await stat(path.join(root, 'installation'))).mode & 0o777).toBe(0o700);
      expect((await stat(path.join(root, 'installation/state.json'))).mode & 0o777).toBe(0o600);
    }
    expect(JSON.parse(await readFile(path.join(root, 'installation/state.json'), 'utf8')).generation).toBe(0);
  });
});

const sample = (outcome: 'success' | 'failure' = 'success') => ({
  occurred_at: '2026-10-27T10:00:00Z',
  version: '0.39.3',
  os: 'darwin' as const,
  arch: 'arm64' as const,
  node_major: 24,
  ci: false,
  counters: [
    {
      kind: 'command' as const,
      name: 'inspect',
      outcome,
      transport: 'none' as const,
      client: 'none' as const,
      bucket: 'none' as const,
      count: 1,
    },
  ],
});

describe('generation-fenced aggregation and final claims', () => {
  it('sends retained data once after a later connection becomes ready', async () => {
    const { store } = await fixture();
    const ticket = (await store.admit())!;
    await store.append(ticket, sample());
    const fallback = vi.fn();
    await store.attemptSend(ticket, fallback, async () => undefined);
    const dispatch = vi.fn();
    const prepare = vi.fn(async () => ({ dispatch, cancel: vi.fn(), isReady: () => true }));
    await store.attemptSend(ticket, fallback, prepare);
    await store.attemptSend(ticket, fallback, prepare);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(prepare).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
    expect((await store.status()).queuedSummaries).toBe(0);
  });

  it('retains unattempted data when connection preparation fails', async () => {
    const { store } = await fixture();
    const ticket = (await store.admit())!;
    await store.append(ticket, sample());
    const dispatch = vi.fn();
    await store.attemptSend(ticket, dispatch, async () => undefined);
    expect(dispatch).not.toHaveBeenCalled();
    expect((await store.status()).queuedSummaries).toBe(1);
  });

  it('prepares outside the lock and rechecks reset before releasing any payload', async () => {
    const { store } = await fixture();
    const ticket = (await store.admit())!;
    await store.append(ticket, sample());
    const dispatch = vi.fn();
    const cancel = vi.fn();
    await store.attemptSend(ticket, vi.fn(), async () => {
      expect((await store.status()).coordination).toBe('available');
      await store.control('reset');
      return { dispatch, cancel, isReady: () => true };
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    expect((await store.status()).identityPresent).toBe(false);
  });

  it('does not claim a batch after its prepared connection expires', async () => {
    const { store } = await fixture();
    const ticket = (await store.admit())!;
    await store.append(ticket, sample());
    const dispatch = vi.fn();
    const cancel = vi.fn();
    await store.attemptSend(ticket, vi.fn(), async () => ({ dispatch, cancel, isReady: () => false }));
    expect(dispatch).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    expect((await store.status()).queuedSummaries).toBe(1);
  });

  it('merges concurrent deltas and never replays an attempted batch', async () => {
    const { store } = await fixture();
    const ticket = (await store.admit())!;
    await Promise.all(Array.from({ length: 6 }, () => store.append(ticket, sample())));
    const bodies: string[] = [];
    await store.attemptSend(ticket, (body) => {
      bodies.push(body);
      throw new Error('ambiguous transport');
    });
    await store.attemptSend(ticket, (body) => {
      bodies.push(body);
    });
    expect(bodies).toHaveLength(1);
    expect(JSON.parse(bodies[0]).summaries[0].counters[0].count).toBe(6);
    expect(await store.status()).toMatchObject({ queuedSummaries: 0 });
  });
  it('never relabels old facts after reset or disable/re-enable', async () => {
    const { store } = await fixture();
    const old = (await store.admit())!;
    await store.append(old, sample());
    await store.control('reset');
    expect(await store.append(old, sample())).toBe(false);
    const next = (await store.admit())!;
    expect(next.installationId).not.toBe(old.installationId);
    await store.control('disable');
    await store.control('enable');
    expect(await store.append(next, sample())).toBe(false);
    const sender = vi.fn();
    await store.attemptSend(old, sender);
    expect(sender).not.toHaveBeenCalled();
  });
  it('rejects unexpected payload fields at the store boundary', async () => {
    const { store } = await fixture();
    const ticket = (await store.admit())!;
    const foreignFacts = { ...sample(), secret: 'must-never-persist' };
    await expect(store.append(ticket, foreignFacts)).rejects.toThrow();
    expect(await store.status()).toMatchObject({ queuedSummaries: 0 });
  });
});

describe('wire and shared queue bounds', () => {
  it('splits counts safely and separates midnight/CI dimensions', async () => {
    const { store } = await fixture();
    const ticket = (await store.admit())!;
    const large = sample();
    large.counters[0].count = 700000;
    await store.append(ticket, large);
    await store.append(ticket, large);
    await store.append(ticket, { ...sample(), ci: true });
    await store.append(ticket, { ...sample(), occurred_at: '2026-10-26T23:59:59Z' });
    const bodies: string[] = [];
    await store.attemptSend(ticket, (body) => {
      bodies.push(body);
    });
    const summaries = JSON.parse(bodies[0]).summaries;
    expect(summaries).toHaveLength(3);
    expect(
      summaries
        .filter((s: { ci: boolean; occurred_at: string }) => !s.ci && s.occurred_at.startsWith('2026-10-27'))[0]
        .counters.map((c: { count: number }) => c.count),
    ).toEqual([1000000, 400000]);
  });
  it('expires old unsent facts and bounds actual serialized queue and envelope bytes', async () => {
    const { store, root } = await fixture();
    const ticket = (await store.admit())!;
    expect(await store.append(ticket, { ...sample(), occurred_at: '2026-10-19T10:00:00Z' })).toBe(false);
    const names = [
      'serve',
      'proxy',
      'mcp',
      'template',
      'preset',
      'config',
      'auth',
      'project',
      'instructions',
      'inspect',
      'run',
      'wait',
      'doctor',
      'telemetry',
      'help',
      'version',
    ];
    for (let i = 0; i < 150; i++)
      await store.append(ticket, {
        ...sample(),
        version: `0.1.${i}`,
        counters: names.map((name) => ({ ...sample().counters[0], name })),
      });
    const state = JSON.parse(await readFile(path.join(root, 'installation/state.json'), 'utf8'));
    expect(Buffer.byteLength(JSON.stringify(state.queue))).toBeLessThanOrEqual(256 * 1024);
    expect(state.queue[0].version).not.toBe('0.1.0');
    const bodies: string[] = [];
    while ((await store.status()).queuedSummaries)
      await store.attemptSend(ticket, (body) => {
        bodies.push(body);
      });
    expect(bodies.length).toBeGreaterThan(1);
    for (const body of bodies) {
      expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(65536);
      expect(JSON.parse(body).summaries.length).toBeLessThanOrEqual(100);
      for (const summary of JSON.parse(body).summaries) expect(summary.counters.length).toBeLessThanOrEqual(16);
    }
  }, 20000);
});

describe('failed telemetry cannot resurrect or replay data', () => {
  it('retains corrupt authoritative state and never silently replaces it', async () => {
    const { store, root } = await fixture();
    await store.admit();
    const file = path.join(root, 'installation/state.json');
    await writeFile(file, '{broken', { mode: 0o600 });
    await expect(store.admit()).rejects.toThrow('state unavailable');
    await expect(store.control('reset')).rejects.toThrow('state unavailable');
    expect(await readFile(file, 'utf8')).toBe('{broken');
  });
  it.each(['201', '400', '409', '429', '503', 'timeout', 'ambiguous'])(
    'makes the %s transport outcome final',
    async (outcome) => {
      const { store } = await fixture();
      const ticket = (await store.admit())!;
      await store.append(ticket, sample());
      const sender = vi.fn(async () => {
        if (outcome !== '201') throw new Error(outcome);
      });
      await store.attemptSend(ticket, sender);
      await store.attemptSend(ticket, sender);
      expect(sender).toHaveBeenCalledTimes(1);
      expect(await store.status()).toMatchObject({ queuedSummaries: 0 });
    },
  );
});

it('persists expiry even when no eligible summary remains for a send', async () => {
  const { root } = await fixture();
  let now = Date.parse('2026-10-27T10:12:34Z');
  const store = new InstallationStore(path.join(root, 'installation'), { notice: vi.fn(), now: () => now });
  const ticket = (await store.admit())!;
  await store.append(ticket, sample());
  now += 8 * 86400000;
  const sender = vi.fn();
  await store.attemptSend(ticket, sender);
  expect(sender).not.toHaveBeenCalled();
  expect(await store.status()).toMatchObject({ queuedSummaries: 0 });
});

it('persists expiry when an append is too old to admit', async () => {
  const { root } = await fixture();
  let now = Date.parse('2026-10-27T10:12:34Z');
  const store = new InstallationStore(path.join(root, 'installation'), { notice: vi.fn(), now: () => now });
  const ticket = (await store.admit())!;
  await store.append(ticket, sample());
  now += 8 * 86400000;
  expect(await store.append(ticket, sample())).toBe(false);
  expect(await store.status()).toMatchObject({ queuedSummaries: 0 });
});
