// Reuse the established authenticated native continuation/ownership matrix.
// Metrics-only keeps its exact propagation assertions valid; trace topology is
// checked separately by runtime/payload/transport acceptance.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

import { afterAll, beforeAll } from 'vitest';

import { parseTelemetryConfig } from '../../src/config/telemetryConfig.ts';
import { startTelemetry, stopTelemetry } from '../../src/observability/telemetry.ts';
import '../e2e/gateway-interactions-four-era.test.ts';
import { createCollector } from './fake-collector.mjs';
import { assertPrivatePayloads } from './privacy-corpus.mjs';

let collector;
beforeAll(async () => {
  collector = await createCollector();
  await startTelemetry(
    parseTelemetryConfig({
      OTEL_METRICS_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_ENDPOINT: collector.url,
      OTEL_METRIC_EXPORT_INTERVAL: '5000',
    }),
    { role: 'runtime', serviceVersion: '0.39.2' },
  );
});
afterAll(async () => {
  try {
    await delay(5500);
    await stopTelemetry({ deadlineMs: Date.now() + 5000 });
    assert(
      collector.requests.some((request) => request.path === '/v1/metrics'),
      'Interaction metrics missing',
    );
    assert(
      collector.requests.some((request) => request.body.includes(Buffer.from('gateway.interaction.lifecycle'))),
      'No actual interaction lifecycle measurements',
    );
    assertPrivatePayloads(collector.requests.map((request) => request.body));
  } finally {
    await stopTelemetry({ deadlineMs: Date.now() + 1000 });
    await collector?.close();
  }
});
