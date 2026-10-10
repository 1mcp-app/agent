#!/usr/bin/env node
// Manual acceptance against an installed 1.6.2 backend. Build first; no npx,
// downloads, dependency installs, hook installation or foreign lock repair.
// Usage: node scripts/verify-codegraph-preparation.mjs /absolute/codegraph /absolute/report-directory
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';

import { CodeGraphPreparationAdapter } from '../build/domains/backend-preparation/codegraphAdapter.js';
import { codeGraphEnvironment } from '../build/domains/backend-preparation/codegraphEnvironment.js';
import { resolveCodeGraphInstallation } from '../build/domains/backend-preparation/codegraphInstallation.js';
import { CodeGraphJournal } from '../build/domains/backend-preparation/codegraphJournal.js';
import { runCodeGraphWorker } from '../build/domains/backend-preparation/codegraphProcess.js';
import { getCodeGraphPreparationToolDefinition } from '../build/domains/backend-preparation/codegraphReadOnly.js';

const run = promisify(execFile);
const [executable, reportDirectory] = process.argv.slice(2);
assert(executable && path.isAbsolute(executable), 'Pass the absolute installed CodeGraph executable.');
assert(reportDirectory && path.isAbsolute(reportDirectory), 'Pass an absolute report directory.');
await mkdir(reportDirectory, { recursive: true });
const fixture = await realpath(await mkdtemp(path.join(reportDirectory, 'codegraph-acceptance-')));
const installation = await resolveCodeGraphInstallation(executable);
const adapter = new CodeGraphPreparationAdapter({ executable, sourceMonitor: 'git-fsmonitor' });
const env = {
  ...codeGraphEnvironment(),
  CODEGRAPH_TELEMETRY: '0',
  CODEGRAPH_NO_DAEMON: '1',
  CODEGRAPH_NO_DOWNLOAD: '1',
  CODEGRAPH_DIR: '.codegraph',
  GIT_OPTIONAL_LOCKS: '0',
};
const report = {
  backendVersion: installation.version,
  platform: `${process.platform}-${process.arch}`,
  fixture,
  cpuCount: os.availableParallelism(),
  totalMemoryBytes: os.totalmem(),
  freeMemoryBytes: os.freemem(),
  sourceWrites: 0,
  sourceBytesWritten: 0,
  results: [],
  timings: {},
  acceptanceGaps: [
    'Runtime capability-catalog refresh and scheduling responsiveness require the integrated runtime acceptance tests.',
    'Cold timings cover these small disposable repositories, not a production-scale repository.',
    'Verified native Git journal support covers Darwin with installed Git2.52.0; Linux and Windows remain unsupported.',
  ],
};

function target(root) {
  return { checkoutRoot: root, backendName: 'codegraph', backendIdentity: 'acceptance-native', configurationKey: 'v1' };
}
async function checked(label, execute) {
  const before = performance.now();
  await execute();
  report.timings[label] = performance.now() - before;
  report.results.push({ label, passed: true });
}
async function source(root, symbol) {
  await mkdir(path.join(root, 'src'), { recursive: true });
  const content = `export function ${symbol}(value: number): number { return value + 1; }\n`;
  await writeFile(path.join(root, 'src', 'probe.ts'), content);
  report.sourceWrites += 1;
  report.sourceBytesWritten += Buffer.byteLength(content);
}
async function git(root, ...args) {
  return run('git', ['-C', root, ...args], { env });
}
async function query(root, symbol) {
  const { stdout } = await run(
    installation.nodeExecutable,
    [
      '--liftoff-only',
      '--disable-warning=ExperimentalWarning',
      path.join(installation.libraryRoot, 'bin/codegraph.js'),
      'query',
      '--json',
      '--path',
      root,
      symbol,
    ],
    { env, maxBuffer: 1_048_576 },
  );
  assert(stdout.includes(symbol), `Expected ${symbol} from ${root}.`);
  return stdout;
}
async function metadata(root, key, value) {
  const code = `const sdk=require(${JSON.stringify(path.join(installation.libraryRoot, 'index.js'))});const root=${JSON.stringify(root)};const db=sdk.DatabaseConnection.open(sdk.getDatabasePath(root));new sdk.QueryBuilder(db.getDb()).setMetadata(${JSON.stringify(key)},${JSON.stringify(value)});db.close();`;
  await run(installation.nodeExecutable, ['--disable-warning=ExperimentalWarning', '-e', code], { env });
}

