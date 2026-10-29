#!/usr/bin/env node
/** Controlled compatibility check. Run with the pinned service checkout's tsx; never contacts a deployed route. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';

const option = (name) => process.argv[process.argv.indexOf(name) + 1];
assert(process.argv.includes('--service'), 'Pass --service <pinned local service checkout>');
const service = path.resolve(option('--service'));
const agent = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pinnedService = '034b40fbf644e7a10df009c6554721b54318c9a6';
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: service, encoding: 'utf8' }).trim(), pinnedService);
const scratch = await mkdtemp(path.join(os.tmpdir(), 'product-pair-'));
const output = process.argv.includes('--out') ? path.resolve(option('--out')) : path.join(scratch, 'evidence');
await mkdir(output, { recursive: true, mode: 0o700 });
const bundle = path.join(scratch, 'producer.mjs');
await build({
  stdin: {
    contents: `export { ProductUsageProducer } from './src/productTelemetry/producer.ts'; export { InstallationStore } from './src/productTelemetry/installationStore.ts';`,
    resolveDir: agent,
  },
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'esm',
});
const { ProductUsageProducer, InstallationStore } = await import(pathToFileURL(bundle).href);
process.chdir(service);
const { harness } = await import(pathToFileURL(path.join(service, 'test/harness.ts')).href);
const { rollup } = await import(pathToFileURL(path.join(service, 'src/storage.ts')).href);
const { report } = await import(pathToFileURL(path.join(service, 'src/reports.ts')).href);
const { parseEnvelope } = await import(pathToFileURL(path.join(service, 'src/contract.ts')).href);
const h = await harness();
const now = Date.now();
const day = new Date(now).toISOString().slice(0, 10);
const bodies = [];
const runtimeFixture = process.argv.includes('--runtime');
const store = new InstallationStore(path.join(scratch, 'installation'), { notice: () => {}, now: () => now });
const producer = async (ci) => {
  const usage = new ProductUsageProducer({
    store,
    now: () => now,
    dimensions: { version: '0.39.2', os: 'darwin', arch: 'arm64', node_major: 24, ci },
    dispatch: (body) => {
      bodies.push(body);
    },
  });
  await usage.settled();
  return usage;
};
try {
  const human = await producer(false);
  human.beginCommand('inspect').finish('success');
  await human.settled();
  human.beginCommand('inspect').finish('failure');
  await human.settled();
  const ci = await producer(true);
  ci.beginCommand('inspect').finish('success');
  await ci.settled();
  await store.control('reset');
  const reset = await producer(false);
  reset.beginCommand('inspect').finish('success');
  await reset.settled();
  const rejected = new ProductUsageProducer({
    store,
    now: () => now,
    dimensions: {
      version: '0.39.2',
      os: 'darwin',
      arch: 'arm64',
      node_major: 24,
      ci: false,
      trace_id: 'forbidden-identity',
    },
    dispatch: (body) => {
      bodies.push(body);
    },
  });
  await rejected.settled();
  rejected.beginCommand('inspect').finish('success');
  await rejected.settled();
  reset.beginCommand('arbitrary-workload-name').finish('success');
  await reset.settled();
  reset.beginCommand('inspect').finish('raw-private-error');
  await reset.settled();
  assert.equal((await store.status()).queuedSummaries, 0);
  if (runtimeFixture) {
    // Hand-computed startup fixture: serve success1/failure2 (including cancel),
    // proxy success1/failure1, worker runtime_start success2/failure1; CI serve success1.
    for (const [name, outcome] of [
      ['serve', 'success'],
      ['serve', 'failure'],
      ['serve', 'failure'],
      ['proxy', 'success'],
      ['proxy', 'failure'],
    ]) {
      const startup = reset.beginCommand(name);
      startup.finish(outcome);
      startup.finish('failure'); // Shutdown/duplicate readiness must not add another fact.
      await reset.settled();
    }
    for (const outcome of ['success', 'success', 'failure']) {
      const startup = reset.beginRuntimeStartup();
      startup.finish(outcome);
      startup.finish('failure');
      await reset.settled();
    }
    const runtimeCi = await producer(true);
    runtimeCi.beginCommand('serve').finish('success');
    await runtimeCi.settled();
  }
  const expectedBatches = runtimeFixture ? 13 : 4;
  assert.equal(bodies.length, expectedBatches);
  const envelopes = bodies.map((body) => parseEnvelope(JSON.parse(body), now));
  for (const envelope of envelopes) {
    assert.deepEqual(Object.keys(envelope).sort(), ['batch_id', 'schema_version', 'summaries']);
    for (const s of envelope.summaries) {
      assert.deepEqual(Object.keys(s).sort(), [
        'arch',
        'ci',
        'counters',
        'installation_id',
        'node_major',
        'occurred_at',
        'os',
        'version',
      ]);
      for (const c of s.counters) {
        assert.deepEqual(Object.keys(c).sort(), ['bucket', 'client', 'count', 'kind', 'name', 'outcome', 'transport']);
        assert(['command', 'feature'].includes(c.kind));
        assert(['inspect', 'serve', 'proxy', 'runtime_start'].includes(c.name));
        assert.equal(c.transport, 'none');
        assert.equal(c.client, 'none');
        assert.equal(c.bucket, 'none');
      }
    }
  }
  assert.equal(envelopes[0].summaries[0].installation_id, envelopes[2].summaries[0].installation_id);
  assert.notEqual(envelopes[0].summaries[0].installation_id, envelopes[3].summaries[0].installation_id);
  const send = (body) =>
    h.ingest.fetch('https://ingest.test/v1/summaries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
  for (const body of bodies) assert.equal((await send(body)).status, 201);
  assert.equal((await send(bodies[0])).status, 200);
  const conflict = JSON.parse(bodies[0]);
  conflict.summaries[0].counters[0].count = 2;
  assert.equal((await send(JSON.stringify(conflict))).status, 409);
  const forbidden = JSON.parse(bodies[0]);
  forbidden.summaries[0].path = '/forbidden-workload';
  assert.equal((await send(JSON.stringify(forbidden))).status, 400);
  const unknown = JSON.parse(bodies[0]);
  unknown.summaries[0].counters[0].name = 'arbitrary-workload-name';
  assert.equal((await send(JSON.stringify(unknown))).status, 400);
  const cancelled = JSON.parse(bodies[0]);
  cancelled.summaries[0].counters[0].outcome = 'cancelled';
  assert.equal((await send(JSON.stringify(cancelled))).status, 400);
  await rollup(h.db, now);
  const humanReport = await report(h.db, new URL(`https://dashboard.test/api/report?from=${day}&to=${day}`), now);
  const ciReport = await report(h.db, new URL(`https://dashboard.test/api/report?from=${day}&to=${day}&ci=true`), now);
  assert.equal(humanReport.observed_installations, 2);
  assert.equal(ciReport.observed_installations, runtimeFixture ? 2 : 1);
  const count = (r, outcome) =>
    r.measures
      .filter((m) => m.kind === 'command' && m.name === 'inspect' && m.outcome === outcome)
      .reduce((n, m) => n + m.count, 0);
  assert.equal(count(humanReport, 'success'), 2);
  assert.equal(count(humanReport, 'failure'), 1);
  assert.equal(count(ciReport, 'success'), 1);
  assert.equal(count(ciReport, 'failure'), 0);
  const runtimeTotals = (r, kind, name, outcome) =>
    r.measures
      .filter((m) => m.kind === kind && m.name === name && m.outcome === outcome)
      .reduce((n, m) => n + m.count, 0);
  if (runtimeFixture) {
    assert.equal(runtimeTotals(humanReport, 'command', 'serve', 'success'), 1);
    assert.equal(runtimeTotals(humanReport, 'command', 'serve', 'failure'), 2);
    assert.equal(runtimeTotals(humanReport, 'command', 'proxy', 'success'), 1);
    assert.equal(runtimeTotals(humanReport, 'command', 'proxy', 'failure'), 1);
    assert.equal(runtimeTotals(humanReport, 'feature', 'runtime_start', 'success'), 2);
    assert.equal(runtimeTotals(humanReport, 'feature', 'runtime_start', 'failure'), 1);
    assert.equal(runtimeTotals(ciReport, 'command', 'serve', 'success'), 1);
  }
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM summaries').first()).n, expectedBatches);
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: agent, encoding: 'utf8' }).trim();
  const sourceFiles = ['producer.ts', 'installationStore.ts', 'permissions.ts', 'contract.ts'];
  const sourceHash = createHash('sha256');
  for (const file of sourceFiles) sourceHash.update(await readFile(path.join(agent, 'src/productTelemetry', file)));
  await writeFile(path.join(output, 'producer-bodies.jsonl'), bodies.join('\n') + '\n', { mode: 0o600 });
  await writeFile(
    path.join(output, 'report.json'),
    JSON.stringify({ human: humanReport, ci: ciReport }, null, 2) + '\n',
    { mode: 0o600 },
  );
  const evidence = {
    agentRevision: revision,
    producerSourceSha256: sourceHash.digest('hex'),
    serviceRevision: pinnedService,
    schemaVersion: 1,
    batches: expectedBatches,
    human: { installations: 2, success: 2, failure: 1 },
    ci: { installations: runtimeFixture ? 2 : 1, success: 1, failure: 0 },
    runtimeStartup: runtimeFixture
      ? {
          human: {
            serve: { success: 1, failure: 2 },
            proxy: { success: 1, failure: 1 },
            runtime_start: { success: 2, failure: 1 },
          },
          ci: { serve: { success: 1, failure: 0 } },
          cancellation: 'failure',
          shutdownDuplicates: 0,
        }
      : undefined,
    exactReplay: 200,
    contentConflict: 409,
    forbiddenField: 400,
    unknownLabel: 400,
    unknownOutcome: 400,
    outgoingUnknownDimensions: 'dropped',
    destination: 'local Miniflare only',
    bodySha256: bodies.map((body) => createHash('sha256').update(body).digest('hex')),
  };
  await writeFile(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(evidence));
} finally {
  await h.mf.dispose();
  if (output.startsWith(scratch + path.sep)) console.log(`Evidence: ${output}`);
  else await rm(scratch, { recursive: true, force: true });
}
