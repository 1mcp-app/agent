import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function decode(text) {
  if (text.startsWith('{')) return JSON.parse(text);
  const data = text
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => JSON.parse(line.slice(5)));
  return data.find((message) => 'result' in message || 'error' in message);
}

export async function proveLegacyRuntime(kind, command) {
  const directory = await mkdtemp(path.join(tmpdir(), '1mcp-package-runtime-'));
  const port = await freePort();
  const endpoint = `http://127.0.0.1:${port}/mcp`;
  await writeFile(
    path.join(directory, 'mcp.json'),
    JSON.stringify({
      mcpServers: {
        packaged_echo: {
          command: kind === 'docker' ? 'node' : process.execPath,
          args: [path.join(root, 'test/e2e/fixtures/echo-server.js')],
        },
      },
    }),
  );
  let child;
  let logs = '';
  const start = async () => {
    const prefix =
      kind === 'docker'
        ? [
            'docker',
            'run',
            '--rm',
            '-p',
            `127.0.0.1:${port}:${port}`,
            '-v',
            `${directory}:${directory}`,
            '-v',
            `${root}:${root}:ro`,
            command[0],
            'node',
            '/usr/src/app/index.js',
          ]
        : command;
    child = spawn(
      prefix[0],
      [
        ...prefix.slice(1),
        'serve',
        '--transport',
        'http',
        '--host',
        kind === 'docker' ? '0.0.0.0' : '127.0.0.1',
        '--port',
        String(port),
        ...(kind === 'docker' ? ['--external-url', `http://localhost:${port}`] : []),
        '--config-dir',
        directory,
        '--enable-auth',
        'false',
        '--async-max-retries',
        '0',
        '--no-async-background-retry',
      ],
      { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (data) => {
        logs = (logs + data).slice(-12000);
      });
    for (let attempt = 0; attempt < 200; attempt++) {
      if (child.exitCode !== null) throw new Error(`Runtime exited: ${logs}`);
      try {
        if ((await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) })).ok) return;
      } catch {
        /* bounded readiness */
      }
      await sleep(100);
    }
    throw new Error(`Runtime readiness timeout: ${logs}`);
  };
  const stop = async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exit = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    await Promise.race([exit, sleep(10000)]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exit;
    }
  };
  let session;
  const post = (body, headers = {}) =>
    fetch(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'mcp-protocol-version': '2025-11-25',
        ...(session ? { 'mcp-session-id': session } : {}),
        ...headers,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  const rpc = async (id, method, params = {}) => {
    const response = await post({ jsonrpc: '2.0', id, method, params });
    assert.equal(response.status, 200);
    const message = decode(await response.text());
    assert.equal(message.id, id);
    assert.equal(message.error, undefined);
    return { response, message };
  };
  try {
    await start();
    const initialized = await rpc(1, 'initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'packaged-proof', version: '1' },
    });
    session = initialized.response.headers.get('mcp-session-id');
    assert.ok(session);
    assert.equal((await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
    for (const id of [0, 7, 'packaged-probe']) {
      const rejected = await post({ jsonrpc: '2.0', id, method: 'ping' }, { 'mcp-protocol-version': '2099-01-01' });
      assert.equal(rejected.status, 400);
      const message = decode(await rejected.text());
      assert.equal(message.id, id);
      assert.equal(message.error.code, -32602);
    }
    for (const body of [
      [{ jsonrpc: '2.0', id: 7, method: 'ping' }],
      { jsonrpc: '2.0', method: 'notifications/initialized' },
    ]) {
      const rejected = await post(body, { 'mcp-protocol-version': '2099-01-01' });
      assert.equal(rejected.status, 400);
      assert.equal(decode(await rejected.text()).id, null);
    }
    const beforeParse = await post({ jsonrpc: '2.0', id: 99, method: 'ping' }, { accept: 'application/json' });
    assert.equal(beforeParse.status, 406);
    assert.equal(decode(await beforeParse.text()).id, null);
    await rpc(2, 'ping');
    const listed = await rpc(3, 'tools/list');
    const tool = listed.message.result.tools.find((candidate) => candidate.name.endsWith('echo'));
    assert.ok(tool);
    const called = await rpc(4, 'tools/call', { name: tool.name, arguments: { message: 'packaged-parity' } });
    assert.ok(JSON.stringify(called.message.result).includes('packaged-parity'));
    const controller = new AbortController();
    const sse = await fetch(endpoint, {
      headers: { accept: 'text/event-stream', 'mcp-session-id': session, 'mcp-protocol-version': '2025-11-25' },
      signal: controller.signal,
    });
    assert.equal(sse.status, 200);
    assert.ok(sse.headers.get('content-type').includes('text/event-stream'));
    controller.abort();
    await sse.body.cancel().catch(() => {});
    await stop();
    await start();
    await rpc(5, 'ping');
    console.log(
      JSON.stringify({
        kind,
        gatewayHeaderGuardIds: [0, 7, 'string'],
        unknownIds: ['batch', 'notification', 'preparse'],
        operations: ['initialize', 'ping', 'tools/list', 'tools/call', 'SSE', 'restored-session-ping'],
        passed: true,
      }),
    );
  } finally {
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [kind, ...command] = process.argv.slice(2);
  if (!['npm', 'sea', 'docker'].includes(kind) || command.length === 0)
    throw new Error('Usage: legacy-runtime-proof.mjs npm|sea|docker command [arguments]');
  await proveLegacyRuntime(kind, command);
}
