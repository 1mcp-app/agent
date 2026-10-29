import { type ChildProcess, fork } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Duplex } from 'node:stream';

import { build } from 'esbuild';
import { expect, it, vi } from 'vitest';

import { createTestProcessEnvironment } from '../../scripts/test-process-environment.mjs';
import { abortProductDelivery, prepareProductDelivery } from './delivery.js';

it('uses the environment proxy and sends no HTTP payload until the durable owner dispatches', async () => {
  const requests: string[] = [];
  const bodies: string[] = [];
  let received!: () => void;
  const incoming = new Promise<void>((resolve) => {
    received = resolve;
  });
  const proxy = http.createServer((req, res) => {
    requests.push(req.url!);
    let body = '';
    req.on('data', (chunk) => {
      body += String(chunk);
    });
    req.on('end', () => {
      bodies.push(body);
      res.end();
      received();
    });
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const port = (proxy.address() as net.AddressInfo).port;
  vi.stubEnv('http_proxy', `http://127.0.0.1:${port}`);
  vi.stubEnv('no_proxy', '');
  vi.stubEnv('NO_PROXY', '');
  let delivery: Awaited<ReturnType<typeof prepareProductDelivery>>;
  try {
    delivery = await prepareProductDelivery('http://collector.invalid/v1/summaries');
    expect(delivery?.isReady()).toBe(true);
    expect(requests).toEqual([]);
    delivery!.dispatch('synthetic');
    await incoming;
    expect(requests).toEqual(['http://collector.invalid/v1/summaries']);
    expect(bodies).toEqual(['synthetic']);
  } finally {
    delivery?.cancel();
    vi.unstubAllEnvs();
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
}, 15000);

it('uses https_proxy CONNECT without releasing a payload before TLS is ready', async () => {
  let connected!: (target: string) => void;
  const tunnel = new Promise<string>((resolve) => {
    connected = resolve;
  });
  const sockets = new Set<Duplex>();
  const proxy = http.createServer();
  proxy.on('connect', (request, socket) => {
    sockets.add(socket);
    // Terminating the TLS sender may reset its peer socket on Linux.
    socket.on('error', (error) => expect(error).toHaveProperty('code', 'ECONNRESET'));
    socket.on('close', () => sockets.delete(socket));
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    connected(request.url!);
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  vi.stubEnv('https_proxy', `http://127.0.0.1:${(proxy.address() as net.AddressInfo).port}`);
  vi.stubEnv('no_proxy', '');
  vi.stubEnv('NO_PROXY', '');
  try {
    const pending = prepareProductDelivery('https://collector.invalid/v1/summaries');
    expect(await tunnel).toBe('collector.invalid:443');
    abortProductDelivery();
    expect(await pending).toBeUndefined();
  } finally {
    abortProductDelivery();
    vi.unstubAllEnvs();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
}, 15000);

it('honors no_proxy instead of sending a bypassed request through http_proxy', async () => {
  let received!: () => void;
  const incoming = new Promise<void>((resolve) => {
    received = resolve;
  });
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.end();
      received();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  vi.stubEnv('http_proxy', 'http://unreachable.invalid:1');
  vi.stubEnv('no_proxy', '127.0.0.1');
  let delivery: Awaited<ReturnType<typeof prepareProductDelivery>>;
  try {
    delivery = await prepareProductDelivery(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
    expect(delivery?.isReady()).toBe(true);
    delivery!.dispatch('synthetic');
    await incoming;
  } finally {
    delivery?.cancel();
    vi.unstubAllEnvs();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 15000);

it('keeps the durable queue and exits while a sender is still connecting', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'product-preparation-'));
  const script = path.join(directory, 'sender.mjs');
  const state = path.join(directory, 'state');
  await build({
    stdin: {
      contents: `
import { InstallationStore } from './src/productTelemetry/installationStore.ts';
import { abortProductDelivery, prepareProductDelivery } from './src/productTelemetry/delivery.ts';
const store = new InstallationStore(process.argv[2], { notice: () => {} });
const ticket = await store.admit();
await store.append(ticket, { occurred_at: new Date().toISOString().replace(/\\.\\d{3}Z$/, 'Z'), version: '0.40.0', os: 'darwin', arch: 'arm64', node_major: 24, ci: false, counters: [{ kind: 'command', name: 'inspect', outcome: 'success', transport: 'none', client: 'none', bucket: 'none', count: 1 }] });
process.on('message', () => process.disconnect());
void store.attemptSend(ticket, () => { throw new Error('unexpected fallback'); }, () => prepareProductDelivery(process.argv[3]));
`,
      resolveDir: process.cwd(),
    },
    define: { 'import.meta.url': JSON.stringify(new URL('./delivery.ts', import.meta.url).href) },
    outfile: script,
    bundle: true,
    platform: 'node',
    format: 'esm',
  });
  let connected!: () => void;
  const connection = new Promise<void>((resolve) => {
    connected = resolve;
  });
  const sockets = new Set<Duplex>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('error', (error) => expect(error).toHaveProperty('code', 'ECONNRESET'));
    socket.once('close', () => sockets.delete(socket));
    connected();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  let child: ChildProcess | undefined;
  let guard: ReturnType<typeof setTimeout> | undefined;
  try {
    const env = createTestProcessEnvironment();
    env.no_proxy = '127.0.0.1';
    env.NO_PROXY = '127.0.0.1';
    child = fork(script, [state, `https://127.0.0.1:${(server.address() as net.AddressInfo).port}`], {
      env,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    const exited = new Promise<number | null>((resolve) => child!.once('exit', resolve));
    const timeout = new Promise<never>((_resolve, reject) => {
      guard = setTimeout(() => reject(new Error('sender preparation held foreground open')), 5000);
    });
    await Promise.race([connection, timeout]);
    child.send('foreground-finished');
    expect(await Promise.race([exited, timeout])).toBe(0);
    const saved = JSON.parse(await readFile(path.join(state, 'state.json'), 'utf8'));
    expect(saved.queue).toHaveLength(1);
    expect(saved.queue[0].counters[0]).toMatchObject({ name: 'inspect', count: 1 });
  } finally {
    clearTimeout(guard);
    child?.kill('SIGKILL');
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 10000);
