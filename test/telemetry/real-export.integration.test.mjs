import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

import { test } from 'vitest';

import { startRealCollector } from '../../scripts/telemetry/real-collector.mjs';
import { parseTelemetryConfig } from '../../src/config/telemetryConfig.ts';
import { startTelemetry, stopTelemetry, withTelemetryOperation } from '../../src/observability/telemetry.ts';
import { assertPrivatePayloads } from './privacy-corpus.mjs';

test.skipIf(!process.env.OTELCOL_BINARY)('pinned Collector decodes 1MCP trace and metric exports', async () => {
  const collector = await startRealCollector(process.env.OTELCOL_BINARY);
  try {
    await startTelemetry(
      parseTelemetryConfig({
        OTEL_TRACES_EXPORTER: 'otlp',
        OTEL_METRICS_EXPORTER: 'otlp',
        OTEL_EXPORTER_OTLP_ENDPOINT: collector.url,
        OTEL_TRACES_SAMPLER: 'always_on',
        OTEL_BSP_SCHEDULE_DELAY: '10',
        OTEL_METRIC_EXPORT_INTERVAL: '5000',
      }),
      { role: 'runtime', serviceVersion: '0.39.2' },
    );
    await withTelemetryOperation(
      { kind: 'server', method: 'tools/list', transport: 'streamable-http' },
      async () => 'ok',
    );
    await delay(5500);
    await stopTelemetry({ deadlineMs: Date.now() + 5000 });
    await collector.stop();
    const payloads = (await readFile(collector.capture, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert(
      payloads.some((payload) =>
        payload.resourceSpans?.some((resource) => resource.scopeSpans?.some((scope) => scope.spans?.length)),
      ),
      'No decoded spans',
    );
    assert(
      payloads.some((payload) =>
        payload.resourceMetrics?.some((resource) => resource.scopeMetrics?.some((scope) => scope.metrics?.length)),
      ),
      'No decoded metrics',
    );
    assertPrivatePayloads(payloads);
  } finally {
    await stopTelemetry({ deadlineMs: Date.now() + 1000 });
    await collector.cleanup();
  }
});
