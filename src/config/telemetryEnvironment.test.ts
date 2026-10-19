import { describe, expect, it } from 'vitest';

import { selectTelemetryEnvironment } from './telemetryEnvironment.js';

describe('runtime telemetry configuration boundary', () => {
  it('selects only standard telemetry settings and preserves explicit empty overrides', () => {
    expect(
      selectTelemetryEnvironment(
        { OTEL_TRACES_EXPORTER: 'otlp', OTEL_SERVICE_NAME: 'parent', SECRET: 'forbidden' },
        { OTEL_TRACES_EXPORTER: '', OTEL_SERVICE_NAME: 'scope', OTEL_UNKNOWN_SECRET: 'forbidden' },
      ),
    ).toEqual({ OTEL_TRACES_EXPORTER: '', OTEL_SERVICE_NAME: 'scope' });
  });
});
