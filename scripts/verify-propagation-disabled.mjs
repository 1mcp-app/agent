import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const source = `
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import dgram from 'node:dgram';
import { syncBuiltinESMExports } from 'node:module';
let connections = 0;
const denied = () => { connections++; throw new Error('Unexpected network activation'); };
net.Socket.prototype.connect = denied;
http.request = denied; https.request = denied; dgram.createSocket = denied;
globalThis.fetch = denied;
syncBuiltinESMExports();
const { bootstrapTracing } = await import('./build/observability/tracing/bootstrap.js');
bootstrapTracing();
const { context, propagation, trace } = await import('@opentelemetry/api');
const { withMcpTraceContext, injectTraceContext, getActiveTraceCorrelation } = await import('./build/observability/tracing/context.js');
const parent = '00-12345678901234567890123456789012-1234567890123456-01';
await withMcpTraceContext({ _meta: { traceparent: parent, baggage: 'secret=forbidden' } }, async () => {
  await Promise.resolve();
  assert.equal(injectTraceContext(undefined)._meta.traceparent, parent);
  assert.equal(propagation.getBaggage(context.active()), undefined);
  assert.equal(getActiveTraceCorrelation().span_id, '1234567890123456');
});
assert.equal(getActiveTraceCorrelation(), undefined);
const span = trace.getTracer('disabled-test').startSpan('test-only-noop');
assert.equal(span.spanContext().traceId, '00000000000000000000000000000000');
span.end();
await new Promise(resolve => setTimeout(resolve, 50));
assert.equal(connections, 0);
console.log('propagation active; no provider, baggage or network connection');
`;
for (const disabled of [undefined, 'true']) {
  const env = { ...process.env, OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318' };
  delete env.NODE_OPTIONS;
  delete env.OTEL_SDK_DISABLED;
  if (disabled !== undefined) env.OTEL_SDK_DISABLED = disabled;
  const result = spawnSync(process.execPath, ['--input-type=module', '-'], {
    input: source,
    encoding: 'utf8',
    env,
    timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  console.log(`OTEL_SDK_DISABLED=${disabled ?? 'unset'}: ${result.stdout.trim()}`);
}
