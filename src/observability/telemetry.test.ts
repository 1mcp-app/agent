import { AlwaysOnSampler } from '@opentelemetry/sdk-trace-base';

import { once } from 'node:events';
import { createServer } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseTelemetryConfig } from '../config/telemetryConfig.js';
import {
  getTelemetryStatus,
  markTelemetryStopping,
  recordTelemetryMeasurement,
  startTelemetry,
  startTelemetryOperation,
  stopTelemetry,
  withTelemetryOperation,
} from './telemetry.js';

afterEach(async () => {
  await stopTelemetry({ deadlineMs: Date.now() + 1000 });
});
describe('SDK-free operational telemetry facade', () => {
  it('marks stopping before drain without disabling recording of existing work', async () => {
    await startTelemetry(parseTelemetryConfig({ OTEL_METRICS_EXPORTER: 'otlp' }), {
      role: 'runtime',
      serviceVersion: '0.39.2',
    });
    markTelemetryStopping();
    expect(getTelemetryStatus().state).toBe('stopping');
    expect(recordTelemetryMeasurement('gateway.active.operations', -1, { operation_family: 'tools' })).toBe(true);
  });
  it('does not activate for selectors-none or one-shot commands and preserves results', async () => {
    await startTelemetry(parseTelemetryConfig({}), { role: 'runtime', serviceVersion: '0.39.2' });
    expect(getTelemetryStatus().state).toBe('disabled');
    expect(
      await withTelemetryOperation({ kind: 'server', method: 'tools/call', transport: 'stdio' }, async () => 'ok'),
    ).toBe('ok');
    await stopTelemetry({ deadlineMs: Date.now() + 1000 });
    await startTelemetry(parseTelemetryConfig({ OTEL_TRACES_EXPORTER: 'otlp' }), {
      role: 'command',
      serviceVersion: '0.39.2',
    });
    expect(getTelemetryStatus().state).toBe('disabled');
  });
  it('exports only approved facts as HTTP protobuf and strips remote tracestate', async () => {
    const payloads: Buffer[] = [];
    const collector = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      payloads.push(Buffer.concat(chunks));
      expect(req.headers['content-type']).toBe('application/x-protobuf');
      res.end();
    });
    collector.listen(0, '127.0.0.1');
    await once(collector, 'listening');
    const address = collector.address();
    if (!address || typeof address === 'string') throw new Error('fixture address');
    try {
      await startTelemetry(
        parseTelemetryConfig({
          OTEL_TRACES_EXPORTER: 'otlp',
          OTEL_METRICS_EXPORTER: 'otlp',
          OTEL_TRACES_SAMPLER: 'always_on',
          OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}`,
        }),
        { role: 'runtime', serviceVersion: '0.39.2' },
      );
      const result = await withTelemetryOperation(
        {
          kind: 'server',
          method: 'tools/call',
          transport: 'stdio',
          remoteParams: {
            _meta: {
              traceparent: '00-12345678901234567890123456789012-1234567890123456-01',
              tracestate: 'vendor=carrier-secret',
            },
          },
        },
        async () => ({ content: 'payload-secret' }),
      );
      expect(result).toEqual({ content: 'payload-secret' });
      await stopTelemetry({ deadlineMs: Date.now() + 2000 });
      expect(payloads.length).toBeGreaterThanOrEqual(2);
      const wire = Buffer.concat(payloads).toString();
      expect(wire).toContain('tools/call');
      expect(wire).toContain('mcp.server.operation.duration');
      expect(wire).not.toContain('payload-secret');
      expect(wire).not.toContain('carrier-secret');
      expect(wire).not.toContain('process.pid');
      expect(wire).not.toContain('host.name');
      expect(getTelemetryStatus().state).toBe('stopped');
    } finally {
      collector.closeAllConnections();
      await new Promise<void>((resolve) => collector.close(() => resolve()));
    }
  });
  it('rejects unknown signal dimensions without executing getters or changing operation results', async () => {
    let calls = 0;
    const hostile = Object.defineProperty({}, 'phase', {
      get() {
        calls++;
        throw new Error('secret');
      },
    });
    expect(recordTelemetryMeasurement('gateway.failures', 1, hostile)).toBe(false);
    expect(recordTelemetryMeasurement('gateway.failures', 1, { pid: 123 } as never)).toBe(false);
    expect(recordTelemetryMeasurement('gateway.failures', -1)).toBe(false);
    expect(recordTelemetryMeasurement('gateway.failures', NaN)).toBe(false);
    expect(await startTelemetryOperation({ kind: 'server', metadata: 'secret' } as never).run(async () => 42)).toBe(42);
    expect(calls).toBe(0);
  });
  it('isolates recording SDK failures from successful callbacks and original thrown errors', async () => {
    await startTelemetry(parseTelemetryConfig({ OTEL_TRACES_EXPORTER: 'otlp', OTEL_TRACES_SAMPLER: 'always_on' }), {
      role: 'runtime',
      serviceVersion: '0.39.2',
    });
    const broken = vi.spyOn(AlwaysOnSampler.prototype, 'shouldSample').mockImplementation(() => {
      throw new Error('SDK-private-secret');
    });
    try {
      expect(
        await withTelemetryOperation({ kind: 'client', method: 'tools/call' }, async () => 'business-result'),
      ).toBe('business-result');
      const original = new Error('original-business-error');
      await expect(
        withTelemetryOperation({ kind: 'client', method: 'tools/call' }, async () => {
          throw original;
        }),
      ).rejects.toBe(original);
    } finally {
      broken.mockRestore();
    }
  });
  it('reports a failed final flush while keeping shutdown once-only', async () => {
    let exports = 0;
    const collector = createServer((_req, res) => {
      exports++;
      res.writeHead(500);
      res.end('collector-private-secret');
    });
    collector.listen(0, '127.0.0.1');
    await once(collector, 'listening');
    const address = collector.address();
    if (!address || typeof address === 'string') throw new Error('fixture address');
    try {
      await startTelemetry(
        parseTelemetryConfig({
          OTEL_TRACES_EXPORTER: 'otlp',
          OTEL_TRACES_SAMPLER: 'always_on',
          OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}`,
        }),
        { role: 'runtime', serviceVersion: '0.39.2' },
      );
      await withTelemetryOperation({ kind: 'server', method: 'ping' }, async () => 'ok');
      await Promise.all([
        stopTelemetry({ deadlineMs: Date.now() + 2000 }),
        stopTelemetry({ deadlineMs: Date.now() + 2000 }),
      ]);
      expect(getTelemetryStatus().traces.shutdown).toBe('failed');
      expect(exports).toBe(1);
      expect(JSON.stringify(getTelemetryStatus())).not.toContain('collector-private-secret');
    } finally {
      collector.closeAllConnections();
      await new Promise<void>((resolve) => collector.close(() => resolve()));
    }
  });
});
