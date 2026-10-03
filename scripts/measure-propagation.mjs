import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import { bootstrapTracing } from '../build/observability/tracing/bootstrap.js';
import {
  getActiveTraceCorrelation,
  injectTraceContext,
  withMcpTraceContext,
} from '../build/observability/tracing/context.js';

bootstrapTracing();
const cases = {
  absent: {},
  valid: {
    traceparent: '00-12345678901234567890123456789012-1234567890123456-01',
    tracestate: 'vendor=opaque',
    baggage: 'secret=forbidden',
  },
  malformed: { traceparent: ['bad', 'conflicting'], baggage: 'secret=forbidden' },
};
const output = [];
for (const [name, meta] of Object.entries(cases)) {
  const wire = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'fixture', arguments: { payload: 'x'.repeat(4096) }, _meta: meta },
  });
  async function batch(enabled, count) {
    const latencies = [];
    const start = performance.now();
    for (let i = 0; i < count; i += 32) {
      await Promise.all(
        Array.from({ length: Math.min(32, count - i) }, async () => {
          const began = performance.now();
          const frame = JSON.parse(wire);
          const business = { ...frame.params };
          delete business._meta;
          const processRequest = async () => {
            await Promise.resolve();
            const params = enabled ? injectTraceContext(business) : business;
            if (enabled) {
              assert.equal(Boolean(getActiveTraceCorrelation()), name === 'valid');
              assert.equal(params._meta?.baggage, undefined);
            }
            const sent = JSON.parse(JSON.stringify({ ...frame, params }));
            const response = JSON.parse(
              JSON.stringify({ id: sent.id, result: { content: [{ type: 'text', text: 'ok' }] } }),
            );
            assert.equal(response.result.content[0].text, 'ok');
          };
          if (enabled) await withMcpTraceContext(frame.params, processRequest);
          else await processRequest();
          assert.equal(getActiveTraceCorrelation(), undefined);
          latencies.push(performance.now() - began);
        }),
      );
    }
    return { ms: performance.now() - start, latencies };
  }
  await batch(false, 1000);
  await batch(true, 1000);
  global.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const baseline = { ms: 0, latencies: [] };
  const propagated = { ms: 0, latencies: [] };
  for (let round = 0; round < 5; round++) {
    for (const enabled of round % 2 ? [true, false] : [false, true]) {
      const result = await batch(enabled, 2000);
      const target = enabled ? propagated : baseline;
      target.ms += result.ms;
      target.latencies.push(...result.latencies);
    }
  }
  global.gc?.();
  const heapGrowth = process.memoryUsage().heapUsed - heapBefore;
  const p95 = (samples) => samples.sort((a, b) => a - b)[Math.floor(samples.length * 0.95)];
  const meanAddedMs = (propagated.ms - baseline.ms) / 10000;
  const p95AddedMs = p95(propagated.latencies) - p95(baseline.latencies);
  const result = {
    name,
    operations: 10000,
    concurrency: 32,
    baselineMs: baseline.ms,
    propagatedMs: propagated.ms,
    throughputRatio: baseline.ms / propagated.ms,
    meanAddedMs,
    p95AddedMs,
    heapGrowthBytes: heapGrowth,
  };
  output.push(result);
  assert(meanAddedMs <= 0.25);
  assert(p95AddedMs <= 1);
  assert(heapGrowth <= 16 * 1024 * 1024);
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, workloads: output }, null, 2));
