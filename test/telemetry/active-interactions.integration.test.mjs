import { once } from 'node:events';
import { createServer } from 'node:http';

import { expect, test, vi } from 'vitest';

import { parseTelemetryConfig } from '../../src/config/telemetryConfig.js';
import { startTelemetry, stopTelemetry } from '../../src/observability/telemetry.js';
import { runGatewayInteractionCell } from '../e2e/fixtures/gatewayInteractionMatrix.js';
import { spans } from '../unit-utils/otlpTraceDecoder.js';

test.each([
  ['legacy', 'legacy'],
  ['legacy', 'modern'],
  ['modern', 'legacy'],
  ['modern', 'modern'],
])('active tracing preserves reverse/resume ancestry: %s inbound / %s outbound', async (inboundEra, upstreamEra) => {
  const payloads = [];
  const wires = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    payloads.push({ path: request.url, body: Buffer.concat(chunks) });
    response.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await startTelemetry(
      parseTelemetryConfig({
        OTEL_TRACES_EXPORTER: 'otlp',
        OTEL_TRACES_SAMPLER: 'always_on',
        OTEL_BSP_SCHEDULE_DELAY: '5',
        OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${server.address().port}`,
      }),
      { role: 'runtime', serviceVersion: 'test' },
    );
    await runGatewayInteractionCell(
      inboundEra,
      upstreamEra,
      1,
      (params, label) => {
        const meta = params?._meta;
        expect(meta?.traceparent, label).toMatch(/^00-12345678901234567890123456789012-[a-f0-9]{16}-01$/u);
        expect(meta.traceparent.split('-')[2]).not.toBe('1234567890123456');
        expect(meta.tracestate).toBe('vendor=opaque');
        expect(meta).not.toHaveProperty('baggage');
        expect(meta).not.toHaveProperty('contextProof');
        wires.push({ label, id: meta.traceparent.split('-')[2] });
      },
      async (_params, method, requestBegan) => {
        await vi.waitFor(
          () => {
            const ended = spans(payloads).filter((span) => span.traceId === '12345678901234567890123456789012');
            const request = ended.find((span) => span.kind === 2 && span.name === method && span.start >= requestBegan);
            expect(request?.kind, 'input_required request must end before continuation is sent').toBe(2);
            expect(request.end > request.start).toBe(true);
          },
          { timeout: 2000 },
        );
      },
    );
    await stopTelemetry({ deadlineMs: Date.now() + 5000 });
    const observed = spans(payloads).filter((span) => span.traceId === '12345678901234567890123456789012');
    expect(observed.length).toBeGreaterThan(0);
    const byId = new Map(observed.map((span) => [span.id, span]));
    for (const wire of wires) expect(byId.has(wire.id), wire.label).toBe(true);
    const clients = observed.filter((span) => span.kind === 3);
    const servers = observed.filter((span) => span.kind === 2);
    expect(clients.length).toBeGreaterThanOrEqual(9);
    expect(servers.length).toBeGreaterThanOrEqual(inboundEra === 'modern' ? 18 : 9);
    expect(observed.every((span) => span.end > span.start)).toBe(true);
    if (inboundEra === 'modern')
      expect(
        servers.some((span) => span.links.some((link) => link.traceId === 'abcdefabcdefabcdefabcdefabcdefab')),
      ).toBe(true);
    for (const span of clients) {
      let ancestor = byId.get(span.parentId);
      const visited = new Set();
      while (ancestor && ancestor.kind !== 2 && !visited.has(ancestor.id)) {
        visited.add(ancestor.id);
        ancestor = byId.get(ancestor.parentId);
      }
      expect(ancestor?.kind, span.name).toBe(2);
    }
    expect(observed.every((span) => span.traceState === '' && span.links.every((link) => link.traceState === ''))).toBe(
      true,
    );
    expect(
      payloads.every(
        (payload) => !payload.body.includes('private-upstream-state') && !payload.body.includes('vendor=opaque'),
      ),
    ).toBe(true);
  } finally {
    await stopTelemetry({ deadlineMs: Date.now() + 1000 });
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
