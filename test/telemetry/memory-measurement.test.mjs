import assert from 'node:assert/strict';

import test from 'node:test';

import { createMemoryPair, pairedInterval } from '../../scripts/telemetry/memory-measurement.mjs';

test('paired memory lanes share admissions, exact counts and duration, including slow batches', async () => {
  let clock = 0;
  const pair = createMemoryPair({
    concurrency: 2,
    intervalMs: 100,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  });
  const calls = [[], []];
  const first = pair.run(5, async (index) => {
    calls[0].push(index);
    if (index === 0) clock += 150;
  });
  assert.deepEqual(calls, [[], []], 'A lane must wait for its partner before admission');
  const second = pair.run(5, async (index) => {
    calls[1].push(index);
  });
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(calls, [
    [0, 1, 2, 3, 4],
    [0, 1, 2, 3, 4],
  ]);
  assert.deepEqual(a.admissionOffsetsMs, [0, 150, 250]);
  assert.deepEqual(b.admissionOffsetsMs, a.admissionOffsetsMs);
  assert.equal(a.elapsedMs, 350);
  assert.equal(b.elapsedMs, a.elapsedMs);
  assert.equal(a.operations, 5);
  // A subsequent phase has its own shared clock after both lanes arrive.
  const next = await Promise.all([pair.run(1, async () => {}), pair.run(1, async () => {})]);
  assert.deepEqual(next[0].admissionOffsetsMs, [0]);
});

test('a failing request rejects both lanes without admitting further batches', async () => {
  const pair = createMemoryPair({ concurrency: 1, intervalMs: 1 });
  const seen = [];
  const results = await Promise.allSettled([
    pair.run(10, async () => {
      throw new Error('request failed');
    }),
    pair.run(10, async (index) => {
      seen.push(index);
    }),
  ]);
  assert(results.every((result) => result.status === 'rejected' && result.reason.message === 'request failed'));
  assert.deepEqual(seen, [0]);
});

test('startup failure aborts a waiting partner, and unequal work cannot pass', async () => {
  const pair = createMemoryPair({ concurrency: 1, intervalMs: 1 });
  const waiting = pair.run(1, async () => {});
  pair.abort(new Error('startup failed'));
  await assert.rejects(waiting, /startup failed/);
  await assert.rejects(
    pair.run(1, async () => {}),
    /startup failed/,
  );
  const other = createMemoryPair({ concurrency: 1, intervalMs: 1 });
  const results = await Promise.allSettled([other.run(1, async () => {}), other.run(2, async () => {})]);
  assert(results.every((result) => result.status === 'rejected'));
});

test('paired interval preserves negative overhead and uncertainty instead of clamping noise to a pass', () => {
  assert.deepEqual(pairedInterval([-2, -2, -2]), { mean: -2, lower: -2, upper: -2 });
  const noisy = pairedInterval([0, 64, 128]);
  assert.equal(noisy.mean, 64);
  assert(noisy.lower < 64 && noisy.upper > 64);
  assert.throws(() => pairedInterval([1, 2]));
  assert.throws(() => pairedInterval([1, 2, NaN]));
});
