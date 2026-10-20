import { once } from 'node:events';
import { createServer } from 'node:http';

import { parseTelemetryConfig } from '@src/config/telemetryConfig.js';
import { startTelemetry, stopTelemetry } from '@src/observability/telemetry.js';
import { withProtocolTelemetry } from '@src/observability/telemetryOperation.js';

import { expect, it, vi } from 'vitest';

import { createSseWireLimitedFetch } from './sseWireLimit.js';

// Read only the OTLP envelope and Span name/kind fields; no SDK objects or exporter mocks.
function fields(bytes: Buffer): Array<{ key: number; value: Buffer | number }> {
  let offset = 0;
  const result: Array<{ key: number; value: Buffer | number }> = [];
  const integer = () => {
    let value = 0;
    let scale = 1;
    while (offset < bytes.length) {
      const byte = bytes[offset++];
      value += (byte & 127) * scale;
      if (!(byte & 128)) return value;
      scale *= 128;
    }
    throw new Error('Truncated OTLP fixture');
  };
  while (offset < bytes.length) {
    const tag = integer();
    const wire = tag & 7;
    if (wire === 0) result.push({ key: tag >>> 3, value: integer() });
    else if (wire === 2) {
      const size = integer();
      result.push({ key: tag >>> 3, value: bytes.subarray(offset, offset + size) });
      offset += size;
    } else if (wire === 1) offset += 8;
    else if (wire === 5) offset += 4;
    else throw new Error('Unsupported OTLP fixture wire type');
  }
  return result;
}
function messages(bytes: Buffer, key: number): Buffer[] {
  return fields(bytes).flatMap((field) => (field.key === key && Buffer.isBuffer(field.value) ? [field.value] : []));
}
function spans(payloads: Buffer[]) {
  return payloads
    .flatMap((payload) =>
      messages(payload, 1).flatMap((resource) => messages(resource, 2).flatMap((scope) => messages(scope, 2))),
    )
    .map((span) => ({
      name: messages(span, 5)[0]?.toString(),
      kind: fields(span).find((field) => field.key === 6)?.value,
    }));
}

it('exports a sanitized outbound HTTP CLIENT span only after the actual response body ends', async () => {
  const payloads: Buffer[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fixture = createServer(async (request, response) => {
    if (request.url === '/v1/traces') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      payloads.push(Buffer.concat(chunks));
      response.end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.write('private-response');
    await gate;
    response.end('-end');
  });
  fixture.listen(0, '127.0.0.1');
  await once(fixture, 'listening');
  const address = fixture.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address unavailable');
  const url = `http://127.0.0.1:${address.port}`;
  try {
    await startTelemetry(
      parseTelemetryConfig({
        OTEL_TRACES_EXPORTER: 'otlp',
        OTEL_TRACES_SAMPLER: 'always_on',
        OTEL_BSP_SCHEDULE_DELAY: '1',
        OTEL_EXPORTER_OTLP_ENDPOINT: url,
      }),
      { role: 'runtime', serviceVersion: 'test' },
    );
    const limitedFetch = createSseWireLimitedFetch(undefined, () => ({ close: async () => undefined }));
    const response = await limitedFetch(`${url}/private-path?token=private-query`, {
      headers: { Authorization: 'Bearer private-header' },
    });
    await withProtocolTelemetry({ kind: 'internal', phase: 'routing' }, async () => undefined);
    await vi.waitFor(() => expect(spans(payloads).some((span) => span.name === 'routing')).toBe(true));
    expect(spans(payloads).filter((span) => span.name === 'http-request')).toHaveLength(0);
    release();
    expect(await response.text()).toBe('private-response-end');
    await stopTelemetry({ deadlineMs: Date.now() + 2000 });
    expect(spans(payloads).filter((span) => span.name === 'http-request')).toEqual([{ name: 'http-request', kind: 3 }]);
    expect(Buffer.concat(payloads).toString()).not.toMatch(
      /private-path|private-query|private-header|private-response|Authorization/,
    );
  } finally {
    release();
    await stopTelemetry({ deadlineMs: Date.now() + 2000 });
    fixture.closeAllConnections();
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
  }
});
