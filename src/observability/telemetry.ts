/** SDK-free operational facade. No authority, results, routing or readiness depend on telemetry. */
import { SpanKind, trace } from '@opentelemetry/api';
import { isTracingSuppressed } from '@opentelemetry/core';

import type { TelemetryConfig } from '../config/telemetryConfig.js';
import { TelemetryConfigurationError } from '../config/telemetryConfig.js';
import type { SignalStatus, TelemetryDiagnostic, TelemetryStatus } from './signals/health.js';
import {
  classifyOperation,
  dataRecord,
  dimensionsSchema,
  type MeasurementDimensions,
  type MeasurementName,
  METRIC_REGISTRY,
  operationSchema,
  outcomeSchema,
  type TelemetryOperationOptions,
  type TelemetryOperationResult,
} from './signals/schema.js';
import type { TelemetrySdk } from './signals/sdk.js';
import {
  extractMcpParentContext,
  getLiveTraceContext,
  installTracingContext,
  runWithOwnedTraceContext,
} from './tracing/otelAdapter.js';

export type {
  MeasurementName,
  MeasurementDimensions,
  TelemetryOperationOptions,
  TelemetryOperationResult,
  OperationOutcome,
} from './signals/schema.js';
export type {
  TelemetryStatus,
  TelemetryDiagnostic,
  SignalStatus,
  SignalState,
  ShutdownOutcome,
} from './signals/health.js';
export { OPERATION_REGISTRY, METRIC_REGISTRY, PHASES, OUTCOMES, classifyOperation } from './signals/schema.js';
export interface TelemetryStartOptions {
  role: 'runtime' | 'proxy' | 'supervisor' | 'command';
  serviceVersion: string;
  onDiagnostic?: (event: TelemetryDiagnostic) => void;
}
let sdk: TelemetrySdk | undefined;
let starting: Promise<void> | undefined;
function disabledSignal(): SignalStatus {
  return {
    state: 'disabled',
    exporter: 'none',
    queueUse: 'empty',
    dropped: 0,
    overflow: 0,
    successAgeMs: null,
    failureAgeMs: null,
    shutdown: 'none',
  };
}
export function getTelemetryStatus(): TelemetryStatus {
  return sdk?.status() ?? { state: 'disabled', traces: disabledSignal(), metrics: disabledSignal() };
}
export function startTelemetry(config: TelemetryConfig, options: TelemetryStartOptions): Promise<void> {
  if (starting) return starting;
  if (sdk && getTelemetryStatus().state !== 'stopped')
    return Promise.reject(new TelemetryConfigurationError('already-started'));
  starting = (async () => {
    installTracingContext();
    sdk = undefined;
    if (
      !['runtime', 'proxy'].includes(options.role) ||
      config.disabled ||
      (config.traces.exporter === 'none' && config.metrics.exporter === 'none')
    )
      return;
    if (!options.serviceVersion || Buffer.byteLength(options.serviceVersion) > 256)
      throw new TelemetryConfigurationError('service-version');
    try {
      const { TelemetrySdk } = await import('./signals/sdk.js');
      sdk = new TelemetrySdk(config, options.serviceVersion, options.onDiagnostic);
      if (config.warnings.length) {
        try {
          options.onDiagnostic?.({
            event: 'telemetry.configuration',
            signal: 'traces',
            category: 'configuration',
            suppressed: 0,
          });
        } catch {
          /* Local diagnosis is isolated. */
        }
      }
    } catch {
      throw new TelemetryConfigurationError('provider-initialization');
    }
  })().finally(() => {
    starting = undefined;
  });
  return starting;
}
/** Read-only state transition before gateway drain; existing operations still record. */
export function markTelemetryStopping(): void {
  isolate(() => sdk?.markStopping());
}
export async function stopTelemetry(options: { deadlineMs: number; fatal?: boolean }): Promise<void> {
  await starting;
  await sdk?.stop(options.deadlineMs, options.fatal);
}
function isolate<T>(operation: () => T): T | undefined {
  try {
    return operation();
  } catch {
    return undefined;
  }
}
export interface TelemetryOperation {
  run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T>;
  end(result?: TelemetryOperationResult): void;
}
/** Unknown attributes reject the signal, never the admitted operation. */
export function startTelemetryOperation(input: TelemetryOperationOptions): TelemetryOperation {
  const safe = dataRecord(input);
  const parsed = safe ? operationSchema.safeParse(safe) : undefined;
  if (!parsed?.success) return { run: (operation) => operation(), end: () => undefined };
  const options = parsed.data;
  const live = getLiveTraceContext();
  if (isTracingSuppressed(live)) return { run: (operation) => operation(), end: () => undefined };
  const parent = options.kind === 'server' ? extractMcpParentContext(options.remoteParams) : live;
  const operation = classifyOperation(options.method);
  const phase = options.phase ?? 'operation';
  let direction: MeasurementDimensions['direction'] = 'internal';
  if (options.kind === 'server') direction = 'inbound';
  if (options.kind === 'client') direction = 'outbound';
  if (options.kind === 'http') direction = options.httpDirection ?? 'inbound';
  const attributes: MeasurementDimensions = {
    operation_family: operation.family as MeasurementDimensions['operation_family'],
    direction,
    era_pair: options.inboundEra && options.outboundEra ? `${options.inboundEra}-${options.outboundEra}` : 'unknown',
    transport: options.transport,
    phase,
    dispatch_state: options.dispatchState,
  };
  const name = options.kind === 'server' || options.kind === 'client' ? operation.method : phase;
  let kind = SpanKind.INTERNAL;
  if (options.kind === 'server') kind = SpanKind.SERVER;
  if (options.kind === 'client') kind = SpanKind.CLIENT;
  if (options.kind === 'http') kind = direction === 'outbound' ? SpanKind.CLIENT : SpanKind.SERVER;
  const owner = sdk;
  const span = isolate(() => owner?.span(name, kind, attributes, parent, options.kind === 'server' ? live : undefined));
  const owned = span ? trace.setSpan(parent, span) : parent;
  const started = performance.now();
  let ended = false;
  isolate(() => owner?.measure('gateway.active.operations', 1, attributes));
  return {
    run: (callback, signal) => runWithOwnedTraceContext(owned, callback, signal),
    end: (inputResult = 'success') => {
      if (ended) return;
      ended = true;
      const parsedResult =
        typeof inputResult === 'string'
          ? outcomeSchema.safeParse(inputResult)
          : outcomeSchema.safeParse(dataRecord(inputResult));
      const result = parsedResult.success ? parsedResult.data : 'internal-error';
      const outcome = typeof result === 'string' ? result : result.outcome;
      const dimensions: MeasurementDimensions = { ...attributes, outcome };
      if (typeof result !== 'string') {
        dimensions.failure_kind = result.failureKind;
        dimensions.failure_code = result.failureCode;
        dimensions.dispatch_state = result.dispatchState ?? dimensions.dispatch_state;
      }
      const error =
        ['upstream-error', 'transport-error', 'invalid-response', 'aborted', 'internal-error', 'draining'].includes(
          outcome,
        ) ||
        (options.kind === 'client' && ['caller-error', 'denied', 'not-found', 'cancelled'].includes(outcome));
      isolate(() => owner?.finish(span, dimensions, error));
      isolate(() => owner?.measure('gateway.active.operations', -1, attributes));
      const duration = Math.max(0, (performance.now() - started) / 1000);
      if (options.kind === 'server')
        isolate(() => owner?.measure('mcp.server.operation.duration', duration, dimensions));
      else if (options.kind === 'client')
        isolate(() => owner?.measure('mcp.client.operation.duration', duration, dimensions));
      else isolate(() => owner?.measure('gateway.phase.duration', duration, dimensions));
      if (!['success', 'tool-error'].includes(outcome))
        isolate(() => owner?.measure('gateway.failures', 1, dimensions));
    },
  };
}
export async function withTelemetryOperation<T>(
  options: TelemetryOperationOptions,
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const handle = startTelemetryOperation(options);
  try {
    const result = await handle.run(operation, signal);
    handle.end(signal?.aborted ? 'cancelled' : 'success');
    return result;
  } catch (error) {
    handle.end(signal?.aborted ? 'cancelled' : 'internal-error');
    throw error;
  }
}
export function recordTelemetryMeasurement(
  name: MeasurementName,
  value: number,
  input: MeasurementDimensions = {},
): boolean {
  if (typeof name !== 'string' || !Object.hasOwn(METRIC_REGISTRY, name) || !Number.isFinite(value)) return false;
  if (value < 0 && METRIC_REGISTRY[name].kind !== 'updown') return false;
  if (isTracingSuppressed(getLiveTraceContext())) return false;
  const safe = dataRecord(input);
  const attributes = safe ? dimensionsSchema.safeParse(safe) : undefined;
  if (!attributes?.success) return false;
  try {
    sdk?.measure(name, value, attributes.data);
    return true;
  } catch {
    return false;
  }
}

/** A bounded tracing seam reports a lost record using only its closed signal name. */
export function recordTelemetryDrop(signal: 'traces' | 'metrics' = 'traces'): boolean {
  if (signal !== 'traces' && signal !== 'metrics') return false;
  isolate(() => sdk?.recordDrop(signal));
  return true;
}
