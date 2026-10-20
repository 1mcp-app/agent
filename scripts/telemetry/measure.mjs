import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createCollector } from '../../test/telemetry/fake-collector.mjs';
import { startModernBackend } from '../../test/telemetry/modern-backend-process.mjs';

const plan = JSON.parse(await readFile(new URL('./workload.json', import.meta.url)));
const input = process.argv[2];
assert(input, 'Usage: node scripts/telemetry/measure.mjs <run-config.json> <report.json>');
const settings = JSON.parse(await readFile(input));
const output = process.argv[3];
assert(output, 'A report path is required');
assert(settings.repetitions >= 3, 'At least three matched repetitions; add more when noisy');
for (const mode of plan.order) {
  assert(Array.isArray(settings.modes[mode].command), `Missing explicit ${mode} runtime command`);
}
assert(settings.baselineDescription, 'Document how the baseline omits propagation');
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(
  execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  '',
  'Commit source changes before performance acceptance',
);
assert.equal(
  settings.baselineDescription.sourceSha,
  sha,
  'Baseline is stale; rerun prepare-performance at the current commit',
);
// Persist the exact workload BEFORE starting any process. Do not store secret env values.
const report = {
  sha,
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  plan,
  baselineDescription: settings.baselineDescription,
  started: new Date().toISOString(),
  samples: [],
  verdict: 'incomplete',
};
await writeFile(output, JSON.stringify(report, null, 2));
const quantile = (values, p) =>
  [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];
