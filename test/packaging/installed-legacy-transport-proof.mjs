import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createRequire } from 'node:module';

const packageRoot = path.resolve(process.argv[2]);
const require = createRequire(path.join(packageRoot, 'package.json'));
const sdkRoot = path.resolve(
  path.dirname(require.resolve('@modelcontextprotocol/sdk/server/streamableHttp.js')),
  '../../..',
);
assert.equal(JSON.parse(await readFile(path.join(sdkRoot, 'package.json'), 'utf8')).version, '1.30.0');
const { WebStandardStreamableHTTPServerTransport: RawTransport } = await import(
  pathToFileURL(path.join(sdkRoot, 'dist/esm/server/webStandardStreamableHttp.js'))
);
const raw = new RawTransport({ sessionIdGenerator: undefined });
const rawResponse = await raw.handleRequest(
  new Request('http://127.0.0.1/mcp', {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': '2099-01-01',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' }),
  }),
);
assert.equal((await rawResponse.json()).id, null);
await raw.close();
const island = path.join(packageRoot, 'build/sdk/legacy/server/retained-sdk');
const provenance = JSON.parse(await readFile(path.join(island, 'provenance.json'), 'utf8'));
assert.equal(provenance.version, '1.30.0');
for (const [file, hashes] of Object.entries(provenance.files)) {
  assert.equal(
    createHash('sha256')
      .update(await readFile(path.join(island, file)))
      .digest('hex'),
    hashes.generatedSha256,
  );
}
const { StreamableHTTPServerTransport: Transport } = await import(
  pathToFileURL(path.join(packageRoot, 'build/sdk/legacy/server/streamableHttp.js'))
);
const { JSONRPCMessageSchema } = await import(pathToFileURL(path.join(sdkRoot, 'dist/esm/types.js')));
for (const stateful of [false, true]) {
  const transports = [];
  const server = createServer((request, response) => {
    const transport = new Transport({ sessionIdGenerator: stateful ? () => 'owned-session' : undefined });
    transports.push(transport);
    void transport.start().then(() => transport.handleRequest(request, response));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/mcp`;
  const post = (body, headers = {}) =>
    fetch(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'mcp-protocol-version': '2099-01-01',
        ...headers,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  try {
    for (const id of [0, 7, 'installed-probe']) {
      const response = await post({ jsonrpc: '2.0', id, method: 'ping' });
      assert.equal(response.status, 400, await response.clone().text());
      const body = await response.json();
      assert.equal(body.id, id);
      assert.equal(body.error.code, -32000);
      assert.equal(JSONRPCMessageSchema.safeParse(body).success, true);
    }
    for (const body of [
      [{ jsonrpc: '2.0', id: 7, method: 'ping' }],
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      '{',
    ]) {
      const response = await post(body);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).id, null);
    }
    const beforeParse = await post({ jsonrpc: '2.0', id: 99, method: 'ping' }, { accept: 'application/json' });
    assert.equal(beforeParse.status, 406);
    assert.equal((await beforeParse.json()).id, null);
  } finally {
    await Promise.all(transports.map((transport) => transport.close()));
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}
assert.equal(
  JSONRPCMessageSchema.safeParse({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'rejected' } }).success,
  false,
);
console.log(
  JSON.stringify({
    installedSdk: '1.30.0',
    rawSdkKnownId: null,
    retainedTransportKnownIds: [0, 7, 'string'],
    statefulAndStateless: true,
    unknownIds: ['batch', 'notification', 'malformed-json', 'preparse'],
    strictNullIdRejection: true,
    passed: true,
  }),
);
