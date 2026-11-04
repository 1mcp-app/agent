import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

export function pairedInterval(values) {
  assert(values.length >= 3 && values.every(Number.isFinite), 'Need at least three finite paired samples');
  const n = values.length;
  const critical = n < 4 ? 4.303 : n < 5 ? 3.182 : n < 6 ? 2.776 : n < 11 ? 2.571 : n < 31 ? 2.262 : 2.042;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  const width = critical * Math.sqrt(variance / n);
  return { mean, lower: mean - width, upper: mean + width };
}

// Both processes receive the same batches at the same times. The slower lane
// sets the pace; this measures memory at equal work, never timing performance.
export function createMemoryPair({ concurrency, intervalMs, now = () => performance.now(), sleep = delay }) {
  assert(Number.isInteger(concurrency) && concurrency > 0);
  assert(Number.isFinite(intervalMs) && intervalMs > 0);
  let waiting = [];
  let failure;
  function abort(error) {
    failure = error;
    for (const lane of waiting) lane.reject(error);
    waiting = [];
  }
  async function execute(lanes) {
    try {
      const count = lanes[0].count;
      assert.equal(lanes[1].count, count, 'Paired memory request counts differ');
      const start = now();
      const admissionOffsetsMs = [];
      const maxBatchMs = [0, 0];
      for (let next = 0; next < count; next += concurrency) {
        if (failure) throw failure;
        const began = now();
        admissionOffsetsMs.push(began - start);
        const results = await Promise.allSettled(
          lanes.map(async (lane, index) => {
            await Promise.all(
              Array.from({ length: Math.min(concurrency, count - next) }, (_, offset) => lane.request(next + offset)),
            );
            maxBatchMs[index] = Math.max(maxBatchMs[index], now() - began);
          }),
        );
        const rejected = results.find((result) => result.status === 'rejected');
        if (rejected) throw rejected.reason;
        await sleep(Math.max(0, intervalMs - (now() - began)));
      }
      const elapsedMs = now() - start;
      for (const [index, lane] of lanes.entries())
        lane.resolve({ operations: count, elapsedMs, admissionOffsetsMs, maxBatchMs: maxBatchMs[index] });
    } catch (error) {
      abort(error);
      for (const lane of lanes) lane.reject(error);
    }
  }
  return {
    abort,
    run(count, request) {
      assert(Number.isInteger(count) && count > 0);
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => {
        waiting.push({ count, request, resolve, reject });
        if (waiting.length !== 2) return;
        const lanes = waiting;
        waiting = [];
        void execute(lanes);
      });
    },
  };
}
