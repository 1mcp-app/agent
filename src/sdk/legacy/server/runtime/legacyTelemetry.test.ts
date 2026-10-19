import { once } from 'node:events';
import { createServer } from 'node:http';

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { parseTelemetryConfig } from '@src/config/telemetryConfig.js';
import { withProtocolTelemetry } from '@src/gateway/telemetryOperation.js';
import { getTelemetryStatus, startTelemetry, stopTelemetry } from '@src/observability/telemetry.js';
import { getActiveTraceCorrelation } from '@src/observability/tracing/context.js';
import type { LegacyConnectionId } from '@src/sdk/contracts/legacySdkAdapter.js';
import { Client } from '@src/sdk/legacy/client/index.js';
import { Server } from '@src/sdk/legacy/server/index.js';
import { CallToolRequestSchema, EmptyResultSchema, PingRequestSchema } from '@src/sdk/legacy/types.js';

import { expect, it, vi } from 'vitest';

import { installLegacyRequestTracing, LegacySdkServerAdapter } from './legacySdkServerAdapter.js';

it('keeps the actual inbound Tool span open until its wire response is sent', async () => {
  const payloads: Buffer[] = [];
  const collector = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    payloads.push(Buffer.concat(chunks));
    response.end();
  });
  collector.listen(0, '127.0.0.1');
  await once(collector, 'listening');
  const address = collector.address();
  if (!address || typeof address === 'string') throw new Error('Collector address unavailable');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new Server({ name: 'private-server-name', version: 'test' }, { capabilities: { tools: {} } });
  const client = new Client({ name: 'private-client-name', version: 'test' });
  const adapter = new LegacySdkServerAdapter('private-session-id' as LegacyConnectionId, server, serverTransport);
  let release!: () => void;
  let sending = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const send = serverTransport.send.bind(serverTransport);
  serverTransport.send = async (message, options) => {
    if ('result' in message && 'content' in message.result) {
      sending = true;
      await gate;
    }
    await send(message, options);
  };
  try {
    await startTelemetry(
      parseTelemetryConfig({
        OTEL_TRACES_EXPORTER: 'otlp',
        OTEL_TRACES_SAMPLER: 'always_on',
        OTEL_BSP_SCHEDULE_DELAY: '1',
        OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}`,
      }),
      { role: 'runtime', serviceVersion: 'test' },
    );
    installLegacyRequestTracing(server);
    server.setRequestHandler(CallToolRequestSchema, async () => {
      expect(getActiveTraceCorrelation()).toBeDefined();
      return { content: [{ type: 'text', text: 'private-result' }] };
    });
    await adapter.start();
    await client.connect(clientTransport);
    const result = client.callTool({ name: 'private-tool-name' });
    await vi.waitFor(() => expect(sending).toBe(true));
    await withProtocolTelemetry({ kind: 'internal', phase: 'routing' }, async () => undefined);
    await vi.waitFor(() => expect(Buffer.concat(payloads).toString()).toContain('routing'));
    expect(Buffer.concat(payloads).toString()).not.toContain('tools/call');
    release();
    await expect(result).resolves.toMatchObject({ content: [{ text: 'private-result' }] });
    await stopTelemetry({ deadlineMs: Date.now() + 2000 });
    const wire = Buffer.concat(payloads).toString();
    expect(wire.match(/tools\/call/g)).toHaveLength(1);
    expect(wire).toContain('initialize');
    expect(wire).not.toContain('private-tool-name');
    expect(wire).not.toContain('private-session-id');
    expect(wire).not.toContain('private-result');
  } finally {
    release();
    await client.close();
    await adapter.close();
    await stopTelemetry({ deadlineMs: Date.now() + 2000 });
    collector.closeAllConnections();
    await new Promise<void>((resolve) => collector.close(() => resolve()));
  }
});

it('preserves request-owned propagation when telemetry bookkeeping saturates', async () => {
  await startTelemetry(
    parseTelemetryConfig({
      OTEL_TRACES_EXPORTER: 'otlp',
      OTEL_TRACES_SAMPLER: 'always_off',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1',
    }),
    { role: 'runtime', serviceVersion: 'test' },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new Server({ name: 'saturation', version: 'test' });
  const client = new Client({ name: 'caller', version: 'test' });
  const adapter = new LegacySdkServerAdapter('saturation' as LegacyConnectionId, server, serverTransport);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const correlations: Array<string | undefined> = [];
  installLegacyRequestTracing(server);
  server.setRequestHandler(PingRequestSchema, async () => {
    correlations.push(getActiveTraceCorrelation()?.trace_id);
    await gate;
    return {};
  });
  const requests: Array<Promise<unknown>> = [];
  try {
    await adapter.start();
    await client.connect(clientTransport);
    for (let index = 1; index <= 1025; index++) {
      const trace = index.toString(16).padStart(32, '0');
      requests.push(
        client.request(
          { method: 'ping', params: { _meta: { traceparent: `00-${trace}-1234567890123456-00` } } },
          EmptyResultSchema,
        ),
      );
    }
    await vi.waitFor(() => expect(correlations).toHaveLength(1025));
    expect(correlations[1024]).toBe((1025).toString(16).padStart(32, '0'));
    expect(getTelemetryStatus().traces.state).toBe('degraded');
    expect(getTelemetryStatus().traces.dropped).toBeGreaterThanOrEqual(1);
    expect(getActiveTraceCorrelation()).toBeUndefined();
    release();
    await Promise.all(requests);
  } finally {
    release();
    await Promise.allSettled(requests);
    await client.close();
    await adapter.close();
    await stopTelemetry({ deadlineMs: Date.now() + 2000 });
  }
});
