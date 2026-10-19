import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { test } from 'node:test';

import { startRealCollector } from '../../scripts/telemetry/real-collector.mjs';
import { createCollector } from './fake-collector.mjs';

// Literal OTLP ExportTraceServiceRequest: one ResourceSpans/ScopeSpans/Span,
// name "fixture", kind SERVER. Infrastructure check only, not 1MCP acceptance.
const fixture = Buffer.from(
  '0a2b122912270a100102030405060708090a0b0c0d0e0f10120801020304050607082a07666978747572653002',
  'hex',
);
test(
  'pinned real Collector receives protobuf and writes decoded trace payload',
  {
    skip: !process.env.OTELCOL_BINARY && 'Set OTELCOL_BINARY to the checksum-verified 0.163.1 binary',
  },
  async () => {
    const collector = await startRealCollector(process.env.OTELCOL_BINARY);
    try {
      const result = await fetch(`${collector.url}/v1/traces`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-protobuf' },
        body: fixture,
      });
      assert.equal(result.status, 200, await result.text());
      await collector.stop();
      const data = await readFile(collector.capture, 'utf8');
      assert(data.includes('fixture'), 'Collector must decode the supplied span');
    } finally {
      await collector.cleanup();
    }
  },
);

test(
  'fault relay forwards valid protobuf after an outage to the pinned real receiver',
  {
    skip: !process.env.OTELCOL_BINARY && 'Set OTELCOL_BINARY to verified Collector0.163.1',
  },
  async () => {
    const collector = await startRealCollector(process.env.OTELCOL_BINARY);
    const relay = await createCollector();
    try {
      relay.respond({ status: 503 });
      assert.equal(
        (
          await fetch(relay.url + '/v1/traces', {
            method: 'POST',
            headers: { 'content-type': 'application/x-protobuf' },
            body: fixture,
          })
        ).status,
        503,
      );
      relay.respond({ status: 200, forwardTo: collector.url });
      assert.equal(
        (
          await fetch(relay.url + '/v1/traces', {
            method: 'POST',
            headers: { 'content-type': 'application/x-protobuf' },
            body: fixture,
          })
        ).status,
        200,
      );
      await collector.stop();
      const decoded = (await readFile(collector.capture, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      const spans = decoded
        .flatMap((payload) => payload.resourceSpans ?? [])
        .flatMap((resource) => resource.scopeSpans ?? [])
        .flatMap((scope) => scope.spans ?? []);
      assert.equal(
        spans.filter((span) => span.name === 'fixture').length,
        1,
        'Relay must deliver exactly the recovered request',
      );
    } finally {
      await relay.close();
      await collector.cleanup();
    }
  },
);
