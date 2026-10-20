import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

import { test } from 'vitest';

import { parseTelemetryConfig } from '../../src/config/telemetryConfig.ts';
import { startTelemetry, stopTelemetry, withTelemetryOperation } from '../../src/observability/telemetry.ts';
import { createCollector } from './fake-collector.mjs';
import { assertPrivatePayloads, privacyCorpus } from './privacy-corpus.mjs';

test('real providers export bounded operations and metrics without input/result/carrier/error data', async () => {
  const collector = await createCollector();
  try {
    const config = parseTelemetryConfig({
      OTEL_TRACES_EXPORTER: 'otlp',
      OTEL_METRICS_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_ENDPOINT: collector.url,
      OTEL_TRACES_SAMPLER: 'always_on',
      OTEL_BSP_SCHEDULE_DELAY: '10',
      OTEL_METRIC_EXPORT_INTERVAL: '5000',
    });
    await startTelemetry(config, { role: 'runtime', serviceVersion: '0.39.2' });
    const result = await withTelemetryOperation(
      {
        kind: 'server',
        method: 'tools/call',
        transport: 'stdio',
        remoteParams: {
          _meta: {
            ...privacyCorpus,
            traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
            baggage: privacyCorpus.baggage,
          },
        },
      },
      async () => ({ content: [{ type: 'text', text: privacyCorpus.result }] }),
    );
    assert.equal(result.content[0].text, privacyCorpus.result);
    const failure = new Error(privacyCorpus.error);
    await assert.rejects(
      withTelemetryOperation({ kind: 'client', method: privacyCorpus.toolName, transport: 'stdio' }, async () => {
        throw failure;
      }),
      (error) => error === failure,
    );
    await delay(5500);
    await stopTelemetry({ deadlineMs: Date.now() + 5000 });
    assert(
      collector.requests.some((request) => request.path === '/v1/traces'),
      'No trace export',
    );
    assert(
      collector.requests.some((request) => request.path === '/v1/metrics'),
      'No metric export',
    );
    assert(collector.requests.every((request) => request.contentType?.startsWith('application/x-protobuf')));
    assertPrivatePayloads(collector.requests.map((request) => request.body));
    // Actual OTLP wire strings: independently expected operation and Resource keys.
    assert(collector.requests.some((request) => request.body.includes(Buffer.from('tools/call'))));
    assert(collector.requests.some((request) => request.body.includes(Buffer.from('service.name'))));
  } finally {
    await stopTelemetry({ deadlineMs: Date.now() + 1000 });
    await collector.close();
  }
});
