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

async function startConformanceMock(protocolVersion, options = {}) {
  if (typeof options === 'string') options = { tools: [{ name: options, inputSchema: { type: 'object' } }] };
  const tools = options.tools ?? [
    {
      name: 'add_numbers',
      description: 'Add two numbers.',
      inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
    },
  ];
  const resources = options.resources ?? [];
  const prompts = options.prompts ?? [];
  const capabilities = {
    tools: {},
    ...(resources.length > 0 ? { resources: {} } : {}),
    ...(prompts.length > 0 ? { prompts: {} } : {}),
  };
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
          capabilities,
          serverInfo: { name: 'conformance-mock', version: '1.0.0' },
        };
      } else if (message.method === 'server/discover') {
        result = {
          resultType: 'complete',
          ttlMs: 0,
          cacheScope: 'private',
          supportedVersions: ['2026-07-28'],
          capabilities,
          serverInfo: { name: 'conformance-mock', version: '1.0.0' },
        };
      } else if (message.method === 'tools/list') {
        result = {
          ...(protocolVersion === '2026-07-28' ? { resultType: 'complete', ttlMs: 0, cacheScope: 'private' } : {}),
          tools,
        };
      } else if (message.method === 'tools/call') {
        result = {
          ...(protocolVersion === '2026-07-28' ? { resultType: 'complete' } : {}),
          content: [{ type: 'text', text: 'synthetic-result' }],
        };
      } else if (message.method === 'resources/list') {
        result = {
          ...(protocolVersion === '2026-07-28' ? { resultType: 'complete', ttlMs: 0, cacheScope: 'private' } : {}),
          resources,
        };
      } else if (message.method === 'resources/read') {
        result = {
          ...(protocolVersion === '2026-07-28' ? { resultType: 'complete', ttlMs: 0, cacheScope: 'private' } : {}),
          contents: [],
        };
      } else if (message.method === 'prompts/list') {
        result = {
          ...(protocolVersion === '2026-07-28' ? { resultType: 'complete', ttlMs: 0, cacheScope: 'private' } : {}),
          prompts,
        };
      } else if (message.method === 'prompts/get') {
        result = {
          ...(protocolVersion === '2026-07-28' ? { resultType: 'complete' } : {}),
          messages: [],
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

test('official tools_call resolves an aggregated gateway tool name', async (t) => {
  const mock = await startConformanceMock('2025-11-25', 'official_conformance_1mcp_add_numbers');
  t.after(() => mock.close());
  const result = await runOfficialClient(mock.endpoint, 'tools_call', '2025-11-25');

  assert.equal(result.code, 0, result.stderr);
  const call = mock.requests.find(({ message }) => message.method === 'tools/call');
  assert.equal(call?.message.params.name, 'official_conformance_1mcp_add_numbers');
});

test('official auth dispatch triggers the gateway upstream client', async (t) => {
  const mock = await startConformanceMock('2026-07-28', { tools: [] });
  t.after(() => mock.close());
  const result = await runOfficialClient(mock.endpoint, 'auth/metadata-default', '2026-07-28');

  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    mock.requests.some(({ message }) => message.method === 'tools/list'),
    true,
  );
});

test('official HTTP header dispatch executes standard and context-provided operations', async (t) => {
  const standard = await startConformanceMock('2026-07-28', {
    tools: [{ name: 'test_headers', inputSchema: { type: 'object' } }],
    resources: [{ uri: 'file:///header-test', name: 'header-test' }],
    prompts: [{ name: 'test_prompt' }],
  });
  t.after(() => standard.close());
  const standardResult = await runOfficialClient(standard.endpoint, 'http-standard-headers', '2026-07-28');
  assert.equal(standardResult.code, 0, standardResult.stderr);
  for (const method of [
    'tools/list',
    'tools/call',
    'resources/list',
    'resources/read',
    'prompts/list',
    'prompts/get',
  ]) {
    assert.equal(
      standard.requests.some(({ message }) => message.method === method),
      true,
      method,
    );
  }

  const custom = await startConformanceMock('2026-07-28', {
    tools: [
      { name: 'test_custom_headers', inputSchema: { type: 'object' } },
      { name: 'test_custom_headers_null', inputSchema: { type: 'object' } },
    ],
  });
  t.after(() => custom.close());
  const toolCalls = [
    { name: 'test_custom_headers', arguments: { region: 'us-west1' } },
    { name: 'test_custom_headers_null', arguments: { verbose: null } },
  ];
  const customResult = await runOfficialClient(custom.endpoint, 'http-custom-headers', '2026-07-28', { toolCalls });
  assert.equal(customResult.code, 0, customResult.stderr);
  assert.deepEqual(
    custom.requests
      .filter(({ message }) => message.method === 'tools/call')
      .map(({ message }) => ({ name: message.params.name, arguments: message.params.arguments })),
    toolCalls,
  );

  const invalid = await startConformanceMock('2026-07-28', {
    tools: [
      { name: 'valid_tool', inputSchema: { type: 'object' } },
      { name: 'invalid_empty_header', inputSchema: { type: 'object' } },
    ],
  });
  t.after(() => invalid.close());
  const invalidResult = await runOfficialClient(invalid.endpoint, 'http-invalid-tool-headers', '2026-07-28');
  assert.equal(invalidResult.code, 0, invalidResult.stderr);
  assert.deepEqual(
    invalid.requests.filter(({ message }) => message.method === 'tools/call').map(({ message }) => message.params.name),
    ['valid_tool'],
  );
});

test('official schema dispatch preserves and echoes the advertised input schema', async (t) => {
  const inputSchema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $defs: { value: { type: 'string' } },
    type: 'object',
  };
  const mock = await startConformanceMock('2026-07-28', {
    tools: [
      { name: 'json_schema_2020_12_tool', inputSchema },
      { name: 'json_schema_echo', inputSchema: { type: 'object' } },
    ],
  });
  t.after(() => mock.close());
  const result = await runOfficialClient(mock.endpoint, 'json-schema-2020-12-preservation', '2026-07-28');

  assert.equal(result.code, 0, result.stderr);
  const call = mock.requests.find(({ message }) => message.method === 'tools/call');
  assert.deepEqual(call?.message.params.arguments.schema, inputSchema);
});

