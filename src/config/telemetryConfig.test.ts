import { describe, expect, it } from 'vitest';

import { parseTelemetryConfig, type TelemetryConfig } from './telemetryConfig.js';

describe('telemetry configuration boundary', () => {
  it('drops unknown Resource values before decoding them and honors span-specific limit precedence', () => {
    const config = parseTelemetryConfig({
      OTEL_RESOURCE_ATTRIBUTES: 'host.name=%invalid,service.name=core',
      OTEL_ATTRIBUTE_COUNT_LIMIT: '2',
      OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT: '4',
    });
    expect(config.serviceName).toBe('core');
    expect(config.warnings).toContain('resource-attribute-dropped');
    expect(config.limits.attributes).toBe(4);
  });
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

describe('standard telemetry setting matrix', () => {
  const numeric: [string, string, string, (config: TelemetryConfig) => number][] = [
    ['OTEL_BSP_MAX_QUEUE_SIZE', '8192', '8193', (c) => c.batch.queueSize],
    ['OTEL_BSP_MAX_EXPORT_BATCH_SIZE', '2048', '2049', (c) => c.batch.batchSize],
    ['OTEL_BSP_SCHEDULE_DELAY', '60000', '60001', (c) => c.batch.delayMs],
    ['OTEL_BSP_EXPORT_TIMEOUT', '30000', '30001', (c) => c.batch.timeoutMs],
    ['OTEL_METRIC_EXPORT_INTERVAL', '300000', '300001', (c) => c.metricReader.intervalMs],
    ['OTEL_METRIC_EXPORT_TIMEOUT', '30000', '30001', (c) => c.metricReader.timeoutMs],
    ['OTEL_ATTRIBUTE_COUNT_LIMIT', '32', '33', (c) => c.limits.attributes],
    ['OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT', '32', '33', (c) => c.limits.attributes],
    ['OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT', '256', '257', (c) => c.limits.attributeBytes],
    ['OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT', '256', '257', (c) => c.limits.attributeBytes],
    ['OTEL_SPAN_EVENT_COUNT_LIMIT', '16', '17', (c) => c.limits.events],
    ['OTEL_SPAN_LINK_COUNT_LIMIT', '8', '9', (c) => c.limits.links],
    ['OTEL_EVENT_ATTRIBUTE_COUNT_LIMIT', '16', '17', (c) => c.limits.eventAttributes],
    ['OTEL_LINK_ATTRIBUTE_COUNT_LIMIT', '16', '17', (c) => c.limits.linkAttributes],
  ];
  it.each(numeric)(
    'validates valid/empty/invalid upper and lexical bounds for %s',
    (name, maximum, excessive, pick) => {
      expect(pick(parseTelemetryConfig({ [name]: maximum }))).toBe(Number(maximum));
      expect(pick(parseTelemetryConfig({ [name]: '' }))).toBe(pick(parseTelemetryConfig({})));
      for (const raw of [excessive, '-1', '1.5', 'NaN', 'Infinity', '1ms'])
        expect(() => parseTelemetryConfig({ [name]: raw })).toThrow(/^Invalid telemetry configuration:/);
    },
  );
  it.each(['', 'TRACES_', 'METRICS_'])('parses shared/per-signal exact OTLP settings %s', (signal) => {
    const key = `OTEL_EXPORTER_OTLP_${signal}`;
    const config = parseTelemetryConfig({
      OTEL_TRACES_EXPORTER: 'otlp',
      OTEL_METRICS_EXPORTER: 'otlp',
      [key + 'ENDPOINT']: 'https://collector.test/exact',
      [key + 'PROTOCOL']: 'HTTP/PROTOBUF',
      [key + 'HEADERS']: 'x-token=secret%20value',
      [key + 'TIMEOUT']: '30000',
      [key + 'COMPRESSION']: 'GZIP',
      [key + 'CERTIFICATE']: '/private/ca',
      [key + 'CLIENT_CERTIFICATE']: '/private/client',
      [key + 'CLIENT_KEY']: '/private/key',
    });
    const output = signal === 'METRICS_' ? config.metrics : config.traces;
    expect(output).toMatchObject({
      protocol: 'http/protobuf',
      headers: { 'x-token': 'secret value' },
      timeoutMs: 30000,
      compression: 'gzip',
      certificate: '/private/ca',
      clientCertificate: '/private/client',
      clientKey: '/private/key',
    });
    expect(output.endpoint).toBe(
      signal === '' ? 'https://collector.test/exact/v1/traces' : 'https://collector.test/exact',
    );
    for (const [suffix, invalid] of [
      ['PROTOCOL', 'http/json'],
      ['TIMEOUT', '30001'],
      ['COMPRESSION', 'brotli'],
      ['HEADERS', 'token=%XX'],
      ['ENDPOINT', 'http://private.internal'],
    ])
      expect(() => parseTelemetryConfig({ [key + suffix]: invalid })).toThrow(/^Invalid telemetry configuration:/);
    const empty = parseTelemetryConfig({
      [key + 'TIMEOUT']: '',
      [key + 'HEADERS']: '',
      [key + 'CERTIFICATE']: '',
      [key + 'CLIENT_CERTIFICATE']: '',
      [key + 'CLIENT_KEY']: '',
      [key + 'COMPRESSION']: '',
      [key + 'PROTOCOL']: '',
      [key + 'ENDPOINT']: '',
    });
    expect(empty.traces).toEqual(parseTelemetryConfig({}).traces);
    expect(empty.metrics).toEqual(parseTelemetryConfig({}).metrics);
  });
  it('applies every per-signal setting over shared configuration, including empty fallback', () => {
    const config = parseTelemetryConfig({
      OTEL_EXPORTER_OTLP_TIMEOUT: '123',
      OTEL_EXPORTER_OTLP_TRACES_TIMEOUT: '456',
      OTEL_EXPORTER_OTLP_METRICS_TIMEOUT: '',
      OTEL_EXPORTER_OTLP_COMPRESSION: 'gzip',
      OTEL_EXPORTER_OTLP_TRACES_COMPRESSION: 'none',
      OTEL_EXPORTER_OTLP_CERTIFICATE: '/shared-ca',
      OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE: '/trace-ca',
      OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE: '/shared-client',
      OTEL_EXPORTER_OTLP_CLIENT_KEY: '/shared-key',
      OTEL_EXPORTER_OTLP_TRACES_CLIENT_CERTIFICATE: '/trace-client',
      OTEL_EXPORTER_OTLP_TRACES_CLIENT_KEY: '/trace-key',
    });
    expect(config.traces).toMatchObject({
      timeoutMs: 456,
      compression: 'none',
      certificate: '/trace-ca',
      clientCertificate: '/trace-client',
      clientKey: '/trace-key',
    });
    expect(config.metrics).toMatchObject({
      timeoutMs: 123,
      compression: 'gzip',
      certificate: '/shared-ca',
      clientCertificate: '/shared-client',
      clientKey: '/shared-key',
    });
  });
  it.each([
    'always_on',
    'always_off',
    'traceidratio',
    'parentbased_always_on',
    'parentbased_always_off',
    'parentbased_traceidratio',
  ])('accepts only standard sampler %s', (name) => {
    expect(parseTelemetryConfig({ OTEL_TRACES_SAMPLER: name.toUpperCase() }).sampler.name).toBe(name);
  });
  it('keeps unsupported controls disabled and produces sanitized warnings once per category', () => {
    const config = parseTelemetryConfig({
      OTEL_PROPAGATORS: 'baggage',
      OTEL_METRICS_EXEMPLAR_FILTER: 'always_on',
      OTEL_NODE_RESOURCE_DETECTORS: 'all',
      OTEL_LOG_LEVEL: 'debug',
      OTEL_EXPORTER_OTLP_INSECURE: 'true',
    });
    expect(config.warnings).toEqual(['unsupported-setting']);
    expect(JSON.stringify(config)).not.toContain('baggage');
    expect(config.traces.endpointClass).toBe('loopback-http');
  });
});
