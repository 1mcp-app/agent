import { once } from 'node:events';
import { createServer } from 'node:http';

import { activateRuntimeScopeEnvironment } from '@src/config/runtimeScopeEnv.js';
import { getTelemetryStatus, withTelemetryOperation } from '@src/observability/telemetry.js';

import { afterEach, expect, it, vi } from 'vitest';

import {
  exitRuntime,
  finishRuntimeTelemetry,
  setRuntimeTelemetryShutdownDeadline,
  startRuntimeTelemetry,
} from './runtimeTelemetry.js';

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

it('gives a fatal result priority over an earlier graceful continuation', async () => {
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  try {
    const fatal = finishRuntimeTelemetry(true);
    exitRuntime(0);
    await fatal;
    expect(exit).toHaveBeenCalledWith(1);
  } finally {
    exit.mockRestore();
  }
});

it('applies an earlier owner IPC deadline after runtime telemetry completion began', async () => {
  const collector = createServer(async (request) => {
    for await (const _chunk of request) {
      /* consume */
    }
  });
  collector.listen(0, '127.0.0.1');
  await once(collector, 'listening');
  const address = collector.address();
  if (!address || typeof address === 'string') throw new Error('fixture address');
  activateRuntimeScopeEnvironment({
    OTEL_TRACES_EXPORTER: 'otlp',
    OTEL_TRACES_SAMPLER: 'always_on',
    OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}`,
    OTEL_BSP_EXPORT_TIMEOUT: '30000',
  });
  try {
    await startRuntimeTelemetry('runtime');
    await withTelemetryOperation({ kind: 'server', method: 'ping' }, async () => 'unchanged');
    const stopping = finishRuntimeTelemetry();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const began = performance.now();
    setRuntimeTelemetryShutdownDeadline(Date.now() + 40);
    await stopping;
    expect(performance.now() - began).toBeLessThan(500);
    expect(getTelemetryStatus().traces.shutdown).toBe('timeout');
  } finally {
    collector.closeAllConnections();
    await new Promise<void>((resolve) => collector.close(() => resolve()));
  }
});
