#!/usr/bin/env node
/** Isolated operation producer/service compatibility fixture. Never contacts deployed collectors. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const option = (name) => process.argv[process.argv.indexOf(name) + 1];
assert(process.argv.includes('--service'), 'Pass --service <pinned local service checkout>');
const service = await realpath(path.resolve(option('--service')));
const agent = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serviceRevision = '034b40fbf644e7a10df009c6554721b54318c9a6';
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: service, encoding: 'utf8' }).trim(), serviceRevision);
const scratch = await mkdtemp(path.join(os.tmpdir(), 'product-operations-'));
const output = process.argv.includes('--out') ? path.resolve(option('--out')) : path.join(scratch, 'evidence');
await mkdir(output, { recursive: true, mode: 0o700 });
// The tsx loader starts esbuild before this module runs; service fixtures use relative entries.
assert.equal(process.cwd(), service, 'Run this fixture from the pinned service checkout');
const bundle = path.join(scratch, 'producer.mjs');
await build({
  stdin: {
    contents: `export {ProductUsageProducer} from './src/productTelemetry/producer.ts'; export {InstallationStore} from './src/productTelemetry/installationStore.ts'; export {productClientFamily} from './src/productTelemetry/operation.ts';`,
    resolveDir: agent,
  },
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'esm',
});
const { ProductUsageProducer, InstallationStore, productClientFamily } = await import(pathToFileURL(bundle).href);
const { harness } = await import(pathToFileURL(path.join(service, 'test/harness.ts')).href);
const { rollup } = await import(pathToFileURL(path.join(service, 'src/storage.ts')).href);
const h = await harness();
const now = Date.now();
const day = new Date(now).toISOString().slice(0, 10);
const bodies = [];
const store = new InstallationStore(path.join(scratch, 'state'), { notice: () => {}, now: () => now });
const producer = new ProductUsageProducer({
  store,
  now: () => now,
  dimensions: { version: '0.39.2', os: 'darwin', arch: 'arm64', node_major: 24, ci: false },
  dispatch: (body) => {
    bodies.push(body);
  },
});
// Hand-computed operation fixture: success 4, failure 2; HTTP 3, stdio 2, SSE 1.
const fixtures = [
  ['tools_call', 'success', 'http', 'codex'],
  ['tools_call', 'success', 'http', 'codex'],
  ['tools_call', 'failure', 'stdio', 'claude'],
  ['tools_call', 'failure', 'sse', 'cursor'],
  ['resources_read', 'success', 'http', 'other'],
  ['initialize', 'success', 'stdio', 'vscode'],
];
try {
  await producer.settled();
  for (const [name, outcome, transport, client] of fixtures) {
    const safeClient =
      client === 'other'
        ? productClientFamily(
            new Proxy(
              { name: 'private-client', title: 'private-title', version: 'private-version' },
              {
                getOwnPropertyDescriptor() {
                  throw new Error('Proxy trap must not run');
                },
              },
            ),
          )
        : client;
    const operation = producer.beginOperation(name, transport, safeClient);
    operation.finish(outcome);
    operation.finish('failure');
    await producer.settled();
  }
  producer.beginCommand('run').finish('success');
  await producer.settled();
  producer.beginFeature('admin_open').finish('success');
  await producer.settled();
  assert.equal(productClientFamily({ name: 'private-tool-name', title: 'secret', version: 'secret' }), 'other');
  assert.equal(
    productClientFamily(
      Object.defineProperty({}, 'name', {
        get() {
          throw Error('getter executed');
        },
      }),
    ),
    'other',
  );
  producer.beginOperation('private-method', 'http', 'other').finish('success');
  producer.beginOperation('tools_call', 'http', 'private-client').finish('success');
  await producer.settled();
  assert.equal(bodies.length, 8);
  for (const value of ['private-client', 'private-title', 'private-version', 'private-method'])
    assert(!bodies.join('').includes(value));
  const counters = bodies.flatMap((body) => JSON.parse(body).summaries.flatMap((s) => s.counters));
  assert.deepEqual(
    counters.slice(0, 6).map((c) => [c.name, c.outcome, c.transport, c.client]),
    fixtures,
  );
  const send = (body) =>
    h.ingest.fetch('https://ingest.test/v1/summaries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
  for (const body of bodies) assert.equal((await send(body)).status, 201);
  assert.equal((await send(bodies[0])).status, 200);
  for (const [key, value] of [
    ['client', 'private-client'],
    ['transport', 'private-transport'],
    ['outcome', 'cancelled'],
    ['tool_name', 'secret'],
  ]) {
    const rejected = JSON.parse(bodies[0]);
    rejected.summaries[0].counters[0][key] = value;
    assert.equal((await send(JSON.stringify(rejected))).status, 400);
  }
  const persisted = await h.db.prepare('SELECT counters FROM summaries').all();
  const d1Counters = persisted.results.flatMap((row) => JSON.parse(row.counters));
  const operationFields = (counter) => [
    counter.name,
    counter.outcome,
    counter.transport,
    counter.client,
    counter.count,
  ];
  const sortedRows = (rows) => rows.map((row) => JSON.stringify(row)).sort();
  assert.deepEqual(
    sortedRows(d1Counters.filter((counter) => counter.kind === 'operation').map(operationFields)),
    sortedRows(fixtures.map((row) => [...row, 1])),
  );
  assert.equal(
    d1Counters.filter((c) => c.kind === 'operation').reduce((n, c) => n + c.count, 0),
    6,
  );
  await rollup(h.db, now);
  const url = `https://dashboard.test/api/report?from=${day}&to=${day}`;
  assert.equal((await h.dashboard.fetch(url)).status, 403);
  const headers = { 'Cf-Access-Jwt-Assertion': await h.token() };
  const response = await h.dashboard.fetch(url, { headers });
  assert.equal(response.status, 200);
  const report = await response.json();
  const operations = report.measures.filter((m) => m.kind === 'operation');
  // Independent hand-computed rollup, including every client-family/transport pairing.
  assert.deepEqual(
    sortedRows(operations.map(operationFields)),
    sortedRows([
      ['tools_call', 'success', 'http', 'codex', 2],
      ['tools_call', 'failure', 'stdio', 'claude', 1],
      ['tools_call', 'failure', 'sse', 'cursor', 1],
      ['resources_read', 'success', 'http', 'other', 1],
      ['initialize', 'success', 'stdio', 'vscode', 1],
    ]),
  );
  assert.equal(
    operations.reduce((n, m) => n + m.count, 0),
    6,
  );
  assert.equal(
    operations.filter((m) => m.outcome === 'success').reduce((n, m) => n + m.count, 0),
    4,
  );
  assert.equal(
    operations.filter((m) => m.outcome === 'failure').reduce((n, m) => n + m.count, 0),
    2,
  );
  for (const [transport, count] of [
    ['http', 3],
    ['stdio', 2],
    ['sse', 1],
  ])
    assert.equal(
      operations.filter((m) => m.transport === transport).reduce((n, m) => n + m.count, 0),
      count,
    );
  assert.equal(report.observed_installations, 1);
  const html = await (await h.dashboard.fetch('https://dashboard.test/', { headers })).text();
  const client = await (await h.dashboard.fetch('https://dashboard.test/app.js', { headers })).text();
  const dom = new JSDOM(html, { url: 'https://dashboard.test/', runScripts: 'outside-only' });
  dom.window.fetch = async () => ({ ok: true, json: async () => report });
  dom.window.eval(client);
  await new Promise((resolve) => setImmediate(resolve));
  const rendered = [...dom.window.document.querySelectorAll('#measures tr')].map((row) =>
    [...row.querySelectorAll('td')].map((cell) => cell.textContent),
  );
  assert.deepEqual(
    rendered
      .filter((row) => row[0] === 'operation')
      .map((row) => row.join('|'))
      .sort(),
    operations
      .map((m) => ['operation', m.name, m.outcome, m.transport, m.client, m.bucket, String(m.count)].join('|'))
      .sort(),
  );
  assert.equal(rendered.filter((row) => row[0] === 'command').length, 1);
  assert.equal(rendered.filter((row) => row[0] === 'feature').length, 1);
  await writeFile(path.join(output, 'producer-bodies.jsonl'), bodies.join('\n') + '\n', { mode: 0o600 });
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  await writeFile(path.join(output, 'rendered.json'), JSON.stringify(rendered, null, 2) + '\n', { mode: 0o600 });
  await writeFile(path.join(output, 'd1.json'), JSON.stringify(d1Counters, null, 2) + '\n', { mode: 0o600 });
  const evidence = {
    agentRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: agent, encoding: 'utf8' }).trim(),
    serviceRevision,
    batches: 8,
    operations: { success: 4, failure: 2, http: 3, stdio: 2, sse: 1 },
    separateFamilies: ['command', 'feature', 'operation'],
    authenticatedReport: 200,
    unauthenticatedReport: 403,
    renderedOperationRows: 5,
    cancellation: 'failure',
    destination: 'local Miniflare only',
    sourceSha256: createHash('sha256')
      .update(await readFile(bundle))
      .digest('hex'),
    bodySha256: bodies.map((body) => createHash('sha256').update(body).digest('hex')),
  };
  await writeFile(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(evidence));
  dom.window.close();
} finally {
  await h.mf.dispose();
  if (!output.startsWith(scratch + path.sep)) await rm(scratch, { recursive: true, force: true });
}
