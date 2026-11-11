#!/usr/bin/env node
/** Actual producer bytes, controlled service faults, no deployed endpoint or service-source mutation. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';
import { createRequire } from 'node:module';

const option = (name) => process.argv[process.argv.indexOf(name) + 1];
assert(process.argv.includes('--service'), 'Pass --service <pinned service checkout>');
assert(process.argv.includes('--out'), 'Pass --out <private evidence directory>');
const service = path.resolve(option('--service'));
const agent = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serviceRevision = '034b40fbf644e7a10df009c6554721b54318c9a6';
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: service, encoding: 'utf8' }).trim(), serviceRevision);
const scratch = await mkdtemp(path.join(os.tmpdir(), 'product-fault-pair-'));
const output = path.resolve(option('--out'));
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
const DAY = 86400000;
const now = Math.floor(Date.now() / 1000) * 1000;
const day = (t) => new Date(t).toISOString().slice(0, 10);
const oldDay = day(now - 6 * DAY);
const missingDay = day(now - 3 * DAY);
const today = day(now);
let clock = now;
const bodies = [];
const attempts = [];
const store = new InstallationStore(path.join(scratch, 'installation'), { notice: () => {}, now: () => clock });
const dimensions = { version: '0.39.3', os: 'darwin', arch: 'arm64', node_major: 24, ci: false };
async function produce(time, outcome = 'success') {
  clock = time;
  const p = new ProductUsageProducer({
    store,
    now: () => clock,
    dimensions,
    dispatch: (body) => {
      bodies.push(body);
    },
  });
  await p.settled();
  p.beginCommand('inspect').finish(outcome);
  await p.settled();
  assert.equal((await store.status()).queuedSummaries, 0);
  return bodies.at(-1);
}
const send = (body) =>
  h.ingest.fetch('https://ingest.test/v1/summaries', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
const range = `?from=${oldDay}&to=${today}`;
let browser;
try {
  const headers = { 'Cf-Access-Jwt-Assertion': await h.token() };
  const readReport = async () => {
    const response = await h.dashboard.fetch('https://dashboard.test/api/report' + range, { headers });
    assert.equal(response.status, 200);
    return response.json();
  };
  const old = await produce(now - 6 * DAY);
  assert.equal((await send(old)).status, 201);
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM summaries').first()).n, 1);
  const pending = await readReport();
  assert.equal(pending.freshness.pending_days, 1);
  assert.equal(pending.freshness.rolled_up_at, null);
  assert.equal(pending.days.find((d) => d.day === oldDay).state, 'missing');
  await rollup(h.db, now);
  const observed = await readReport();
  assert.equal(observed.days.find((d) => d.day === oldDay).state, 'observed');
  const late = await produce(now - 6 * DAY + 1_000, 'failure');
  const current = await produce(now);
  for (const body of [late, current]) assert.equal((await send(body)).status, 201);
  assert.equal((await send(late)).status, 200);
  const changed = JSON.parse(late);
  changed.summaries[0].counters[0].count = 99;
  assert.equal((await send(JSON.stringify(changed))).status, 409);
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM summaries').first()).n, 3);
  const stale = await readReport();
  assert.equal(stale.days.find((d) => d.day === oldDay).state, 'stale');
  assert.equal(stale.days.find((d) => d.day === oldDay).summaries, 1);
  assert.equal(stale.freshness.pending_days, 2);
  await rollup(h.db, now);
  await rollup(h.db, now);
  const complete = await readReport();
  assert.equal(complete.observed_installations, 1);
  assert.equal(complete.days.find((d) => d.day === oldDay).summaries, 2);
  assert.equal(complete.days.find((d) => d.day === oldDay).state, 'observed');
  assert.equal(complete.days.find((d) => d.day === today).state, 'provisional');
  assert.deepEqual(
    complete.days.find((d) => d.day === missingDay),
    { day: missingDay, installations: null, summaries: null, state: 'missing', rolled_up_at: null },
  );
  const count = (outcome) =>
    complete.measures
      .filter((m) => m.kind === 'command' && m.name === 'inspect' && m.outcome === outcome)
      .reduce((n, m) => n + m.count, 0);
  assert.equal(count('success'), 2);
  assert.equal(count('failure'), 1);
  assert.equal(complete.freshness.pending_days, 0);
  const elapsed = await report(h.db, new URL('https://dashboard.test/api/report' + range), now + 3 * 3600000);
  assert.equal(elapsed.freshness.rollup_stale, true);

  // Exact receiver time boundaries use actual producer-serialized envelopes and a fixed parser clock.
  const edge = await produce(now - 7 * DAY);
  assert.doesNotThrow(() => parseEnvelope(JSON.parse(edge), now));
  assert.throws(() => parseEnvelope(JSON.parse(edge), now + 1000));
  const future = await produce(now + 300000);
  assert.doesNotThrow(() => parseEnvelope(JSON.parse(future), now));
  assert.throws(() => parseEnvelope(JSON.parse(future), now - 1000));
  const tooOld = await produce(now - 8 * DAY);
  assert.equal((await send(tooOld)).status, 400);
  const tooFuture = await produce(now + 360000);
  assert.equal((await send(tooFuture)).status, 400);

  // Real serialized attempts remain final under quota, persisted-but-ambiguous response, and D1 failure.
  clock = now;
  const ticket = await store.admit();
  const facts = { ...JSON.parse(current).summaries[0] };
  delete facts.installation_id;
  async function attempt(label, dispatch, ambiguous = false) {
    await store.append(ticket, facts);
    let completion;
    await store.attemptSend(ticket, (body) => {
      attempts.push({ label, body });
      completion = dispatch(body);
      return completion;
    });
    if (ambiguous) await assert.rejects(completion, /controlled response lost/);
    else await completion;
    let retries = 0;
    await store.attemptSend(ticket, () => {
      retries++;
    });
    assert.equal(retries, 0);
    assert.equal((await store.status()).queuedSummaries, 0);
  }
  await h.db.prepare('UPDATE intake_budget SET summaries=1000').run();
  await attempt('quota', async (body) => {
    assert.equal((await send(body)).status, 429);
  });
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM summaries').first()).n, 3);
  await h.db.prepare('UPDATE intake_budget SET summaries=3').run();
  await attempt(
    'persisted-ambiguous',
    async (body) => {
      assert.equal((await send(body)).status, 201);
      throw new Error('controlled response lost');
    },
    true,
  );
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM summaries').first()).n, 4);
  await h.db.prepare('DROP TABLE summaries').run();
  await attempt('storage-unavailable', async (body) => {
    const response = await send(body);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'storage_unavailable', persisted: false });
  });
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM batches').first()).n, 4);
  const failedId = JSON.parse(attempts.at(-1).body).batch_id;
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM batches WHERE id=?').bind(failedId).first()).n, 0);
  const unavailable = await h.dashboard.fetch('https://dashboard.test/api/report' + range, { headers });
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { error: 'report_unavailable' });

  // Render the actual authenticated service assets with reports captured above, without changing service code.
  const requireService = createRequire(path.join(service, 'package.json'));
  const { chromium } = requireService('@playwright/test');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let selected = pending;
  let failed = false;
  await page.route('https://dashboard.test/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/report') {
      await route.fulfill({
        status: failed ? 503 : 200,
        contentType: 'application/json',
        body: JSON.stringify(failed ? { error: 'report_unavailable' } : selected),
      });
      return;
    }
    const response = await h.dashboard.fetch(url.href, { headers });
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
    });
  });
  const rendered = [];
  for (const [name, data] of [
    ['pending', pending],
    ['stale', stale],
    ['complete', complete],
    ['elapsed', elapsed],
  ]) {
    selected = data;
    await page.goto('https://dashboard.test/');
    await page.waitForFunction(
      () =>
        globalThis.document.querySelector('#report').getAttribute('aria-busy') === 'false' &&
        !globalThis.document.querySelector('#report').hidden,
    );
    await page.getByText('Daily values & coverage', { exact: true }).click();
    const daily = await page.locator('#daily').innerText();
    assert.ok(daily.includes('missing'));
    if (name === 'stale') assert.ok(daily.includes('stale'));
    if (name === 'complete') assert.ok(daily.includes('provisional'));
    const freshness = await page.locator('#freshness-note').innerText();
    if (name === 'elapsed' || name === 'pending') assert.ok(freshness.includes('incomplete or stale'));
    rendered.push({ name, daily, freshness });
    await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
  }
  failed = true;
  await page.locator('#filters button').click();
  await page.locator('#status.error').waitFor();
  assert.equal(await page.locator('#report').isVisible(), false);
  assert.ok((await page.locator('#status').innerText()).includes('Report unavailable'));
  await page.screenshot({ path: path.join(output, 'unavailable.png'), fullPage: true });
  const sourceHash = createHash('sha256');
  for (const name of ['producer.ts', 'installationStore.ts', 'permissions.ts', 'contract.ts'])
    sourceHash.update(await readFile(path.join(agent, 'src/productTelemetry', name)));
  const evidence = {
    agentRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: agent, encoding: 'utf8' }).trim(),
    serviceRevision,
    producerSourceSha256: sourceHash.digest('hex'),
    schemaVersion: 1,
    destination: 'local Miniflare and intercepted local browser only',
    persistedBeforeFaults: 3,
    totals: { success: 2, failure: 1, installations: 1 },
    finality: attempts.map((a) => a.label),
    receiverAgeBoundary: 'seven days inclusive',
    receiverFutureBoundary: 'five minutes inclusive',
    rendered,
  };
  for (const [name, data] of Object.entries({ evidence, reports: { pending, observed, stale, complete, elapsed } }))
    await writeFile(path.join(output, name + '.json'), JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  await writeFile(
    path.join(output, 'producer-bodies.jsonl'),
    [...bodies, ...attempts.map((a) => a.body)].join('\n') + '\n',
    { mode: 0o600 },
  );
  console.log(JSON.stringify(evidence));
} finally {
  await browser?.close();
  await h.mf.dispose();
  await rm(scratch, { recursive: true, force: true });
}
