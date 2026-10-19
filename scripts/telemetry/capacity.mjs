import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { decodedPayloads } from '../../test/telemetry/collector-payloads.mjs';
import { createCollector } from '../../test/telemetry/fake-collector.mjs';
import { assertPrivatePayloads } from '../../test/telemetry/privacy-corpus.mjs';
import { startRuntime, waitUntil } from '../../test/telemetry/runtime-fixture.mjs';
import { startRealCollector } from './real-collector.mjs';

export async function runCapacity(output, binary) {
  assert(binary, 'Set OTELCOL_BINARY to verified official0.163.1 executable');
  const plan = JSON.parse(await readFile(new URL('./capacity-workload.json', import.meta.url)));
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(
    execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
    '',
    'Capacity acceptance requires clean source',
  );
  const report = {
    sha,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    plan,
    started: new Date().toISOString(),
    windows: [],
    verdict: 'incomplete',
  };
  await writeFile(output, JSON.stringify(report, null, 2));
  let real, collector, runtime;
  try {
    real = await startRealCollector(binary);
    collector = await createCollector({ maxRequests: 2048 });
    runtime = await startRuntime({
      collector,
      admin: true,
      logLevel: 'error',
      probe: output + '.probe.jsonl',
      env: {
        ACCEPTANCE_CAPACITY_TOOLS: String(plan.uniqueToolIdentities),
        OTEL_BSP_MAX_QUEUE_SIZE: String(plan.queueSize),
        OTEL_BSP_MAX_EXPORT_BATCH_SIZE: String(plan.batchSize),
        OTEL_BSP_EXPORT_TIMEOUT: String(plan.exportTimeoutMs),
        OTEL_EXPORTER_OTLP_TIMEOUT: String(plan.exportTimeoutMs),
        OTEL_BSP_SCHEDULE_DELAY: '1000',
      },
    });
    const cookie = await runtime.login();
    const health = async () => {
      const response = await fetch(runtime.url + '/admin/api/runtime/health', { headers: { cookie } });
      assert.equal(response.status, 200);
      return (await response.json()).telemetry;
    };
    const tools = runtime.tools.filter((tool) => tool.name.includes('private_tool_'));
    assert.equal(tools.length, plan.uniqueToolIdentities);
    let cursor = 0;
    async function work(count, durationMs = 0) {
      const start = performance.now();
      let admitted = 0;
      await Promise.all(
        Array.from({ length: plan.concurrency }, async () => {
          while (admitted < count || performance.now() - start < durationMs) {
            admitted++;
            const tool = tools[cursor++ % tools.length];
            const result = await runtime.client.callTool({ name: tool.name, arguments: {} });
            assert.equal(result.content[0].text, 'capacity-ok');
            assert(!result.isError);
          }
        }),
      );
      return admitted;
    }
    const samples = async () =>
      (await readFile(output + '.probe.jsonl', 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((sample) => sample.pid === runtime.child.pid);
    collector.respond({ status: 200, forwardTo: real.url });
    await work(plan.warmupOperations);
    await delay(1000);
    const before = await samples();
    assert(before.length);
    const baselineRss = before.at(-1).rss;
    report.baselineRss = baselineRss;
    collector.respond({ status: 503, delayMs: plan.exportTimeoutMs });
    for (let window = 0; window < plan.windows; window++) {
      const index = (await samples()).length;
      const operations = await work(plan.minimumOperationsPerWindow, plan.windowSeconds * 1000);
      const readings = (await samples()).slice(index);
      assert(readings.length);
      const sorted = readings.map((sample) => sample.rss).sort((a, b) => a - b);
      const state = await health();
      assert((await fetch(runtime.url + '/health/ready')).ok, 'Collector stall changed runtime readiness');
      report.windows.push({
        window,
        operations,
        maxRss: sorted.at(-1),
        medianRss: sorted[Math.floor(sorted.length / 2)],
        state,
      });
      await writeFile(output, JSON.stringify(report, null, 2));
    }
    assert(
      report.windows
        .slice(-3)
        .every((window) => window.state.traces.dropped > 0 && window.state.traces.queueUse === 'high'),
      'Workload did not sustain actual maxqueue pressure; capacity acceptance unproven',
    );
    assert(
      Math.max(...report.windows.map((window) => window.maxRss)) - baselineRss <= plan.rssEnvelopeMiB * 1024 ** 2,
      'RSS exceeded approved active envelope',
    );
    const tail = report.windows.slice(-3).map((window) => window.medianRss);
    assert(
      Math.max(...tail) - Math.min(...tail) <= plan.plateauLastThreeWindowSpreadMiB * 1024 ** 2,
      'RSS did not plateau under sustained pressure',
    );
    collector.respond({ status: 200, forwardTo: real.url });
    await waitUntil(
      async () => {
        await work(32);
        return (await health()).traces.state === 'healthy';
      },
      'Actual maxqueue status did not recover',
      plan.recoveryDeadlineMs,
      1000,
    );
    report.finalState = await health();
    await runtime.stop();
    await real.stop();
    const payloads = await decodedPayloads(real);
    assertPrivatePayloads(payloads);
    const metrics = payloads
      .flatMap((payload) => payload.resourceMetrics ?? [])
      .flatMap((resource) => resource.scopeMetrics ?? [])
      .flatMap((scope) => scope.metrics ?? []);
    assert(metrics.length > 0, 'No decoded actual runtime metrics');
    for (const metric of metrics) {
      const points = (metric.histogram ?? metric.sum ?? metric.gauge)?.dataPoints ?? [];
      const cap = metric.histogram ? 1024 : metric.sum?.isMonotonic ? 512 : 256;
      assert(points.length <= cap, `Actual runtime ${metric.name} exceeded readercap`);
      assert(!JSON.stringify(points).includes('private_tool_'), 'Raw toolidentities entered metric series');
    }
    assert(!JSON.stringify(payloads).includes('private_tool_'), 'Raw tool identities entered decoded signals');
    report.verdict = 'pass';
  } catch (error) {
    report.error = error.message;
    report.verdict = 'fail';
    throw error;
  } finally {
    report.cleanupErrors = [];
    for (const [name, cleanup] of [
      ['runtime', () => runtime?.close()],
      ['relay', () => collector?.close()],
      ['collector', () => real?.cleanup()],
    ]) {
      try {
        await cleanup();
      } catch (error) {
        report.cleanupErrors.push({ name, message: error.message });
      }
    }
    if (report.cleanupErrors.length) report.verdict = 'fail';
    await writeFile(output, JSON.stringify(report, null, 2));
  }
  if (report.cleanupErrors.length) throw new Error('Capacity cleanup failed; inspect report');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv[2], 'Usage: node scripts/telemetry/capacity.mjs <report.json>');
  await runCapacity(resolve(process.argv[2]), process.env.OTELCOL_BINARY);
}
