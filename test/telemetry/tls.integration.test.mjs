import assert from 'node:assert/strict';

import { test } from 'vitest';

import { parseTelemetryConfig } from '../../src/config/telemetryConfig.ts';
import { startTelemetry, stopTelemetry, withTelemetryOperation } from '../../src/observability/telemetry.ts';
import { createCollector } from './fake-collector.mjs';
import { createTlsFixture } from './tls-fixture.mjs';

test.each([false, true])('OTLP HTTPS export with custom CA (mutual TLS: %s)', async (mutual) => {
  const tls = await createTlsFixture();
  const collector = await createCollector({ tls: { ...tls.server, requestCert: mutual, rejectUnauthorized: mutual } });
  try {
    await startTelemetry(
      parseTelemetryConfig({
        OTEL_TRACES_EXPORTER: 'otlp',
        OTEL_EXPORTER_OTLP_ENDPOINT: collector.url,
        OTEL_TRACES_SAMPLER: 'always_on',
        OTEL_EXPORTER_OTLP_CERTIFICATE: tls.file('ca.crt'),
        ...(mutual
          ? {
              OTEL_EXPORTER_OTLP_TRACES_CLIENT_CERTIFICATE: tls.file('client.crt'),
              OTEL_EXPORTER_OTLP_TRACES_CLIENT_KEY: tls.file('client.key'),
            }
          : {}),
      }),
      { role: 'runtime', serviceVersion: '0.39.2' },
    );
    await withTelemetryOperation({ kind: 'server', method: 'tools/list', transport: 'stdio' }, async () => 'ok');
    await stopTelemetry({ deadlineMs: Date.now() + 5000 });
    assert(
      collector.requests.some((request) => request.path === '/v1/traces'),
      'No authenticated HTTPS trace export',
    );
  } finally {
    await stopTelemetry({ deadlineMs: Date.now() + 1000 });
    await collector.close();
    await tls.close();
  }
});
