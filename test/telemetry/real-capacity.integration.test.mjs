import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

import { test } from 'vitest';

import { startRealCollector } from '../../scripts/telemetry/real-collector.mjs';
import { parseTelemetryConfig } from '../../src/config/telemetryConfig.ts';
import { recordTelemetryMeasurement, startTelemetry, stopTelemetry } from '../../src/observability/telemetry.ts';

test.skipIf(!process.env.OTELCOL_BINARY)(
  'real Collector rejects10000identities and proves exact accepted totals and all reader caps across intervals',
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
              assert.equal(recordTelemetryMeasurement(instrument, 1, { operation_family, outcome, phase }), true);
          }
      const acceptedPerInstrument = families.length * outcomes.length * phases.length;
      // Distinct identity strings exercise unknown keys and invalid values in known keys.
      // Split across intervals to catch rejected updates changing existing cumulative series.
      for (let interval = 0; interval < 2; interval++) {
        for (let index = interval * 5000; index < (interval + 1) * 5000; index++) {
          const identity = `FORBIDDEN_IDENTITY_489_${index}`;
          const dimensions =
            index % 2 === 0
              ? { [identity]: identity }
              : { [['operation_family', 'outcome', 'phase'][index % 3]]: identity };
          for (const [instrument] of instruments)
            assert.equal(
              recordTelemetryMeasurement(instrument, 1, dimensions),
              false,
              `Accepted forbidden identity ${index}`,
            );
        }
        await delay(5500);
      }
      await stopTelemetry({ deadlineMs: Date.now() + 5000 });
      await collector.stop();
      const captured = (await readFile(collector.capture, 'utf8')).trim();
      assert(captured.length > 0, `No decoded capacity payload: ${collector.diagnostic}`);
      const payloads = captured
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      assert(!captured.includes('FORBIDDEN_IDENTITY_489_'), 'Forbidden identity entered decoded export');
      const metrics = payloads
        .flatMap((payload) => payload.resourceMetrics ?? [])
        .flatMap((resource) => resource.scopeMetrics ?? [])
        .flatMap((scope) => scope.metrics ?? []);
      for (const [name, cap] of instruments) {
        const matching = metrics.filter((metric) => metric.name === name);
        assert(matching.length >= 2, `Fewer than two decoded collections for ${name}`);
        const collectionTimes = new Set();
        for (const metric of matching) {
          const points = (metric.histogram ?? metric.sum ?? metric.gauge).dataPoints;
          collectionTimes.add(String(points[0]?.timeUnixNano));
          assert.equal(points.length, cap, `${name} unexpected series count`);
          const total = points.reduce(
            (sum, point) => sum + Number(metric.histogram ? point.count : (point.asDouble ?? point.asInt)),
            0,
          );
          assert.equal(total, acceptedPerInstrument, `${name} rejected attempts changed measurement totals`);
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
        assert(collectionTimes.size >= 2, `${name} did not span two collection intervals`);
      }
    } finally {
      await stopTelemetry({ deadlineMs: Date.now() + 1000 });
      await collector.cleanup();
    }
  },
);
