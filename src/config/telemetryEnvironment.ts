import { getRuntimeParentEnvironment } from './runtimeBootstrap.js';
import { getRuntimeScopeEnvironment } from './runtimeScopeEnv.js';

// Explicit start-only environment plumbing. Never pass an arbitrary environment to the SDK.
const SETTINGS = [
  'OTEL_SDK_DISABLED',
  'OTEL_SERVICE_NAME',
  'OTEL_RESOURCE_ATTRIBUTES',
  'OTEL_CONFIG_FILE',
  'OTEL_TRACES_EXPORTER',
  'OTEL_METRICS_EXPORTER',
  'OTEL_LOGS_EXPORTER',
  'OTEL_TRACES_SAMPLER',
  'OTEL_TRACES_SAMPLER_ARG',
  'OTEL_BSP_MAX_QUEUE_SIZE',
  'OTEL_BSP_MAX_EXPORT_BATCH_SIZE',
  'OTEL_BSP_SCHEDULE_DELAY',
  'OTEL_BSP_EXPORT_TIMEOUT',
  'OTEL_METRIC_EXPORT_INTERVAL',
  'OTEL_METRIC_EXPORT_TIMEOUT',
  // Standard OTLP metric controls retained only for unsupported-setting diagnosis.
  'OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE',
  'OTEL_EXPORTER_OTLP_METRICS_DEFAULT_HISTOGRAM_AGGREGATION',
  'OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT',
  'OTEL_ATTRIBUTE_COUNT_LIMIT',
  'OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT',
  'OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT',
  'OTEL_SPAN_EVENT_COUNT_LIMIT',
  'OTEL_SPAN_LINK_COUNT_LIMIT',
  'OTEL_EVENT_ATTRIBUTE_COUNT_LIMIT',
  'OTEL_LINK_ATTRIBUTE_COUNT_LIMIT',
  'OTEL_PROPAGATORS',
  'OTEL_METRICS_EXEMPLAR_FILTER',
  'OTEL_LOG_LEVEL',
  ...['', '_TRACES', '_METRICS', '_LOGS'].flatMap((signal) =>
    [
      'ENDPOINT',
      'PROTOCOL',
      'HEADERS',
      'CERTIFICATE',
      'CLIENT_KEY',
      'CLIENT_CERTIFICATE',
      'TIMEOUT',
      'COMPRESSION',
    ].map((setting) => `OTEL_EXPORTER_OTLP${signal}_${setting}`),
  ),
];

export function selectTelemetryEnvironment(
  parent: Readonly<Record<string, string | undefined>> = getRuntimeParentEnvironment(),
  scope: Readonly<Record<string, string>> = getRuntimeScopeEnvironment(),
): Record<string, string> {
  const selected: Record<string, string> = {};
  for (const key of SETTINGS) {
    const value = scope[key] ?? parent[key];
    if (value !== undefined) selected[key] = value;
  }
  return selected;
}
