import { type Context, ROOT_CONTEXT, type Span, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { Counter, Gauge, Histogram, UpDownCounter } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  AggregationType,
  createAllowListAttributesProcessor,
  InstrumentType,
  MeterProvider,
  MetricReader,
  type ViewOptions,
} from '@opentelemetry/sdk-metrics';
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  BasicTracerProvider,
  ParentBasedSampler,
  type ReadableSpan,
  type SpanProcessor,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';

import { randomUUID } from 'node:crypto';

import type { TelemetryConfig } from '../../config/telemetryConfig.js';
import { exportableSpan, metricExporter, type SecureExporter, traceExporter } from './export.js';
import {
  aggregateState,
  type ShutdownOutcome,
  SignalHealth,
  type TelemetryDiagnostic,
  type TelemetryStatus,
} from './health.js';
import {
  CONVENTION_SOURCE,
  type MeasurementDimensions,
  type MeasurementName,
  METRIC_ATTRIBUTE_KEYS,
  METRIC_REGISTRY,
} from './schema.js';

const instanceId = randomUUID();
const BOUNDARIES = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10];
/** All promises started here are observed, including work that outlives a shutdown deadline. */
async function bounded(work: Promise<unknown>, timeout: number): Promise<ShutdownOutcome> {
  if (timeout <= 0) {
    void work.catch(() => undefined);
    return 'timeout';
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.then(
        () => 'success' as const,
        () => 'failed' as const,
      ),
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeout);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
class TraceQueue implements SpanProcessor {
  private queue: ReadableSpan[] = [];
  private inFlight?: Promise<void>;
  private stopped = false;
  private timer: ReturnType<typeof setInterval>;
  private failures = 0;
  constructor(
    private config: TelemetryConfig['batch'],
    private exporter: SecureExporter<ReadableSpan[]>,
    private health: SignalHealth,
  ) {
    this.timer = setInterval(() => {
      void this.send();
    }, config.delayMs);
    this.timer.unref();
  }
  onStart(): void {}
  onEnd(span: ReadableSpan): void {
    if (this.stopped) return;
    if (this.queue.length >= this.config.queueSize) {
      this.health.drop();
      return;
    }
    this.queue.push(span);
    this.health.queue(this.queue.length);
    if (this.queue.length >= this.config.batchSize) void this.send();
  }
  private send(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (!this.queue.length) return Promise.resolve();
    const batch = this.queue.splice(0, this.config.batchSize).map(exportableSpan);
    this.health.queue(this.queue.length);
    this.inFlight = (async () => {
      const result = await bounded(
        this.exporter.export(batch).then((success) => {
          if (!success) throw new Error('export-failed');
        }),
        this.config.timeoutMs,
      );
      if (result === 'success') this.health.success();
      else {
        this.failures++;
        this.health.fail();
      }
    })().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }
  async forceFlush(): Promise<void> {
    const before = this.failures;
    await this.inFlight;
    while (this.queue.length) await this.send();
    if (this.failures > before) throw new Error('telemetry-flush-failed');
  }
  async shutdown(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    try {
      await this.forceFlush();
    } finally {
      await this.exporter.shutdown();
    }
  }
  stop(): void {
    this.stopped = true;
    clearInterval(this.timer);
  }
  destroy(): void {
    this.stop();
    this.queue = [];
    this.health.queue(0);
    this.exporter.destroy();
  }
}
class BoundedMetricReader extends MetricReader {
  private timer?: ReturnType<typeof setInterval>;
  private inFlight?: Promise<void>;
  private stopped = false;
  private failures = 0;
  constructor(
    private config: TelemetryConfig['metricReader'],
    private exporter: ReturnType<typeof metricExporter>,
    private health: SignalHealth,
  ) {
    super({
      cardinalitySelector: (type) =>
        type === InstrumentType.HISTOGRAM ? 1024 : type === InstrumentType.COUNTER ? 512 : 256,
    });
  }
  protected onInitialized(): void {
    this.timer = setInterval(() => {
      void this.send();
    }, this.config.intervalMs);
    this.timer.unref();
  }
  private send(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.health.queue(1);
    this.inFlight = (async () => {
      try {
        const collected = await this.collect({ timeoutMillis: this.config.timeoutMs });
        if (collected.errors.length) {
          this.failures++;
          this.health.fail();
          return;
        }

        const result = await bounded(
          this.exporter.export(collected.resourceMetrics).then((success) => {
            if (!success) throw new Error('export-failed');
          }),
          this.config.timeoutMs,
        );
        // Metric export has no queued work after completion.
        this.health.queue(0);
        if (result === 'success') this.health.success();
        else {
          this.failures++;
          this.health.fail();
        }
      } catch {
        this.failures++;
        this.health.fail();
      } finally {
        this.health.queue(0);
      }
    })().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }
  protected async onForceFlush(): Promise<void> {
    const before = this.failures;
    await this.send();
    if (this.failures > before) throw new Error('telemetry-flush-failed');
  }
  protected async onShutdown(): Promise<void> {
    this.stop();
    await this.inFlight;
    await this.exporter.shutdown();
  }
  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }
  destroy(): void {
    this.stop();
    this.exporter.destroy();
  }
}
export class TelemetrySdk {
  readonly traces: SignalHealth;
  readonly metrics: SignalHealth;
  private tracer?: ReturnType<BasicTracerProvider['getTracer']>;
  private traceProvider?: BasicTracerProvider;
  private meterProvider?: MeterProvider;
  private traceQueue?: TraceQueue;
  private metricReader?: BoundedMetricReader;
  private instruments = new Map<MeasurementName, Counter | Histogram | UpDownCounter | Gauge>();
  private series = new Map<MeasurementName, Set<string>>();
  private ticker: ReturnType<typeof setInterval>;
  private stopping?: Promise<void>;
  constructor(
    readonly config: TelemetryConfig,
    version: string,
    diagnostic?: (event: TelemetryDiagnostic) => void,
  ) {
    this.traces = new SignalHealth('traces', config.batch.delayMs, config.batch.queueSize, config.traces, diagnostic);
    this.metrics = new SignalHealth('metrics', config.metricReader.intervalMs, 2, config.metrics, diagnostic);
    // Resource is independently closed. No defaults/detectors or environment resource parser.
    const resource = resourceFromAttributes({
      'service.name': config.serviceName,
      'service.version': version,
      'service.instance.id': instanceId,
    });
    try {
      if (config.traces.exporter === 'otlp') {
        const name = config.sampler.name;
        const root = name.endsWith('always_on')
          ? new AlwaysOnSampler()
          : name.endsWith('always_off')
            ? new AlwaysOffSampler()
            : new TraceIdRatioBasedSampler(config.sampler.ratio);
        const sampler = name.startsWith('parentbased_') ? new ParentBasedSampler({ root }) : root;
        this.traceQueue = new TraceQueue(config.batch, traceExporter(config.traces), this.traces);
        this.traceProvider = new BasicTracerProvider({
          resource,
          sampler,
          spanProcessors: [this.traceQueue],
          forceFlushTimeoutMillis: config.batch.timeoutMs,
          generalLimits: {
            attributeCountLimit: config.limits.attributes,
            attributeValueLengthLimit: config.limits.attributeBytes,
          },
          spanLimits: {
            attributeCountLimit: config.limits.attributes,
            attributeValueLengthLimit: config.limits.attributeBytes,
            eventCountLimit: config.limits.events,
            linkCountLimit: config.limits.links,
            attributePerEventCountLimit: config.limits.eventAttributes,
            attributePerLinkCountLimit: config.limits.linkAttributes,
          },
        });
        this.tracer = this.traceProvider.getTracer('1mcp.operational', version, {
          schemaUrl: CONVENTION_SOURCE,
        });
      }
      if (config.metrics.exporter === 'otlp') {
        this.metricReader = new BoundedMetricReader(config.metricReader, metricExporter(config.metrics), this.metrics);
        const views: ViewOptions[] = Object.entries(METRIC_REGISTRY).map(([instrumentName, spec]) => ({
          instrumentName,
          attributesProcessors: [
            createAllowListAttributesProcessor([...METRIC_ATTRIBUTE_KEYS, 'otel.metric.overflow']),
          ],
          aggregationCardinalityLimit: spec.cap,
          ...(spec.kind === 'histogram'
            ? { aggregation: { type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM, options: { boundaries: BOUNDARIES } } }
            : {}),
        }));
        this.meterProvider = new MeterProvider({
          resource,
          readers: [this.metricReader],
          views,
          sdkMetricsEnabled: false,
        });
        const meter = this.meterProvider.getMeter('1mcp.operational', version, {
          schemaUrl: CONVENTION_SOURCE,
        });
        for (const [name, spec] of Object.entries(METRIC_REGISTRY)) {
          let instrument: Counter | Histogram | UpDownCounter | Gauge;
          if (spec.kind === 'histogram') instrument = meter.createHistogram(name, { unit: spec.unit });
          else if (spec.kind === 'counter') instrument = meter.createCounter(name, { unit: spec.unit });
          else if (spec.kind === 'updown') instrument = meter.createUpDownCounter(name, { unit: spec.unit });
          else instrument = meter.createGauge(name, { unit: spec.unit });
          this.instruments.set(name as MeasurementName, instrument);
        }
      }
    } catch (error) {
      this.traceQueue?.destroy();
      this.metricReader?.destroy();
      throw error;
    }
    this.ticker = setInterval(
      () => {
        this.traces.tick();
        this.metrics.tick();
      },
      Math.min(1000, config.batch.delayMs, config.metricReader.intervalMs),
    );
    this.ticker.unref();
  }
  span(
    name: string,
    kind: SpanKind,
    attributes: MeasurementDimensions,
    parent: Context,
    transportLink?: Context,
  ): Span | undefined {
    if (this.stopping || !this.tracer) return undefined;
    const link = transportLink ? trace.getSpanContext(transportLink) : undefined;
    const links = link ? [{ context: link, attributes: {} }] : [];
    const limited = Object.fromEntries(
      Object.entries(attributes)
        .filter(([, value]) => value !== undefined && Buffer.byteLength(value) <= this.config.limits.attributeBytes)
        .slice(0, this.config.limits.attributes),
    );
    return this.tracer.startSpan(name, { kind, attributes: limited, links }, parent);
  }
  finish(span: Span | undefined, attributes: MeasurementDimensions, error: boolean): void {
    if (!span) return;
    for (const [key, value] of Object.entries(attributes))
      if (value !== undefined && Buffer.byteLength(value) <= this.config.limits.attributeBytes)
        span.setAttribute(key, value);
    if (error) span.setStatus({ code: SpanStatusCode.ERROR, message: 'Operation failed' });
    span.end();
  }
  measure(name: MeasurementName, value: number, attributes: MeasurementDimensions): void {
    if (this.stopping) return;
    const instrument = this.instruments.get(name);
    if (!instrument) return;
    const spec = METRIC_REGISTRY[name];
    const sorted = Object.entries(attributes)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    const key = JSON.stringify(sorted);
    const seen = this.series.get(name) ?? new Set<string>();
    this.series.set(name, seen);
    // Bounded local detection mirrors the SDK cumulative series cap (including overflow series).
    if (!seen.has(key)) {
      if (seen.size < spec.cap - 1) seen.add(key);
      else {
        this.metrics.cardinality();
        attributes = { 'otel.metric.overflow': true } as MeasurementDimensions;
      }
    }
    if ('record' in instrument) instrument.record(value, attributes, ROOT_CONTEXT);
    else instrument.add(value, attributes, ROOT_CONTEXT);
  }
  status(): TelemetryStatus {
    const traces = this.traces.status();
    const metrics = this.metrics.status();
    return { state: aggregateState([traces, metrics]), traces, metrics };
  }
  markStopping(): void {
    for (const health of [this.traces, this.metrics]) {
      if (['starting', 'healthy', 'degraded'].includes(health.state)) health.state = 'stopping';
    }
  }
  stop(deadlineMs: number, fatal = false): Promise<void> {
    this.stopping ??= this.shutdown(Math.min(deadlineMs, Date.now() + (fatal ? 1000 : 5000)));
    return this.stopping;
  }
  private async shutdown(deadline: number): Promise<void> {
    clearInterval(this.ticker);
    const active = [this.traces, this.metrics].filter((health) => health.state !== 'disabled');
    for (const health of active) health.state = 'stopping';
    this.traceQueue?.stop();
    this.metricReader?.stop();
    const clean = async (health: SignalHealth, provider: BasicTracerProvider | MeterProvider | undefined) => {
      if (!provider) return;
      const outcome = await bounded(
        (async () => {
          let failed = false;
          try {
            await provider.forceFlush();
          } catch {
            failed = true;
          }
          try {
            await provider.shutdown();
          } catch {
            failed = true;
          }
          if (failed) throw new Error('telemetry-shutdown-failed');
        })(),
        Math.max(0, deadline - Date.now()),
      );
      health.state = 'stopped';
      health.shutdown = outcome;
      if (outcome !== 'success') health.warn('shutdown');
    };
    await Promise.all([clean(this.traces, this.traceProvider), clean(this.metrics, this.meterProvider)]);
    // Destroy agents on deadlines too: no long-lived export sockets may extend runtime stop.
    this.traceQueue?.destroy();
    this.metricReader?.destroy();
  }
}
