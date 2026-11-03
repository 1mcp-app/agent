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
describe('configuration observation contract', () => {
  it.each([
    [0, '0'],
    [1, '1'],
    [2, '2-5'],
    [5, '2-5'],
    [6, '6-20'],
    [20, '6-20'],
    [21, '21-100'],
    [100, '21-100'],
    [101, '101+'],
    [Number.MAX_SAFE_INTEGER, '101+'],
  ])('buckets %s before exporting counts', async (count, bucket) => {
    const { producer, bodies } = await fixture();
    await producer.settled();
    producer.observeConfiguration('tools', Number(count));
    producer.recordFeature('admin_open', 'success');
    await producer.settled();
    expect(JSON.parse(bodies[0]).summaries[0].counters[1]).toMatchObject({ name: 'tools', bucket, count: 1 });
  });

  it('uses the latest snapshot rather than the maximum and consumes it once per genuine activity', async () => {
    const { producer, bodies } = await fixture();
    await producer.settled();
    producer.observeConfiguration('servers', 999);
    producer.observeConfiguration('servers', 0);
    producer.observeConfiguration('servers', 0);
    producer.recordFeature('admin_open', 'success');
    await producer.settled();
    producer.recordFeature('admin_open', 'success');
    await producer.settled();
    expect(JSON.parse(bodies[0]).summaries[0].counters[1]).toMatchObject({ bucket: '0', count: 1 });
    expect(JSON.parse(bodies[1]).summaries[0].counters).toHaveLength(1);
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'drops malformed count %s without replacing the approved snapshot',
    async (count) => {
      const { producer, bodies } = await fixture();
      await producer.settled();
      producer.observeConfiguration('tools', 1);
      producer.observeConfiguration('tools', count);
      producer.recordFeature('admin_open', 'success');
      await producer.settled();
      expect(JSON.parse(bodies[0]).summaries[0].counters[1]).toMatchObject({ bucket: '1', count: 1 });
    },
  );
});
