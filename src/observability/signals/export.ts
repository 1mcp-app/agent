import { context, ROOT_CONTEXT } from '@opentelemetry/api';
import { type ExportResult, ExportResultCode, suppressTracing } from '@opentelemetry/core';
import { OTLPExporterBase } from '@opentelemetry/otlp-exporter-base';
import { createOtlpHttpExportDelegate } from '@opentelemetry/otlp-exporter-base/node-http';
import { type ISerializer, ProtobufMetricsSerializer, ProtobufTraceSerializer } from '@opentelemetry/otlp-transformer';
import type { ResourceMetrics } from '@opentelemetry/sdk-metrics';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';

import { readFileSync } from 'node:fs';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { createSecureContext } from 'node:tls';

import type { SignalExportConfig } from '../../config/telemetryConfig.js';
import { TelemetryConfigurationError } from '../../config/telemetryConfig.js';

/** Public OTel delegate API, intentionally bypassing environment-reading exporter constructors. */
export class SecureExporter<T> {
  private readonly exporter: OTLPExporterBase<T>;
  private readonly agent: HttpAgent;
  private stopped = false;
  constructor(config: SignalExportConfig, serializer: ISerializer<T, unknown>) {
    try {
      const ca = config.certificate ? readFileSync(config.certificate) : undefined;
      const cert = config.clientCertificate ? readFileSync(config.clientCertificate) : undefined;
      const key = config.clientKey ? readFileSync(config.clientKey) : undefined;
      if (config.endpointClass === 'https') {
        createSecureContext({ ca, cert, key });
        this.agent = new HttpsAgent({ ca, cert, key, rejectUnauthorized: true, keepAlive: true, maxSockets: 1 });
      } else this.agent = new HttpAgent({ keepAlive: true, maxSockets: 1 });
      this.exporter = new OTLPExporterBase(
        createOtlpHttpExportDelegate(
          {
            url: config.endpoint,
            headers: async () => ({ ...config.headers, 'Content-Type': 'application/x-protobuf' }),
            compression: config.compression,
            concurrencyLimit: 1,
            timeoutMillis: config.timeoutMs,
            agentFactory: () => this.agent,
          },
          serializer,
        ),
      );
    } catch {
      throw new TelemetryConfigurationError('exporter-initialization');
    }
  }
  export(data: T): Promise<boolean> {
    if (this.stopped) return Promise.resolve(false);
    return new Promise((resolve) => {
      try {
        context.with(suppressTracing(ROOT_CONTEXT), () =>
          this.exporter.export(data, (result: ExportResult) => resolve(result.code === ExportResultCode.SUCCESS)),
        );
      } catch {
        resolve(false);
      }
    });
  }
  async shutdown(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.agent.destroy();
    await this.exporter.shutdown();
  }
  destroy(): void {
    this.stopped = true;
    this.agent.destroy();
  }
}
export function traceExporter(config: SignalExportConfig): SecureExporter<ReadableSpan[]> {
  return new SecureExporter(config, ProtobufTraceSerializer);
}
export function metricExporter(config: SignalExportConfig): SecureExporter<ResourceMetrics> {
  return new SecureExporter(config, ProtobufMetricsSerializer);
}
/** TraceState is a propagation carrier, not signal data. Keep propagation context untouched. */
export function exportableSpan(span: ReadableSpan): ReadableSpan {
  const cleanContext = (value: ReturnType<ReadableSpan['spanContext']>) => ({
    traceId: value.traceId,
    spanId: value.spanId,
    traceFlags: value.traceFlags,
    isRemote: value.isRemote,
  });
  return {
    ...span,
    spanContext: () => cleanContext(span.spanContext()),
    parentSpanContext: span.parentSpanContext ? cleanContext(span.parentSpanContext) : undefined,
    links: span.links.map((link) => ({ ...link, context: cleanContext(link.context) })),
  };
}
