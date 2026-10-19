import { activateRuntimeScopeEnvironment } from '@src/config/runtimeScopeEnv.js';
import { getTelemetryStatus } from '@src/observability/telemetry.js';

import { afterEach, expect, it, vi } from 'vitest';

import { finishRuntimeTelemetry, startRuntimeTelemetry } from './runtimeTelemetry.js';

afterEach(async () => {
  await finishRuntimeTelemetry();
  activateRuntimeScopeEnvironment({});
  vi.unstubAllEnvs();
});

it('rejects active invalid configuration before runtime startup without exposing its value', async () => {
  activateRuntimeScopeEnvironment({
    OTEL_TRACES_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://private-secret.example/export?token=secret',
  });
  const failure = await startRuntimeTelemetry('runtime').catch((error) => error);
  expect(failure).toBeInstanceOf(Error);
  expect(failure.message).toBe('Telemetry initialization failed; check supported telemetry configuration');
  expect(failure.cause).toBeUndefined();
  expect(failure.stack).not.toContain('private-secret');
  expect(getTelemetryStatus().state).toBe('disabled');
});
