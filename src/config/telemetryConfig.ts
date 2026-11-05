import { z } from 'zod';

export type TelemetryEnvironment = Readonly<Record<string, string | undefined>>;
export type SignalName = 'traces' | 'metrics';
export interface SignalExportConfig {
  readonly exporter: 'none' | 'otlp';
  readonly endpoint: string;
  readonly endpointClass: 'loopback-http' | 'https';
  readonly protocol: 'http/protobuf';
  readonly headers: Readonly<Record<string, string>>;
  readonly compression: 'none' | 'gzip';
  readonly timeoutMs: number;
  readonly certificate?: string;
  readonly clientCertificate?: string;
  readonly clientKey?: string;
}
export const SAMPLERS = [
  'always_on',
  'always_off',
  'traceidratio',
  'parentbased_always_on',
  'parentbased_always_off',
  'parentbased_traceidratio',
] as const;
export interface TelemetryConfig {
  readonly disabled: boolean;
  readonly serviceName: string;
  readonly traces: SignalExportConfig;
  readonly metrics: SignalExportConfig;
  readonly sampler: { readonly name: (typeof SAMPLERS)[number]; readonly ratio: number };
  readonly batch: {
    readonly queueSize: number;
    readonly batchSize: number;
    readonly delayMs: number;
    readonly timeoutMs: number;
  };
  readonly metricReader: { readonly intervalMs: number; readonly timeoutMs: number };
  readonly limits: {
    readonly attributes: number;
    readonly attributeBytes: number;
    readonly events: number;
    readonly links: number;
    readonly eventAttributes: number;
    readonly linkAttributes: number;
  };
  readonly warnings: readonly string[];
}
/** Errors contain fixed categories only, never values, URLs, keys or parser text. */
export class TelemetryConfigurationError extends Error {
  constructor(readonly category: string) {
    super(`Invalid telemetry configuration: ${category}`);
    this.name = 'TelemetryConfigurationError';
  }
}
function invalid(category: string): never {
  throw new TelemetryConfigurationError(category);
}
function value(env: TelemetryEnvironment, key: string): string | undefined {
  return env[key] === '' ? undefined : env[key];
}
function enumValue<T extends string>(raw: string | undefined, allowed: readonly T[], fallback: T, category: string): T {
  if (raw === undefined) return fallback;
  const normalized = raw.toLowerCase();
  return allowed.includes(normalized as T) ? (normalized as T) : invalid(category);
}
function boundedInteger(
  env: TelemetryEnvironment,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = value(env, key);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) return invalid('numeric-setting');
  const parsed: number = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) return invalid('numeric-bound');
  return parsed;
}
function pairs(raw: string | undefined, category: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (raw === undefined) return result;
  for (const item of raw.split(',')) {
    const separator = item.indexOf('=');
    if (separator < 1) return invalid(category);
    try {
      Object.defineProperty(result, item.slice(0, separator).trim(), {
        value: decodeURIComponent(item.slice(separator + 1).trim()),
        enumerable: true,
        configurable: true,
      });
    } catch {
      return invalid(category);
    }
  }
  return result;
}
function signalConfig(env: TelemetryEnvironment, signal: SignalName, disabled: boolean): SignalExportConfig {
  const prefix = `OTEL_EXPORTER_OTLP_${signal.toUpperCase()}_`;
  const setting = (name: string) => value(env, prefix + name) ?? value(env, 'OTEL_EXPORTER_OTLP_' + name);
  const selected = enumValue(
    value(env, `OTEL_${signal.toUpperCase()}_EXPORTER`),
    ['none', 'otlp'],
    'none',
    'exporter-selector',
  );
  const exporter = disabled ? 'none' : selected;
  const protocol = enumValue(setting('PROTOCOL'), ['http/protobuf'], 'http/protobuf', 'exporter-protocol');
  const sharedEndpoint = value(env, 'OTEL_EXPORTER_OTLP_ENDPOINT') ?? 'http://localhost:4318';
  let endpoint = value(env, prefix + 'ENDPOINT');
  if (endpoint === undefined) endpoint = sharedEndpoint.replace(/\/$/, '') + `/v1/${signal}`;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return invalid('exporter-endpoint');
  }
  const loopback =
    url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (url.username || url.password || url.hash || url.search) return invalid('exporter-endpoint');
  if (url.protocol !== 'https:') {
    if (url.protocol !== 'http:' || !loopback) return invalid('exporter-transport-security');
  }
  const headers = pairs(setting('HEADERS'), 'exporter-headers');
  for (const [key, entry] of Object.entries(headers)) {
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(key) || /[^\x20-\x7e]/.test(entry)) return invalid('exporter-headers');
    if (['host', 'content-length', 'content-type', 'connection', 'transfer-encoding'].includes(key.toLowerCase()))
      return invalid('exporter-headers');
  }
  const clientCertificate = setting('CLIENT_CERTIFICATE');
  const clientKey = setting('CLIENT_KEY');
  if (Boolean(clientCertificate) !== Boolean(clientKey)) return invalid('exporter-client-credentials');
  return {
    exporter,
    endpoint: url.toString(),
    endpointClass: url.protocol === 'https:' ? 'https' : 'loopback-http',
    protocol,
    headers,
    compression: enumValue(setting('COMPRESSION'), ['none', 'gzip'], 'none', 'exporter-compression'),
    timeoutMs: boundedInteger({ timeout: setting('TIMEOUT') }, 'timeout', 10000, 1, 30000),
    certificate: setting('CERTIFICATE'),
    clientCertificate,
    clientKey,
  };
}
/** Pure explicit-map parser. Environment access belongs to the existing runtime config boundary. */
export function parseTelemetryConfig(input: TelemetryEnvironment): TelemetryConfig {
  const parsed = z.record(z.string(), z.string().optional()).safeParse(input);
  if (!parsed.success) return invalid('environment-map');
  const env = parsed.data;
  if (value(env, 'OTEL_CONFIG_FILE') !== undefined) return invalid('config-file-unsupported');
  enumValue(value(env, 'OTEL_LOGS_EXPORTER'), ['none'], 'none', 'logs-export-unsupported');
  const warnings = new Set<string>();
  const rawDisabled = value(env, 'OTEL_SDK_DISABLED')?.toLowerCase();
  if (rawDisabled !== undefined && !['true', 'false'].includes(rawDisabled)) warnings.add('sdk-disabled-boolean');
  const disabled = rawDisabled === 'true';
  let resourceServiceName: string | undefined;
  const rawResource = value(env, 'OTEL_RESOURCE_ATTRIBUTES');
  if (rawResource !== undefined) {
    for (const entry of rawResource.split(',')) {
      const separator = entry.indexOf('=');
      if (separator < 1) return invalid('resource-attributes');
      if (entry.slice(0, separator).trim() !== 'service.name') {
        warnings.add('resource-attribute-dropped');
        continue;
      }
      try {
        resourceServiceName = decodeURIComponent(entry.slice(separator + 1).trim());
      } catch {
        return invalid('resource-attributes');
      }
    }
  }
  const serviceName = value(env, 'OTEL_SERVICE_NAME') ?? resourceServiceName ?? '1mcp';
  if (
    !serviceName.length ||
    Buffer.byteLength(serviceName) > 256 ||
    Array.from(serviceName).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    return invalid('service-name');
  const queueSize = boundedInteger(env, 'OTEL_BSP_MAX_QUEUE_SIZE', 2048, 1, 8192);
  const batchSize = Math.min(queueSize, boundedInteger(env, 'OTEL_BSP_MAX_EXPORT_BATCH_SIZE', 512, 1, 2048));
  const name = enumValue(value(env, 'OTEL_TRACES_SAMPLER'), SAMPLERS, 'traceidratio', 'sampler');
  const explicitSampler = value(env, 'OTEL_TRACES_SAMPLER') !== undefined;
  let ratio = explicitSampler ? 1 : 0.1;
  const rawRatio = value(env, 'OTEL_TRACES_SAMPLER_ARG');
  if (rawRatio !== undefined && name.endsWith('traceidratio')) {
    if (!/^(?:0(?:\.\d*)?|1(?:\.0*)?|\.\d+)$/.test(rawRatio)) return invalid('sampler-argument');
    ratio = Number(rawRatio);
  }
  const count = boundedInteger(env, 'OTEL_ATTRIBUTE_COUNT_LIMIT', 32, 0, 32);
  const bytes = boundedInteger(env, 'OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT', 256, 0, 256);
  const known = new Set([
    'OTEL_CONFIG_FILE',
    'OTEL_SDK_DISABLED',
    'OTEL_LOGS_EXPORTER',
    'OTEL_RESOURCE_ATTRIBUTES',
    'OTEL_SERVICE_NAME',
    'OTEL_TRACES_EXPORTER',
    'OTEL_METRICS_EXPORTER',
    'OTEL_TRACES_SAMPLER',
    'OTEL_TRACES_SAMPLER_ARG',
    'OTEL_BSP_MAX_QUEUE_SIZE',
    'OTEL_BSP_MAX_EXPORT_BATCH_SIZE',
    'OTEL_BSP_SCHEDULE_DELAY',
    'OTEL_BSP_EXPORT_TIMEOUT',
    'OTEL_METRIC_EXPORT_INTERVAL',
    'OTEL_METRIC_EXPORT_TIMEOUT',
    'OTEL_ATTRIBUTE_COUNT_LIMIT',
    'OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT',
    'OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT',
    'OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT',
    'OTEL_SPAN_EVENT_COUNT_LIMIT',
    'OTEL_SPAN_LINK_COUNT_LIMIT',
    'OTEL_EVENT_ATTRIBUTE_COUNT_LIMIT',
    'OTEL_LINK_ATTRIBUTE_COUNT_LIMIT',
  ]);
  for (const prefix of ['OTEL_EXPORTER_OTLP_', 'OTEL_EXPORTER_OTLP_TRACES_', 'OTEL_EXPORTER_OTLP_METRICS_']) {
    for (const suffix of [
      'ENDPOINT',
      'PROTOCOL',
      'HEADERS',
      'TIMEOUT',
      'COMPRESSION',
      'CERTIFICATE',
      'CLIENT_KEY',
      'CLIENT_CERTIFICATE',
    ])
      known.add(prefix + suffix);
  }
  for (const key of Object.keys(env))
    if (key.startsWith('OTEL_') && value(env, key) !== undefined && !known.has(key))
      warnings.add('unsupported-setting');
  return {
    disabled,
    serviceName,
    traces: signalConfig(env, 'traces', disabled),
    metrics: signalConfig(env, 'metrics', disabled),
    sampler: { name, ratio },
    batch: {
      queueSize,
      batchSize,
      delayMs: boundedInteger(env, 'OTEL_BSP_SCHEDULE_DELAY', 5000, 1, 60000),
      timeoutMs: boundedInteger(env, 'OTEL_BSP_EXPORT_TIMEOUT', 10000, 1, 30000),
    },
    metricReader: {
      intervalMs: boundedInteger(env, 'OTEL_METRIC_EXPORT_INTERVAL', 60000, 5000, 300000),
      timeoutMs: boundedInteger(env, 'OTEL_METRIC_EXPORT_TIMEOUT', 10000, 1, 30000),
    },
    limits: {
      attributes: boundedInteger(env, 'OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT', count, 0, 32),
      attributeBytes: boundedInteger(env, 'OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT', bytes, 0, 256),
      events: boundedInteger(env, 'OTEL_SPAN_EVENT_COUNT_LIMIT', 16, 0, 16),
      links: boundedInteger(env, 'OTEL_SPAN_LINK_COUNT_LIMIT', 8, 0, 8),
      eventAttributes: boundedInteger(env, 'OTEL_EVENT_ATTRIBUTE_COUNT_LIMIT', 16, 0, 16),
      linkAttributes: boundedInteger(env, 'OTEL_LINK_ATTRIBUTE_COUNT_LIMIT', 16, 0, 16),
    },
    warnings: [...warnings],
  };
}
