import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import { test } from 'vitest';

import { createCollector } from './fake-collector.mjs';
import { startRuntime, waitUntil } from './runtime-fixture.mjs';

const variants = process.env.ONE_MCP_TEST_BINARY
  ? [{ name: 'SEA', executable: resolve(process.env.ONE_MCP_TEST_BINARY), entry: '' }]
  : [{ name: 'Node', executable: process.execPath, entry: resolve('build/index.js') }];

for (const variant of variants) {
  test(`${variant.name}: authenticated supervised stop preserves readiness ownership, telemetry status and cleanup deadline`, async () => {
    const collector = await createCollector();
    const runtime = await startRuntime({
      collector,
      ...variant,
      background: true,
      env: {
        OTEL_EXPORTER_OTLP_TIMEOUT: '30000',
        OTEL_BSP_EXPORT_TIMEOUT: '30000',
        OTEL_BSP_SCHEDULE_DELAY: '60000',
        OTEL_METRIC_EXPORT_INTERVAL: '300000',
      },
    });
    try {
      const status = await runtime.execute(['serve', '--status']);
      assert(/telemetry/i.test(status.stdout), 'Supervisor status omitted worker telemetry');
      assert(!status.stdout.includes(collector.url), 'Supervisor telemetry exposed export endpoint');
      assert((await fetch(runtime.url + '/health/ready')).ok);
      collector.respond({ status: 503, delayMs: 10000 });
      const began = performance.now();
      await runtime.stop();
      const stoppedAt = performance.now();
      assert(stoppedAt - began <= 30_000, 'Supervised stop exceeded the existing owner retirement limit');
      const flushes = collector.requests.filter((request) => request.receivedAt >= began);
      assert(flushes.length > 0, 'No post-drain telemetry flush was observed');
      await waitUntil(
        () => flushes.every((request) => request.closedAt !== null),
        'Exporter sockets survived owner retirement',
        1000,
      );
      const flushBegan = Math.min(...flushes.map((request) => request.receivedAt));
      const flushEnded = Math.max(...flushes.map((request) => request.closedAt));
      assert(
        flushEnded - flushBegan <= 5500,
        'Post-drain telemetry flush exceeded five seconds plus scheduling allowance',
      );
      process.stdout.write(
        JSON.stringify({
          phase: 'supervised-stop',
          cliAndDrainMs: flushBegan - began,
          observedFlushMs: flushEnded - flushBegan,
          retirementAndCliMs: stoppedAt - flushEnded,
          totalMs: stoppedAt - began,
        }) + '\n',
      );
      assert(
        collector.requests.some((request) => request.path === '/v1/traces'),
        'Supervised worker did not attempt telemetry flush',
      );
      const stopped = await runtime.execute(['serve', '--status'], { acceptExitCodes: [3] });
      assert(/not running/i.test(stopped.stdout), 'Supervisor or worker remained after successful stop');
    } finally {
      await runtime.close();
      await collector.close();
    }
  });
  test.skipIf(process.platform === 'win32')(
    `${variant.name}: repeated shutdown signals keep the original exit result and bounded cleanup`,
    async () => {
      const collector = await createCollector();
      collector.respond({ status: 503, delayMs: 10000 });
      const runtime = await startRuntime({
        collector,
        ...variant,
        env: {
          OTEL_EXPORTER_OTLP_TIMEOUT: '30000',
          OTEL_BSP_EXPORT_TIMEOUT: '30000',
          OTEL_BSP_SCHEDULE_DELAY: '60000',
          OTEL_METRIC_EXPORT_INTERVAL: '300000',
        },
      });
      try {
        const echo = runtime.tools.find((tool) => tool.name.endsWith('echo'));
        assert(echo);
        assert.equal(
          (await runtime.client.callTool({ name: echo.name, arguments: { message: 'unchanged' } })).content[0].text,
          'unchanged',
        );
        const began = performance.now();
        runtime.child.kill('SIGTERM');
        await delay(20);
        runtime.child.kill('SIGINT');
        await waitUntil(
          () => runtime.child.exitCode !== null || runtime.child.signalCode !== null,
          'Shutdown exceeded five-second telemetry budget',
          5500,
        );
        const elapsedMs = performance.now() - began;
        assert.equal(runtime.child.exitCode, 0, 'Repeated shutdown changed exit result');
        assert(elapsedMs <= 5500, `Shutdown took ${elapsedMs}ms`);
        assert(
          collector.requests.some((request) => request.path === '/v1/traces'),
          'Actual runtime did not attempt bounded shutdown flush',
        );
        assert(
          collector.requests.filter((request) => request.path === '/v1/traces').length <= 1,
          'Repeated signal duplicated trace flush',
        );
      } finally {
        await runtime.close();
        await collector.close();
      }
    },
  );
}

test.each([false, true])(
  'Node fatal uncaught exception retains exit1 and shortens stalled cleanup; graceful already running=%s',
  async (graceful) => {
    const collector = await createCollector();
    collector.respond({ status: 503, delayMs: 10000 });
    const faultDirectory = await mkdtemp(join(tmpdir(), '1mcp-fatal-'));
    const faultFile = join(faultDirectory, 'control');
    const runtime = await startRuntime({
      collector,
      env: {
        TELEMETRY_ACCEPTANCE_FAULT_FILE: faultFile,
        NODE_OPTIONS: `--import=${pathToFileURL(resolve('test/telemetry/fatal-preload.mjs')).href}`,
        OTEL_EXPORTER_OTLP_TIMEOUT: '30000',
        OTEL_BSP_EXPORT_TIMEOUT: '30000',
        OTEL_BSP_SCHEDULE_DELAY: '60000',
        OTEL_METRIC_EXPORT_INTERVAL: '300000',
      },
    });
    try {
      const faultUrl = await readFile(`${faultFile}.${runtime.child.pid}`, 'utf8');
      if (graceful) {
        assert.equal((await fetch(faultUrl + '/graceful', { method: 'POST' })).status, 200);
        await waitUntil(
          () => collector.requests.some((request) => request.path === '/v1/traces'),
          'Graceful flush did not start',
          8000,
        );
      }
      const began = performance.now();
      assert.equal((await fetch(faultUrl, { method: 'POST' })).status, 200);
      await waitUntil(
        () => runtime.child.exitCode !== null || runtime.child.signalCode !== null,
        'Fatal exit exceeded one-second telemetry budget',
        1250,
      );
      assert.equal(runtime.child.exitCode, 1, 'Fatal telemetry cleanup changed original exit1');
      assert(
        collector.requests.some((request) => request.path === '/v1/traces'),
        'Actual runtime did not attempt fatal flush',
      );
      assert(performance.now() - began <= 1250, 'Fatal flush exceeded one second plus polling/scheduling allowance');
      assert(
        !JSON.stringify(collector.requests.map((request) => request.body.toString('utf8'))).includes(
          'PRIVACY_ERROR_489',
        ),
      );
    } catch (error) {
      const triggered = await readFile(`${faultFile}.${runtime.child.pid}.triggered`, 'utf8').catch(() => 'NO-TRIGGER');
      throw new Error(
        `${error.message}; trigger=${triggered}; exit=${runtime.child.exitCode}; signal=${runtime.child.signalCode}; logs=${(await runtime.readLog()).slice(-5000)}`,
        { cause: error },
      );
    } finally {
      await runtime.close();
      await collector.close();
      await rm(faultDirectory, { recursive: true, force: true });
    }
  },
);
