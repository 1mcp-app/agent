import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createRequire } from 'node:module';
import { test } from 'node:test';

import { sha256, transformTransport, vendorLegacyTransport } from '../../scripts/vendor-legacy-transport.mjs';

const root = process.cwd();
const sdkRoot = path.resolve(
  path.dirname(createRequire(import.meta.url).resolve('@modelcontextprotocol/sdk/server/streamableHttp.js')),
  '../../..',
);

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), '1mcp-retained-transport-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'patches']) {
    await cp(path.join(root, file), path.join(directory, file), { recursive: true });
  }
  await symlink(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
  await mkdir(path.join(directory, 'build/sdk/legacy/server'), { recursive: true });
  await writeFile(
    path.join(directory, 'build/sdk/legacy/server/streamableHttp.js'),
    "export * from '@modelcontextprotocol/sdk/server/streamableHttp.js';\n",
  );
  return directory;
}

test('generated transport retains exact corrected SDK code with deterministic provenance', async (t) => {
  const directory = await fixture(t);
  await vendorLegacyTransport(directory);
  const output = path.join(directory, 'build/sdk/legacy/server/retained-sdk');
  const provenance = JSON.parse(await readFile(path.join(output, 'provenance.json'), 'utf8'));
  assert.equal(provenance.version, '1.30.0');
  for (const name of ['streamableHttp.js', 'webStandardStreamableHttp.js']) {
    const source = await readFile(path.join(sdkRoot, 'dist/esm/server', name), 'utf8');
    const generated = await readFile(path.join(output, name), 'utf8');
    assert.equal(generated, transformTransport(name, source));
    assert.equal(provenance.files[name].sourceSha256, sha256(source));
    assert.equal(provenance.files[name].generatedSha256, sha256(generated));
    assert.equal(generated.includes('sourceMappingURL='), false);
  }
  assert.equal(
    await readFile(path.join(output, 'LICENSE'), 'utf8'),
    await readFile(path.join(sdkRoot, 'LICENSE'), 'utf8'),
  );
  assert.equal(
    await readFile(path.join(directory, 'build/sdk/legacy/server/streamableHttp.js'), 'utf8'),
    "export * from './retained-sdk/streamableHttp.js';\n",
  );
  await writeFile(
    path.join(directory, 'build/sdk/legacy/server/streamableHttp.js'),
    "export * from '@modelcontextprotocol/sdk/server/streamableHttp.js';\n",
  );
  const original = await readFile(path.join(output, 'provenance.json'), 'utf8');
  await vendorLegacyTransport(directory);
  assert.equal(await readFile(path.join(output, 'provenance.json'), 'utf8'), original);
});

for (const [file, mutate, expected] of [
  [
    'package.json',
    (source) => source.replace('"@modelcontextprotocol/sdk": "1.30.0"', '"@modelcontextprotocol/sdk": "1.32.1"'),
    /SDK pin changed/u,
  ],
  [
    'package.json',
    (source) => source.replace('"@hono/node-server": "2.0.12"', '"@hono/node-server": "2.0.13"'),
    /adapter pin changed/u,
  ],
  ['patches/@modelcontextprotocol__sdk@1.30.0.patch', (source) => `${source}\n`, /patch changed/u],
  ['pnpm-lock.yaml', (source) => source.replace('hash: 75c775', 'hash: 000000'), /patch lock changed/u],
  [
    'pnpm-lock.yaml',
    (source) => source.replace('version: 2.0.12(hono@4.12.34)', 'version: 2.0.12(hono@4.12.35)'),
    /adapter installation lock changed/u,
  ],
  ['pnpm-workspace.yaml', (source) => source.replace('patches/', 'missing/'), /configuration changed/u],
]) {
  test(`generation rejects changed ${file}: ${expected}`, async (t) => {
    const directory = await fixture(t);
    const filePath = path.join(directory, file);
    await writeFile(filePath, mutate(await readFile(filePath, 'utf8')));
    await assert.rejects(vendorLegacyTransport(directory), expected);
  });
}

test('generation rejects raw or modified upstream transport code', async () => {
  const source = await readFile(path.join(sdkRoot, 'dist/esm/server/webStandardStreamableHttp.js'), 'utf8');
  assert.throws(
    () =>
      transformTransport('webStandardStreamableHttp.js', source.replace('id: options?.requestId ?? null', 'id: null')),
    /Unexpected pinned SDK source/u,
  );
  assert.throws(
    () => transformTransport('webStandardStreamableHttp.js', `${source}\n`),
    /Unexpected pinned SDK source/u,
  );
});
