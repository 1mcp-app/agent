import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { test } from 'node:test';

import { startRealCollector } from '../../scripts/telemetry/real-collector.mjs';

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
