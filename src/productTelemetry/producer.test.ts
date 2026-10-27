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
    const { store } = await fixture();
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
