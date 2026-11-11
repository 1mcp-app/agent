#!/usr/bin/env node
/** Installed producer + real CLI SEA + service distribution; synthetic and local destinations only. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';
import { createRequire } from 'node:module';

import { artifactRecord, verifyArtifacts } from './product-telemetry-artifacts.mjs';
import { isolatedTestEnvironment } from './test-process-environment.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const option = (name) => {
  assert(process.argv.includes(name), `Pass ${name}`);
  return path.resolve(process.argv[process.argv.indexOf(name) + 1]);
};
const service = option('--service');
const installed = option('--package');
const archive = option('--archive');
const sea = option('--sea');
const out = option('--out');
assert.equal(Number(process.versions.node.split('.')[0]), 24, 'Use Node 24');
await mkdir(out, { recursive: true, mode: 0o700 });
const revision = (cwd) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
assert.equal(revision(service), '034b40fbf644e7a10df009c6554721b54318c9a6');
assert.equal(
  execFileSync('git', ['status', '--porcelain'], { cwd: service, encoding: 'utf8' }),
  '',
  'Clean pinned service required',
);
const metadata = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'));
assert.equal(metadata.name, '@1mcp/agent');
const run = (executable, args, options = {}) =>
  execFileSync(executable, args, { encoding: 'utf8', timeout: 30000, ...options });
const artifacts = [];
async function record(role, file) {
  artifacts.push(await artifactRecord(role, file));
}
await record('npm-tarball', archive);
await record('real-cli-sea', sea);
await record('installed-package-metadata', path.join(installed, 'package.json'));
await record('installation-lockfile', path.resolve(installed, '../../../package-lock.json'));
// Manifest all installed runtime bytes, including dependencies copied into the retained SDK island.
async function inventory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await inventory(file);
    else if (entry.isFile()) await record('installed/' + path.relative(installed, file), file);
    else assert.fail('Unexpected non-file in installed runtime');
  }
}
await inventory(path.join(installed, 'build'));
assert(
  !artifacts.some((a) => /telemetry\/(?:src|dist)\//.test(a.role)),
  'Service implementation must stay outside agent',
);
const controls = [];
for (const [name, executable, prefix] of [
  ['installed-node-cli', process.execPath, [path.join(installed, 'build/index.js')]],
  ['real-cli-sea', sea, []],
]) {
  const scope = isolatedTestEnvironment();
  try {
    const invoke = (args) =>
      run(executable, [...prefix, ...args], {
        cwd: scope.env.ONE_MCP_CONFIG_DIR,
        env: { ...scope.env, CI: 'true', ONE_MCP_PRODUCT_TELEMETRY: 'true', ONE_MCP_PRODUCT_TELEMETRY_CI: 'true' },
      });
    const status = () => JSON.parse(invoke(['telemetry', 'status', '--json']));
    invoke(['--version']);
    invoke(['--help']);
    assert.equal(status().identityPresent, false);
    invoke(['telemetry', 'enable']);
    assert.equal(status().preference, 'enabled');
    // A real short command, enabled environment and CI opt-in remain hard test-suppressed.
    invoke(['mcp', 'list']);
    assert.equal(status().identityPresent, false);
    assert.equal(status().queuedSummaries, 0);
    invoke(['telemetry', 'disable']);
    assert.equal(status().preference, 'disabled');
    invoke(['telemetry', 'reset']);
    assert.equal(status().preference, 'disabled');
    assert.equal(status().identityPresent, false);
    assert.equal(status().queuedSummaries, 0);
    controls.push({
      artifact: name,
      controls: 'enable/disable/reset/status',
      suppression: 'hard test suppression despite enable+CI opt-in',
      identity: false,
    });
  } finally {
    scope.cleanup();
  }
}

// Separate facade fixture compiled ONLY from installed package modules. Never a production CLI escape hatch.
const fixture = path.join(out, 'synthetic-producer.cjs');
const packageModule = (name) => JSON.stringify(path.join(installed, 'build/productTelemetry', name + '.js'));
await build({
  stdin: {
    contents: `
import { ProductUsageProducer } from ${packageModule('producer')};
import { InstallationStore } from ${packageModule('installationStore')};
import { labels } from ${packageModule('contract')};
import { collectionEnabled } from ${packageModule('policy')};
import fs from 'node:fs/promises';
import path from 'node:path';
(async () => {
 const output = process.argv[2]; const now = Number(process.argv[3]); const bodies=[];
 const policy={ testSuppressed:false, ci:false };
 if (!collectionEnabled(policy)) throw Error('default policy');
 for (const blocked of [{testSuppressed:true,ciEnabled:true},{doNotTrack:true,processEnabled:true},{storedEnabled:false,processEnabled:true},{processEnabled:false,ciEnabled:true},{ci:true}])
  if (collectionEnabled({...policy,...blocked})) throw Error('disable precedence');
 if (!collectionEnabled({...policy,ci:true,ciEnabled:true})) throw Error('CI opt-in');
 for (const ci of [false,true]) {
  const store = new InstallationStore(path.join(output,ci?'ci':'human'), {notice:()=>{}, now:()=>now});
  for (const time of [now-2*86400000,now]) {
   const producer = new ProductUsageProducer({store,now:()=>time,dimensions:{version:${JSON.stringify(metadata.version)},os:process.platform,arch:process.arch,node_major:24,ci}, dispatch:body=>{bodies.push(body)}});
   await producer.settled();
   for (const name of labels.command) {producer.beginCommand(name).finish('success'); await producer.settled();}
   producer.beginRuntimeStartup().finish('success'); await producer.settled();
   for (const name of labels.operation) {producer.recordOperation(name,'failure','http','codex'); await producer.settled();}
   for (const name of labels.feature) {producer.recordFeature(name,'success'); await producer.settled();}
   producer.observeConfiguration('servers',3); producer.observeConfiguration('tools',0);
   producer.beginCommand('inspect').finish('failure'); await producer.settled();
  }
  const before=(await store.admit()).installationId;
  await store.control('disable'); if (!(await store.status()).identityPresent) throw Error('disable identity');
  await store.control('enable'); if ((await store.admit()).installationId!==before) throw Error('reenable identity');
  await store.control('reset'); if ((await store.status()).identityPresent) throw Error('reset identity');
  if ((await store.admit()).installationId===before) throw Error('fresh identity');
 }
 await fs.writeFile(path.join(output,'bodies.json'), JSON.stringify(bodies));
})().catch(e=>{console.error(e);process.exitCode=1});
`,
    resolveDir: installed,
  },
  outfile: fixture,
  platform: 'node',
  format: 'cjs',
  bundle: true,
});
await record('synthetic-packed-producer-node', fixture);
const config = path.join(out, 'synthetic-sea.json');
const blob = path.join(out, 'synthetic.blob');
await writeFile(
  config,
  JSON.stringify({
    main: fixture,
    output: blob,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
  }),
);
run(process.execPath, ['--experimental-sea-config', config]);
const syntheticSEA = path.join(out, process.platform === 'win32' ? 'synthetic.exe' : 'synthetic');
await copyFile(process.execPath, syntheticSEA);
await chmod(syntheticSEA, 0o700);
if (process.platform === 'darwin') run('codesign', ['--remove-signature', syntheticSEA]);
const inject = [
  path.join(root, 'node_modules/postject/dist/cli.js'),
  syntheticSEA,
  'NODE_SEA_BLOB',
  blob,
  '--sentinel-fuse',
  'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
];
if (process.platform === 'darwin') inject.push('--macho-segment-name', 'NODE_SEA');
run(process.execPath, inject);
if (process.platform === 'darwin')
  run('codesign', ['--sign', '-', '--entitlements', path.join(root, 'entitlements.plist'), syntheticSEA]);
await record('synthetic-packed-producer-sea', syntheticSEA);
const now = Math.floor(Date.now() / 1000) * 1000;
const bodies = [];
for (const [name, exe, prefix] of [
  ['node', process.execPath, [fixture]],
  ['sea', syntheticSEA, []],
]) {
  const directory = path.join(out, name);
  await mkdir(directory, { mode: 0o700 });
  const scope = isolatedTestEnvironment();
  try {
    run(exe, [...prefix, directory, String(now)], { env: scope.env, cwd: directory });
  } finally {
    scope.cleanup();
  }
  bodies.push(...JSON.parse(await readFile(path.join(directory, 'bodies.json'), 'utf8')));
}

// Execute the canonical service release build; only ignored dist output changes, never source.
const serviceDist = path.join(out, 'service');
run(process.execPath, [path.join(service, 'scripts/build.mjs')], { cwd: service });
await mkdir(serviceDist, { mode: 0o700 });
for (const name of ['ingest.js', 'dashboard.js'])
  await copyFile(path.join(service, 'dist', name), path.join(serviceDist, name));
for (const name of ['ingest.js', 'dashboard.js'])
  await record('service-distribution/' + name, path.join(serviceDist, name));
await record('service-migration', path.join(service, 'migrations/0001_service.sql'));
const requireService = createRequire(path.join(service, 'package.json'));
const { Miniflare, convertV4MiniflareOptions } = requireService('miniflare');
const { generateKeyPair, exportJWK, SignJWT } = await import(pathToFileURL(requireService.resolve('jose')).href);
const issuer = 'https://test-team.cloudflareaccess.com';
const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256', use: 'sig' };
const token = async (overrides = {}, options = {}) =>
  new SignJWT({ email: 'maintainer@1mcp.app', type: 'app', ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? 'test-aud')
    .setSubject('synthetic')
    .setIssuedAt()
    .setExpirationTime(options.expiry ?? '1h')
    .sign(privateKey);
const base = { modules: true, compatibilityDate: '2026-10-19', d1Databases: { DB: 'distribution-db' } };
const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      {
        ...base,
        name: 'ingest',
        script: await readFile(path.join(serviceDist, 'ingest.js'), 'utf8'),
        bindings: { INGEST_HOST: 'ingest.test' },
        ratelimits: { INTAKE_LIMITER: { namespace_id: '1001', simple: { limit: 10000, period: 60 } } },
      },
      {
        ...base,
        name: 'dashboard',
        script: await readFile(path.join(serviceDist, 'dashboard.js'), 'utf8'),
        bindings: {
          DASHBOARD_HOST: 'dashboard.test',
          ACCESS_ISSUER: issuer,
          ACCESS_AUDIENCE: 'test-aud',
          ACCESS_EMAIL_DOMAIN: '1mcp.app',
        },
        outboundService: async (request) =>
          request.url === issuer + '/cdn-cgi/access/certs'
            ? Response.json({ keys: [jwk] })
            : new Response('Blocked', 403),
      },
      {
        ...base,
        name: 'unconfigured-dashboard',
        script: await readFile(path.join(serviceDist, 'dashboard.js'), 'utf8'),
        bindings: { DASHBOARD_HOST: 'dashboard.test' },
        outboundService: async () => new Response('Blocked', 403),
      },
    ],
  }),
);
let browser;
try {
  const db = await mf.getD1Database('DB', 'ingest');
  const ingest = await mf.getWorker('ingest');
  const dashboard = await mf.getWorker('dashboard');
  const migrate = async () =>
    db.batch(
      (await readFile(path.join(service, 'migrations/0001_service.sql'), 'utf8'))
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => db.prepare(s)),
    );
  const send = (body) =>
    ingest.fetch('https://ingest.test/v1/summaries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
  // Missing schema fails safely. The same bytes remain valid after schema-first migration.
  assert.equal((await send(bodies[0])).status, 503);
  await migrate();
  for (const body of bodies) assert.equal((await send(body)).status, 201);
  assert.equal((await send(bodies[0])).status, 200);
  for (const change of [
    (e) => {
      e.schema_version = 2;
    },
    (e) => {
      e.extra = 'forbidden';
    },
    (e) => {
      e.summaries[0].url = 'forbidden';
    },
    (e) => {
      e.summaries[0].counters[0].name = 'unknown';
    },
  ]) {
    const envelope = JSON.parse(bodies[0]);
    change(envelope);
    assert.equal((await send(JSON.stringify(envelope))).status, 400);
  }
  const stored = await db.prepare('SELECT * FROM summaries').all();
  assert.equal(stored.results.length, bodies.length);
  await writeFile(path.join(out, 'stored.json'), JSON.stringify(stored.results, null, 2));
  const serialized = bodies.join('\n');
  for (const forbidden of ['request_id', 'runtime_scope', 'trace_id', 'authorization', 'url', 'raw_error'])
    assert(!serialized.includes('"' + forbidden + '"'));
  assert.equal(bodies.length, 304, 'Two artifacts x two segments x two days x 38 facts');
  const headers = { 'Cf-Access-Jwt-Assertion': await token() };
  const day = (t) => new Date(t).toISOString().slice(0, 10);
  const range = `?from=${day(now - 3 * 86400000)}&to=${day(now)}`;
  const readReport = async (ci = false) => {
    const response = await dashboard.fetch('https://dashboard.test/api/report' + range + (ci ? '&ci=true' : ''), {
      headers,
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const pending = await readReport();
  assert.equal(pending.freshness.pending_days, 2);
  // Invoke the shipped scheduled handler against the same local D1 binding; no source helper imports.
  const ingestModule = await import(pathToFileURL(path.join(serviceDist, 'ingest.js')).href);
  await ingestModule.default.scheduled({}, { DB: db });
  await ingestModule.default.scheduled({}, { DB: db });
  const human = await readReport();
  const ci = await readReport(true);
  assert.equal(human.observed_installations, 2);
  assert.equal(human.cohorts[0].installations, 2);
  assert.equal(ci.cohorts.length, 0);
  assert.equal(ci.observed_installations, 2);
  for (const report of [human, ci]) {
    for (const [kind, count] of [
      ['command', 72],
      ['feature', 44],
      ['operation', 36],
      ['configuration', 8],
    ])
      assert.equal(
        report.measures.filter((m) => m.kind === kind).reduce((n, m) => n + m.count, 0),
        count,
      );
    assert.equal(report.measures.find((m) => m.kind === 'configuration' && m.name === 'servers').bucket, '2-5');
    assert.equal(report.measures.find((m) => m.kind === 'configuration' && m.name === 'tools').bucket, '0');
    assert.equal(report.freshness.pending_days, 0);
    assert(report.days.some((d) => d.state === 'missing'));
    assert(report.days.some((d) => d.state === 'provisional'));
    for (const [kind, name, outcome, count] of [
      ['command', 'inspect', 'success', 4],
      ['command', 'inspect', 'failure', 4],
      ['feature', 'runtime_start', 'success', 8],
      ['operation', 'tools_call', 'failure', 4],
      ['configuration', 'servers', 'observation', 4],
      ['configuration', 'tools', 'observation', 4],
    ]) {
      assert.equal(
        report.measures
          .filter((m) => m.kind === kind && m.name === name && m.outcome === outcome)
          .reduce((n, m) => n + m.count, 0),
        count,
        `${kind}/${name}/${outcome}`,
      );
    }
    for (const [dimension, value] of [
      ['version', metadata.version],
      ['os', process.platform],
      ['arch', process.arch],
      ['node_major', '24'],
    ])
      assert(
        report.segments.some(
          (s) => s.dimension === dimension && s.values.some((v) => v.value === value && v.installations === 2),
        ),
      );
  }
  const unconfigured = await mf.getWorker('unconfigured-dashboard');
  assert.equal((await unconfigured.fetch('https://dashboard.test/', { headers })).status, 403);
  const auth = [];
  for (const route of ['/', '/app.js', '/style.css', '/api/report' + range]) {
    for (const assertion of [
      undefined,
      'invalid',
      await token({ email: 'outside@example.test' }),
      await token({}, { issuer: 'https://wrong.test' }),
      await token({}, { audience: 'wrong' }),
      await token({}, { expiry: Math.floor(now / 1000) - 3600 }),
    ]) {
      const response = await dashboard.fetch('https://dashboard.test' + route, {
        headers: assertion ? { 'Cf-Access-Jwt-Assertion': assertion } : {},
      });
      assert.equal(response.status, 403);
    }
    assert.equal((await dashboard.fetch('https://preview.test' + route, { headers })).status, 404);
    assert.equal((await dashboard.fetch('https://dashboard.test' + route, { headers })).status, 200);
    auth.push({ route, missingInvalidOutside: 403, alternateHost: 404, valid: 200 });
  }
  assert.equal(
    (await dashboard.fetch('https://dashboard.test/api/report' + range, { method: 'POST', headers })).status,
    405,
  );
  const late = JSON.parse(bodies[0]);
  late.batch_id = crypto.randomUUID();
  assert.equal((await send(JSON.stringify(late))).status, 201);
  const stale = await readReport();
  assert(stale.days.some((d) => d.state === 'stale'));
  await db
    .prepare('UPDATE service_health SET rolled_up_at=? WHERE id=1')
    .bind(new Date(now - 3 * 3600000).toISOString())
    .run();
  const elapsed = await readReport();
  assert.equal(elapsed.freshness.rollup_stale, true);
  let selected = human;
  let unavailable = false;
  const { chromium } = requireService('@playwright/test');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.route('https://dashboard.test/**', async (route) => {
    if (new URL(route.request().url()).pathname === '/api/report') {
      await route.fulfill({
        status: unavailable ? 503 : 200,
        contentType: 'application/json',
        body: JSON.stringify(unavailable ? { error: 'report_unavailable' } : selected),
      });
      return;
    }

    const response = await dashboard.fetch(route.request().url(), { headers });
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
  const rendered = await page.locator('#report').innerText();
  for (const value of [
    'tools_call',
    'runtime_start',
    'servers',
    'inspect',
    metadata.version,
    process.platform,
    process.arch,
  ])
    assert(rendered.includes(value), value);
  await page.screenshot({ path: path.join(out, 'dashboard.png'), fullPage: true });
  for (const [name, data] of [
    ['pending', pending],
    ['stale', stale],
    ['elapsed', elapsed],
  ]) {
    selected = data;
    await page.reload();
    await page.waitForFunction(
      () =>
        !globalThis.document.querySelector('#report').hidden &&
        globalThis.document.querySelector('#report').getAttribute('aria-busy') === 'false',
    );
    await page.getByText('Daily values & coverage', { exact: true }).click();
    if (name === 'stale') assert((await page.locator('#daily').innerText()).includes('stale'));
    if (name === 'pending' || name === 'elapsed')
      assert((await page.locator('#freshness-note').innerText()).includes('incomplete or stale'));
    await page.screenshot({ path: path.join(out, name + '.png'), fullPage: true });
  }
  selected = ci;
  await page.getByLabel('Activity', { exact: true }).selectOption('true');
  await page.locator('#filters button').click();
  await page.waitForFunction(() => globalThis.document.querySelector('#report').getAttribute('aria-busy') === 'false');
  await page.screenshot({ path: path.join(out, 'ci.png'), fullPage: true });

  // Advance only the directly imported distribution scheduled handler clock; Worker report clocks remain real.
  const originalNow = Date.now;
  try {
    Date.now = () => now + 91 * 86400000;
    await ingestModule.default.scheduled({}, { DB: db });
  } finally {
    Date.now = originalNow;
  }
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM summaries').first()).n, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM activity').first()).n, 8);
  try {
    Date.now = () => now + 367 * 86400000;
    await ingestModule.default.scheduled({}, { DB: db });
  } finally {
    Date.now = originalNow;
  }
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM activity').first()).n, 0);
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS n FROM daily_reports').first()).n,
    2,
    'UUID-free totals survive retention',
  );
  // The original supported bytes still ingest into the unchanged schema after retention (rollback compatibility).
  const rollback = JSON.parse(bodies[0]);
  rollback.batch_id = crypto.randomUUID();
  assert.equal((await send(JSON.stringify(rollback))).status, 201);
  await db.prepare('DROP TABLE summaries').run();
  const failedReport = await dashboard.fetch('https://dashboard.test/api/report' + range, { headers });
  assert.equal(failedReport.status, 503);
  assert.deepEqual(await failedReport.json(), { error: 'report_unavailable' });
  unavailable = true;
  await page.locator('#filters button').click();
  await page.locator('#status.error').waitFor();
  assert.equal(await page.locator('#report').isVisible(), false);
  const manifest = {
    agentRevision: revision(root),
    serviceRevision: revision(service),
    schemaVersion: 1,
    version: metadata.version,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    proof: {
      realCLI: controls,
      syntheticCollection: 'installed modules in separate Node/SEA fixtures',
      service: 'release entrypoint bundles, local Miniflare/D1, signed synthetic Access and intercepted local browser',
      liveActivation: false,
    },
    artifacts,
  };
  await verifyArtifacts(manifest);
  for (const [name, data] of Object.entries({
    manifest,
    reports: { pending, human, ci, stale, elapsed },
    acceptance: {
      auth,
      rendered,
      retention: { detailDays: 91, linkedDays: 367, aggregateDaysPreserved: 2 },
      rollback: 'schema 1 remains accepted after retention',
    },
  }))
    await writeFile(path.join(out, name + '.json'), JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  console.log(
    JSON.stringify({
      agentRevision: manifest.agentRevision,
      serviceRevision: manifest.serviceRevision,
      batches: bodies.length,
      artifacts: artifacts.length,
      checks:
        'installed Node + real CLI SEA controls, packaged synthetic Node/SEA facts -> service bundles -> D1/schedule/auth/report/render/retention/rollback',
    }),
  );
} finally {
  await browser?.close();
  await mf.dispose();
}