const collector = await createCollector({ maxRequests: 16 });
async function run(mode, round) {
  const config = settings.modes[mode];
  const temporary = await mkdtemp(join(tmpdir(), '1mcp-perf-'));
  const probe = join(temporary, 'probe.jsonl');
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith('OTEL_') && !key.startsWith('ONE_MCP_')),
    ),
    ...config.env,
    TELEMETRY_ACCEPTANCE_PROBE: probe,
  };
  env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(fileURLToPath(new URL('./runtime-probe.mjs', import.meta.url))).href}`;
  if (mode === 'healthy' || mode === 'outage') {
    env.OTEL_TRACES_EXPORTER = 'otlp';
    env.OTEL_METRICS_EXPORTER = 'otlp';
    env.OTEL_EXPORTER_OTLP_ENDPOINT = collector.url;
    env.OTEL_TRACES_SAMPLER = 'traceidratio';
    env.OTEL_TRACES_SAMPLER_ARG = '0.1';
  }
  collector.respond({ status: mode === 'outage' ? 503 : 200 });
  let child, backend, mcp;
  let spawnError;
  try {
    backend = await startModernBackend({ stderrPath: `${output}.${round}.${mode}.backend.stderr.log` });
    const configPath = join(temporary, 'mcp.json');
    await writeFile(configPath, JSON.stringify({ mcpServers: { fixture: backend.config } }));
    const args = config.command.slice(1);
    for (const [option, value] of [
      ['--config', configPath],
      ['--config-dir', temporary],
    ]) {
      const index = args.indexOf(option);
      assert(index >= 0 && index + 1 < args.length, `Missing runtime ${option}`);
      args[index + 1] = value;
    }
    const stderr = openSync(`${output}.${round}.${mode}.runtime.stderr.log`, 'w', 0o600);
    try {
      child = spawn(config.command[0], args, { env, cwd: temporary, stdio: ['ignore', 'ignore', stderr] });
    } finally {
      closeSync(stderr);
    }
    child.once('error', (error) => {
      spawnError = error;
    });
    for (let attempt = 0; ; attempt++) {
      if (spawnError) throw spawnError;
      assert(child.exitCode === null, 'Runtime exited before readiness');
      try {
        if ((await fetch(config.healthUrl, { signal: AbortSignal.timeout(500) })).ok) break;
      } catch {
        /* Retry until the bounded readiness deadline. */
      }
      assert(attempt < 100, 'Runtime readiness timed out');
      await delay(100);
    }
    const client = await import('@modelcontextprotocol/sdk/client/index.js');
    const transport = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    mcp = new client.Client({ name: 'telemetry-acceptance', version: '1.0.0' });
    await mcp.connect(new transport.StreamableHTTPClientTransport(new URL(config.mcpUrl)));
    async function batch(count, measure) {
      let next = 0;
      const latencies = [];
      const start = performance.now();
      let completed = 0;
      await Promise.all(
        Array.from({ length: plan.concurrency }, async () => {
          while (next < count || (measure && performance.now() - start < 60_000)) {
            const index = next++ % 100;
            const began = performance.now();
            if (index < 80) {
              await mcp.listTools();
            } else if (index < 99) {
              const result = await mcp.callTool({ name: settings.echoTool, arguments: { message: 'x'.repeat(4096) } });
              assert(!result.isError, 'Echo failed');
              assert.equal(result.content[0].text, 'x'.repeat(4096), 'Echo result changed');
            } else {
              const result = await mcp.callTool({ name: settings.errorTool, arguments: {} });
              assert(result.isError, 'Expected Tool isError');
            }
            completed++;
            if (measure) latencies.push(performance.now() - began);
          }
        }),
      );
      return {
        p95Ms: quantile(latencies, 0.95),
        operations: completed,
        throughput: completed / ((performance.now() - start) / 1000),
      };
    }
    await batch(plan.warmupRequests, false);
    await delay(plan.settleMs);
    // Leave at least one full probe interval after warm-up.
    await delay(300);
    await writeFile(probe, '');
    const result = await batch(plan.measuredRequests, true);
    await delay(300);
    await mcp.close();
    assert((await fetch(config.healthUrl)).ok, 'Readiness changed during workload');
    const readings = (await readFile(probe, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((sample) => sample.pid === child.pid);
    assert(readings.length > 0, 'No runtime RSS/event-loop samples; acceptance incomplete');
    return {
      mode,
      round,
      ...result,
      rss: Math.max(...readings.map((v) => v.rss)),
      eventLoopP99Ms: Math.max(...readings.map((v) => v.eventLoopP99Ms)),
    };
  } finally {
    try {
      if (child) {
        child.kill('SIGTERM');
        for (let attempt = 0; child.exitCode === null && child.signalCode === null && attempt < 70; attempt++)
          await delay(100);
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
          for (let attempt = 0; child.exitCode === null && child.signalCode === null && attempt < 30; attempt++)
            await delay(100);
          assert(child.exitCode !== null || child.signalCode !== null, 'Owned benchmark runtime did not exit');
        }
      }
      await mcp?.close().catch(() => {});
    } finally {
      try {
        await backend?.close();
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    }
  }
}
try {
  for (let round = 0; round < settings.repetitions; round++) {
    const order = [...plan.order.slice(round % 4), ...plan.order.slice(0, round % 4)];
    for (const mode of order) {
      report.samples.push(await run(mode, round));
      await writeFile(output, JSON.stringify(report, null, 2));
    }
  }
  // Conservative paired 95% interval. Student-t critical values (two-sided).
  const critical = (n) => (n < 4 ? 4.303 : n < 5 ? 3.182 : n < 6 ? 2.776 : n < 11 ? 2.571 : n < 31 ? 2.262 : 2.042);
  const interval = (values) => {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
    const width = critical(values.length) * Math.sqrt(variance / values.length);
    return { mean, lower: mean - width, upper: mean + width };
  };
  report.comparisons = [];
  for (const [mode, budget] of Object.entries(plan.budgets)) {
    const measures = {
      p95Regression: (a, b) => a.p95Ms / b.p95Ms - 1,
      throughputRegression: (a, b) => 1 - a.throughput / b.throughput,
      rssMiB: (a, b) => (a.rss - b.rss) / 1024 ** 2,
      eventLoopP99Ms: (a, b) => a.eventLoopP99Ms - b.eventLoopP99Ms,
    };
    for (const [metric, measure] of Object.entries(measures)) {
      if (!(metric in budget)) continue;
      const values = Array.from({ length: settings.repetitions }, (_, round) =>
        measure(
          report.samples.find((s) => s.mode === mode && s.round === round),
          report.samples.find((s) => s.mode === budget.relativeTo && s.round === round),
        ),
      );
      const bounds = interval(values);
      report.comparisons.push({
        mode,
        metric,
        budget: budget[metric],
        ...bounds,
        verdict: bounds.upper <= budget[metric] ? 'pass' : bounds.lower > budget[metric] ? 'fail' : 'inconclusive',
      });
    }
  }
  report.verdict = report.comparisons.some((c) => c.verdict === 'fail')
    ? 'fail'
    : report.comparisons.every((c) => c.verdict === 'pass')
      ? 'pass'
      : 'inconclusive';
} finally {
  await collector.close();
  await writeFile(output, JSON.stringify(report, null, 2));
}
if (report.verdict !== 'pass') process.exitCode = 1;
