#!/usr/bin/env node
/** Adoption-only compatibility evidence; local synthetic producer, Miniflare and intercepted browser. */
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
assert(
  process.argv.includes('--service') && process.argv.includes('--out'),
  'Pass --service <pinned checkout> --out <private evidence directory>',
);
const service = path.resolve(option('--service'));
const agent = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serviceRevision = '034b40fbf644e7a10df009c6554721b54318c9a6';
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: service, encoding: 'utf8' }).trim(), serviceRevision);
assert.equal(
  process.cwd(),
  service,
  'Run with the pinned service checkout as working directory (tsx/esbuild captures cwd at import).',
);
const scratch = await mkdtemp(path.join(os.tmpdir(), 'product-adoption-pair-'));
process.env.ONE_MCP_CONFIG_DIR = path.join(scratch, 'runtime');
process.env.ONE_MCP_PRODUCT_TELEMETRY_TEST_SUPPRESSED = 'true';
const output = path.resolve(option('--out'));
await mkdir(output, { recursive: true, mode: 0o700 });
const bundle = path.join(scratch, 'adoption.mjs');
// Only this synthetic bundle substitutes the product facade. Ordinary tests and shipped sources retain suppression.
await build({
  stdin: {
    contents: `
    export { ProductUsageProducer } from './src/productTelemetry/producer.ts';
    export { InstallationStore } from './src/productTelemetry/installationStore.ts';
    export { AdminOperationService } from './src/domains/admin/adminOperationService.ts';
    export { runProductCommand } from './src/productTelemetry/commandScope.ts';
    export { setupAppCommands } from './src/commands/app/index.ts';
    export { default as yargs } from 'yargs';
  `,
    resolveDir: agent,
  },
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'esm',
  banner: {
    js: `import { createRequire as adoptionCreateRequire } from 'node:module'; const require = adoptionCreateRequire(${JSON.stringify(path.join(agent, 'package.json'))});`,
  },
  plugins: [
    {
      name: 'controlled-adoption-facade',
      setup(b) {
        b.onResolve({ filter: /productTelemetry\/index\.js$/ }, () => ({ path: 'facade', namespace: 'controlled' }));
        b.onLoad({ filter: /.*/, namespace: 'controlled' }, () => ({
          contents: `
      export const beginProductCommand = name => globalThis.__adoptionProducer.beginCommand(name);
      export const beginProductFeature = name => globalThis.__adoptionProducer.beginFeature(name);
      export const recordProductFeature = (name,outcome) => globalThis.__adoptionProducer.recordFeature(name,outcome);
      export const observeProductConfiguration = () => {};
      export const observeProductRuntimeConfiguration = () => {};
    `,
        }));
      },
    },
  ],
});
const { ProductUsageProducer, InstallationStore, AdminOperationService, runProductCommand, setupAppCommands, yargs } =
  await import(pathToFileURL(bundle).href);
