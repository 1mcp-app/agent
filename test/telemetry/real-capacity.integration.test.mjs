import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

import { test } from 'vitest';

import { startRealCollector } from '../../scripts/telemetry/real-collector.mjs';
import { parseTelemetryConfig } from '../../src/config/telemetryConfig.ts';
import { recordTelemetryMeasurement, startTelemetry, stopTelemetry } from '../../src/observability/telemetry.ts';

test.skipIf(!process.env.OTELCOL_BINARY)(
  'real Collector proves reader series caps for histogram, counter and up-down metrics',
  async () => {
    const collector = await startRealCollector(process.env.OTELCOL_BINARY);
    try {
      await startTelemetry(
        parseTelemetryConfig({
          OTEL_METRICS_EXPORTER: 'otlp',
          OTEL_EXPORTER_OTLP_ENDPOINT: collector.url,
          OTEL_METRIC_EXPORT_INTERVAL: '5000',
        }),
        { role: 'runtime', serviceVersion: '0.39.2' },
      );
      const instruments = [
        ['mcp.server.operation.duration', 1024],
        ['gateway.failures', 512],
        ['gateway.active.operations', 256],
      ];
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
            for (const [instrument] of instruments)
              recordTelemetryMeasurement(instrument, 1, { operation_family, outcome, phase });
          }
      await delay(5500);
      await stopTelemetry({ deadlineMs: Date.now() + 5000 });
      await collector.stop();
      const captured = (await readFile(collector.capture, 'utf8')).trim();
      assert(captured.length > 0, `No decoded capacity payload: ${collector.diagnostic}`);
      const payloads = captured
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      const metrics = payloads
        .flatMap((payload) => payload.resourceMetrics ?? [])
        .flatMap((resource) => resource.scopeMetrics ?? [])
        .flatMap((scope) => scope.metrics ?? []);
      for (const [name, cap] of instruments) {
        const matching = metrics.filter((metric) => metric.name === name);
        assert(matching.length > 0, `No decoded ${name}`);
        for (const metric of matching) {
          const points = (metric.histogram ?? metric.sum ?? metric.gauge).dataPoints;
          assert(points.length <= cap, `${name} exceeded its reader cap`);
          assert(
            points.some((point) =>
              point.attributes?.some(
                (attribute) => attribute.key === 'otel.metric.overflow' && attribute.value.boolValue === true,
              ),
            ),
            `No standard ${name} overflow series`,
          );
        }
      }
    } finally {
      await stopTelemetry({ deadlineMs: Date.now() + 1000 });
      await collector.cleanup();
    }
  },
);
