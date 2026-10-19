import { describe, expect, it } from 'vitest';

import { parseTelemetryConfig } from './telemetryConfig.js';
import { selectTelemetryEnvironment } from './telemetryEnvironment.js';

describe('runtime telemetry configuration boundary', () => {
  it.each([
    'OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE',
    'OTEL_EXPORTER_OTLP_METRICS_DEFAULT_HISTOGRAM_AGGREGATION',
  ])('retains recognized unsupported %s for sanitized configuration diagnosis', (setting) => {
    const selected = selectTelemetryEnvironment(
      { [setting]: 'parent-private-value', OTEL_UNREVIEWED_SECRET: 'forbidden' },
      { [setting]: 'scope-private-value' },
    );
    expect(selected).toEqual({ [setting]: 'scope-private-value' });
    expect(parseTelemetryConfig(selected).warnings).toEqual(['unsupported-setting']);
  });
  it('selects only standard telemetry settings and preserves explicit empty overrides', () => {
    expect(
      selectTelemetryEnvironment(
        { OTEL_TRACES_EXPORTER: 'otlp', OTEL_SERVICE_NAME: 'parent', SECRET: 'forbidden' },
        { OTEL_TRACES_EXPORTER: '', OTEL_SERVICE_NAME: 'scope', OTEL_UNKNOWN_SECRET: 'forbidden' },
      ),
    ).toEqual({ OTEL_TRACES_EXPORTER: '', OTEL_SERVICE_NAME: 'scope' });
  });
});
