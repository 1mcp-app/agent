import assert from 'node:assert/strict';

import test from 'node:test';

import { startCapacityResource } from '../../scripts/telemetry/capacity.mjs';

for (const name of ['collector', 'relay', 'backend', 'runtime', 'clients']) {
  test(`${name} startup rejection cannot be reported as confirmed cleanup`, async () => {
    const report = {};
    const failure = new Error('startup failed before returning an owned handle');
    await assert.rejects(
      startCapacityResource(report, name, async () => {
        throw failure;
      }),
      (error) => error === failure,
    );
    assert.deepEqual(report.cleanupErrors, [
      { name, message: 'Startup failed before ownership was returned; cleanup unconfirmed' },
    ]);
    // The workflow only permits preparation/timing when this exact assertion passes.
    assert.throws(() => assert.deepEqual(report.cleanupErrors, []));
  });
}

test('successful startup preserves the handle and permits confirmed cleanup after a workload failure', async () => {
  const report = {};
  let closed = false;
  const handle = {
    close: async () => {
      closed = true;
    },
  };
  assert.equal(await startCapacityResource(report, 'backend', async () => handle), handle);
  report.verdict = 'fail';
  report.cleanupErrors ??= [];
  await handle.close();
  assert(closed);
  assert.deepEqual(report.cleanupErrors, []);
});
