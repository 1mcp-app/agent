import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { InstallationStore } from './installationStore.js';
import { ProductUsageProducer } from './producer.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'product-facade-'));
  roots.push(root);
  const now = () => Date.parse('2026-10-27T10:12:34Z');
  const store = new InstallationStore(path.join(root, 'state'), { notice: vi.fn(), now });
  const bodies: string[] = [];
  const producer = new ProductUsageProducer({
    store,
    now,
    dimensions: { version: '0.39.3', os: 'darwin', arch: 'arm64', node_major: 24, ci: false },
    dispatch: (body) => {
      bodies.push(body);
    },
  });
  return { producer, store, bodies };
}
describe('closed nonblocking collection facade', () => {
  it('sends runtime startup at readiness once and on the five minute opportunity', async () => {
    const { producer, bodies } = await fixture();
    await producer.settled();
    producer.startRuntime();
    const startup = producer.beginCommand('serve');
    startup.finish('success');
    startup.finish('failure');
    await producer.settled();
    expect(bodies).toHaveLength(0);
    vi.useFakeTimers();
    producer.stopRuntime();
    producer.startRuntime();
    await vi.advanceTimersByTimeAsync(300_000);
    await producer.settled();
    expect(JSON.parse(bodies[0]).summaries[0].counters).toEqual([
      {
        kind: 'command',
        name: 'serve',
        outcome: 'success',
        transport: 'none',
        client: 'none',
        bucket: 'none',
        count: 1,
      },
    ]);
    producer.stopRuntime();
    vi.useRealTimers();
  });
  it('observes reset without retagging an earlier startup and admits later activity separately', async () => {
    const { producer, store, bodies } = await fixture();
    await producer.settled();
    const old = producer.beginCommand('serve');
    producer.startRuntime();
    await store.control('reset');
    vi.useFakeTimers();
    producer.stopRuntime();
    producer.startRuntime();
    await vi.advanceTimersByTimeAsync(4_000);
    await producer.settled();
    old.finish('success');
    await producer.settled();
    expect((await store.status()).identityPresent).toBe(false);
    producer.recordFeature('admin_open', 'success');
    await producer.settled();
    producer.recordFeature('admin_open', 'success');
    await producer.settled();
    await vi.advanceTimersByTimeAsync(300_000);
    await producer.settled();
    expect(JSON.parse(bodies[0]).summaries[0].counters).toEqual([
      {
        kind: 'feature',
        name: 'admin_open',
        outcome: 'success',
        transport: 'none',
        client: 'none',
        bucket: 'none',
        count: 1,
      },
    ]);
    producer.stopRuntime();
    vi.useRealTimers();
  });
  it('keeps disabled idle runtimes identity-free and aborts delivery after a live disable', async () => {
    const { producer, store } = await fixture();
    await producer.settled();
    await store.control('disable');
    const abortDelivery = vi.fn();
    const runtime = new ProductUsageProducer({
      store,
      now: () => Date.parse('2026-10-27T10:12:34Z'),
      dimensions: { version: '0.39.3', os: 'darwin', arch: 'arm64', node_major: 24, ci: false },
      dispatch: vi.fn(),
      abortDelivery,
    });
    await runtime.settled();
    vi.useFakeTimers();
    runtime.startRuntime();
    await vi.advanceTimersByTimeAsync(300_000);
    await runtime.settled();
    expect((await store.status()).queuedSummaries).toBe(0);
    expect(abortDelivery).not.toHaveBeenCalled();
    await store.control('enable');
    runtime.recordFeature('admin_open', 'success');
    await runtime.settled();
    runtime.recordFeature('admin_open', 'success');
    await runtime.settled();
    await store.control('disable');
    await vi.advanceTimersByTimeAsync(2_000);
    await runtime.settled();
    expect(abortDelivery).toHaveBeenCalledOnce();
    expect((await store.status()).queuedSummaries).toBe(0);
    runtime.stopRuntime();
    vi.useRealTimers();
  });
  it('does not manufacture activity from configuration snapshots or idle flushes', async () => {
    const { producer, store, bodies } = await fixture();
    await producer.settled();
    producer.observeConfiguration('servers', 12);
    vi.useFakeTimers();
    producer.startRuntime();
    await vi.advanceTimersByTimeAsync(300_000);
    await producer.settled();
    expect(bodies).toHaveLength(0);
    expect((await store.status()).queuedSummaries).toBe(0);
    producer.recordFeature('admin_open', 'success');
    await producer.settled();
    await vi.advanceTimersByTimeAsync(300_000);
    await producer.settled();
    expect(JSON.parse(bodies[0]).summaries[0].counters).toHaveLength(2);
    expect(JSON.parse(bodies[0]).summaries[0].counters[1]).toMatchObject({
      kind: 'configuration',
      name: 'servers',
      bucket: '6-20',
      count: 1,
    });
    producer.stopRuntime();
    vi.useRealTimers();
  });
  it('counts each admitted inspect completion once without accepting command data', async () => {
    const { producer, bodies } = await fixture();
    await producer.settled();
    const completion = producer.beginCommand('inspect');
    completion.finish('success');
    completion.finish('failure');
    await producer.settled();
    expect(bodies).toHaveLength(1);
    expect(JSON.parse(bodies[0])).toMatchObject({
      schema_version: 1,
      summaries: [
        {
          occurred_at: '2026-10-27T10:12:34Z',
          counters: [{ kind: 'command', name: 'inspect', outcome: 'success', count: 1 }],
        },
      ],
    });
    expect(Object.keys(JSON.parse(bodies[0]).summaries[0]).sort()).toEqual([
      'arch',
      'ci',
      'counters',
      'installation_id',
      'node_major',
      'occurred_at',
      'os',
      'version',
    ]);
  });
  it('captures a first command whose asynchronous admission completes before the command', async () => {
    const { producer, bodies } = await fixture();
    const completion = producer.beginCommand('inspect');
    await producer.settled();
    completion.finish('success');
    await producer.settled();
    expect(bodies).toHaveLength(1);
  });
  it('drops completion before admission and never delays command completion on stalled state', async () => {
    const { store, producer: initial } = await fixture();
    await initial.settled();
    vi.spyOn(store, 'admit').mockReturnValue(new Promise(() => {}));
    const dispatch = vi.fn();
    const producer = new ProductUsageProducer({
      store,
      now: Date.now,
      dimensions: { version: '0.39.3', os: 'darwin', arch: 'arm64', node_major: 24, ci: false },
      dispatch,
    });
    expect(producer.beginCommand('inspect').finish('success')).toBeUndefined();
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('does not send old command facts after reset wins', async () => {
    const { producer, store, bodies } = await fixture();
    await producer.settled();
    const completion = producer.beginCommand('inspect');
    await store.control('reset');
    completion.finish('success');
    await producer.settled();
    expect(bodies).toHaveLength(0);
  });
});
