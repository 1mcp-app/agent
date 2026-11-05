import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

import { test } from 'vitest';

import { startRealCollector } from '../../scripts/telemetry/real-collector.mjs';
import { attributes, decodedPayloads, decodedSpans } from './collector-payloads.mjs';
import { assertPrivatePayloads, privacyCorpus } from './privacy-corpus.mjs';
import { startRuntime, waitUntil } from './runtime-fixture.mjs';

const httpTrace = 'abcdefabcdefabcdefabcdefabcdefab';
const httpParent = 'abcdefabcdefabcd';
const parent = '00f067aa0ba902b7';
const traceIds = ['1'.repeat(32), '2'.repeat(32), '3'.repeat(32), '4'.repeat(32)];

test.skipIf(!process.env.OTELCOL_BINARY)(
  'real CLI preserves local HTTP/backend diagnostics while exporting only bounded signals and correct topology/outcomes',
  async () => {
    const collector = await startRealCollector(process.env.OTELCOL_BINARY);
    const runtime = await startRuntime({
      collector,
      httpHeaders: { traceparent: `00-${httpTrace}-${httpParent}-00`, 'x-private-corpus': privacyCorpus.authorization },
    });
    try {
      const find = (suffix) => {
        const tool = runtime.tools.find((tool) => tool.name.endsWith(suffix));
        assert(tool);
        return tool.name;
      };
      const meta = (index) => ({ traceparent: `00-${traceIds[index]}-${parent}-01`, baggage: privacyCorpus.baggage });
      const diagnostic = await runtime.client.callTool({
        name: find('diagnostics'),
        arguments: { ...privacyCorpus },
        _meta: meta(0),
      });
      assert.equal(diagnostic.content[0].text, JSON.stringify(privacyCorpus));
      assert.equal(
        (await runtime.client.callTool({ name: find('error'), arguments: {}, _meta: meta(1) })).isError,
        true,
      );
      await assert.rejects(runtime.client.callTool({ name: find('rpc-failure'), arguments: {}, _meta: meta(2) }));
      await assert.rejects(runtime.client.callTool({ name: 'fixture_1mcp_missing', arguments: {}, _meta: meta(3) }));
      await waitUntil(async () => {
        const local = await runtime.readLog();
        return (
          local.includes('http.request-body') &&
          local.includes(privacyCorpus.backendLog) &&
          local.includes('backend-stderr')
        );
      }, 'The actual local diagnostic sinks never received the corpus');
      const local = await runtime.readLog();
      assert(local.includes(privacyCorpus.argument), 'Debug HTTP body diagnostic omitted the benign corpus payload');
      assert(local.includes('local-diagnostic'), 'Upstream failure never entered local diagnostics');
      // The diagnostics must remain useful locally, and cannot gain automatic correlation.
      const records = local
        .split('\n')
        .map((line) => line.match(/ (\{"(?:source|serverName)":.*\})$/)?.[1])
        .filter(Boolean)
        .map((text) => JSON.parse(text));
      for (const record of records.filter((record) =>
        ['http-diagnostic', 'backend-stderr', 'local-diagnostic'].includes(record.source),
      )) {
        assert(
          !('trace_id' in record) && !('span_id' in record),
          'Local diagnostics gained automatic telemetry correlation',
        );
      }
      assert(
        records.some((record) => record.source === 'backend-stderr'),
        'Backend sink was not actually exercised',
      );
      assert(
        records.some((record) => record.source === 'http-diagnostic'),
        'HTTP sink was not actually exercised',
      );
      await delay(5500);
      await runtime.stop();
      await collector.stop();
      const payloads = await decodedPayloads(collector);
      assertPrivatePayloads(payloads);
      const spans = decodedSpans(payloads);
      const logical = traceIds.map((traceId) => {
        const matching = spans.filter(
          (span) => span.traceId === traceId && span.kind === 2 && span.name === 'tools/call',
        );
        assert.equal(matching.length, 1, 'One logical inbound SERVER per Tool request');
        assert.equal(matching[0].parentSpanId, parent, 'Logical MCP parent must come from MCP metadata');
        return matching[0];
      });
      const http = spans.filter((span) => span.kind === 2 && span.name === 'http-mcp' && span.traceId === httpTrace);
      assert(http.length > 0, 'Real HTTP middleware transport spans missing');
      assert(http.every((span) => span.parentSpanId === httpParent));
      assert(
        logical.every((span) =>
          span.links?.some(
            (link) => link.traceId === httpTrace && http.some((transport) => transport.spanId === link.spanId),
          ),
        ),
        'Differing HTTP carrier must be an independent transport link',
      );
      const client = spans.filter(
        (span) => span.kind === 3 && span.name === 'tools/call' && span.traceId === traceIds[0],
      );
      assert.equal(client.length, 1, 'One selected-upstream CLIENT operation per Tool call');
      const byId = new Map(spans.map((span) => [span.spanId, span]));
      let ancestor = byId.get(client[0].parentSpanId);
      while (ancestor && ancestor.spanId !== logical[0].spanId) ancestor = byId.get(ancestor.parentSpanId);
      assert(ancestor, 'Outbound CLIENT must descend from its logical SERVER');
      assert.equal(attributes(logical[0]).outcome, 'success');
      assert.equal(attributes(logical[1]).outcome, 'tool-error');
      assert.notEqual(logical[1].status?.code, 2, 'Tool isError must not mark SERVER unhealthy');
      assert.equal(logical[2].status?.code, 2, 'Upstream RPC failure must mark SERVER error');
      assert.notEqual(logical[3].status?.code, 2, 'Not-found/caller validation must not mark SERVER unhealthy');
    } finally {
      await runtime.close();
      await collector.cleanup();
    }
  },
);

test('authenticated Admin Runtime Health and serve status expose only read-only sanitized telemetry state', async () => {
  const { createCollector } = await import('./fake-collector.mjs');
  const collector = await createCollector();
  const runtime = await startRuntime({
    collector,
    admin: true,
    env: { OTEL_EXPORTER_OTLP_HEADERS: `x-private=${privacyCorpus.authorization}` },
  });
  try {
    const url = runtime.url + '/admin/api/runtime/health';
    assert.equal((await fetch(url)).status, 401, 'Telemetry status must require authentication');
    const cookie = await runtime.login();
    const response = await fetch(url, { headers: { cookie } });
    assert.equal(response.status, 200);
    const health = await response.json();
    assert(health.telemetry?.traces?.state, 'Authenticated health omitted telemetry');
    assert(health.telemetry?.metrics?.state);
    for (const signal of [health.telemetry.traces, health.telemetry.metrics]) {
      assert.equal(signal.exporter, 'otlp');
      assert.equal(signal.protocol, 'http/protobuf');
      assert.equal(signal.endpointClass, 'loopback-http');
      assert(!('endpoint' in signal));
      assert(!('headers' in signal));
    }
    assert(!JSON.stringify(health.telemetry).includes(collector.url));
    assert(!JSON.stringify(health.telemetry).includes(privacyCorpus.authorization));
    const publicHealth = await (await fetch(runtime.url + '/health/ready')).json();
    assert(!JSON.stringify(publicHealth).includes('telemetry'), 'Public readiness gained telemetry coupling');
    const projected = await runtime.execute(['serve', '--status']);
    assert(/telemetry/i.test(projected.stdout), 'serve status omitted worker telemetry');
    assert(!projected.stdout.includes(collector.url));
    assert.equal(
      (await fetch(url, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: '{}' }))
        .status >= 400,
      true,
      'Telemetry health must not provide a write-capable control',
    );
  } finally {
    await runtime.close();
    await collector.close();
  }
});
