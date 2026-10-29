import { type ChildProcess, fork } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { build } from 'esbuild';
import { expect, it } from 'vitest';

import { createTestProcessEnvironment } from '../../scripts/test-process-environment.mjs';

it('exits while an actually connected one-shot telemetry request is stalled', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'product-delivery-'));
  const script = path.join(directory, 'sender.mjs');
  await build({
    stdin: {
      contents: `import { dispatchProductBatch } from './src/productTelemetry/delivery.ts'; const schedule = globalThis.setTimeout; globalThis.setTimeout = (fn, ms, ...args) => schedule(() => { if (ms === 10000) process.stdout.write('deadline-fired'); fn(...args); }, ms); dispatchProductBatch('{}', process.argv[2]); process.on('message', () => process.disconnect());`,
      resolveDir: process.cwd(),
    },
    define: { 'import.meta.url': JSON.stringify(new URL('./delivery.ts', import.meta.url).href) },
    outfile: script,
    bundle: true,
    platform: 'node',
    format: 'esm',
  });
  let child: ChildProcess | undefined;
  let output = '';
  let received!: () => void;
  const incoming = new Promise<void>((resolve) => {
    received = resolve;
  });
  const sockets = new Set<import('node:net').Socket>();
  const server = http.createServer((_request, _response) => {
    received();
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as import('node:net').AddressInfo;
  try {
    child = fork(script, [`http://127.0.0.1:${address.port}/controlled`], {
      env: createTestProcessEnvironment({
        no_proxy: '127.0.0.1,controlled.invalid',
        NO_PROXY: '127.0.0.1,controlled.invalid',
      }),
      stdio: ['ignore', 'pipe', 'ignore', 'ipc'],
    });
    child.stdout!.on('data', (chunk) => {
      output += String(chunk);
    });
    const exited = new Promise<number | null>((resolve) => child!.once('exit', (code) => resolve(code)));
    const hangGuard = new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('stalled sender held process open')), 5000);
      timer.unref();
    });
    await Promise.race([incoming, hangGuard]);
    child.send('receiver-is-stalled');
    expect(await Promise.race([exited, hangGuard])).toBe(0);
    expect(output).toBe('');
  } finally {
    child?.kill('SIGKILL');
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 10000);

it('exits during an actually connected stalled TLS handshake', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'product-tls-'));
  const script = path.join(directory, 'sender.mjs');
  await build({
    stdin: {
      contents: `import { dispatchProductBatch } from './src/productTelemetry/delivery.ts'; const schedule = globalThis.setTimeout; globalThis.setTimeout = (fn, ms, ...args) => schedule(() => { if (ms === 10000) process.stdout.write('deadline-fired'); fn(...args); }, ms); dispatchProductBatch('{}', process.argv[2]); process.on('message', () => process.disconnect());`,
      resolveDir: process.cwd(),
    },
    define: { 'import.meta.url': JSON.stringify(new URL('./delivery.ts', import.meta.url).href) },
    outfile: script,
    bundle: true,
    platform: 'node',
    format: 'esm',
  });
  let child: ChildProcess | undefined;
  let output = '';
  let connected!: () => void;
  const connection = new Promise<void>((resolve) => {
    connected = resolve;
  });
  const sockets = new Set<import('node:net').Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    connected();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as import('node:net').AddressInfo;
  try {
    child = fork(script, [`https://127.0.0.1:${address.port}/controlled`], {
      env: createTestProcessEnvironment({
        no_proxy: '127.0.0.1,controlled.invalid',
        NO_PROXY: '127.0.0.1,controlled.invalid',
      }),
      stdio: ['ignore', 'pipe', 'ignore', 'ipc'],
    });
    child.stdout!.on('data', (chunk) => {
      output += String(chunk);
    });
    const exited = new Promise<number | null>((resolve) => child!.once('exit', (code) => resolve(code)));
    const hangGuard = new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('stalled TLS held process open')), 5000);
      timer.unref();
    });
    await Promise.race([connection, hangGuard]);
    child.send('tls-is-stalled');
    expect(await Promise.race([exited, hangGuard])).toBe(0);
    expect(output).toBe('');
  } finally {
    child?.kill('SIGKILL');
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 10000);

it('exits before any deadline while an isolated DNS lookup owns a referenced asynchronous handle', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'product-dns-'));
  const script = path.join(directory, 'sender.mjs');
  await build({
    stdin: {
      contents: `
import dns from 'node:dns';
import workers from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { dispatchProductBatch } from './src/productTelemetry/delivery.ts';
// A controlled resolver with a referenced pending handle models native lookup retention.
dns.lookup = () => { process.send('dns-waiting'); setTimeout(() => {}, 60000); };
const OriginalWorker = workers.Worker;
workers.Worker = class extends OriginalWorker {
 constructor(source, options) {
  super("require('node:dns').lookup = () => { require('node:worker_threads').parentPort.postMessage('dns-waiting'); setTimeout(() => {}, 60000); };" + source, options);
  this.on('message', message => { if (message === 'dns-waiting') process.send(message); });
 }
};
syncBuiltinESMExports();
const schedule = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...args) => schedule(() => { if (ms === 10000) process.stdout.write('deadline-fired'); fn(...args); }, ms);
process.env.no_proxy = 'controlled.invalid';
dispatchProductBatch('{}', 'https://controlled.invalid/v1/summaries');
process.on('message', () => process.disconnect());
`,
      resolveDir: process.cwd(),
    },
    define: { 'import.meta.url': JSON.stringify(new URL('./delivery.ts', import.meta.url).href) },
    outfile: script,
    bundle: true,
    platform: 'node',
    format: 'esm',
  });
  let child: ChildProcess | undefined;
  let output = '';
  try {
    child = fork(script, [], {
      env: createTestProcessEnvironment({
        no_proxy: '127.0.0.1,controlled.invalid',
        NO_PROXY: '127.0.0.1,controlled.invalid',
      }),
      stdio: ['ignore', 'pipe', 'ignore', 'ipc'],
    });
    child.stdout!.on('data', (chunk) => {
      output += String(chunk);
    });
    const exited = new Promise<number | null>((resolve) => child!.once('exit', (code) => resolve(code)));
    const waiting = new Promise<void>((resolve) => child!.once('message', () => resolve()));
    const hangGuard = new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('pending DNS held process open')), 5000);
      timer.unref();
    });
    await Promise.race([waiting, hangGuard]);
    child.send('foreground-finished');
    expect(await Promise.race([exited, hangGuard])).toBe(0);
    expect(output).toBe('');
  } finally {
    child?.kill('SIGKILL');
    await rm(directory, { recursive: true, force: true });
  }
}, 10000);