test('official request-state and legacy extension dispatch call every advertised tool', async (t) => {
  const requestStateTools = [
    'test_mrtr_echo_state',
    'test_mrtr_no_state',
    'test_mrtr_unrelated',
    'test_mrtr_no_result_type',
  ];
  const modern = await startConformanceMock('2026-07-28', {
    tools: requestStateTools.map((name) => ({ name, inputSchema: { type: 'object' } })),
  });
  t.after(() => modern.close());
  const modernResult = await runOfficialClient(modern.endpoint, 'sep-2322-client-request-state', '2026-07-28');
  assert.equal(modernResult.code, 0, modernResult.stderr);
  assert.deepEqual(
    modern.requests.filter(({ message }) => message.method === 'tools/call').map(({ message }) => message.params.name),
    requestStateTools,
  );

  const legacy = await startConformanceMock('2025-11-25', {
    tools: [{ name: 'test_client_elicitation_defaults', inputSchema: { type: 'object' } }],
  });
  t.after(() => legacy.close());
  const legacyResult = await runOfficialClient(legacy.endpoint, 'elicitation-sep1034-client-defaults', '2025-11-25');
  assert.equal(legacyResult.code, 0, legacyResult.stderr);
  assert.equal(
    legacy.requests.some(
      ({ message }) => message.method === 'tools/call' && message.params.name === 'test_client_elicitation_defaults',
    ),
    true,
  );

  const retry = await startConformanceMock('2025-11-25', {
    tools: [{ name: 'test_reconnection', inputSchema: { type: 'object' } }],
  });
  t.after(() => retry.close());
  const retryResult = await runOfficialClient(retry.endpoint, 'sse-retry', '2025-11-25');
  assert.equal(retryResult.code, 0, retryResult.stderr);
  assert.equal(
    retry.requests.some(
      ({ message }) => message.method === 'tools/call' && message.params.name === 'test_reconnection',
    ),
    true,
  );
});

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

for (const sdkEra of ['v1', 'v2']) {
  test(`${sdkEra} runtime output reports the revision returned by the initialize response`, async (t) => {
    const mock = await startConformanceMock('2024-11-05');
    t.after(() => mock.close());

    const { output } = await runFixture([
      'probe',
      '--sdk-era',
      sdkEra,
      '--protocol-era',
      'legacy',
      '--transport',
      'streamable-http',
      '--endpoint',
      mock.endpoint,
      '--runtime-output',
    ]);

    assert.equal(output.negotiatedRevision, '2024-11-05');
    assert.equal(
      mock.requests.find(({ message }) => message.method === 'initialize')?.message.params.protocolVersion,
      '2025-11-25',
    );
  });
}

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
