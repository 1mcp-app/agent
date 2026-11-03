import { type ChildProcess, fork } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { build } from 'esbuild';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createTestProcessEnvironment } from '../../scripts/test-process-environment.mjs';
import { type AdmissionTicket, InstallationStore } from './installationStore.js';

let directory: string;
let bundle: string;
const children: ChildProcess[] = [];
const fixtureRoots: string[] = [];
const facts = {
  occurred_at: '2026-10-27T10:00:00Z',
  version: '0.39.3',
  os: 'darwin',
  arch: 'arm64',
  node_major: 24,
  ci: false,
  counters: [
    {
      kind: 'command',
      name: 'inspect',
      outcome: 'success',
      transport: 'none',
      client: 'none',
      bucket: 'none',
      count: 1,
    },
  ],
};
beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'product-workers-'));
  bundle = path.join(directory, 'worker.mjs');
  await build({
    entryPoints: ['test/unit-utils/productTelemetryWorker.ts'],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'esm',
  });
});
afterEach(async () => {
  for (const child of children.splice(0)) await stop(child);
  await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const base = await mkdtemp(path.join(os.tmpdir(), 'product-process-'));
  fixtureRoots.push(base);
  const root = path.join(base, 'installation');
  const store = new InstallationStore(root, { notice: () => {}, now: () => Date.parse('2026-10-27T10:12:34Z') });
  return { root, store };
}
function waitFor(
  child: ChildProcess,
  predicate: (message: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Owned telemetry fixture did not respond'));
    }, 15000);
    const onMessage = (value: Record<string, unknown>) => {
      if (predicate(value)) {
        cleanup();
        resolve(value);
      }
    };
    const onExit = () => {
      cleanup();
      reject(new Error('Owned telemetry fixture exited early'));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.off('message', onMessage);
      child.off('exit', onExit);
    };
    child.on('message', onMessage);
    child.once('exit', onExit);
  });
}
async function worker(root: string, phase = '') {
  const child = fork(bundle, [root, phase], {
    env: createTestProcessEnvironment(),
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  children.push(child);
  await waitFor(child, (m) => m.ready === true);
  return child;
}
let requestId = 0;
async function request(child: ChildProcess, action: string, extra: Record<string, unknown> = {}) {
  const id = ++requestId;
  const result = waitFor(child, (m) => m.id === id);
  child.send({ id, action, ...extra });
  return result;
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGKILL');
  await exited;
}

describe('owned OS process installation transactions', () => {
  it('shares one notice/identity, sums concurrent deltas and exclusively claims each batch', async () => {
    const { root, store } = await fixture();
    // Set up Windows ACLs before child starts; admission itself remains process-concurrent.
    await store.control('enable');
    const workers = await Promise.all(Array.from({ length: 4 }, () => worker(root)));
    let notices = 0;
    const bodies: string[] = [];
    workers.forEach((w) =>
      w.on('message', (m: { notice?: boolean; body?: string }) => {
        if (m.notice) notices++;
        if (m.body) bodies.push(m.body);
      }),
    );
    const admissions = await Promise.all(workers.map((w) => request(w, 'admit')));
    expect(admissions.every((r) => !r.error)).toBe(true);
    const tickets = admissions.map((r) => r.result as AdmissionTicket);
    expect(new Set(tickets.map((t) => t.installationId)).size).toBe(1);
    expect(notices).toBe(1);
    await Promise.all(workers.map((w, i) => request(w, 'append', { ticket: tickets[i], facts })));
    await Promise.all(workers.map((w, i) => request(w, 'send', { ticket: tickets[i] })));
    expect(bodies).toHaveLength(1);
    expect(JSON.parse(bodies[0]).summaries[0].counters[0].count).toBe(4);
    expect(await store.status()).toMatchObject({ queuedSummaries: 0 });
  }, 30000);
  it.each(['before-write', 'after-write', 'before-rename', 'after-rename', 'notice'])(
    'recovers a demonstrably dead main owner at %s without replaying orphan writes',
    async (phase) => {
      const { root, store } = await fixture();
      const old = (await store.admit())!;
      // notice checkpoint needs a fresh notice transition, other stages interrupt reset commit.
      if (phase === 'notice') {
        const fresh = await fixture();
        const paused = await worker(fresh.root, phase);
        const pausedAt = waitFor(paused, (m) => m.checkpoint === phase);
        paused.send({ id: ++requestId, action: 'admit' });
        await pausedAt;
        await stop(paused);
        expect(await fresh.store.admit()).toBeDefined();
        return;
      }
      const child = await worker(root, phase);
      const checkpoint = waitFor(child, (m) => m.checkpoint === phase);
      child.send({ id: ++requestId, action: 'reset' });
      await checkpoint;
      await stop(child);
      const next = (await store.admit())!;
      if (phase === 'after-rename') expect(next.installationId).not.toBe(old.installationId);
      else expect(next.installationId).toBe(old.installationId);
      expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    },
    30000,
  );
  it.each(['before-owner', 'guard-created'])(
    'fails closed at ambiguous %s and supports explicit offline coordination cleanup',
    async (phase) => {
      const { root, store } = await fixture();
      const ticket = (await store.admit())!;
      const child = await worker(root, phase);
      const checkpoint = waitFor(child, (m) => m.checkpoint === phase);
      child.send({ id: ++requestId, action: 'admit' });
      await checkpoint;
      await stop(child);
      expect(await store.status()).toMatchObject({ coordination: 'busy-or-ambiguous' });
      await expect(store.admit()).rejects.toThrow('offline recovery');
      // All owned producers are stopped. Remove coordination only, retain authoritative state/tombstone.
      await rm(path.join(root, 'lock'), { recursive: true, force: true });
      await rm(path.join(root, 'guard'), { recursive: true, force: true });
      expect((await store.admit())!.installationId).toBe(ticket.installationId);
    },
    30000,
  );
  it('does not steal a paused live owner; simultaneous reapers preserve one identity', async () => {
    const { root, store } = await fixture();
    const child = await worker(root, 'notice');
    const checkpoint = waitFor(child, (m) => m.checkpoint === 'notice');
    child.send({ id: ++requestId, action: 'admit' });
    await checkpoint;
    await expect(store.admit()).rejects.toThrow('busy or ambiguous');
    await stop(child);
    const reapers = await Promise.all([worker(root), worker(root)]);
    const results = await Promise.all(reapers.map((w) => request(w, 'admit')));
    expect(results.every((r) => !r.error)).toBe(true);
    expect(new Set(results.map((r) => (r.result as AdmissionTicket).installationId)).size).toBe(1);
  }, 30000);
  it.each(['write-failure', 'rename-failure'])(
    'does not dispatch or leave temporary data when %s prevents final commit',
    async (phase) => {
      const { root, store } = await fixture();
      const ticket = (await store.admit())!;
      await store.append(ticket, {
        occurred_at: '2026-10-27T10:00:00Z',
        version: '0.39.3',
        os: 'darwin',
        arch: 'arm64',
        node_major: 24,
        ci: false,
        counters: [
          {
            kind: 'command',
            name: 'inspect',
            outcome: 'success',
            transport: 'none',
            client: 'none',
            bucket: 'none',
            count: 1,
          },
        ],
      });
      const child = await worker(root, phase);
      const bodies: string[] = [];
      child.on('message', (m: { body?: string }) => {
        if (m.body) bodies.push(m.body);
      });
      expect(await request(child, 'send', { ticket })).toMatchObject({ error: true });
      expect(bodies).toEqual([]);
      expect(await store.status()).toMatchObject({ queuedSummaries: 1 });
      expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    },
    30000,
  );
  it('never replays a final claim when the sender is killed after durable removal', async () => {
    const { root, store } = await fixture();
    const ticket = (await store.admit())!;
    await store.append(ticket, {
      ...facts,
      os: 'darwin',
      arch: 'arm64',
      counters: [
        {
          kind: 'command',
          name: 'inspect',
          outcome: 'success',
          transport: 'none',
          client: 'none',
          bucket: 'none',
          count: 1,
        },
      ],
    });
    const child = await worker(root, 'after-rename');
    const checkpoint = waitFor(child, (m) => m.checkpoint === 'after-rename');
    child.send({ id: ++requestId, action: 'send', ticket });
    await checkpoint;
    await stop(child);
    const next = (await store.admit())!;
    const bodies: string[] = [];
    await store.attemptSend(next, (body) => {
      bodies.push(body);
    });
    expect(bodies).toEqual([]);
  }, 30000);
  it('rejects another process stale ticket after reset/disable/re-enable, and never restores corrupt or missing state', async () => {
    const { root, store } = await fixture();
    const child = await worker(root);
    const ticket = (await request(child, 'admit')).result as AdmissionTicket;
    await store.control('reset');
    expect(await request(child, 'append', { ticket, facts })).toMatchObject({ result: false });
    await store.control('disable');
    await store.control('enable');
    expect(await request(child, 'append', { ticket, facts })).toMatchObject({ result: false });
    await rm(path.join(root, 'state.json'));
    expect(await request(child, 'append', { ticket, facts })).toMatchObject({ result: false });
    await store.control('enable');
    const file = path.join(root, 'state.json');
    const state = JSON.parse(await readFile(file, 'utf8'));
    expect(state.installationId).toBeUndefined();
  }, 30000);
});
