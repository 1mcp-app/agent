import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export async function waitUntil(predicate, message, timeoutMs = 10000, intervalMs = 50) {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    assert(Date.now() < deadline, message);
    await delay(intervalMs);
  }
}
export async function startRuntime({
  collector,
  admin = false,
  env: extra = {},
  probe,
  executable = process.execPath,
  entry = resolve('build/index.js'),
  httpHeaders = {},
  background = false,
  logLevel = 'debug',
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), '1mcp-runtime-acceptance-'));
  const socket = createServer();
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close((error) => (error ? reject(error) : resolve())));
  const url = `http://127.0.0.1:${port}`;
  const log = join(directory, 'runtime.log');
  const config = join(directory, 'mcp.json');
  await writeFile(
    config,
    JSON.stringify({
      mcpServers: {
        fixture: {
          command: process.execPath,
          args: [resolve('test/telemetry/workload-backend.mjs')],
          protocolVersion: 'legacy',
          stderr: 'pipe',
          env: { ACCEPTANCE_CAPACITY_TOOLS: extra.ACCEPTANCE_CAPACITY_TOOLS ?? '0' },
        },
      },
    }),
  );
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith('OTEL_') && !key.startsWith('ONE_MCP_')),
    ),
    OTEL_TRACES_EXPORTER: 'otlp',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_LOGS_EXPORTER: 'none',
    OTEL_EXPORTER_OTLP_ENDPOINT: collector.url,
    OTEL_TRACES_SAMPLER: 'always_on',
    OTEL_BSP_SCHEDULE_DELAY: '10',
    OTEL_METRIC_EXPORT_INTERVAL: '5000',
    ...extra,
  };
  if (probe) {
    env.TELEMETRY_ACCEPTANCE_PROBE = probe;
    env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(resolve('scripts/telemetry/runtime-probe.mjs')).href}`;
  }
  const prefix = entry ? [entry] : [];
  const execute = async (args, options = {}) => {
    try {
      return await promisify(execFile)(
        executable,
        [...prefix, ...args, '--config', config, '--config-dir', directory],
        {
          cwd: directory,
          env,
          timeout: 10000,
          maxBuffer: 1024 * 1024,
          ...options,
        },
      );
    } catch (error) {
      if (options.acceptExitCodes?.includes(error.code)) return { stdout: error.stdout, stderr: error.stderr };
      throw new Error(`CLI ${args.join(' ')} failed code=${error.code}: ${error.stdout ?? ''} ${error.stderr ?? ''}`, {
        cause: error,
      });
    }
  };
  let child;
  let client;
  let diagnostic = '';
  const exited = () => child?.exitCode !== null || child?.signalCode !== null;
  let stopping;
  async function stop(signal = 'SIGTERM') {
    if (background) {
      stopping ??= execute(['serve', '--stop'], { timeout: 15000 });
      await stopping;
      return;
    }
    if (!child || exited()) return;
    child.kill(signal);
    await waitUntil(exited, 'Runtime exceeded cleanup deadline', 8000);
  }
  async function close() {
    await client?.close().catch(() => {});
    try {
      await stop();
    } finally {
      if (child && !exited()) {
        child.kill('SIGKILL');
        await waitUntil(exited, 'Runtime could not be reaped', 2000);
      }
      await rm(directory, { recursive: true, force: true });
    }
  }
  try {
    if (admin)
      await execute([
        'admin',
        'bootstrap',
        '--username',
        'acceptance',
        '--password',
        'acceptance-only-489-password',
        '--json',
      ]);
    child = spawn(
      executable,
      [
        ...prefix,
        'serve',
        ...(background ? ['--background'] : []),
        '--transport',
        'http',
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--config',
        config,
        '--config-dir',
        directory,
        '--no-enable-auth',
        '--no-enable-async-loading',
        '--log-level',
        logLevel,
        '--log-file',
        log,
      ],
      { cwd: directory, env, stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let spawnError;
    child.once('error', (error) => {
      spawnError = error;
    });
    child.stderr.on('data', (chunk) => {
      diagnostic = (diagnostic + chunk).slice(-8192);
    });
    await waitUntil(
      async () => {
        if (spawnError) throw spawnError;
        assert(
          background ? child.exitCode === null || child.exitCode === 0 : !exited(),
          `Runtime exited before readiness: ${diagnostic}`,
        );
        try {
          return (await fetch(url + '/health/ready', { signal: AbortSignal.timeout(300) })).ok;
        } catch {
          return false;
        }
      },
      `Runtime failed readiness: ${diagnostic}`,
      15000,
    );
    await waitUntil(
      async () => {
        const response = await fetch(url + '/api/v1/tools', { signal: AbortSignal.timeout(1000) });
        return response.ok && (await response.text()).includes('fixture_1mcp_');
      },
      'Runtime listening but fixture backend unavailable',
      15000,
    );
    client = new Client({ name: 'acceptance-client', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url + '/mcp'), { requestInit: { headers: httpHeaders } }),
    );
    const tools = (await client.listTools()).tools;
    return {
      directory,
      url,
      child,
      client,
      execute,
      tools,
      env,
      config,
      stop,
      close,
      readLog: () => readFile(log, 'utf8'),
      async login() {
        const response = await fetch(url + '/admin/api/session/login', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: url,
          },
          body: JSON.stringify({ username: 'acceptance', password: 'acceptance-only-489-password' }),
        });
        assert.equal(response.status, 200, await response.text());
        return response.headers.get('set-cookie').split(';')[0];
      },
    };
  } catch (error) {
    const evidence = await readFile(log, 'utf8').catch(() => diagnostic);
    await close();
    throw new Error(`${error.message}; runtime diagnostics: ${evidence.slice(-10000)}`, { cause: error });
  }
}
