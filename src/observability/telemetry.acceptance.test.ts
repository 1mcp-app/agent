import { Client } from '@modelcontextprotocol/client';
import { context, diag, DiagLogLevel, ROOT_CONTEXT, trace } from '@opentelemetry/api';

import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { fileURLToPath } from 'node:url';

import { ModernSdkClientAdapter } from '@src/sdk/legacy/client/runtime/modernSdkClientAdapter.js';
import { createTransports } from '@src/transport/transportFactory.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseTelemetryConfig, type TelemetryEnvironment } from '../config/telemetryConfig.js';
import {
  getTelemetryStatus,
  OUTCOMES,
  PHASES,
  recordTelemetryDrop,
  recordTelemetryMeasurement,
  startTelemetry,
  startTelemetryOperation,
  stopTelemetry,
  withTelemetryOperation,
} from './telemetry.js';
import { captureTraceContext, getActiveTraceCorrelation, injectTraceContext } from './tracing/context.js';

async function collector(handler?: (request: IncomingMessage, response: ServerResponse) => void) {
  const payloads: { path: string; body: Buffer }[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    payloads.push({ path: request.url ?? '', body: Buffer.concat(chunks) });
    if (handler) handler(request, response);
    else response.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture-address');
  return {
    payloads,
    endpoint: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
async function active(endpoint: string, extra: TelemetryEnvironment = {}) {
  await startTelemetry(
    parseTelemetryConfig({
      OTEL_TRACES_EXPORTER: 'otlp',
      OTEL_TRACES_SAMPLER: 'always_on',
      OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
      ...extra,
    }),
    { role: 'runtime', serviceVersion: '0.39.2' },
  );
}

// Decode the standard OTLP envelope at the actual network boundary. No SDK internals/mocks.
function fields(bytes: Buffer): Map<number, (Buffer | bigint)[]> {
  const result = new Map<number, (Buffer | bigint)[]>();
  let offset = 0;
  const variable = () => {
    let value = 0n;
    let shift = 0n;
    while (offset < bytes.length) {
      const byte = bytes[offset++];
      value |= BigInt(byte & 127) << shift;
      if (!(byte & 128)) return value;
      shift += 7n;
    }
    throw new Error('truncated protobuf');
  };
  while (offset < bytes.length) {
    const tag = Number(variable());
    const number = tag >>> 3;
    const wire = tag & 7;
    let value: Buffer | bigint;
    if (wire === 0) value = variable();
    else if (wire === 1) {
      value = bytes.readBigUInt64LE(offset);
      offset += 8;
    } else if (wire === 5) {
      value = BigInt(bytes.readUInt32LE(offset));
      offset += 4;
    } else if (wire === 2) {
      const length = Number(variable());
      value = bytes.subarray(offset, offset + length);
      offset += length;
    } else throw new Error('unsupported protobuf wire');
    const entries = result.get(number) ?? [];
    entries.push(value);
    result.set(number, entries);
  }
  return result;
}
function messages(bytes: Buffer, number: number): Buffer[] {
  return (fields(bytes).get(number) ?? []).filter((entry): entry is Buffer => Buffer.isBuffer(entry));
}
function bytesAt(bytes: Buffer, number: number): Buffer {
  return messages(bytes, number)[0] ?? Buffer.alloc(0);
}
function textAt(bytes: Buffer, number: number): string {
  return bytesAt(bytes, number).toString();
}
function numericAt(bytes: Buffer, number: number): bigint {
  const value = fields(bytes).get(number)?.[0];
  return typeof value === 'bigint' ? value : 0n;
}
function spans(payloads: { path: string; body: Buffer }[]) {
  return payloads
    .filter((p) => p.path.endsWith('/traces'))
    .flatMap((p) => messages(p.body, 1))
    .flatMap((resource) => messages(resource, 2))
    .flatMap((scope) => messages(scope, 2))
    .map((span) => ({
      name: textAt(span, 5),
      kind: Number(numericAt(span, 6)),
      id: bytesAt(span, 2).toString('hex'),
      traceId: bytesAt(span, 1).toString('hex'),
      parentId: bytesAt(span, 4).toString('hex'),
      traceState: textAt(span, 3),
      status: Number(numericAt(bytesAt(span, 15), 3)),
      links: messages(span, 13).map((link) => ({
        traceId: bytesAt(link, 1).toString('hex'),
        traceState: textAt(link, 3),
      })),
      attributes: messages(span, 9).map((attribute) => [textAt(attribute, 1), textAt(bytesAt(attribute, 2), 1)]),
    }));
}

function metricPayloads(payloads: { path: string; body: Buffer }[]) {
  return payloads
    .filter((p) => p.path.endsWith('/metrics'))
    .flatMap((p) => messages(p.body, 1))
    .flatMap((resource) => messages(resource, 2))
    .flatMap((scope) => messages(scope, 2))
    .map((metric) => {
      const histogram = messages(metric, 9)[0];
      const data = histogram ?? messages(metric, 7)[0] ?? messages(metric, 5)[0];
      return {
        name: textAt(metric, 1),
        unit: textAt(metric, 3),
        points: data
          ? messages(data, 1).map((point) => ({
              count: Number(numericAt(point, 4)),
              exemplars: messages(point, histogram ? 8 : 5),
              attributes: messages(point, histogram ? 9 : 7).map((attribute) => ({
                key: textAt(attribute, 1),
                value: textAt(bytesAt(attribute, 2), 1),
                boolean: numericAt(bytesAt(attribute, 2), 2) === 1n,
              })),
              boundaries: histogram
                ? (() => {
                    const values = bytesAt(point, 7);
                    return Array.from({ length: values.length / 8 }, (_, i) => values.readDoubleLE(i * 8));
                  })()
                : [],
            }))
          : [],
      };
    });
}

function fixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await stopTelemetry({ deadlineMs: Date.now() + 1000 });
  diag.disable();
});
describe('operational telemetry accepted export and lifecycle boundary', () => {
  it('keeps SDK constructor environment diagnostics inside the typed local boundary', async () => {
    const log = vi.fn();
    const diagnostics: unknown[] = [];
    diag.setLogger({ warn: log, error: log, info: log, debug: log, verbose: log }, DiagLogLevel.WARN);
    vi.stubEnv('OTEL_TRACES_SAMPLER', 'sdk-env-private-sentinel');
    try {
      await startTelemetry(parseTelemetryConfig({ OTEL_TRACES_EXPORTER: 'otlp', OTEL_TRACES_SAMPLER: 'always_on' }), {
        role: 'runtime',
        serviceVersion: '0.39.2',
        onDiagnostic: (event) => diagnostics.push(event),
      });
      expect(JSON.stringify([log.mock.calls, diagnostics])).not.toContain('sdk-env-private-sentinel');
      expect(diagnostics).toContainEqual({
        event: 'telemetry.failure',
        signal: 'traces',
        category: 'configuration',
        suppressed: 0,
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('reports a closed wire-tracing drop without exporting caller details or changing readiness', async () => {
    const diagnostics: unknown[] = [];
    await startTelemetry(parseTelemetryConfig({ OTEL_TRACES_EXPORTER: 'otlp' }), {
      role: 'runtime',
      serviceVersion: '0.39.2',
      onDiagnostic: (event) => diagnostics.push(event),
    });
    expect(recordTelemetryDrop('traces')).toBe(true);
    expect(recordTelemetryDrop('private-server-secret' as never)).toBe(false);
    expect(getTelemetryStatus().traces).toMatchObject({ state: 'degraded', dropped: 1 });
    expect(diagnostics).toEqual([{ event: 'telemetry.failure', signal: 'traces', category: 'queue', suppressed: 0 }]);
  });
  it('keeps partial Collector response prose out of SDK diagnostics and reports rejected export', async () => {
    const secret = Buffer.from('collector-private-credential');
    const partial = Buffer.concat([Buffer.from([8, 1, 18, secret.length]), secret]);
    const wire = Buffer.concat([Buffer.from([10, partial.length]), partial]);
    const sink = collector((_req, response) => response.end(wire));
    const target = await sink;
    const log = vi.fn();
    diag.setLogger({ warn: log, error: log, info: log, debug: log, verbose: log }, DiagLogLevel.WARN);
    try {
      await active(target.endpoint);
      await withTelemetryOperation({ kind: 'server', method: 'ping' }, async () => 'ok');
      await stopTelemetry({ deadlineMs: Date.now() + 2000 });
      expect(JSON.stringify(log.mock.calls)).not.toContain('collector-private-credential');
      expect(getTelemetryStatus().traces.shutdown).toBe('failed');
    } finally {
      await target.close();
    }
  });
  it('makes the first successful export healthy even with queued work below a sustained-high interval', async () => {
    let hold = true;
    const pending: ServerResponse[] = [];
    const target = await collector((_request, response) => {
      if (hold) pending.push(response);
      else response.end();
    });
    try {
      await active(target.endpoint, { OTEL_BSP_MAX_QUEUE_SIZE: '4', OTEL_BSP_MAX_EXPORT_BATCH_SIZE: '1' });
      for (let index = 0; index < 4; index++)
        await withTelemetryOperation({ kind: 'server', method: 'ping' }, async () => undefined);
      await vi.waitFor(() => expect(pending.length).toBe(1));
      expect(getTelemetryStatus().traces.queueUse).toBe('high');
      hold = false;
      pending[0].end();
      await vi.waitFor(() => expect(getTelemetryStatus().traces.successAgeMs).not.toBeNull());
      expect(getTelemetryStatus().traces.state).toBe('healthy');
      await stopTelemetry({ deadlineMs: Date.now() + 2000 });
    } finally {
      await target.close();
    }
  });
  it.each([
    ['legacy', 'legacy'],
    ['legacy', 'modern'],
    ['modern', 'legacy'],
    ['modern', 'modern'],
  ] as const)(
    'keeps MCP parent, HTTP link, outbound ancestry and finite request lifetime in %s/%s',
    async (inboundEra, outboundEra) => {
      const target = await collector();
      try {
        await active(target.endpoint);
        const httpId = 'abcdefabcdefabcdefabcdefabcdefab';
        const remoteId = '12345678901234567890123456789012';
        const transport = trace.setSpanContext(ROOT_CONTEXT, {
          traceId: httpId,
          spanId: 'abcdefabcdefabcd',
          traceFlags: 1,
        });
        let currentId: string | undefined;
        let resume: ReturnType<typeof captureTraceContext> | undefined;
        let release!: () => void;
        let detached!: Promise<void>;
        await context.with(transport, async () =>
          withTelemetryOperation(
            {
              kind: 'server',
              method: 'tools/call',
              transport: 'streamable-http',
              inboundEra,
              outboundEra,
              remoteParams: {
                _meta: {
                  traceparent: `00-${remoteId}-1234567890123456-01`,
                  tracestate: 'vendor=carrier-secret',
                  baggage: 'forbidden',
                },
              },
            },
            async () => {
              currentId = getActiveTraceCorrelation()?.span_id;
              expect(injectTraceContext(undefined)).toMatchObject({ _meta: { tracestate: 'vendor=carrier-secret' } });
              resume = captureTraceContext();
              detached = new Promise<void>((resolve) => {
                release = resolve;
              }).then(() => {
                expect(getActiveTraceCorrelation()).toBeUndefined();
              });
              await withTelemetryOperation(
                { kind: 'client', method: 'custom/customer-secret', transport: 'stdio', inboundEra, outboundEra },
                async () => 'ok',
              );
            },
          ),
        );
        release();
        await detached;
        await resume?.(async () => {
          expect(getActiveTraceCorrelation()?.span_id).toBe(currentId);
        });
        await stopTelemetry({ deadlineMs: Date.now() + 2000 });
        const observed = spans(target.payloads);
        const server = observed.find((span) => span.name === 'tools/call');
        const client = observed.find((span) => span.name === 'other');
        expect(server).toMatchObject({
          traceId: remoteId,
          parentId: '1234567890123456',
          traceState: '',
          links: [{ traceId: httpId, traceState: '' }],
        });
        expect(client).toMatchObject({ traceId: remoteId, parentId: currentId });
        expect(observed).toHaveLength(2);
        expect(Buffer.concat(target.payloads.map((p) => p.body)).toString()).not.toMatch(
          /customer-secret|carrier-secret|forbidden/,
        );
      } finally {
        await target.close();
      }
    },
  );
  it.each([
    [undefined, undefined, '00000000000000000000000000000001', '00', 1],
    [undefined, undefined, 'ffffffff000000000000000000000000', '01', 0],
    ['always_on', undefined, 'ffffffff000000000000000000000000', '00', 1],
    ['always_off', undefined, '00000000000000000000000000000001', '01', 0],
    ['traceidratio', '0', '00000000000000000000000000000001', '01', 0],
    ['traceidratio', '1', 'ffffffff000000000000000000000000', '00', 1],
    ['parentbased_always_on', undefined, '00000000000000000000000000000001', '00', 0],
    ['parentbased_always_off', undefined, 'ffffffff000000000000000000000000', '01', 1],
    ['parentbased_traceidratio', '0', '00000000000000000000000000000001', '01', 1],
    ['parentbased_traceidratio', '1', '00000000000000000000000000000001', '00', 0],
  ])('uses deterministic standard sampling %#', async (selector, ratio, traceId, flags, count) => {
    const target = await collector();
    try {
      await active(target.endpoint, { OTEL_TRACES_SAMPLER: selector, OTEL_TRACES_SAMPLER_ARG: ratio });
      await withTelemetryOperation(
        {
          kind: 'server',
          method: 'ping',
          remoteParams: { _meta: { traceparent: `00-${traceId}-1234567890123456-${flags}` } },
        },
        async () => undefined,
      );
      await stopTelemetry({ deadlineMs: Date.now() + 2000 });
      expect(spans(target.payloads)).toHaveLength(count as number);
    } finally {
      await target.close();
    }
  });
  it('records explicit JSON-RPC/Tool outcomes with fixed error descriptions and no payload data', async () => {
    const target = await collector();
    try {
      await active(target.endpoint);
      const tool = startTelemetryOperation({ kind: 'server', method: 'tools/call' });
      await tool.run(async () => ({ isError: true, content: 'secret' }));
      tool.end('tool-error');
      tool.end('internal-error');
      const rpc = startTelemetryOperation({ kind: 'client', method: 'resources/read' });
      await rpc.run(async () => ({ error: { message: 'raw-error-secret' } }));
      rpc.end({ outcome: 'upstream-error', failureKind: 'protocol', failureCode: 'other' });
      await stopTelemetry({ deadlineMs: Date.now() + 2000 });
      expect(spans(target.payloads).map((span) => ({ name: span.name, status: span.status }))).toEqual([
        { name: 'tools/call', status: 0 },
        { name: 'resources/read', status: 2 },
      ]);
      expect(Buffer.concat(target.payloads.map((p) => p.body)).toString()).not.toContain('raw-error-secret');
    } finally {
      await target.close();
    }
  });
  it('records reviewed outbound HTTP transport with CLIENT kind and fixed phase name', async () => {
    const target = await collector();
    try {
      await active(target.endpoint);
      await withTelemetryOperation(
        { kind: 'http', httpDirection: 'outbound', phase: 'http-sse', transport: 'sse' },
        async () => undefined,
      );
      await stopTelemetry({ deadlineMs: Date.now() + 2000 });
      expect(spans(target.payloads)).toMatchObject([
        { name: 'http-sse', kind: 3, attributes: expect.arrayContaining([['direction', 'outbound']]) },
      ]);
    } finally {
      await target.close();
    }
  });
  it.each([false, true])('exports through verified TLS with client certificate required=%s', async (requireClient) => {
    let requests = 0;
    let authorized = false;
    const server = createHttpsServer(
      {
        key: readFileSync(fixture('test-server.key')),
        cert: readFileSync(fixture('test-server.pem')),
        ca: readFileSync(fixture('test-ca.pem')),
        requestCert: requireClient,
        rejectUnauthorized: true,
      },
      (request, response) => {
        requests++;
        authorized = 'authorized' in request.socket && request.socket.authorized === true;
        expect(request.headers.authorization).toBe('Bearer private-header');
        response.end();
      },
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture-address');
    try {
      await active(`https://127.0.0.1:${address.port}`, {
        OTEL_EXPORTER_OTLP_CERTIFICATE: fixture('test-ca.pem'),
        OTEL_EXPORTER_OTLP_HEADERS: 'authorization=Bearer%20private-header',
        ...(requireClient
          ? {
              OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE: fixture('test-client.pem'),
              OTEL_EXPORTER_OTLP_CLIENT_KEY: fixture('test-client.key'),
            }
          : {}),
      });
      await withTelemetryOperation({ kind: 'server', method: 'ping' }, async () => 'ok');
      await stopTelemetry({ deadlineMs: Date.now() + 2000 });
      expect(requests).toBe(1);
      if (requireClient) expect(authorized).toBe(true);
      expect(getTelemetryStatus().traces.shutdown).toBe('success');
      expect(JSON.stringify(getTelemetryStatus())).not.toMatch(/private-header|test-ca|127\.0\.0\.1/);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it('fails provider initialization for unreadable explicit certificates with no private error prose', async () => {
    await expect(
      active('https://localhost:4318', { OTEL_EXPORTER_OTLP_CERTIFICATE: '/private/credential-not-a-certificate' }),
    ).rejects.toThrow('Invalid telemetry configuration: provider-initialization');
    expect(getTelemetryStatus().state).toBe('disabled');
  });
  it('does not follow redirects or forward secret headers to another authority', async () => {
    const destination = await collector();
    const redirect = await collector((_request, response) => {
      response.writeHead(307, { location: destination.endpoint + '/v1/traces' });
      response.end();
    });
    try {
      await active(redirect.endpoint, { OTEL_EXPORTER_OTLP_HEADERS: 'authorization=credential' });
      await withTelemetryOperation({ kind: 'server', method: 'ping' }, async () => 'ok');
      await stopTelemetry({ deadlineMs: Date.now() + 2000 });
      expect(redirect.payloads).toHaveLength(1);
      expect(destination.payloads).toHaveLength(0);
      expect(getTelemetryStatus().traces.shutdown).toBe('failed');
    } finally {
      await redirect.close();
      await destination.close();
    }
  });
  it.each([false, true])('bounds shutdown at the remaining owner deadline with fatal=%s', async (fatal) => {
    const target = await collector(() => undefined);
    try {
      await active(target.endpoint);
      await withTelemetryOperation({ kind: 'server', method: 'ping' }, async () => 'ok');
      const started = performance.now();
      const deadlineMs = Date.now() + 40;
      await Promise.all([stopTelemetry({ deadlineMs, fatal }), stopTelemetry({ deadlineMs, fatal })]);
      expect(performance.now() - started).toBeLessThan(500);
      expect(getTelemetryStatus().traces).toMatchObject({ state: 'stopped', shutdown: 'timeout' });
      expect(target.payloads).toHaveLength(1);
    } finally {
      await target.close();
    }
  });
  it('exports actual factory transport dimensions for modern outbound operations', async () => {
    const target = await collector();
    try {
      await active(target.endpoint);
      const transports = createTransports({
        privateStdioIdentity: { type: 'stdio', command: 'private-command', protocolVersion: '2026-07-28' },
        privateSseIdentity: { type: 'sse', url: 'https://private.example/sse', protocolVersion: '2026-07-28' },
        privateHttpIdentity: { type: 'http', url: 'https://private.example/mcp', protocolVersion: '2026-07-28' },
      });
      for (const transport of Object.values(transports)) {
        const client = new Client({ name: 'private-peer', version: '1' });
        vi.spyOn(client, 'getProtocolEra').mockReturnValue('modern');
        vi.spyOn(client, 'getNegotiatedProtocolVersion').mockReturnValue('2026-07-28');
        vi.spyOn(client, 'request').mockResolvedValue({} as never);
        const adapter = new ModernSdkClientAdapter(client, transport);
        await expect(adapter.request({ id: 'private-id' as never, method: 'ping', params: {} })).resolves.toEqual({});
      }
      await stopTelemetry({ deadlineMs: Date.now() + 2000 });
      const observed = spans(target.payloads).filter((span) => span.kind === 3);
      expect(observed.map((span) => Object.fromEntries(span.attributes).transport)).toEqual([
        'stdio',
        'sse',
        'streamable-http',
      ]);
      expect(target.payloads.every((payload) => !payload.body.includes('private'))).toBe(true);
    } finally {
      await target.close();
    }
  });
  it('shortens an in-progress graceful stop to a later earlier owner deadline', async () => {
    const target = await collector(() => undefined);
    try {
      await active(target.endpoint);
      await withTelemetryOperation({ kind: 'server', method: 'ping' }, async () => 'ok');
      const graceful = stopTelemetry({ deadlineMs: Date.now() + 3000 });
      await vi.waitFor(() => expect(target.payloads).toHaveLength(1));
      const began = performance.now();
      await Promise.all([graceful, stopTelemetry({ deadlineMs: Date.now() + 40, fatal: true })]);
      expect(performance.now() - began).toBeLessThan(500);
      expect(getTelemetryStatus().traces).toMatchObject({ state: 'stopped', shutdown: 'timeout' });
      expect(target.payloads).toHaveLength(1);
    } finally {
      await target.close();
    }
  });
  it('collects a final cumulative snapshot after an already running metric export', async () => {
    const responses: ServerResponse[] = [];
    const target = await collector((_request, response) => {
      responses.push(response);
      if (responses.length > 1) response.end();
    });
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      await active(target.endpoint, {
        OTEL_TRACES_EXPORTER: 'none',
        OTEL_METRICS_EXPORTER: 'otlp',
        OTEL_METRIC_EXPORT_INTERVAL: '5000',
      });
      recordTelemetryMeasurement('mcp.server.operation.duration', 1, {});
      await vi.advanceTimersByTimeAsync(5000);
      await vi.waitFor(() => expect(responses).toHaveLength(1));
      recordTelemetryMeasurement('mcp.server.operation.duration', 1, {});
      const stopping = stopTelemetry({ deadlineMs: Date.now() + 2000 });
      responses[0].end();
      await stopping;
      const histograms = metricPayloads(target.payloads).filter(
        (metric) => metric.name === 'mcp.server.operation.duration',
      );
      expect(histograms.map((metric) => metric.points[0].count)).toEqual([1, 2]);
      expect(getTelemetryStatus().metrics.shutdown).toBe('success');
    } finally {
      await target.close();
    }
  });
  it('bounds every metric kind across the reader lifetime and exports the standard overflow series', async () => {
    const target = await collector();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      await active(target.endpoint, {
        OTEL_TRACES_EXPORTER: 'none',
        OTEL_METRICS_EXPORTER: 'otlp',
        OTEL_METRIC_EXPORT_INTERVAL: '5000',
      });
      const eras = ['legacy-legacy', 'legacy-modern', 'modern-legacy', 'modern-modern', 'unknown'] as const;
      const transports = ['stdio', 'streamable-http', 'sse'] as const;
      const combinations = OUTCOMES.flatMap((outcome) =>
        PHASES.flatMap((phase) =>
          eras.flatMap((era_pair) => transports.map((transport) => ({ outcome, phase, era_pair, transport }))),
        ),
      ).slice(0, 1500);
      for (const [index, dimensions] of combinations.entries()) {
        if (index === 750) {
          await vi.advanceTimersByTimeAsync(5000);
          await vi.waitFor(() => expect(getTelemetryStatus().metrics.successAgeMs).not.toBeNull());
        }
        recordTelemetryMeasurement('mcp.server.operation.duration', 1, dimensions);
        recordTelemetryMeasurement('gateway.failures', 1, dimensions);
        recordTelemetryMeasurement('gateway.queue.depth', 1, dimensions);
      }
      expect(getTelemetryStatus().metrics.state).toBe('degraded');
      expect(getTelemetryStatus().metrics.overflow).toBeGreaterThan(0);
      await stopTelemetry({ deadlineMs: Date.now() + 2000 });
      const observed = metricPayloads(target.payloads);
      for (const [name, cap] of [
        ['mcp.server.operation.duration', 1024],
        ['gateway.failures', 512],
        ['gateway.queue.depth', 256],
      ] as const) {
        const metric = observed.filter((metric) => metric.name === name).at(-1);
        expect(metric?.points).toHaveLength(cap);
        expect(
          metric?.points.some((point) =>
            point.attributes.some((attribute) => attribute.key === 'otel.metric.overflow' && attribute.boolean),
          ),
        ).toBe(true);
      }
      const histogram = observed.filter((metric) => metric.name === 'mcp.server.operation.duration').at(-1);
      expect(histogram?.unit).toBe('s');
      expect(histogram?.points[0].boundaries).toEqual([0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300]);
      expect(histogram?.points.reduce((count, point) => count + point.count, 0)).toBe(1500);
    } finally {
      await target.close();
    }
  });
  it('ignores SDK environment fallback, exemplars and private local diagnostic fields at the actual Collector boundary', async () => {
    const target = await collector();
    vi.stubEnv('OTEL_METRICS_EXEMPLAR_FILTER', 'always_on');
    vi.stubEnv('OTEL_RESOURCE_ATTRIBUTES', 'host.name=environment-secret,process.pid=12345');
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://unauthorized.invalid');
    vi.stubEnv('OTEL_EXPORTER_OTLP_HEADERS', 'authorization=environment-credential');
    try {
      await active(target.endpoint, {
        OTEL_METRICS_EXPORTER: 'otlp',
        OTEL_RESOURCE_ATTRIBUTES: 'host.name=resource-secret',
      });
      const corpus = [
        { source: 'managed-backend', message: 'backend-secret', serverName: 'configured-backend-secret', pid: 12345 },
        { source: 'http-diagnostic', body: 'http-body-secret', url: '/private-uri-secret', headers: 'header-secret' },
        {
          source: 'local-diagnostic',
          template: 'configured-template-secret',
          instanceId: 'runtime-instance-secret',
          fingerprint: 'private-fingerprint-secret',
          error: new Error('error-prose-secret'),
        },
      ];
      for (const local of corpus) {
        expect(recordTelemetryMeasurement('gateway.failures', 1, local as never)).toBe(false);
        await withTelemetryOperation({ kind: 'server', method: 'tools/call' }, async () => local);
      }
      await stopTelemetry({ deadlineMs: Date.now() + 2000 });
      const body = Buffer.concat(target.payloads.map((p) => p.body)).toString();
      expect(body).not.toMatch(
        /environment-secret|environment-credential|resource-secret|backend-secret|http-body-secret|private-uri-secret|header-secret|template-secret|instance-secret|fingerprint-secret|error-prose-secret|host.name|process.pid/,
      );
      expect(
        metricPayloads(target.payloads)
          .flatMap((metric) => metric.points)
          .every((point) => point.exemplars.length === 0),
      ).toBe(true);
      expect(spans(target.payloads)).toHaveLength(3);
    } finally {
      vi.unstubAllEnvs();
      await target.close();
    }
  });
  it('degrades on three exporter failures, bounds local warnings, and recovers after two successes', async () => {
    let fail = true;
    let clock = Date.now();
    let requests = 0;
    const diagnostics: unknown[] = [];
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const target = await collector((_request, response) => {
      requests++;
      response.writeHead(fail ? 500 : 200);
      response.end(fail ? 'private-collector-prose' : undefined);
    });
    try {
      const config = parseTelemetryConfig({
        OTEL_TRACES_EXPORTER: 'otlp',
        OTEL_TRACES_SAMPLER: 'always_on',
        OTEL_EXPORTER_OTLP_ENDPOINT: target.endpoint,
        OTEL_BSP_MAX_EXPORT_BATCH_SIZE: '1',
      });
      await startTelemetry(config, {
        role: 'runtime',
        serviceVersion: '0.39.2',
        onDiagnostic: (event) => diagnostics.push(event),
      });
      for (let index = 1; index <= 3; index++) {
        clock++;
        await withTelemetryOperation({ kind: 'server', method: 'ping' }, async () => 'unchanged');
        await vi.waitFor(() => expect(requests).toBe(index));
        await vi.waitFor(() => expect(getTelemetryStatus().traces.failureAgeMs).toBe(0));
        expect(getTelemetryStatus().traces.state).toBe(index < 3 ? 'starting' : 'degraded');
      }
      expect(diagnostics).toEqual([
        { event: 'telemetry.failure', signal: 'traces', category: 'export', suppressed: 0 },
      ]);
      fail = false;
      for (let index = 1; index <= 2; index++) {
        clock++;
        await withTelemetryOperation({ kind: 'server', method: 'ping' }, async () => 'unchanged');
        await vi.waitFor(() => expect(requests).toBe(index + 3));
        await vi.waitFor(() => expect(getTelemetryStatus().traces.successAgeMs).not.toBeNull());
        expect(getTelemetryStatus().traces.state).toBe(index === 1 ? 'degraded' : 'healthy');
      }
      expect(diagnostics).toContainEqual({
        event: 'telemetry.recovered',
        signal: 'traces',
        category: 'export',
        suppressed: 2,
      });
      expect(JSON.stringify(diagnostics)).not.toContain('private-collector-prose');
    } finally {
      now.mockRestore();
      await stopTelemetry({ deadlineMs: Date.now() + 2000 });
      await target.close();
    }
  });
  it('ticks through idle degradation without request traffic and requires two exports to recover', async () => {
    const target = await collector();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    try {
      await active(target.endpoint);
      expect(getTelemetryStatus().traces.state).toBe('starting');
      await vi.advanceTimersByTimeAsync(10000);
      expect(getTelemetryStatus().traces.state).toBe('degraded');
      for (let index = 1; index <= 2; index++) {
        await withTelemetryOperation({ kind: 'server', method: 'ping' }, async () => 'ok');
        await vi.advanceTimersByTimeAsync(5000);
        await vi.waitFor(() => expect(getTelemetryStatus().traces.successAgeMs ?? Infinity).toBeLessThan(1000));
        expect(getTelemetryStatus().traces.state).toBe(index === 1 ? 'degraded' : 'healthy');
      }
    } finally {
      vi.useRealTimers();
      await stopTelemetry({ deadlineMs: Date.now() + 2000 });
      await target.close();
    }
  });
  it('bounds the trace queue during a stalled Collector and recovers after low-queue successes', async () => {
    let hold = true;
    const responses: ServerResponse[] = [];
    const target = await collector((_req, response) => {
      if (hold) responses.push(response);
      else response.end();
    });
    try {
      await active(target.endpoint, {
        OTEL_BSP_MAX_QUEUE_SIZE: '2',
        OTEL_BSP_MAX_EXPORT_BATCH_SIZE: '1',
        OTEL_BSP_SCHEDULE_DELAY: '200',
      });
      for (let index = 0; index < 4; index++)
        expect(await withTelemetryOperation({ kind: 'server', method: 'ping' }, async () => index)).toBe(index);
      expect(getTelemetryStatus().traces).toMatchObject({ state: 'degraded', dropped: 1, queueUse: 'high' });
      await vi.waitFor(() => expect(responses).toHaveLength(1));
      hold = false;
      responses[0].end();
      await vi.waitFor(() => expect(target.payloads).toHaveLength(3));
      await vi.waitFor(() => expect(getTelemetryStatus().traces.queueUse).toBe('empty'));
      expect(getTelemetryStatus().traces.state).toBe('degraded');
      await withTelemetryOperation({ kind: 'server', method: 'ping' }, async () => 'ok');
      await vi.waitFor(() => expect(getTelemetryStatus().traces.state).toBe('healthy'));
      expect(getTelemetryStatus().traces.dropped).toBe(1);
    } finally {
      await stopTelemetry({ deadlineMs: Date.now() + 2000 });
      await target.close();
    }
  });
});
