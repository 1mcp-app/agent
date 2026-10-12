#!/usr/bin/env node
// External, intentionally narrow acceptance integration. This is not a universal
// readiness adapter: coverage is only the explicitly listed fixture sources.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createRequire } from 'node:module';

const run = promisify(execFile);
const [backend, executable, action, checkout] = process.argv.slice(2);
const root = await realpath(checkout);
const state = path.join(root, '.preparation-example');
const lock = path.join(state, 'writer');
const receiptPath = path.join(state, backend + '.json');
const env = { ...process.env, CODEGRAPH_NO_DAEMON: '1', CODEGRAPH_NO_DOWNLOAD: '1', CODEGRAPH_TELEMETRY: '0' };
const manifest = JSON.parse(await readFile(path.join(state, 'sources.json'), 'utf8'));
if (!['codegraph', 'code-review-graph'].includes(backend)) throw new Error('Unknown example backend');
if (!Array.isArray(manifest) || manifest.length < 1 || manifest.length > 64)
  throw new Error('Bounded manifest required');

async function codegraphReadOnly(mode, symbol) {
  const resolved = await realpath(executable);
  const bundle =
    path.basename(resolved) === 'npm-shim.js'
      ? path.dirname(
          createRequire(resolved).resolve(`@colbymchenry/codegraph-${process.platform}-${process.arch}/package.json`),
        )
      : path.dirname(path.dirname(resolved));
  return run(
    path.join(bundle, 'node'),
    [
      '--disable-warning=ExperimentalWarning',
      fileURLToPath(new URL('./codegraph-fixture-readonly.mjs', import.meta.url)),
      path.join(bundle, 'lib', 'dist'),
      mode,
      root,
      ...(symbol ? [symbol] : []),
    ],
    { cwd: root, env, timeout: 5000, maxBuffer: 1048576 },
  );
}

async function fingerprint() {
  const hash = createHash('sha256');
  for (const { file, symbol } of manifest) {
    const sourcePath = path.resolve(root, file);
    if (!sourcePath.startsWith(root + path.sep)) throw new Error('Source escapes checkout');
    if (!(await realpath(sourcePath)).startsWith(root + path.sep)) throw new Error('Source symlink escapes checkout');
    if (typeof symbol !== 'string' || !symbol.length) throw new Error('Source symbol required');
    const source = await readFile(sourcePath);
    if (source.length > 65536) throw new Error('Fixture source exceeds coverage bound');
    hash.update(file).update(source).update(symbol);
  }
  return hash.digest('hex');
}
async function native(args) {
  return run(executable, args, { cwd: root, env, timeout: 110000, maxBuffer: 1048576 });
}
async function initialized() {
  if (backend === 'codegraph') {
    const { stdout } = await codegraphReadOnly('status');
    const status = JSON.parse(stdout);
    if (status.initialized === false) return false;
    if (status.initialized !== true || status.state !== 'complete' || status.stale)
      throw new Error('Native index state unknown/incomplete');
    if ((await realpath(path.join(root, '.codegraph'))) !== path.join(root, '.codegraph'))
      throw new Error('Shared/foreign index path');
    return true;
  }
  let stdout;
  try {
    ({ stdout } = await native(['status', '--repo', root, '--json']));
  } catch (error) {
    if (
      error.code === 1 &&
      error.stderr?.startsWith(`No graph found at ${path.join(root, '.code-review-graph', 'graph.db')}.`)
    )
      return false;
    throw error;
  }
  // CRG status has no exit-code readiness contract; the external wrapper owns
  // translation. Missing graphs may print a human diagnostic with exit zero.
  if (stdout.startsWith('No graph found at ')) return false;
  const status = JSON.parse(stdout);
  if (!(status.nodes > 0) || status.build_incomplete !== false)
    throw new Error('Native graph state unknown/incomplete');
  return true;
}
async function sourceEvidence() {
  const evidence = [];
  for (const { file, symbol } of manifest) {
    const { stdout } =
      backend === 'codegraph'
        ? await codegraphReadOnly('query', symbol)
        : await native(['search', symbol, '--repo', root, '--limit', '10']);
    const result = JSON.parse(stdout);
    const matched =
      backend === 'codegraph'
        ? Array.isArray(result) && result.some(({ node }) => node.name === symbol && node.filePath === file)
        : result.results?.some((node) => node.name === symbol && node.file_path === path.join(root, file));
    if (!matched) throw new Error('Native query missing checkout-specific symbol/root: ' + symbol);
    evidence.push({ symbol, result: stdout.slice(0, 32768) });
  }
  return evidence;
}
async function probe() {
  if (backend === 'codegraph') {
    try {
      await readFile(path.join(root, '.codegraph', 'writer.pid'));
      return 12;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  try {
    await readFile(path.join(lock, 'owner.json'));
    return 12;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  // Directory existence also blocks a crashed writer before its owner record.
  try {
    await realpath(lock);
    return 12;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  let receipt;
  try {
    receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  } catch {
    return (await initialized()) ? 13 : 10;
  }
  if (receipt.checkout !== root || receipt.coverage !== 'explicit-manifest') return 13;
  if (receipt.fingerprint !== (await fingerprint())) return 11;
  if (!(await initialized())) return 13;
  await sourceEvidence();
  return 0;
}

if (action === 'probe') {
  const exit = await probe();
  console.log(JSON.stringify({ coverage: 'explicit-manifest', sourceFiles: manifest.length, exit }));
  process.exitCode = exit;
} else {
  if (!['initialize', 'sync'].includes(action)) throw new Error('Unsupported action');
  await mkdir(lock); // Exclusive integration-owned writer admission, never repair foreign locks.
  try {
    await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, backend }));
    const before = await fingerprint();
    const args =
      backend === 'codegraph'
        ? action === 'initialize'
          ? ['init', root, '--yes']
          : ['sync', root]
        : [action === 'initialize' ? 'build' : 'update', '--repo', root];
    await native(args);
    if (!(await initialized())) throw new Error('Native status still not initialized after action');
    const evidence = await sourceEvidence();
    if (before !== (await fingerprint())) throw new Error('Source changed during action; explicit retry required');
    await writeFile(
      receiptPath,
      JSON.stringify({ checkout: root, fingerprint: before, coverage: 'explicit-manifest', evidence }),
    );
  } finally {
    await rm(lock, { recursive: true }); // Only this invocation created this lock.
  }
}
