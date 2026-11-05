import { Socket } from 'node:net';

import { afterEach, expect, it, vi } from 'vitest';

import { parseTelemetryConfig } from '../config/telemetryConfig.js';
import { selectTelemetryEnvironment } from '../config/telemetryEnvironment.js';
import { getTelemetryStatus, startTelemetry, stopTelemetry, withTelemetryOperation } from './telemetry.js';

// An inactive facade must not even load the provider/exporter module.
vi.mock('./signals/sdk.js', () => {
  throw new Error('Disabled telemetry loaded SDK providers');
});

afterEach(async () => {
  await stopTelemetry({ deadlineMs: Date.now() + 1000 });
  vi.restoreAllMocks();
});

it.each([false, true])(
  'diagnoses recognized unsupported settings once with no SDK/network; sdkDisabled=%s',
  async (disabled) => {
    const network = vi.spyOn(Socket.prototype, 'connect').mockImplementation(() => {
      throw new Error('Disabled telemetry attempted network');
    });
    const diagnostic = vi.fn();
    const config = parseTelemetryConfig(
      selectTelemetryEnvironment(
        {},
        {
          OTEL_SDK_DISABLED: String(disabled),
          OTEL_TRACES_EXPORTER: disabled ? 'otlp' : 'none',
          OTEL_METRICS_EXPORTER: disabled ? 'otlp' : 'none',
          OTEL_PROPAGATORS: 'private-propagator-value',
          OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: 'private-temporality-value',
          OTEL_EXPORTER_OTLP_METRICS_DEFAULT_HISTOGRAM_AGGREGATION: 'private-histogram-value',
          OTEL_UNREVIEWED_SECRET: 'forbidden',
        },
      ),
    );
    await startTelemetry(config, { role: 'runtime', serviceVersion: 'test', onDiagnostic: diagnostic });
    expect(diagnostic.mock.calls).toEqual([
      [{ event: 'telemetry.configuration', signal: 'traces', category: 'configuration', suppressed: 0 }],
    ]);
    expect(JSON.stringify(diagnostic.mock.calls)).not.toMatch(/private-|forbidden/u);
    expect(getTelemetryStatus().state).toBe('disabled');
    await expect(withTelemetryOperation({ kind: 'server', method: 'ping' }, async () => 'unchanged')).resolves.toBe(
      'unchanged',
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(network).not.toHaveBeenCalled();
  },
);

it('isolates an inactive diagnostic consumer failure from startup and operation results', async () => {
  await expect(
    startTelemetry(parseTelemetryConfig({ OTEL_PROPAGATORS: 'private-value' }), {
      role: 'runtime',
      serviceVersion: 'test',
      onDiagnostic: () => {
        throw new Error('private-consumer-error');
      },
    }),
  ).resolves.toBeUndefined();
  expect(getTelemetryStatus().state).toBe('disabled');
});
