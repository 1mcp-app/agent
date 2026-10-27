#!/usr/bin/env node
/** Synthetic Node/SEA delivery acceptance. Fixed facts, controlled loopback/resolver only. */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { build } from 'esbuild';

import { createTestProcessEnvironment } from './test-process-environment.mjs';

assert.equal(Number(process.versions.node.split('.')[0]), 24, 'Use repository Node 24');
const execute = promisify(execFile);
const agent = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(os.tmpdir(), 'product-synthetic-sea-'));
const output = process.argv.includes('--out')
  ? path.resolve(process.argv[process.argv.indexOf('--out') + 1])
  : undefined;
const source = `
import dns from 'node:dns';
import workers from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { dispatchProductBatch } from './src/productTelemetry/delivery.ts';
const mode = process.argv.find(arg => arg === 'dns');
if (mode) {
  dns.lookup = () => { process.send('dns-waiting'); setTimeout(() => {}, 60000); };
  const OriginalWorker = workers.Worker;
  workers.Worker = class extends OriginalWorker {
    constructor(source, options) {
      super("require('node:dns').lookup = () => { require('node:worker_threads').parentPort.postMessage('dns-waiting'); setTimeout(() => {}, 60000); };" + source, options);
      this.on('message', message => { if (message === 'dns-waiting') process.send(message); });
    }
  };
  syncBuiltinESMExports();
}
const schedule = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...args) => schedule(() => { if (ms === 1500) process.stdout.write('deadline-fired'); fn(...args); }, ms);
dispatchProductBatch('{}', process.argv.find(arg => arg.startsWith('http')));
process.on('message', () => process.disconnect());
`;
const entry = path.join(directory, 'synthetic.cjs');
await build({
  stdin: { contents: source, resolveDir: agent },
  outfile: entry,
  bundle: true,
  platform: 'node',
  format: 'cjs',
});
const binaries = [{ name: 'node', executable: process.execPath, prefix: [entry] }];
const environment = createTestProcessEnvironment();
try {
  if (process.argv.includes('--sea')) {
    const blob = path.join(directory, 'synthetic.blob');
    const config = path.join(directory, 'sea.json');
    await writeFile(
      config,
      JSON.stringify({
        main: entry,
        output: blob,
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: false,
      }),
      { mode: 0o600 },
    );
    await execute(process.execPath, ['--experimental-sea-config', config], { env: environment });
    const binary = path.join(directory, process.platform === 'win32' ? 'synthetic.exe' : 'synthetic');
    await copyFile(process.execPath, binary);
    await chmod(binary, 0o700);
    if (process.platform === 'darwin') await execute('codesign', ['--remove-signature', binary], { env: environment });
    const postject = path.join(agent, 'node_modules/postject/dist/cli.js');
    const args = [
      postject,
      binary,
      'NODE_SEA_BLOB',
      blob,
      '--sentinel-fuse',
      'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    ];
    if (process.platform === 'darwin') args.push('--macho-segment-name', 'NODE_SEA');
    await execute(process.execPath, args, { env: environment });
    if (process.platform === 'darwin')
      await execute('codesign', ['--sign', '-', '--entitlements', path.join(agent, 'entitlements.plist'), binary], {
        env: environment,
      });
    binaries.push({ name: 'sea', executable: binary, prefix: [] });
  }
  const results = [];
  for (const binary of binaries)
    for (const mode of ['http', 'tls', 'dns']) {
      const sockets = new Set();
      let observe;
      const observed = new Promise((resolve) => {
        observe = resolve;
      });
      const server = mode === 'http' ? http.createServer(() => observe()) : net.createServer(() => observe());
      server.on('connection', (socket) => {
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = server.address().port;
      const endpoint =
        mode === 'dns'
          ? 'https://controlled.invalid/v1/summaries'
          : `${mode === 'tls' ? 'https' : 'http'}://127.0.0.1:${port}/controlled`;
      let child;
      let timeout;
      try {
        child = spawn(binary.executable, [...binary.prefix, endpoint, ...(mode === 'dns' ? ['dns'] : [])], {
          env: environment,
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (data) => {
          stdout += data;
        });
        child.stderr.on('data', (data) => {
          stderr += data;
        });
        const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
        child.on('message', (message) => {
          if (message === 'dns-waiting') observe();
        });
        const guard = new Promise((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(new Error(`${binary.name}/${mode} retained foreground process; stderr: ${stderr.slice(0, 400)}`)),
            10000,
          );
        });
        await Promise.race([observed, guard]);
        child.send('foreground-complete');
        const exit = await Promise.race([exited, guard]);
        assert.equal(exit.code, 0);
        assert.equal(stdout, '', 'Foreground must exit without waiting for background deadline');
        results.push({ artifact: binary.name, mode, exitCode: exit.code, backgroundDeadlineFired: false });
      } finally {
        clearTimeout(timeout);
        child?.kill('SIGKILL');
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve) => server.close(resolve));
      }
    }
  const evidence = {
    platform: process.platform,
    arch: process.arch,
    node: process.versions.node,
    deliverySourceSha256: createHash('sha256')
      .update(await readFile(path.join(agent, 'src/productTelemetry/delivery.ts')))
      .digest('hex'),
    results,
  };
  if (output) await writeFile(output, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(evidence));
} finally {
  await rm(directory, { recursive: true, force: true });
}
