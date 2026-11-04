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

// Fixed slots match work and admission pacing. An overloaded host cannot produce acceptance evidence.
export async function pacedRequests({
  count,
  concurrency,
  intervalMs,
  request,
  now = () => performance.now(),
  sleep = delay,
}) {
  assert(Number.isInteger(count) && count > 0);
  assert(Number.isInteger(concurrency) && concurrency > 0);
  assert(Number.isFinite(intervalMs) && intervalMs > 0);
  const start = now();
  let maxBatchMs = 0;
  let maxStartLagMs = 0;
  for (let next = 0, slot = 0; next < count; next += concurrency, slot++) {
    const due = start + slot * intervalMs;
    await sleep(Math.max(0, due - now()));
    const began = now();
    maxStartLagMs = Math.max(maxStartLagMs, began - due);
    // A missed slot changes process age and GC history; never silently catch up.
    assert(began - due < intervalMs, 'Memory workload missed an admission slot');
    await Promise.all(
      Array.from({ length: Math.min(concurrency, count - next) }, (_, offset) => request(next + offset)),
    );
    maxBatchMs = Math.max(maxBatchMs, now() - began);
    assert(now() <= due + intervalMs, 'Memory workload overran its admission slot');
  }
  const durationMs = Math.ceil(count / concurrency) * intervalMs;
  await sleep(Math.max(0, start + durationMs - now()));
  return { operations: count, durationMs, elapsedMs: now() - start, maxBatchMs, maxStartLagMs };
}
