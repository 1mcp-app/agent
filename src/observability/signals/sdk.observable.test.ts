import { ROOT_CONTEXT } from '@opentelemetry/api';
import { JsonMetricsSerializer } from '@opentelemetry/otlp-transformer';
import { MeterProvider, MetricReader, type ResourceMetrics } from '@opentelemetry/sdk-metrics';

import { parseTelemetryConfig } from '@src/config/telemetryConfig.js';

import { expect, it, vi } from 'vitest';

import { SecureExporter } from './export.js';
import { type MeasurementDimensions, OUTCOMES, PHASES } from './schema.js';
import { TelemetrySdk } from './sdk.js';

class ManualReader extends MetricReader {
  protected async onForceFlush(): Promise<void> {}
  protected async onShutdown(): Promise<void> {}
}

/** Decode OTLP and ignore only timestamps, which reflect different collection clocks. */
function wireMetrics(resource: ResourceMetrics) {
  const payload = JsonMetricsSerializer.serializeRequest(resource)!;
  const decoded = JSON.parse(Buffer.from(payload).toString(), (key, value: unknown) =>
    key === 'startTimeUnixNano' || key === 'timeUnixNano' ? undefined : value,
  );
  return decoded.resourceMetrics.flatMap((item: { scopeMetrics: Array<{ metrics: unknown[] }> }) =>
    item.scopeMetrics.flatMap((scope) => scope.metrics),
  );
}

it('preserves synchronous cumulative state wire values, bounded overflow and final shutdown collection', async () => {
  const exports: ReturnType<typeof wireMetrics>[] = [];
  const exportSpy = vi.spyOn(SecureExporter.prototype, 'export').mockImplementation(async (resource) => {
    if (Array.isArray(resource)) throw new Error('Unexpected trace export');
    exports.push(wireMetrics(resource as ResourceMetrics));
    return true;
  });
  const reader = new ManualReader();
  const baseline = new MeterProvider({ readers: [reader] });
  const meter = baseline.getMeter('synchronous-baseline');
  const names = ['gateway.active.operations', 'gateway.queue.depth', 'gateway.upstream.connections'] as const;
  const synchronous = {
    'gateway.active.operations': meter.createUpDownCounter(names[0], { unit: '{operation}' }),
    'gateway.queue.depth': meter.createGauge(names[1], { unit: '{operation}' }),
    'gateway.upstream.connections': meter.createGauge(names[2], { unit: '{connection}' }),
  };
  const sdk = new TelemetrySdk(
    parseTelemetryConfig({ OTEL_METRICS_EXPORTER: 'otlp', OTEL_METRIC_EXPORT_INTERVAL: '300000' }),
    'test',
  );
  const known = new Map<string, MeasurementDimensions>();
  const overflow = { 'otel.metric.overflow': true };
  function measure(name: (typeof names)[number], value: number, dimensions: MeasurementDimensions) {
    sdk.measure(name, value, dimensions);
    const key = JSON.stringify(dimensions);
    let attributes: MeasurementDimensions | typeof overflow | undefined = known.get(key);
    if (!attributes && known.size < 255) {
      attributes = { ...dimensions };
      known.set(key, attributes);
    }
    attributes ??= overflow;
    const instrument = synchronous[name];
    if ('add' in instrument) instrument.add(value, attributes, ROOT_CONTEXT);
    else instrument.record(value, attributes, ROOT_CONTEXT);
  }
  async function compare() {
    await sdk['meterProvider']!.forceFlush();
    const collected = await reader.collect();
    expect(collected.errors).toEqual([]);
    expect(exports.at(-1)).toEqual(wireMetrics(collected.resourceMetrics));
  }
  const combinations = OUTCOMES.flatMap((outcome) =>
    PHASES.flatMap((phase) =>
      (['legacy-legacy', 'legacy-modern', 'modern-legacy', 'modern-modern', 'unknown'] as const).map((era_pair) => ({
        outcome,
        phase,
        era_pair,
      })),
    ),
  ).slice(0, 300);
  try {
    await compare();
    expect(exports.at(-1)).toEqual([]);
    for (const dimensions of combinations) {
      measure(names[0], 1, dimensions);
      measure(names[0], -1, dimensions);
      measure(names[1], 4, dimensions);
      measure(names[1], 9, dimensions);
      measure(names[2], 3, dimensions);
    }
    const overflowAttempts = (300 - 255) * 5;
    expect(sdk.status().metrics.overflow).toBe(overflowAttempts);
    await compare();
    await compare();
    expect(sdk.status().metrics.overflow).toBe(overflowAttempts);
    for (const dimensions of [combinations[0], combinations[299]]) {
      measure(names[0], 5, dimensions);
      measure(names[0], -2, dimensions);
      measure(names[1], 0, dimensions);
      measure(names[2], 1, dimensions);
    }
    await compare();
    const last = wireMetrics((await reader.collect()).resourceMetrics);
    measure(names[0], -3, combinations[0]);
    measure(names[0], -3, combinations[299]);
    await sdk.stop(Date.now() + 2000);
    expect(exports.at(-1)).toEqual(wireMetrics((await reader.collect()).resourceMetrics));
    expect(exports.at(-1)).not.toEqual(last);
    expect(sdk.status().metrics.shutdown).toBe('success');
    for (const metric of exports.at(-1)) {
      const points = (metric.sum ?? metric.gauge).dataPoints;
      expect(points).toHaveLength(256);
      expect(points.every((point: { exemplars?: unknown[] }) => !point.exemplars?.length)).toBe(true);
      expect(
        points.filter((point: { attributes: Array<{ key: string }> }) =>
          point.attributes.some((attribute) => attribute.key === 'otel.metric.overflow'),
        ),
      ).toHaveLength(1);
    }
  } finally {
    await sdk.stop(Date.now() + 2000);
    await baseline.shutdown();
    exportSpy.mockRestore();
  }
});
