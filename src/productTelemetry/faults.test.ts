import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { DAY } from './contract.js';
import { InstallationStore } from './installationStore.js';
import { ProductUsageProducer } from './producer.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const dimensions = { version: '0.39.3', os: 'darwin' as const, arch: 'arm64' as const, node_major: 24, ci: false };
const facts = (time: number) => ({
  ...dimensions,
  occurred_at: new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  counters: [
    {
      kind: 'command' as const,
      name: 'inspect',
      outcome: 'success' as const,
      transport: 'none' as const,
      client: 'none' as const,
      bucket: 'none' as const,
      count: 1,
    },
  ],
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'product-fault-'));
  roots.push(root);
  let now = Date.parse('2026-10-27T12:00:00Z');
  const create = () => new InstallationStore(path.join(root, 'installation'), { notice: vi.fn(), now: () => now });
  return {
    create,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

it('accepts the exact local age/future boundaries and persists expiry one second later', async () => {
  const f = await fixture();
  const store = f.create();
  const ticket = (await store.admit())!;
  expect(await store.append(ticket, facts(f.now() - 7 * DAY))).toBe(true);
  expect(await store.append(ticket, facts(f.now() - 7 * DAY - 1000))).toBe(false);
  expect(await store.append(ticket, facts(f.now() + 300000))).toBe(true);
  expect(await store.append(ticket, facts(f.now() + 301000))).toBe(false);
  f.advance(1000);
  const bodies: string[] = [];
  await store.attemptSend(ticket, (body) => {
    bodies.push(body);
  });
  expect(bodies).toHaveLength(1);
  expect(JSON.parse(bodies[0]).summaries).toHaveLength(1);
  expect(JSON.parse(bodies[0]).summaries[0].occurred_at).toBe('2026-10-27T12:05:00Z');
  expect((await store.status()).queuedSummaries).toBe(0);
});

it('a later execution sends unattempted prior-day facts alongside its own completed command', async () => {
  const f = await fixture();
  const first = f.create();
  const ticket = (await first.admit())!;
  await first.append(ticket, facts(f.now()));
  f.advance(DAY);
  const bodies: string[] = [];
  const later = new ProductUsageProducer({
    store: f.create(),
    now: f.now,
    dimensions,
    dispatch: (body) => {
      bodies.push(body);
    },
  });
  await later.settled();
  later.beginCommand('inspect').finish('success');
  await later.settled();
  expect(bodies).toHaveLength(1);
  expect(JSON.parse(bodies[0]).summaries.map((s: { occurred_at: string }) => s.occurred_at.slice(0, 10))).toEqual([
    '2026-10-27',
    '2026-10-28',
  ]);
  expect((await first.status()).queuedSummaries).toBe(0);
});

it.each(['disable', 'reset'] as const)(
  '%s completes while a claimed request is stalled and fences all later old-ticket sends',
  async (action) => {
    const f = await fixture();
    const store = f.create();
    const ticket = (await store.admit())!;
    await store.append(ticket, facts(f.now()));
    const sender = vi.fn(() => new Promise<void>(() => {}));
    await store.attemptSend(ticket, sender);
    await f.create().control(action);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(await store.append(ticket, facts(f.now()))).toBe(false);
    await store.attemptSend(ticket, sender);
    expect(sender).toHaveBeenCalledTimes(1);
    expect((await store.status()).queuedSummaries).toBe(0);
  },
);

it('competing claimants cannot duplicate a batch even while its result remains ambiguous', async () => {
  const f = await fixture();
  const store = f.create();
  const ticket = (await store.admit())!;
  await store.append(ticket, facts(f.now()));
  const sender = vi.fn(() => Promise.reject(new Error('private error must never reach output')));
  await Promise.all([store.attemptSend(ticket, sender), f.create().attemptSend(ticket, sender)]);
  expect(sender).toHaveBeenCalledTimes(1);
  expect((await store.status()).queuedSummaries).toBe(0);
});
