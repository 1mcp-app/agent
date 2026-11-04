import assert from 'node:assert/strict';

import test from 'node:test';

import { pacedRequests, pairedInterval } from '../../scripts/telemetry/memory-measurement.mjs';

test('paced memory workload fixes admission times, concurrency, exact count and final duration', async () => {
  let clock = 0;
  const calls = [];
  const result = await pacedRequests({
    count: 5,
    concurrency: 2,
    intervalMs: 100,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    request: async (index) => {
      calls.push([index, clock]);
    },
  });
  assert.deepEqual(calls, [
    [0, 0],
    [1, 0],
    [2, 100],
    [3, 100],
    [4, 200],
  ]);
  assert.equal(result.operations, 5);
  assert.equal(result.elapsedMs, 300);
});

test('slow work and missed slots reject instead of changing the comparison workload', async () => {
  for (const lateStart of [false, true]) {
    let clock = 0;
    await assert.rejects(
      pacedRequests({
        count: 4,
        concurrency: 2,
        intervalMs: 100,
        now: () => clock,
        sleep: async (ms) => {
          clock += ms + (lateStart ? 101 : 0);
        },
        request: async () => {
          clock += 101;
        },
      }),
      /admission slot/,
    );
  }
});

test('paired interval preserves negative overhead and uncertainty instead of clamping noise to a pass', () => {
  assert.deepEqual(pairedInterval([-2, -2, -2]), { mean: -2, lower: -2, upper: -2 });
  const noisy = pairedInterval([0, 64, 128]);
  assert.equal(noisy.mean, 64);
  assert(noisy.lower < 64 && noisy.upper > 64);
  assert.throws(() => pairedInterval([1, 2]));
  assert.throws(() => pairedInterval([1, 2, NaN]));
});
