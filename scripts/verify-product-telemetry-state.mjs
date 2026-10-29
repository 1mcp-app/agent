#!/usr/bin/env node
/** Synthetic state + ordinary suppressed CLI controls; never starts a collector or uses operator state. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { build } from 'esbuild';

import { createTestProcessEnvironment, isolatedTestEnvironment } from './test-process-environment.mjs';

const execute = promisify(execFile);
const agent = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isolated = isolatedTestEnvironment();
const scratch = await mkdtemp(path.join(os.tmpdir(), 'product-state-smoke-'));
const binary = process.argv.includes('--binary')
  ? path.resolve(process.argv[process.argv.indexOf('--binary') + 1])
  : undefined;
const output = process.argv.includes('--out')
  ? path.resolve(process.argv[process.argv.indexOf('--out') + 1])
  : undefined;
const root = path.join(
  isolated.env.HOME,
  process.platform === 'win32' ? 'AppData/Roaming/1mcp/product-telemetry' : '.config/1mcp/product-telemetry',
);
const secondScope = path.join(scratch, 'other-runtime-scope');
await mkdir(secondScope, { mode: 0o700 });
const bundle = path.join(scratch, 'state.mjs');
await build({
  stdin: {
    contents: `export { InstallationStore } from './src/productTelemetry/installationStore.ts'; export { verifyInstallationPrivacy, secureNewInstallationEntry } from './src/productTelemetry/permissions.ts';`,
    resolveDir: agent,
  },
  outfile: bundle,
  bundle: true,
  format: 'esm',
  platform: 'node',
});
const { InstallationStore, verifyInstallationPrivacy, secureNewInstallationEntry } = await import(
  pathToFileURL(bundle).href
);
const environment = createTestProcessEnvironment({
  ...isolated.env,
  CI: 'true',
  ONE_MCP_PRODUCT_TELEMETRY: 'true',
  ONE_MCP_PRODUCT_TELEMETRY_CI: 'true',
});
const run = async (args) => {
  const result = await execute(
    binary ?? process.execPath,
    [...(binary ? [] : [path.join(agent, 'build/index.js')]), ...args],
    { env: environment, timeout: 60000, maxBuffer: 1024 * 1024 },
  );
  assert.equal(result.stderr, '');
  return result.stdout;
};
const control = async (action) =>
  JSON.parse(
    await run([
      'telemetry',
      action,
      '--json',
      '--context',
      'nonexistent-synthetic-remote',
      '--url',
      'http://127.0.0.1:1/mcp',
      '--config-dir',
      secondScope,
      '--product-telemetry-test-suppressed=false',
    ]),
  );
const stateFile = path.join(root, 'state.json');
const store = new InstallationStore(root, { notice: () => {} });
try {
  await run(['--help']);
  await run(['--version']);
  await run(['inspect', '--help']);
  assert.deepEqual(await control('status'), {
    preference: 'default',
    identityPresent: false,
    queuedSummaries: 0,
    coordination: 'available',
    collectionEnabled: false,
  });
  await assert.rejects(stat(root));
  assert.equal((await control('enable')).identityPresent, false);
  const first = await store.admit();
  assert(first);
  const facts = {
    occurred_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    version: '0.39.2',
    os: 'win32',
    arch: 'x64',
    node_major: 24,
    ci: false,
    counters: [
      {
        kind: 'command',
        name: 'inspect',
        outcome: 'success',
        transport: 'none',
        client: 'none',
        bucket: 'none',
        count: 1,
      },
    ],
  };
  await store.append(first, facts);
  const before = await readFile(stateFile, 'utf8');
  await run([
    'inspect',
    '--help',
    '--product-telemetry=true',
    '--product-telemetry-ci=true',
    '--product-telemetry-test-suppressed=false',
  ]);
  assert.equal(await readFile(stateFile, 'utf8'), before);
  const status = await control('status');
  assert.equal(status.identityPresent, true);
  assert.equal(status.queuedSummaries, 1);
  assert.equal(status.collectionEnabled, false);
  assert.equal((await control('disable')).preference, 'disabled');
  assert.equal((await store.status()).queuedSummaries, 0);
  assert.equal((await control('enable')).identityPresent, true);
  const preserved = await store.admit();
  assert.equal(preserved.installationId, first.installationId);
  assert.equal((await control('reset')).identityPresent, false);
  assert.equal((await store.status()).preference, 'enabled');
  assert.equal(await store.append(first, facts), false);
  const second = await store.admit();
  assert.notEqual(second.installationId, first.installationId);
  await verifyInstallationPrivacy(root);
  if (process.platform === 'win32') await assert.rejects(secureNewInstallationEntry(stateFile, false));
  await control('disable');
  await control('reset');
  assert.equal(await store.admit(), undefined);
  assert.equal((await store.status()).preference, 'disabled');
  assert.equal((await store.status()).identityPresent, false);
  let foreignPopulatedRefused = 'not-applicable';
  if (process.platform === 'win32') {
    const executable = path.win32.join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    const tokenScript =
      "$i=[Security.Principal.WindowsIdentity]::GetCurrent(); if($i.Owner.Value -ne $i.User.Value){'different'}else{'same'}";
    const token = await execute(
      executable,
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(tokenScript, 'utf16le').toString('base64')],
      { timeout: 10000 },
    );
    if (token.stdout.trim() === 'different') {
      const foreignRoot = path.join(scratch, 'foreign-populated');
      await mkdir(foreignRoot, { mode: 0o700 });
      await verifyInstallationPrivacy(foreignRoot, { created: true });
      await writeFile(path.join(foreignRoot, 'populated.json'), '{"synthetic":true}', { mode: 0o600 });
      await assert.rejects(verifyInstallationPrivacy(foreignRoot));
      foreignPopulatedRefused = true;
    } else foreignPopulatedRefused = 'token-owner-is-user';
  }
  const evidence = {
    artifact: binary ? 'SEA' : 'Node',
    sourceRevision: (await execute('git', ['rev-parse', 'HEAD'], { cwd: agent })).stdout.trim(),
    binarySha256: binary
      ? createHash('sha256')
          .update(await readFile(binary))
          .digest('hex')
      : undefined,
    platform: process.platform,
    arch: process.arch,
    node: process.versions.node,
    ownerAndAclVerified: true,
    foreignPopulatedRefused,
    helpVersionStatusInert: true,
    controlsRemainLocal: true,
    scopesShareIdentity: true,
    disableRetainsIdentity: true,
    resetPreservesPreference: true,
    staleGenerationRejected: true,
    ordinaryCollectionSuppressed: true,
    collectorRequests: 0,
  };
  if (output) await writeFile(output, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(evidence));
} finally {
  await rm(scratch, { recursive: true, force: true });
  isolated.cleanup();
}
