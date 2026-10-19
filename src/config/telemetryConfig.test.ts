import { describe, expect, it } from 'vitest';

import { parseTelemetryConfig } from './telemetryConfig.js';

describe('telemetry configuration boundary', () => {
  it('keeps export absent without explicit selectors and uses bounded defaults', () => {
    const config = parseTelemetryConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example' });
    expect(config.traces.exporter).toBe('none');
    expect(config.metrics.exporter).toBe('none');
    expect(config.batch).toEqual({ queueSize: 2048, batchSize: 512, delayMs: 5000, timeoutMs: 10000 });
    expect(config.sampler).toEqual({ name: 'traceidratio', ratio: 0.1 });
  });
  it('applies per-signal precedence and shared endpoint path construction', () => {
    const config = parseTelemetryConfig({
      OTEL_TRACES_EXPORTER: 'OTLP',
      OTEL_METRICS_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example/base/',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://127.0.0.1:4318/exact',
      OTEL_EXPORTER_OTLP_HEADERS: 'authorization=Bearer%20secret,x-key=shared',
      OTEL_EXPORTER_OTLP_TRACES_HEADERS: 'x-key=trace',
      OTEL_SERVICE_NAME: 'gateway',
      OTEL_RESOURCE_ATTRIBUTES: 'service.name=ignored,host.name=secret',
    });
    expect(config.traces.endpoint).toBe('http://127.0.0.1:4318/exact');
    expect(config.metrics.endpoint).toBe('https://collector.example/base/v1/metrics');
    expect(config.traces.headers).toEqual({ 'x-key': 'trace' });
    expect(config.metrics.headers.authorization).toBe('Bearer secret');
    expect(config.serviceName).toBe('gateway');
    expect(config.warnings).toContain('resource-attribute-dropped');
  });
  it.each([
    { OTEL_TRACES_EXPORTER: 'otlp,none' },
    { OTEL_LOGS_EXPORTER: 'otlp' },
    { OTEL_CONFIG_FILE: '/secret' },
    { OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc' },
    { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://10.0.0.1:4318' },
    { OTEL_EXPORTER_OTLP_ENDPOINT: 'https://user:secret@example.test' },
    { OTEL_BSP_MAX_QUEUE_SIZE: '8193' },
    { OTEL_METRIC_EXPORT_INTERVAL: '4999' },
    { OTEL_TRACES_SAMPLER_ARG: 'NaN' },
    { OTEL_EXPORTER_OTLP_HEADERS: 'authorization=secret%0d%0ainjected' },
    { OTEL_EXPORTER_OTLP_CLIENT_KEY: '/secret/key' },
  ])('rejects unsafe or unsupported active configuration without echoing values %#', (env) => {
    expect(() => parseTelemetryConfig({ OTEL_TRACES_EXPORTER: 'otlp', ...env })).toThrow(
      /^Invalid telemetry configuration: [a-z-]+$/,
    );
  });
  it('normalizes a batch larger than the queue and honors case insensitive SDK disablement', () => {
    const config = parseTelemetryConfig({
      OTEL_TRACES_EXPORTER: 'otlp',
      OTEL_SDK_DISABLED: 'TRUE',
      OTEL_BSP_MAX_QUEUE_SIZE: '8',
      OTEL_BSP_MAX_EXPORT_BATCH_SIZE: '16',
    });
    expect(config.traces.exporter).toBe('none');
    expect(config.batch.batchSize).toBe(8);
  });
  it('uses standard explicit ratio sampler default while lowering all record limits', () => {
    const config = parseTelemetryConfig({
      OTEL_TRACES_SAMPLER: 'parentbased_traceidratio',
      OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT: '8',
      OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT: '64',
      OTEL_SPAN_EVENT_COUNT_LIMIT: '2',
      OTEL_SPAN_LINK_COUNT_LIMIT: '1',
    });
    expect(config.sampler.ratio).toBe(1);
    expect(config.limits).toMatchObject({ attributes: 8, attributeBytes: 64, events: 2, links: 1 });
  });
});
