import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import test from 'node:test';

const fixture = fileURLToPath(new URL('../src/fixture.mjs', import.meta.url));

async function runFixture(args, env = {}) {
  const child = spawn(process.execPath, [fixture, ...args], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.setEncoding('utf8').on('data', (chunk) => stdout.push(chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk) => stderr.push(chunk));
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, stderr.join(''));
  return { output: JSON.parse(stdout.join('')), text: stdout.join('') + stderr.join('') };
}

async function runOfficialClient(endpoint, scenario, protocolVersion, context = {}) {
  const child = spawn(process.execPath, [fixture, endpoint], {
    env: {
      ...process.env,
      MCP_CONFORMANCE_CONTEXT: JSON.stringify(context),
      MCP_CONFORMANCE_PROTOCOL_VERSION: protocolVersion,
      MCP_CONFORMANCE_SCENARIO: scenario,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.setEncoding('utf8').on('data', (chunk) => stdout.push(chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk) => stderr.push(chunk));
  const [code] = await once(child, 'exit');
  return { code, stdout: stdout.join(''), stderr: stderr.join('') };
}

async function startConformanceMock(protocolVersion) {
  const requests = [];
  let rejectedModernProbe = false;
  const server = createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' }).end();
      return;
    }
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push({ headers: req.headers, message });
      res.setHeader('content-type', 'application/json');
      if (protocolVersion === '2026-07-28' && !rejectedModernProbe) {
        rejectedModernProbe = true;
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32022,
              message: 'Unsupported protocol version',
              data: { supported: ['2026-07-28'], requested: 'synthetic-unsupported' },
            },
          }),
        );
        return;
      }
      let result = {};
      if (message.method === 'initialize') {
        result = {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'conformance-mock', version: '1.0.0' },
        };
      } else if (message.method === 'server/discover') {
        result = {
          resultType: 'complete',
          ttlMs: 0,
          cacheScope: 'private',
          supportedVersions: ['2026-07-28'],
          capabilities: { tools: {} },
          serverInfo: { name: 'conformance-mock', version: '1.0.0' },
        };
      } else if (message.method === 'tools/list') {
        result = {
          ...(protocolVersion === '2026-07-28' ? { resultType: 'complete', ttlMs: 0, cacheScope: 'private' } : {}),
          tools: [
            {
              name: 'add_numbers',
              description: 'Add two numbers.',
              inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
            },
          ],
        };
      } else if (message.method === 'tools/call') {
        result = {
          ...(protocolVersion === '2026-07-28' ? { resultType: 'complete' } : {}),
          content: [{ type: 'text', text: 'synthetic-result' }],
        };
      }
      res.statusCode = message.method?.startsWith('notifications/') ? 202 : 200;
      res.end(message.id === undefined ? '' : JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.equal(typeof address, 'object');
  return {
    endpoint: `http://127.0.0.1:${address.port}/mcp`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function startHttpServer(sdkEra, transport = 'streamable-http') {
  const child = spawn(process.execPath, [fixture, 'server', '--sdk-era', sdkEra, '--transport', transport], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const errors = [];
  child.stderr.setEncoding('utf8').on('data', (chunk) => errors.push(chunk));
  const lines = createInterface({ input: child.stdout });
  const timeout = AbortSignal.timeout(10_000);
  const [line] = await once(lines, 'line', { signal: timeout });
  const ready = JSON.parse(line);
  assert.deepEqual(
    { kind: ready.kind, sdkEra: ready.sdkEra, transport: ready.transport, host: ready.host },
    { kind: 'ready', sdkEra, transport, host: '127.0.0.1' },
  );
  assert.equal(Number.isInteger(ready.port) && ready.port > 0, true);
  return {
    child,
    endpoint: `http://127.0.0.1:${ready.port}/${transport === 'sse' ? 'sse' : 'mcp'}`,
    errors,
  };
}

async function stopServer(server) {
  server.child.kill('SIGTERM');
  const [code, signal] = await once(server.child, 'exit');
  assert.equal(code === 0 || signal === 'SIGTERM', true, server.errors.join(''));
}

test('--self-check verifies exact package versions and required public exports', async () => {
  const { output } = await runFixture(['--self-check']);

  assert.equal(output.kind, 'self-check');
  assert.equal(output.ok, true);
  assert.deepEqual(output.packages, {
    '@modelcontextprotocol/client': '2.0.0',
    '@modelcontextprotocol/node': '2.0.0',
    '@modelcontextprotocol/sdk': '1.30.0',
    '@modelcontextprotocol/server': '2.0.0',
    '@modelcontextprotocol/server-legacy': '2.0.0',
  });
  assert.deepEqual(output.profiles, {
    v1: ['stdio', 'streamable-http', 'sse'],
    v2: ['stdio', 'streamable-http', 'sse'],
  });
  assert.deepEqual(output.checks, { exports: true, versions: true });
});

for (const { scenario, protocolVersion } of [
  { scenario: 'initialize', protocolVersion: '2025-06-18' },
  { scenario: 'tools_call', protocolVersion: '2025-11-25' },
  { scenario: 'tools_call', protocolVersion: '2026-07-28' },
]) {
  test(`official conformance ${scenario} startup contract at ${protocolVersion}`, async (t) => {
    const mock = await startConformanceMock(protocolVersion);
    t.after(() => mock.close());
    const contextSecret = `context-secret-${scenario}`;
    const result = await runOfficialClient(mock.endpoint, scenario, protocolVersion, { secret: contextSecret });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout.includes(mock.endpoint), false);
    assert.equal(result.stderr.includes(contextSecret), false);
    if (protocolVersion === '2026-07-28') {
      assert.equal(
        mock.requests.some(({ message }) => message.method === 'server/discover'),
        true,
      );
    } else {
      const initialize = mock.requests.find(({ message }) => message.method === 'initialize');
      assert.equal(initialize?.message.params.protocolVersion, '2025-11-25');
    }
    if (scenario === 'tools_call') {
      const call = mock.requests.find(({ message }) => message.method === 'tools/call');
      assert.equal(typeof call?.message.params.arguments.a, 'number');
      assert.equal(typeof call?.message.params.arguments.b, 'number');
    }
  });
}

test('official conformance request-metadata contract uses modern per-request metadata', async (t) => {
  const mock = await startConformanceMock('2026-07-28');
  t.after(() => mock.close());
  const result = await runOfficialClient(mock.endpoint, 'request-metadata', '2026-07-28');

  assert.equal(result.code, 0, result.stderr);
  assert.equal(mock.requests.length >= 3, true);
  for (const request of mock.requests) {
    assert.equal(request.headers['mcp-protocol-version'], '2026-07-28');
    assert.equal(request.message.params._meta['io.modelcontextprotocol/protocolVersion'], '2026-07-28');
  }
});

test('official conformance mode classifies unsupported scenarios without echoing inputs', async (t) => {
  const mock = await startConformanceMock('2025-11-25');
  t.after(() => mock.close());
  const scenario = 'unsupported-secret-scenario';
  const contextSecret = 'unsupported-context-secret';
  const result = await runOfficialClient(mock.endpoint, scenario, '2025-11-25', { secret: contextSecret });

  assert.equal(result.code, 2);
  const diagnostic = JSON.parse(result.stderr);
  assert.deepEqual(diagnostic, {
    kind: 'conformance-client',
    ok: false,
    classification: 'unsupported-scenario',
  });
  assert.equal(result.stderr.includes(scenario), false);
  assert.equal(result.stderr.includes(contextSecret), false);
  assert.equal(result.stderr.includes(mock.endpoint), false);
});

test('official conformance mode rejects non-loopback endpoints without echoing them', async () => {
  const endpoint = 'https://external-secret.example/mcp';
  const result = await runOfficialClient(endpoint, 'initialize', '2025-11-25');

  assert.equal(result.code, 1);
  assert.deepEqual(JSON.parse(result.stderr), { kind: 'error', code: 'INVALID_ARGUMENTS' });
  assert.equal(result.stderr.includes(endpoint), false);
});

for (const scenario of [
  { client: 'v1', server: 'v1', protocol: 'legacy' },
  { client: 'v2', server: 'v1', protocol: 'legacy' },
  { client: 'v1', server: 'v2', protocol: 'legacy' },
  { client: 'v2', server: 'v2', protocol: 'modern' },
]) {
  test(`${scenario.client} client probes ${scenario.server} Streamable HTTP server`, async (t) => {
    const server = await startHttpServer(scenario.server);
    t.after(() => stopServer(server));
    const secret = `fixture-secret-${scenario.client}-${scenario.server}`;
    const { output, text } = await runFixture(
      [
        'probe',
        '--sdk-era',
        scenario.client,
        '--protocol-era',
        scenario.protocol,
        '--transport',
        'streamable-http',
        '--endpoint',
        server.endpoint,
      ],
      { FIXTURE_SECRET_SENTINEL: secret },
    );

    assert.equal(output.ok, scenario.protocol === 'legacy');
    assert.equal(output.sdkEra, scenario.client);
    assert.equal(output.protocolEra, scenario.protocol);
    assert.equal(output.transport, 'streamable-http');
    assert.deepEqual(output.operations, {
      initialize: scenario.protocol === 'legacy',
      ping: scenario.protocol === 'legacy',
      toolsList: { count: 1, fixtureTool: true },
      toolsCall: { contentTypes: ['text'], isError: false },
    });
    if (scenario.protocol === 'modern') {
      assert.equal(output.classification, 'unsupported-operation');
      assert.deepEqual(output.unsupported, [
        { operation: 'initialize', reason: 'modern-uses-server-discover' },
        { operation: 'ping', reason: 'not-in-2026-07-28' },
      ]);
    }
    assert.equal(text.includes(secret), false);
    assert.equal(text.includes(server.endpoint), false);
    assert.equal(text.includes('fixture-input-must-not-leak'), false);
    assert.equal(text.includes('fixture-result-must-not-leak'), false);
  });
}

for (const sdkEra of ['v1', 'v2']) {
  test(`${sdkEra} retained SSE fixture completes a legacy MCP probe`, async (t) => {
    const server = await startHttpServer(sdkEra, 'sse');
    t.after(() => stopServer(server));
    const { output } = await runFixture([
      'probe',
      '--sdk-era',
      sdkEra,
      '--protocol-era',
      'legacy',
      '--transport',
      'sse',
      '--endpoint',
      server.endpoint,
    ]);

    assert.equal(output.ok, true);
    assert.deepEqual(output.operations, {
      initialize: true,
      ping: true,
      toolsList: { count: 1, fixtureTool: true },
      toolsCall: { contentTypes: ['text'], isError: false },
    });
  });

  test(`${sdkEra} stdio fixture owns its subprocess and completes the MCP probe`, async () => {
    const protocolEra = sdkEra === 'v2' ? 'modern' : 'legacy';
    const { output, text } = await runFixture([
      'probe',
      '--sdk-era',
      sdkEra,
      '--protocol-era',
      protocolEra,
      '--transport',
      'stdio',
      '--command',
      process.execPath,
      '--arg',
      fixture,
      '--arg',
      'server',
      '--arg=--sdk-era',
      '--arg',
      sdkEra,
      '--arg=--transport',
      '--arg',
      'stdio',
    ]);

    assert.equal(output.ok, sdkEra === 'v1');
    assert.equal(output.transport, 'stdio');
    assert.equal(output.protocolEra, protocolEra);
    assert.equal(text.includes(fixture), false);
  });
}
