import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, Server } from '@modelcontextprotocol/server';

import { type ChildProcess, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { Client } from '@src/sdk/legacy/client/index.js';
import { StreamableHTTPClientTransport } from '@src/sdk/legacy/client/streamableHttp.js';

import { afterEach, describe, expect, it } from 'vitest';

import { createTestProcessEnvironment } from '../../scripts/test-process-environment.mjs';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function freePort(): Promise<number> {
  const reservation = createServer();
  await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done));
  const { port } = reservation.address() as AddressInfo;
  await new Promise<void>((done) => reservation.close(() => done()));
  return port;
}

async function stop(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((done) => {
    child.once('exit', done);
    child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), 3000);
    force.unref();
    child.once('exit', () => clearTimeout(force));
  });
}

async function startLateBackend(port: number): Promise<void> {
  const handler = createMcpHandler(() => {
    const server = new Server({ name: 'late-backend', version: '1' }, { capabilities: { tools: {} } });
    server.setRequestHandler('tools/list', async () => ({
      tools: [{ name: 'ping', description: 'Replies pong', inputSchema: { type: 'object', properties: {} } }],
    }));
    server.setRequestHandler('tools/call', async () => ({ content: [{ type: 'text', text: 'pong' }] }));
    return server;
  });
  const backend: HttpServer = createServer(toNodeHandler(handler));
  await new Promise<void>((done) => backend.listen(port, '127.0.0.1', done));
  cleanups.push(
    () =>
      new Promise<void>((done) => {
        backend.closeAllConnections();
        backend.close(() => done());
      }),
  );
}

/** The loading manager marks a backend `failed` only after its foreground retries are exhausted. */
async function loadingState(origin: string, server: string): Promise<string | undefined> {
  try {
    const response = await fetch(`${origin}/health/mcp/${server}`, { signal: AbortSignal.timeout(500) });
    return ((await response.json()) as { state?: string }).state;
  } catch {
    return undefined;
  }
}

async function health(origin: string): Promise<{ healthy: number; unhealthy: number } | undefined> {
  try {
    const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(500) });
    const body = (await response.json()) as { servers?: { healthy: number; unhealthy: number } };
    return body.servers;
  } catch {
    return undefined;
  }
}

async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!accept(value) && Date.now() < deadline) {
    await delay(100);
    value = await read();
  }
  return value;
}

async function startRuntime(backendPort: number, backgroundRetry: boolean): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), '1mcp-transient-backend-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const home = join(directory, 'home');
  await mkdir(home);
  await writeFile(
    join(directory, 'mcp.json'),
    JSON.stringify({ mcpServers: { late: { type: 'streamableHttp', url: `http://127.0.0.1:${backendPort}/mcp` } } }),
  );
  const port = await freePort();
  const child = spawn(
    process.execPath,
    [
      resolve('build/index.js'),
      'serve',
      '--transport',
      'http',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--config-dir',
      directory,
      '--enable-auth',
      'false',
      '--credential-store',
      'file',
      '--enable-async-loading',
      '--async-max-retries',
      '0',
      backgroundRetry ? '--async-background-retry' : '--no-async-background-retry',
      '--async-background-retry-interval',
      '1000',
    ],
    {
      cwd: directory,
      env: createTestProcessEnvironment(
        {},
        {
          PATH: process.env.PATH,
          HOME: home,
          NODE_ENV: 'test',
          ONE_MCP_CONFIG_DIR: directory,
          ONE_MCP_LOG_LEVEL: 'error',
        },
      ),
      stdio: ['ignore', 'ignore', 'ignore'],
    },
  );
  cleanups.push(() => stop(child));
  const origin = `http://127.0.0.1:${port}`;
  const ready = await until(
    () => health(origin),
    (servers) => servers !== undefined,
    15_000,
  );
  expect(child.exitCode).toBeNull();
  expect(ready).toBeDefined();
  return origin;
}

describe('backend that is not listening when the runtime starts', () => {
  it('recovers through background retry once the backend starts, without a restart', async () => {
    const backendPort = await freePort();
    const origin = await startRuntime(backendPort, true);

    // Start the backend only once foreground attempts are exhausted, so recovery must come from background retry.
    expect(
      await until(
        () => loadingState(origin, 'late'),
        (state) => state === 'failed',
        20_000,
      ),
    ).toBe('failed');
    expect(await health(origin)).toMatchObject({ healthy: 0, unhealthy: 1 });

    await startLateBackend(backendPort);
    expect(
      await until(
        () => health(origin),
        (servers) => servers?.healthy === 1,
        20_000,
      ),
    ).toMatchObject({ healthy: 1, unhealthy: 0 });

    const client = new Client({ name: 'transient-backend-e2e', version: '1' }, { capabilities: {} });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`)));
    cleanups.push(() => client.close());
    const { tools } = await client.listTools();
    const ping = tools.find((tool) => tool.name.endsWith('ping'));
    expect(ping).toBeDefined();
    await expect(client.callTool({ name: ping!.name, arguments: {} })).resolves.toMatchObject({
      content: [{ type: 'text', text: 'pong' }],
    });
  }, 60_000);

  it('leaves the exhausted backend failed when background retry is disabled', async () => {
    const backendPort = await freePort();
    const origin = await startRuntime(backendPort, false);

    expect(
      await until(
        () => loadingState(origin, 'late'),
        (state) => state === 'failed',
        20_000,
      ),
    ).toBe('failed');
    await startLateBackend(backendPort);
    // Several background intervals would have elapsed if retry were enabled.
    await delay(3500);
    expect(await health(origin)).toMatchObject({ healthy: 0, unhealthy: 1 });
  }, 60_000);
});
