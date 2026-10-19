import { Client as ModernClient, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler, Server as ModernServer } from '@modelcontextprotocol/server';

import { once } from 'node:events';
import { createServer } from 'node:http';

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { parseTelemetryConfig } from '@src/config/telemetryConfig.js';
import { startTelemetry, stopTelemetry } from '@src/observability/telemetry.js';
import { getActiveTraceCorrelation } from '@src/observability/tracing/context.js';
import { Client } from '@src/sdk/legacy/client/index.js';
import { LegacySdkClientAdapter } from '@src/sdk/legacy/client/runtime/legacySdkClientAdapter.js';
import type { AuthProviderTransport } from '@src/sdk/legacy/client/runtime/legacyTransport.js';
import { ModernSdkClientAdapter } from '@src/sdk/legacy/client/runtime/modernSdkClientAdapter.js';
import { Server } from '@src/sdk/legacy/server/index.js';
import { CallToolRequestSchema } from '@src/sdk/legacy/types.js';

import { afterEach, describe, expect, it } from 'vitest';

import { withProtocolTelemetry } from './telemetryOperation.js';

async function backend(era: 'legacy' | 'modern') {
  const result = { isError: true, content: [{ type: 'text' as const, text: 'private-result-canary' }] };
  if (era === 'legacy') {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new Server({ name: 'private-backend', version: 'test' }, { capabilities: { tools: {} } });
    server.setRequestHandler(CallToolRequestSchema, async () => result);
    const client = new Client({ name: 'private-client', version: 'test' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const adapter = new LegacySdkClientAdapter(client, clientTransport);
    await adapter.start();
    return {
      adapter,
      close: async () => {
        await adapter.close();
        await server.close();
      },
    };
  }
  const handler = createMcpHandler(
    () => {
      const server = new ModernServer({ name: 'private-backend', version: 'test' }, { capabilities: { tools: {} } });
      server.setRequestHandler('tools/call', async () => result);
      return server;
    },
    { legacy: 'reject' },
  );
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
    fetch: async (input, init) => handler.fetch(new Request(input, init)),
  });
  const client = new ModernClient(
    { name: 'private-client', version: 'test' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  );
  await client.connect(transport);
  const adapter = new ModernSdkClientAdapter(client, transport as unknown as AuthProviderTransport);
  return {
    adapter,
    close: async () => {
      await adapter.close();
      await handler.close();
    },
  };
}

afterEach(async () => {
  await stopTelemetry({ deadlineMs: Date.now() + 2000 });
});

describe('protocol operation boundary', () => {
  it('preserves propagation and expires detached context when recording is disabled', async () => {
    await startTelemetry(parseTelemetryConfig({}), { role: 'runtime', serviceVersion: 'test' });
    let detached!: () => Promise<unknown>;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const remote = '00-12345678901234567890123456789012-1234567890123456-01';
    await withProtocolTelemetry(
      { kind: 'server', method: 'tools/call', remoteParams: { _meta: { traceparent: remote } } },
      async () => {
        expect(getActiveTraceCorrelation()?.trace_id).toBe('12345678901234567890123456789012');
        const task = (async () => {
          await barrier;
          return getActiveTraceCorrelation();
        })();
        detached = () => task;
        return { isError: true };
      },
    );
    release();
    expect(await detached()).toBeUndefined();
    expect(getActiveTraceCorrelation()).toBeUndefined();
  });

  it.each(['legacy', 'modern'] as const)(
    'carries %s inbound era into each selected upstream operation',
    async (inboundEra) => {
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
      try {
        await startTelemetry(
          parseTelemetryConfig({
            OTEL_TRACES_EXPORTER: 'otlp',
            OTEL_TRACES_SAMPLER: 'always_on',
            OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}`,
          }),
          { role: 'runtime', serviceVersion: 'test' },
        );
        await withProtocolTelemetry(
          {
            kind: 'server',
            method: 'tools/call',
            inboundEra,
            remoteParams: { _meta: { traceparent: '00-12345678901234567890123456789012-1234567890123456-01' } },
          },
          async () => {
            expect(getActiveTraceCorrelation()).toBeDefined();
            for (const outboundEra of ['legacy', 'modern'] as const) {
              const peer = await backend(outboundEra);
              try {
                const result = await peer.adapter.request({
                  id: 'private-request-id' as never,
                  method: 'tools/call',
                  params: { name: 'private-tool-name' },
                });
                expect(result).toMatchObject({ isError: true });
              } finally {
                await peer.close();
              }
            }
            return {};
          },
        );
        await stopTelemetry({ deadlineMs: Date.now() + 2000 });
        const wire = Buffer.concat(payloads).toString();
        expect(wire).toContain(`${inboundEra}-legacy`);
        expect(wire).toContain(`${inboundEra}-modern`);
        expect(wire).toContain('tool-error');
        expect(wire).not.toContain('private-result-canary');
      } finally {
        collector.closeAllConnections();
        await new Promise<void>((resolve) => collector.close(() => resolve()));
      }
    },
  );
});
