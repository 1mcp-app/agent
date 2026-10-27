#!/usr/bin/env node
/** Controlled compatibility check. Run with the pinned service checkout's tsx; never contacts a deployed route. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';
import { createRequire } from 'node:module';

const option = (name) => process.argv[process.argv.indexOf(name) + 1];
assert(process.argv.includes('--service'), 'Pass --service <pinned local service checkout>');
const service = realpathSync(path.resolve(option('--service')));
// The service's esbuild harness captures the process launch directory.
if (realpathSync(process.cwd()) !== service) {
  execFileSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], { cwd: service, stdio: 'inherit' });
  process.exit(0);
}
const agent = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pinnedService = '034b40fbf644e7a10df009c6554721b54318c9a6';
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: service, encoding: 'utf8' }).trim(), pinnedService);
const scratch = await mkdtemp(path.join(os.tmpdir(), 'product-pair-'));
const output = process.argv.includes('--out') ? path.resolve(option('--out')) : path.join(scratch, 'evidence');
await mkdir(output, { recursive: true, mode: 0o700 });
const bundle = path.join(scratch, 'producer.mjs');
await build({
  absWorkingDir: service,
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
const { parseEnvelope } = await import(pathToFileURL(path.join(service, 'src/contract.ts')).href);
const h = await harness();
const now = Date.now();
const day = new Date(now).toISOString().slice(0, 10);
const bodies = [];
const make = async (store, ci = false) => {
  const producer = new ProductUsageProducer({
    store,
    now: () => now,
    dimensions: { version: '0.39.2', os: 'darwin', arch: 'arm64', node_major: 24, ci },
    dispatch: (body) => {
      bodies.push(body);
    },
  });
  await producer.settled();
  return producer;
};
const store = new InstallationStore(path.join(scratch, 'shared'), { notice: () => {}, now: () => now });
let browser;
try {
  const first = await make(store);
  const second = await make(new InstallationStore(path.join(scratch, 'shared'), { notice: () => {}, now: () => now })); // Separate runtime scopes, one installation state.
  first.observeConfiguration('servers', 999);
  first.observeConfiguration('servers', 0); // Latest, not maximum.
  first.observeConfiguration('servers', 0);
  first.observeConfiguration('tools', 0);
  first.observeConfiguration('private-name', 1);
  await first.settled();
  assert.equal(bodies.length, 0);
  first.beginCommand('inspect').finish('success');
  await first.settled();
  first.beginCommand('inspect').finish('success'); // No refreshed observation to repeat.
  await first.settled();
  second.observeConfiguration('servers', 101);
  second.observeConfiguration('tools', Number.MAX_SAFE_INTEGER);
  second.beginCommand('inspect').finish('success');
  await second.settled();
  first.observeConfiguration('servers', 2);
  first.observeConfiguration('tools', 21);
  for (const invalid of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 'private-value', { secret: 1 }])
    first.observeConfiguration('tools', invalid);
  first.beginCommand('inspect').finish('success');
  await first.settled();
  const ci = await make(store, true);
  ci.observeConfiguration('servers', 1);
  ci.beginCommand('inspect').finish('success');
  await ci.settled();
  await store.control('disable');
  first.observeConfiguration('servers', 20);
  first.beginCommand('inspect').finish('success');
  await first.settled();
  assert.equal(bodies.length, 5);
  await store.control('enable');
  await store.control('reset');
  const reset = await make(store);
  reset.observeConfiguration('servers', 1);
  reset.beginCommand('inspect').finish('success');
  await reset.settled();
  assert.equal(bodies.length, 6);
  const envelopes = bodies.map((body) => parseEnvelope(JSON.parse(body), now));
  const sharedIds = envelopes.slice(0, 5).map((e) => e.summaries[0].installation_id);
  assert.equal(new Set(sharedIds).size, 1);
  assert.notEqual(sharedIds[0], envelopes[5].summaries[0].installation_id);
  assert.equal(envelopes[1].summaries[0].counters.length, 1);
  assert(!bodies.join('').includes('private-value'));
  const send = (body) =>
    h.ingest.fetch('https://ingest.test/v1/summaries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
  for (const body of bodies) assert.equal((await send(body)).status, 201);
  assert.equal((await send(bodies[0])).status, 200);
  await rollup(h.db, now);
  await rollup(h.db, now);
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM summaries').first()).n, 6);
  const headers = { 'Cf-Access-Jwt-Assertion': await h.token() };
  const range = `?from=${day}&to=${day}`;
  assert.equal((await h.dashboard.fetch('https://dashboard.test/api/report' + range)).status, 403);
  const response = await h.dashboard.fetch('https://dashboard.test/api/report' + range, { headers });
  assert.equal(response.status, 200);
  const human = await response.json();
  const ciResponse = await h.dashboard.fetch('https://dashboard.test/api/report' + range + '&ci=true', { headers });
  assert.equal(ciResponse.status, 200);
  const ciReport = await ciResponse.json();
  assert.equal(human.observed_installations, 2);
  assert.equal(ciReport.observed_installations, 1);
  const buckets = (data) =>
    data.measures
      .filter((m) => m.kind === 'configuration')
      .map((m) => [m.name, m.bucket, m.count])
      .sort();
  const expected = [
    ['servers', '0', 1],
    ['servers', '1', 1],
    ['servers', '101+', 1],
    ['servers', '2-5', 1],
    ['tools', '0', 1],
    ['tools', '101+', 1],
    ['tools', '21-100', 1],
  ].sort();
  assert.deepEqual(buckets(human), expected);
  assert.deepEqual(buckets(ciReport), [['servers', '1', 1]]);
  assert.equal(
    human.measures.filter((m) => m.kind === 'command').reduce((n, m) => n + m.count, 0),
    5,
  );
  const requireService = createRequire(path.join(service, 'package.json'));
  const { chromium } = requireService('@playwright/test');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.route('https://dashboard.test/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/report') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(human) });
      return;
    }
    const asset = await h.dashboard.fetch(url.href, { headers });
    await route.fulfill({ status: asset.status, headers: Object.fromEntries(asset.headers), body: await asset.text() });
  });
  await page.goto('https://dashboard.test/');
  await page.waitForFunction(() => !globalThis.document.querySelector('#report').hidden);
  const rendered = await page.locator('#measures tr').allTextContents();
  for (const [name, bucket, count] of expected)
    assert(rendered.includes(`configuration${name}observationnonenone${bucket}${count}`));
  await page.screenshot({ path: path.join(output, 'configuration.png'), fullPage: true });
  await writeFile(path.join(output, 'producer-bodies.jsonl'), bodies.join('\n') + '\n', { mode: 0o600 });
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ human, ci: ciReport }, null, 2), { mode: 0o600 });
  const evidence = {
    agentRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: agent, encoding: 'utf8' }).trim(),
    serviceRevision: pinnedService,
    schemaVersion: 1,
    batches: 6,
    producerSourceSha256: createHash('sha256')
      .update(await readFile(path.join(agent, 'src/productTelemetry/producer.ts')))
      .digest('hex'),
    humanInstallations: 2,
    ciInstallations: 1,
    configuration: expected,
    rendered,
    semantics: 'latest snapshot; observation frequency, not distinct installations per bucket or UTC maximum',
    destination: 'local Miniflare and intercepted authenticated report replay only',
  };
  await writeFile(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(evidence));
} finally {
  await browser?.close();
  await h.mf.dispose();
  if (!output.startsWith(scratch + path.sep)) await rm(scratch, { recursive: true, force: true });
  else console.log(`Evidence: ${output}`);
}
