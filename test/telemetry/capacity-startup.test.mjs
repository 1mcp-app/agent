import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import test from 'node:test';

import { preserveCapacityRuntimeLog, startCapacityResource } from '../../scripts/telemetry/capacity.mjs';

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

test('capacity failure retains only a bounded runtime log tail without changing the original error', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'capacity-log-'));
  const output = join(directory, 'report.json');
  const report = { error: 'original workload failure' };
  try {
    await preserveCapacityRuntimeLog(
      report,
      { readLog: async () => 'x'.repeat(100000) + 'ORIGINAL_EXCEPTION' },
      output,
    );
    const retained = await readFile(output + '.runtime-error.log');
    assert.equal(retained.length, 65536);
    assert(retained.toString().endsWith('ORIGINAL_EXCEPTION'));
    assert.equal(report.error, 'original workload failure');
    assert.equal(report.runtimeDiagnostic.retainedBytes, 65536);
    assert.equal(report.runtimeDiagnostic.truncated, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('capacity log read/write failures record a gap and preserve the workload error', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'capacity-log-gap-'));
  try {
    for (const runtime of [
      undefined,
      {
        readLog: async () => {
          throw new Error('read failed');
        },
      },
      { readLog: async () => 'error evidence' },
    ]) {
      const report = { error: 'original workload failure' };
      await preserveCapacityRuntimeLog(report, runtime, join(directory, 'missing-parent', 'report.json'));
      assert.equal(report.error, 'original workload failure');
      assert.equal(report.runtimeDiagnostic.gap, 'Runtime error log unavailable or could not be retained');
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
