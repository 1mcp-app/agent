#!/usr/bin/env node
// Manual real-backend acceptance. Build first; installed executables only.
// node scripts/verify-configured-preparation.mjs ABS_CODEGRAPH ABS_CRG ABS_REPORT_DIRECTORY
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { PreparationAdapterRegistry } from '../build/domains/backend-preparation/adapterRegistry.js';
import { ConfiguredCommandPreparationAdapter } from '../build/domains/backend-preparation/configuredCommandAdapter.js';
import { BackendPreparationService } from '../build/domains/backend-preparation/service.js';

const run = promisify(execFile);
const [codegraph, crg, directory] = process.argv.slice(2);
for (const argument of [codegraph, crg, directory])
  assert(argument && path.isAbsolute(argument), 'Absolute arguments required');
await mkdir(directory, { recursive: true });
const fixture = await realpath(await mkdtemp(path.join(directory, 'configured-acceptance-')));
const wrapper = fileURLToPath(new URL('../examples/backend-preparation/native-fixture-command.mjs', import.meta.url));
const report = {
  startedAt: new Date().toISOString(),
  platform: `${process.platform}-${process.arch}`,
  node: process.version,
  nodeExecutable: process.execPath,
  fixture,
  cpuCount: os.availableParallelism(),
  totalMemoryBytes: os.totalmem(),
  freeMemoryBytes: os.freemem(),
  sourceFilesPerCheckout: 1,
  sourceBytesPerCheckout: 0,
  results: [],
  backends: {},
  gaps: [
    'Manifest coverage is limited to the explicit fixture sources, not arbitrary repositories.',
    'These small disposable repositories do not establish production-scale performance.',
    'This script covers the shared adapter/service; HTTP capability refresh and supported client hooks have separate acceptance gates.',
    'Owned process cancellation is covered by configured-command containment tests, not long-running native builds in this script.',
    'Native child peak CPU/memory measurements are unavailable; host CPU/memory observations are recorded.',
  ],
};
const repos = {};
async function git(root, ...args) {
  return run('git', ['-C', root, ...args]);
}
async function source(root, symbol) {
  const text = `export function ${symbol}(value: number): number { return value + 576; }\n`;
  await writeFile(path.join(root, 'probe.ts'), text);
  await mkdir(path.join(root, '.preparation-example'), { recursive: true });
  await writeFile(
    path.join(root, '.preparation-example', 'sources.json'),
    JSON.stringify([{ file: 'probe.ts', symbol }]),
  );
  report.sourceBytesPerCheckout = Buffer.byteLength(text);
}
async function check(label, action) {
  const started = performance.now();
  try {
    await action();
    report.results.push({ label, passed: true, elapsedMs: performance.now() - started });
  } catch (error) {
    report.results.push({ label, passed: false, error: String(error), elapsedMs: performance.now() - started });
    throw error;
  }
}
async function finish(service, result) {
  assert.equal(result.state, 'job');
  const deadline = performance.now() + 120000;
  let status;
  do {
    status = await service.wait(result.status.id, { waitMs: 1000 });
    assert(status, 'Job remains observable');
    if (performance.now() > deadline) throw new Error('Default deadline exceeded: ' + JSON.stringify(status));
  } while (['queued', 'running', 'cancelling'].includes(status.state));
  assert.equal(status.state, 'ready', JSON.stringify(status));
  return status;
}
try {
  for (const name of ['main', 'independent']) {
    const root = path.join(fixture, name + ' checkout ;literal');
    await mkdir(root);
    await git(root, 'init', '-q');
    await source(root, name + 'Unique576');
    await writeFile(path.join(root, '.gitignore'), '.codegraph/\n.code-review-graph/\n.preparation-example/\n');
    await git(root, 'add', '.');
    await git(
      root,
      '-c',
      'user.name=Acceptance',
      '-c',
      'user.email=acceptance@example.invalid',
      'commit',
      '-qm',
      'fixture',
    );
    repos[name] = root;
  }
  repos.linked = path.join(fixture, 'linked checkout $literal');
  await git(repos.main, 'worktree', 'add', '--detach', repos.linked);
  await source(repos.main, 'mainDirtyUnique576');
  await source(repos.linked, 'linkedDirtyUnique576');
  for (const [backend, executable] of [
    ['codegraph', codegraph],
    ['code-review-graph', crg],
  ]) {
    report.backends[backend] = {
      version: (await run(executable, ['--version'])).stdout.trim(),
      jobs: [],
      warmProbeMs: [],
    };
    const command = (action) => ({
      executable: process.execPath,
      args: [wrapper, backend, executable, action, '{checkout}'],
    });
    const adapter = new ConfiguredCommandPreparationAdapter({
      probe: command('probe'),
      actions: { initialize: command('initialize'), sync: command('sync') },
      readinessExitCodes: {
        0: { state: 'ready' },
        10: { state: 'required', action: 'initialize', instructions: 'Initialize fixture index' },
        11: { state: 'required', action: 'sync', instructions: 'Synchronize changed manifest source' },
        12: { state: 'conflict', instructions: 'Native/example writer ownership unresolved; do not break lock' },
      },
      containment: 'posix-process-group',
      inspectionTimeoutMs: 5000,
    });
    const registry = new PreparationAdapterRegistry();
    registry.register(backend, adapter);
    const service = new BackendPreparationService(registry);
    const policy = { allowedActions: ['initialize', 'sync'] };
    try {
      for (const [label, root] of Object.entries(repos)) {
        const target = {
          checkoutRoot: root,
          backendName: backend,
          backendIdentity: backend + ':' + root,
          configurationKey: 'fixture-v1',
        };
        await check(backend + ':' + label + ':cold-and-deduplicated', async () => {
          assert.equal((await service.inspect(target, 'query')).state, 'required');
          const before = performance.now();
          const first = await service.prepare(target, 'query', policy);
          report.backends[backend].jobs.push({
            id: first.status?.id,
            admissionMs: performance.now() - before,
            checkout: root,
          });
          const second = await service.prepare(target, 'query', policy);
          assert.equal(first.status.id, second.status.id);
          await finish(service, first);
          assert.equal((await service.inspect(target, 'query')).state, 'ready');
          report.backends[backend].jobs.at(-1).sourceEvidence = JSON.parse(
            await readFile(path.join(root, '.preparation-example', backend + '.json'), 'utf8'),
          ).evidence;
        });
        await check(backend + ':' + label + ':warm-read-only', async () => {
          const receipt = path.join(root, '.preparation-example', backend + '.json');
          const before = await readFile(receipt, 'utf8');
          const database = path.join(
            root,
            backend === 'codegraph' ? '.codegraph/codegraph.db' : '.code-review-graph/graph.db',
          );
          const databaseBefore = await readFile(database);
          for (let index = 0; index < 3; index++) {
            const started = performance.now();
            assert.equal((await service.inspect(target, 'query')).state, 'ready');
            report.backends[backend].warmProbeMs.push(performance.now() - started);
          }
          assert.equal(await readFile(receipt, 'utf8'), before);
          assert.deepEqual(
            await readFile(database),
            databaseBefore,
            'Warm inspection must preserve native database bytes',
          );
        });
        await check(backend + ':' + label + ':dirty-incremental-update', async () => {
          await source(root, backend.replaceAll('-', '') + label + 'ChangedUnique576');
          const inspected = await service.inspect(target, 'query');
          assert.equal(inspected.state, 'required');
          assert.equal(inspected.action, 'sync');
          const job = await service.prepare(target, 'query', policy);
          await finish(service, job);
          report.backends[backend].jobs.push({
            id: job.status.id,
            action: 'sync',
            checkout: root,
            sourceEvidence: JSON.parse(
              await readFile(path.join(root, '.preparation-example', backend + '.json'), 'utf8'),
            ).evidence,
          });
        });
        await check(backend + ':' + label + ':foreign-lock-preserved', async () => {
          const lock = path.join(root, '.preparation-example', 'writer');
          await mkdir(lock);
          const foreign = JSON.stringify({ pid: process.pid, foreign: true });
          await writeFile(path.join(lock, 'owner.json'), foreign);
          assert.equal((await service.inspect(target, 'query')).state, 'conflict');
          assert.equal((await service.prepare(target, 'query', policy)).state, 'conflict');
          assert.equal(await readFile(path.join(lock, 'owner.json'), 'utf8'), foreign);
          await rm(lock, { recursive: true }); // Test-owned marker only.
        });
      }
    } finally {
      await service.shutdown();
    }
  }
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(directory, 'configured-preparation-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
