import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

import { test } from 'vitest';

import { parseTelemetryConfig } from '../../src/config/telemetryConfig.ts';
import {
  getTelemetryStatus,
  recordTelemetryMeasurement,
  startTelemetry,
  stopTelemetry,
  withTelemetryOperation,
} from '../../src/observability/telemetry.ts';
import { createCollector } from './fake-collector.mjs';

async function until(predicate, message, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    assert(Date.now() < deadline, message);
    await delay(20);
  }
}

test('slow/outage Collector bounds trace queue, warnings, idle state and recovery without changing results', async () => {
  const collector = await createCollector();
  const diagnostics = [];
  collector.respond({ status: 503, delayMs: 200 });
  const operation = () =>
    withTelemetryOperation({ kind: 'server', method: 'tools/list', transport: 'stdio' }, async () => 'unchanged');
  try {
    await startTelemetry(
      parseTelemetryConfig({
        OTEL_TRACES_EXPORTER: 'otlp',
        OTEL_EXPORTER_OTLP_ENDPOINT: collector.url,
        OTEL_TRACES_SAMPLER: 'always_on',
        OTEL_BSP_MAX_QUEUE_SIZE: '4',
        OTEL_BSP_MAX_EXPORT_BATCH_SIZE: '1',
        OTEL_BSP_SCHEDULE_DELAY: '50',
        OTEL_BSP_EXPORT_TIMEOUT: '500',
        OTEL_EXPORTER_OTLP_TIMEOUT: '500',
      }),
      { role: 'runtime', serviceVersion: '0.39.2', onDiagnostic: (event) => diagnostics.push(event) },
    );
    for (let index = 0; index < 100; index++) assert.equal(await operation(), 'unchanged');
    assert(getTelemetryStatus().traces.dropped > 0, 'Full queue did not report drops');
    assert.equal(getTelemetryStatus().traces.state, 'degraded');
    assert.equal(
      diagnostics.filter((event) => event.category === 'queue' && event.event === 'telemetry.failure').length,
      1,
      'Queue diagnostics must be bounded to one per minute',
    );
    await until(() => getTelemetryStatus().traces.queueUse === 'empty', 'Queue did not drain');
    // Let the final in-flight failed batch finish before recovery requests.
    await delay(300);
    collector.respond({ status: 200 });
    await operation();
    await until(() => getTelemetryStatus().traces.successAgeMs !== null, 'First recovery export missing');
    assert.equal(getTelemetryStatus().traces.state, 'degraded', 'One success must not recover degradation');
    await operation();
    await until(() => getTelemetryStatus().traces.state === 'healthy', 'Two successful exports did not recover');
    assert(diagnostics.some((event) => event.event === 'telemetry.recovered' && event.suppressed > 0));
    const exported = collector.requests.length;
    await delay(150);
    assert.equal(getTelemetryStatus().traces.state, 'degraded', 'Idle no-success deadline must degrade');
    assert.equal(collector.requests.length, exported, 'Exporter must not recursively trace itself or idle health');
    const status = JSON.stringify(getTelemetryStatus());
    assert(!status.includes(collector.url), 'Status exposed endpoint');
  } finally {
    await stopTelemetry({ deadlineMs: Date.now() + 1000 });
    await collector.close();
  }
});

test('SDK Views produce bounded histogram overflow from approved dimension combinations', async () => {
  const collector = await createCollector();
  try {
    await startTelemetry(
      parseTelemetryConfig({
        OTEL_METRICS_EXPORTER: 'otlp',
        OTEL_EXPORTER_OTLP_ENDPOINT: collector.url,
        OTEL_METRIC_EXPORT_INTERVAL: '5000',
      }),
      { role: 'runtime', serviceVersion: '0.39.2' },
    );
    const families = [
      'session',
      'tools',
      'resources',
      'subscriptions',
      'prompts',
      'completion',
      'logging',
      'sampling',
      'elicitation',
      'roots',
      'other',
    ];
    const outcomes = [
      'success',
      'caller-error',
      'denied',
      'not-found',
      'cancelled',
      'tool-error',
      'upstream-error',
      'transport-error',
      'invalid-response',
      'aborted',
      'internal-error',
      'draining',
    ];
    const phases = [
      'operation',
      'proxy-forward',
      'routing',
      'schema',
      'cache',
      'interaction',
      'subscription',
      'aggregation',
      'connection',
    ];
    for (const operation_family of families)
      for (const outcome of outcomes)
        for (const phase of phases) {
          recordTelemetryMeasurement('mcp.server.operation.duration', 0.01, { operation_family, outcome, phase });
        }
    await delay(5500);
    await stopTelemetry({ deadlineMs: Date.now() + 5000 });
    assert(
      collector.requests.some((request) => request.body.includes(Buffer.from('otel.metric.overflow'))),
      'Standard overflow series missing',
    );
    assert(getTelemetryStatus().metrics.overflow > 0, 'Overflow not exposed in bounded status');
  } finally {
    await stopTelemetry({ deadlineMs: Date.now() + 1000 });
    await collector.close();
  }
});