async function waitForWriter(root) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      return JSON.parse(await readFile(path.join(root, '.codegraph', 'writer.pid'), 'utf8')).pid;
    } catch {
      // The owned writer may not have published its marker yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Owned native writer did not start.');
}
async function countedSource(root) {
  let files = 0,
    bytes = 0;
  for (const entry of await readdir(path.join(root, 'src'))) {
    const buffer = await readFile(path.join(root, 'src', entry));
    files += 1;
    bytes += buffer.length;
  }
  return { files, bytes };
}

async function readOnlySession(root) {
  const entry = path.resolve('build/domains/backend-preparation/codegraphReadOnly.js');
  const code = `import {runCodeGraphReadOnlyServer} from ${JSON.stringify('file://' + entry)}; await runCodeGraphReadOnlyServer(${JSON.stringify({ executable, checkoutPath: root })});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = new Promise((resolve) => child.once('close', resolve));
  let buffer = '',
    diagnostics = '',
    sequence = 0;
  const waiting = new Map();
  child.stderr.on('data', (data) => {
    diagnostics = (diagnostics + data).slice(-8192);
  });
  child.stdout.on('data', (data) => {
    buffer += data;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        for (const request of waiting.values()) request.reject(new Error('Non-protocol stdout: ' + line));
        continue;
      }
      const request = waiting.get(message.id);
      if (request) {
        waiting.delete(message.id);
        clearTimeout(request.timer);
        request.resolve(message);
      }
    }
  });
  function request(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error('Readonly MCP timeout: ' + diagnostics));
      }, 10000);
      waiting.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  return {
    child,
    request,
    async close() {
      child.stdin.end();
      const force = setTimeout(() => child.kill('SIGKILL'), 2000);
      await exited;
      clearTimeout(force);
    },
  };
}

try {
  const main = path.join(fixture, 'main');
  await mkdir(main);
  await source(main, 'AcceptanceMainUnique');
  await git(main, 'init', '-q');
  await git(main, 'add', 'src');
  await git(
    main,
    '-c',
    'user.name=CodeGraph Acceptance',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-qm',
    'Fixture',
  );
  await checked('native-tool-metadata-without-index-side-effects', async () => {
    const content = await readFile(path.join(main, 'src', 'probe.ts'));
    const definition = await getCodeGraphPreparationToolDefinition(
      { executable, toolName: 'codegraph_explore' },
      { executionDeadlineMs: 5_000 },
    );
    assert.equal(definition.name, 'codegraph_explore');
    assert(definition.inputSchema.required.includes('query'));
    assert(
      !definition.inputSchema.required.includes('projectPath'),
      'Configured checkout supplies the default project context.',
    );
    assert.equal(await getCodeGraphPreparationToolDefinition({ executable, toolName: 'not_a_native_tool' }), undefined);
    if (!env.CODEGRAPH_MCP_TOOLS)
      assert.equal(
        await getCodeGraphPreparationToolDefinition({ executable, toolName: 'codegraph_search' }),
        undefined,
      );
    await assert.rejects(access(path.join(main, '.codegraph')));
    await assert.rejects(access(path.join(main, '.gitignore')));
    assert.deepEqual(await readFile(path.join(main, 'src', 'probe.ts')), content);
  });
  await checked('cold-main', async () => {
    assert.equal((await adapter.inspect(target(main), 'codegraph_explore')).action, 'initialize');
    await adapter.prepare(target(main), 'initialize', {
      signal: new AbortController().signal,
      executionDeadlineMs: 120_000,
    });
    assert.equal((await adapter.inspect(target(main), 'codegraph_explore')).state, 'ready');
    await query(main, 'AcceptanceMainUnique');
  });
  await checked('cold-probe-never-runs-external-hook-or-writes-Git-index', async () => {
    const marker = path.join(fixture, 'foreign-hook-invoked');
    const hook = path.join(fixture, 'external-fsmonitor-hook');
    await writeFile(
      hook,
      `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)},'invoked');\n`,
      { mode: 0o700 },
    );
    await git(main, 'config', '--local', 'core.fsmonitor', hook);
    const before = await readFile(path.join(main, '.git', 'index'));
    assert.equal((await adapter.inspect(target(main), 'codegraph_explore')).state, 'ready');
    await assert.rejects(access(marker));
    assert.deepEqual(await readFile(path.join(main, '.git', 'index')), before);
    await git(main, 'config', '--local', '--unset', 'core.fsmonitor');
  });
  await checked('warm-20-inspections', async () => {
    // The native CLI query opens a writable handle and checkpoints SQLite,
    // changing DB/WAL bytes. Validate that new snapshot before measuring the
    // stable warm sequence; index mutations are intentionally not ignored.
    assert.equal((await adapter.inspect(target(main), 'codegraph_explore')).state, 'ready');
    const before = adapter.getMeasurements();
    for (let i = 0; i < 20; i += 1)
      assert.equal((await adapter.inspect(target(main), 'codegraph_explore')).state, 'ready');
    const after = adapter.getMeasurements();
    assert.equal(after.inspections, before.inspections, 'Warm checks must not full-scan the repository.');
    assert.equal(after.preparations, before.preparations, 'Warm checks must not enqueue indexing.');
  });
  await checked('dirty-incremental-sync', async () => {
    await source(main, 'AcceptanceDirtyUnique');
    assert.equal((await adapter.inspect(target(main), 'codegraph_explore')).action, 'sync');
    await adapter.prepare(target(main), 'sync', { signal: new AbortController().signal, executionDeadlineMs: 120_000 });
    assert.equal((await adapter.inspect(target(main), 'codegraph_explore')).state, 'ready');
    await query(main, 'AcceptanceDirtyUnique');
  });
  await checked('immediate-add-rename-delete', async () => {
    const added = path.join(main, 'src', 'new.ts');
    await writeFile(added, 'export function AcceptanceNewUnique() { return 3; }\n');
    assert.equal((await adapter.inspect(target(main), 'codegraph_explore')).action, 'sync');
    await adapter.prepare(target(main), 'sync', { signal: new AbortController().signal, executionDeadlineMs: 120_000 });
    assert.equal((await adapter.inspect(target(main), 'codegraph_explore')).state, 'ready');
    await rename(added, path.join(main, 'src', 'renamed.ts'));
    assert.equal((await adapter.inspect(target(main), 'codegraph_explore')).action, 'sync');
    await adapter.prepare(target(main), 'sync', { signal: new AbortController().signal, executionDeadlineMs: 120_000 });
    assert.equal((await adapter.inspect(target(main), 'codegraph_explore')).state, 'ready');
    await rm(path.join(main, 'src', 'renamed.ts'));
    assert.equal((await adapter.inspect(target(main), 'codegraph_explore')).action, 'sync');
    await adapter.prepare(target(main), 'sync', { signal: new AbortController().signal, executionDeadlineMs: 120_000 });
    assert.equal((await adapter.inspect(target(main), 'codegraph_explore')).state, 'ready');
  });
  const linked = path.join(fixture, 'linked');
  await git(main, 'worktree', 'add', '-qb', 'acceptance-linked', linked, 'HEAD');
  await source(linked, 'AcceptanceLinkedUnique');
  await checked('cold-linked-worktree', async () => {
    assert.equal((await adapter.inspect(target(linked), 'codegraph_explore')).action, 'initialize');
    await adapter.prepare(target(linked), 'initialize', {
      signal: new AbortController().signal,
      executionDeadlineMs: 120_000,
    });
    assert.equal((await adapter.inspect(target(linked), 'codegraph_explore')).state, 'ready');
    const linkedResult = await query(linked, 'AcceptanceLinkedUnique');
    assert(!linkedResult.includes('AcceptanceDirtyUnique'), 'Linked checkout must not reuse dirty main symbols.');
    await query(main, 'AcceptanceDirtyUnique');
  });
  const independent = path.join(fixture, 'independent');
  await mkdir(independent);
  await source(independent, 'AcceptanceIndependentUnique');
  await git(independent, 'init', '-q');
  await checked('cold-independent-repository', async () => {
    await adapter.prepare(target(independent), 'initialize', {
      signal: new AbortController().signal,
      executionDeadlineMs: 120_000,
    });
    assert.equal((await adapter.inspect(target(independent), 'codegraph_explore')).state, 'ready');
    await query(independent, 'AcceptanceIndependentUnique');
  });
  await checked('branch-change', async () => {
    await git(main, 'checkout', '-qb', 'acceptance-branch');
    await source(main, 'AcceptanceBranchUnique');
    assert.equal((await adapter.inspect(target(main), 'codegraph_explore')).action, 'sync');
    await adapter.prepare(target(main), 'sync', { signal: new AbortController().signal, executionDeadlineMs: 120_000 });
    assert.equal((await adapter.inspect(target(main), 'codegraph_explore')).state, 'ready');
    await query(main, 'AcceptanceBranchUnique');
  });
  await checked('interrupted-index-state', async () => {
    await metadata(independent, 'index_state', 'indexing');
    const readiness = await adapter.inspect(target(independent), 'codegraph_explore');
    assert.equal(readiness.action, 'rebuild');
    assert.equal(readiness.evidence.coverage, 'partial');
    await metadata(independent, 'index_state', 'complete');
  });
  await checked('foreign-ownership-preserved', async () => {
    const lock = path.join(independent, '.codegraph', 'writer.pid');
    const owner = JSON.stringify({ pid: process.pid, mode: 'foreign-fixture', startedAt: Date.now(), ready: false });
    await writeFile(lock, owner);
    assert.equal((await adapter.inspect(target(independent), 'codegraph_explore')).state, 'conflict');
    await assert.rejects(
      adapter.prepare(target(independent), 'sync', { signal: new AbortController().signal, executionDeadlineMs: 1000 }),
      { code: 'ownership_conflict' },
    );
    assert.equal(await readFile(lock, 'utf8'), owner);
  });
  await checked('native-readonly-session-before-and-after-preparation', async () => {
    const root = path.join(fixture, 'readonly');
    await mkdir(root);
    await source(root, 'AcceptanceReadonlyUnique');
    await git(root, 'init', '-q');
    const session = await readOnlySession(root);
    const foreignDatabase = await readFile(path.join(independent, '.codegraph', 'codegraph.db'));
    const foreignIgnore = await readFile(path.join(independent, '.gitignore')).catch(() => undefined);
    const foreignSource = await readFile(path.join(independent, 'src', 'probe.ts'));
    async function rejectForeignTarget() {
      const rejected = await session.request('tools/call', {
        name: 'codegraph_explore',
        arguments: { query: 'AcceptanceIndependentUnique', projectPath: independent },
      });
      assert.equal(rejected.result.isError, true);
      assert(JSON.stringify(rejected).includes('canonical configured checkout'));
      assert.deepEqual(await readFile(path.join(independent, '.codegraph', 'codegraph.db')), foreignDatabase);
      assert.deepEqual(await readFile(path.join(independent, '.gitignore')).catch(() => undefined), foreignIgnore);
      assert.deepEqual(await readFile(path.join(independent, 'src', 'probe.ts')), foreignSource);
    }
    try {
      assert.equal(
        (
          await session.request('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'acceptance', version: '1' },
          })
        ).result.serverInfo.name,
        'codegraph',
      );
      const initially = await session.request('tools/list');
      report.initialWrapperToolCount = initially.result.tools.length;
      assert.equal(
        initially.result.tools.length,
        0,
        'First-party readonly wrapper availability gate must be empty before preparation.',
      );
      await rejectForeignTarget();
      assert.equal(
        (
          await session.request('tools/call', {
            name: 'codegraph_explore',
            arguments: { query: 'AcceptanceReadonlyUnique' },
          })
        ).result.isError,
        true,
      );
      await assert.rejects(access(path.join(root, '.codegraph')));
      await adapter.prepare(target(root), 'initialize', {
        signal: new AbortController().signal,
        executionDeadlineMs: 120_000,
      });
      assert.equal((await adapter.inspect(target(root), 'codegraph_explore')).state, 'ready');
      const database = await readFile(path.join(root, '.codegraph', 'codegraph.db'));
      const ignore = await readFile(path.join(root, '.gitignore')).catch(() => undefined);
      assert((await session.request('tools/list')).result.tools.length > 0);
      const result = await session.request('tools/call', {
        name: 'codegraph_explore',
        arguments: { query: 'AcceptanceReadonlyUnique', projectPath: root },
      });
      assert(JSON.stringify(result).includes('AcceptanceReadonlyUnique'));
      await rejectForeignTarget();
      assert.deepEqual(await readFile(path.join(root, '.codegraph', 'codegraph.db')), database);
      assert.deepEqual(await readFile(path.join(root, '.gitignore')).catch(() => undefined), ignore);
      await assert.rejects(access(path.join(root, '.codegraph', 'writer.pid')));
      await assert.rejects(access(path.join(root, '.codegraph', 'rebuild.pid')));
      // execve preserves the supervisor PID. Native initialization and queries
      // remained in this exact foreground process, with no daemon/writer.
      report.readOnlySupervisorPid = session.child.pid;
    } finally {
      await session.close();
    }
  });
  await checked('borrowed-observer-survives-dispose', async () => {
    const borrower = new CodeGraphPreparationAdapter({ executable });
    assert.equal((await borrower.inspect(target(main), 'codegraph_explore')).state, 'ready');
    await borrower.dispose();
    assert.equal((await adapter.inspect(target(main), 'codegraph_explore')).state, 'ready');
  });
  await checked('native-FileLock-race-preserves-unknown-owner', async () => {
    const root = path.join(fixture, 'race');
    await mkdir(root);
    await source(root, 'AcceptanceRaceUnique');
    await git(root, 'init', '-q');
    const shim = path.join(fixture, 'race-sdk', 'lib', 'dist');
    await mkdir(path.join(shim, 'mcp'), { recursive: true });
    await mkdir(path.join(shim, 'extraction'));
    await writeFile(path.join(shim, '..', 'package.json'), JSON.stringify({ version: '1.6.2' }));
    for (const file of ['directory.js', 'utils.js', 'mcp/writer-lock.js', 'extraction/extraction-version.js']) {
      await writeFile(
        path.join(shim, file),
        `module.exports=require(${JSON.stringify(path.join(installation.libraryRoot, file))});`,
      );
    }
    // Test-only wrapper inserts an explicit handshake after real native init,
    // while both native writer claims are held, before real native indexAll.
    // All indexing/locking implementations remain the installed native SDK.
    await writeFile(
      path.join(shim, 'index.js'),
      `
      const fs=require('node:fs'),path=require('node:path'),sdk=require(${JSON.stringify(path.join(installation.libraryRoot, 'index.js'))});
      const initialize=sdk.CodeGraph.init.bind(sdk.CodeGraph);
      sdk.CodeGraph.init=async(root,options)=>{const graph=await initialize(root,options);fs.writeFileSync(path.join(root,'race-ready'),'ready');while(!fs.existsSync(path.join(root,'race-go')))await new Promise(resolve=>setTimeout(resolve,10));return graph;};
      module.exports=sdk;
    `,
    );
    const job = runCodeGraphWorker({ ...installation, libraryRoot: shim }, root, 'initialize', {
      executionDeadlineMs: 10000,
    });
    const observed = job.then(
      () => ({ success: true }),
      (error) => ({ error }),
    );
    for (let attempt = 0; attempt < 300; attempt += 1) {
      try {
        await access(path.join(root, 'race-ready'));
        break;
      } catch {
        // The isolated fixture has not reached the handshake marker yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await access(path.join(root, 'race-ready'));
    const foreign = 'foreign unknown owner injected after native writer claims';
    await writeFile(path.join(root, '.codegraph', 'codegraph.lock'), foreign, { flag: 'wx' });
    await writeFile(path.join(root, 'race-go'), 'go');
    const result = await observed;
    assert.equal(result.error?.code, 'ownership_conflict');
    assert.equal(await readFile(path.join(root, '.codegraph', 'codegraph.lock'), 'utf8'), foreign);
    await assert.rejects(access(path.join(root, '.codegraph', 'writer.pid')));
    await assert.rejects(access(path.join(root, '.codegraph', 'rebuild.pid')));
  });
  await checked('real-native-cancellation-and-deadline', async () => {
    for (const mode of ['cancel', 'deadline']) {
      const root = path.join(fixture, mode);
      await mkdir(path.join(root, 'src'), { recursive: true });
      await git(root, 'init', '-q');
      for (let batch = 0; batch < 20; batch += 1)
        await Promise.all(
          Array.from({ length: 100 }, (_, offset) => {
            const i = batch * 100 + offset;
            return writeFile(
              path.join(root, 'src', `probe${i}.ts`),
              `export function NativeStopFixture${i}(v: number) { return v + ${i}; }\n`,
            );
          }),
        );
      const controller = new AbortController();
      const work = runCodeGraphWorker(installation, root, 'initialize', {
        signal: controller.signal,
        executionDeadlineMs: mode === 'deadline' ? 1500 : 120000,
      });
      // Attach rejection observation immediately, while waiting for a verified
      // nonce-owned native writer record to prove a live indexing process.
      const observed = work.then(
        () => ({ success: true }),
        (error) => ({ error }),
      );
      const pid = await waitForWriter(root);
      if (mode === 'cancel') controller.abort();
      const outcome = await observed;
      assert.equal(outcome.error?.code, mode === 'cancel' ? 'cancelled' : 'deadline_exceeded');
      assert.throws(() => process.kill(pid, 0), 'Cancellation must resolve after actual native child exit.');
      const retained = [];
      for (const name of ['writer.pid', 'rebuild.pid', 'codegraph.lock']) {
        if (
          await access(path.join(root, '.codegraph', name)).then(
            () => true,
            () => false,
          )
        )
          retained.push(name);
      }
      report[`${mode}RetainedNativeLocks`] = retained;
      if (retained.length > 0)
        report.acceptanceGaps.push(
          `${mode}: forced exit retained native locks; explicit manual ownership reconciliation is required before further preparation.`,
        );
      report[`${mode}NativePid`] = pid;
    }
  });
  report.sourceSize = {};
  for (const directory of ['main', 'linked', 'independent', 'readonly', 'race', 'cancel', 'deadline'])
    report.sourceSize[directory] = await countedSource(path.join(fixture, directory));
  report.jobCounts = adapter.getMeasurements();
  await checked('owned-observers-exit-before-dispose-resolves', async () => {
    await adapter.dispose();
    await assert.rejects((await CodeGraphJournal.create(main)).query(), { code: 'journal_unavailable' });
    await assert.rejects((await CodeGraphJournal.create(linked)).query(), { code: 'journal_unavailable' });
  });
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = error.stack || String(error);
  process.exitCode = 1;
} finally {
  await adapter.dispose();
  const reportPath = path.join(reportDirectory, `codegraph-acceptance-${Date.now()}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ reportPath, ...report }, null, 2));
}