const { harness } = await import(pathToFileURL(path.join(service, 'test/harness.ts')).href);
const { rollup } = await import(pathToFileURL(path.join(service, 'src/storage.ts')).href);
const h = await harness();
const now = Date.now();
const day = new Date(now).toISOString().slice(0, 10);
const bodies = [];
const commands = [
  'serve',
  'proxy',
  'mcp',
  'preset',
  'config',
  'auth',
  'project',
  'instructions',
  'inspect',
  'run',
  'wait',
];
const features = [
  ['applyConfiguredServerCreate', 'server_add'],
  ['applyConfiguredServerEdit', 'server_update'],
  ['deleteConfiguredServer', 'server_remove'],
  ['enableConfiguredServer', 'server_enable'],
  ['disableConfiguredServer', 'server_disable'],
  ['createPreset', 'preset_update'],
  ['createInstructionTemplate', 'template_update'],
];
let browser;
try {
  const expected = [];
  for (const ci of [false, true]) {
    const store = new InstallationStore(path.join(scratch, ci ? 'ci' : 'human'), { notice: () => {}, now: () => now });
    const producer = new ProductUsageProducer({
      store,
      now: () => now,
      dimensions: { version: '0.39.2', os: 'darwin', arch: 'arm64', node_major: 24, ci },
      dispatch: (body) => bodies.push(body),
    });
    globalThis.__adoptionProducer = producer;
    await producer.settled();
    const addExpected = (kind, name, outcome, count = 1) => expected.push({ ci, kind, name, outcome, count });
    for (const name of commands) {
      await runProductCommand(name, async () => {});
      await producer.settled();
      addExpected('command', name, 'success');
      await assert.rejects(
        runProductCommand(name, async () => {
          throw new Error('synthetic private failure');
        }),
      );
      await producer.settled();
      addExpected('command', name, 'failure');
    }
    // A real registered builder/handler, including its nested implementation, rather than only producer calls.
    if (!ci) {
      await setupAppCommands(yargs().exitProcess(false)).parseAsync(['app', 'list', '--configurable-only']);
      await producer.settled();
      addExpected('command', 'config', 'success');
    }
    const operations = new AdminOperationService({
      storageDir: path.join(scratch, ci ? 'admin-ci' : 'admin-human'),
      runtimeScopeId: 'synthetic-scope',
    });
    for (const [operationName, feature] of features) {
      for (const outcome of ['success', 'failure']) {
        const context = {
          actor: { type: 'admin_session', accountId: 'synthetic-account' },
          origin: outcome === 'success' ? 'browser' : 'cli',
          target: { type: 'configured_server', id: 'synthetic-private-target' },
          runtimeIdentity: { runtimeScopeId: 'synthetic-scope' },
          request: { requestId: 'synthetic-request' },
          idempotencyKey: operationName + outcome,
          requestFingerprint: outcome,
        };
        const input = {
          context,
          operationName,
          run: async () => {
            if (outcome === 'failure') throw new Error('synthetic private error');
            return { privatePayload: 'not exported' };
          },
        };
        const result = await operations.executeMutation(input);
        assert.equal(result.ok, outcome === 'success');
        await operations.executeMutation(input); // Replay is not another feature.
        await producer.settled();
        addExpected('feature', feature, outcome);
      }
    }
    producer.recordFeature('admin_open', 'success');
    await producer.settled();
    addExpected('feature', 'admin_open', 'success');
    const before = bodies.length;
    producer.recordFeature('other', 'success');
    producer.beginCommand('raw-private-name').finish('success');
    await producer.settled();
    assert.equal(bodies.length, before);
    assert.equal((await store.status()).queuedSummaries, 0);
  }
  delete globalThis.__adoptionProducer;
  const send = (body) =>
    h.ingest.fetch('https://ingest.test/v1/summaries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
  for (const body of bodies) {
    assert.ok(!/synthetic-private|privatePayload|synthetic-request|synthetic-account|private error/.test(body));
    for (const summary of JSON.parse(body).summaries)
      for (const counter of summary.counters) {
        assert.deepEqual(Object.keys(counter).sort(), [
          'bucket',
          'client',
          'count',
          'kind',
          'name',
          'outcome',
          'transport',
        ]);
        assert.equal(counter.transport, 'none');
        assert.equal(counter.client, 'none');
        assert.equal(counter.bucket, 'none');
      }
    assert.equal((await send(body)).status, 201);
  }
  assert.equal((await send(bodies[0])).status, 200);
  const invalid = JSON.parse(bodies[0]);
  invalid.summaries[0].counters[0].name = 'raw-private-name';
  assert.equal((await send(JSON.stringify(invalid))).status, 400);
  await rollup(h.db, now);
  const range = `?from=${day}&to=${day}`;
  assert.equal((await h.dashboard.fetch('https://dashboard.test/api/report' + range)).status, 403);
  const headers = { 'Cf-Access-Jwt-Assertion': await h.token() };
  assert.equal(
    (
      await h.dashboard.fetch('https://dashboard.test/api/report' + range, {
        headers: { 'Cf-Access-Jwt-Assertion': await h.token({ email: 'outside@example.test' }) },
      })
    ).status,
    403,
  );
  const reports = {};
  for (const ci of [false, true]) {
    const response = await h.dashboard.fetch('https://dashboard.test/api/report' + range + (ci ? '&ci=true' : ''), {
      headers,
    });
    assert.equal(response.status, 200);
    const report = await response.json();
    reports[ci ? 'ci' : 'human'] = report;
    assert.equal(report.observed_installations, 1);
    for (const key of new Set(expected.filter((e) => e.ci === ci).map((e) => `${e.kind}/${e.name}/${e.outcome}`))) {
      const [kind, name, outcome] = key.split('/');
      const wanted = expected
        .filter((e) => e.ci === ci && e.kind === kind && e.name === name && e.outcome === outcome)
        .reduce((n, e) => n + e.count, 0);
      const actual = report.measures
        .filter((m) => m.kind === kind && m.name === name && m.outcome === outcome)
        .reduce((n, m) => n + m.count, 0);
      assert.equal(actual, wanted, `${ci}/${key}`);
    }
    assert.equal(
      report.measures.reduce((n, m) => n + m.count, 0),
      expected.filter((e) => e.ci === ci).reduce((n, e) => n + e.count, 0),
    );
  }
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM summaries').first()).n, bodies.length);
  const requireService = createRequire(path.join(service, 'package.json'));
  const { chromium } = requireService('@playwright/test');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.route('https://dashboard.test/**', async (route) => {
    const response = await h.dashboard.fetch(route.request().url(), { headers });
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
    });
  });
  await page.goto('https://dashboard.test/');
  await page.waitForFunction(
    () =>
      !globalThis.document.querySelector('#report').hidden &&
      globalThis.document.querySelector('#report').getAttribute('aria-busy') === 'false',
  );
  const rendered = await page.locator('#measures').innerText();
  for (const name of [...commands, ...features.map(([, name]) => name), 'admin_open'])
    assert.ok(rendered.includes(name), name);
  const configRows = await page.locator('#measures tr').allTextContents();
  assert.ok(configRows.some((row) => row.includes('config') && row.includes('success') && row.trim().endsWith('2')));
  await page.screenshot({ path: path.join(output, 'adoption-human.png'), fullPage: true });
  await page.getByLabel('Activity', { exact: true }).selectOption('true');
  await page.locator('#filters button').click();
  await page.waitForFunction(() => globalThis.document.querySelector('#report').getAttribute('aria-busy') === 'false');
  const ciRows = await page.locator('#measures tr').allTextContents();
  assert.ok(ciRows.some((row) => row.includes('config') && row.includes('success') && row.trim().endsWith('1')));
  await page.screenshot({ path: path.join(output, 'adoption-ci.png'), fullPage: true });
  const files = [
    'src/productTelemetry/producer.ts',
    'src/productTelemetry/commandScope.ts',
    'src/commands/shared/commandRunner.ts',
    'src/domains/admin/adminOperationService.ts',
  ];
  const hash = createHash('sha256');
  for (const file of files) hash.update(await readFile(path.join(agent, file)));
  const evidence = {
    agentRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: agent, encoding: 'utf8' }).trim(),
    serviceRevision,
    sourceSha256: hash.digest('hex'),
    batches: bodies.length,
    expected,
    rendered,
    auth: { unauthenticated: 403, wrongDomain: 403, authenticated: 200 },
    destination: 'local Miniflare and intercepted browser only',
    terminalExit: 'best-effort hook assertions only; async persistence may be lost',
  };
  await writeFile(path.join(output, 'producer-bodies.jsonl'), bodies.join('\n') + '\n', { mode: 0o600 });
  await writeFile(path.join(output, 'reports.json'), JSON.stringify(reports, null, 2) + '\n', { mode: 0o600 });
  await writeFile(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  console.log(
    JSON.stringify({
      agentRevision: evidence.agentRevision,
      serviceRevision,
      batches: bodies.length,
      checks: 'command/feature outcomes, D1, auth, human/CI report totals and rendered counters passed',
    }),
  );
} finally {
  delete globalThis.__adoptionProducer;
  await browser?.close();
  await h.mf.dispose();
  await rm(scratch, { recursive: true, force: true });
}
