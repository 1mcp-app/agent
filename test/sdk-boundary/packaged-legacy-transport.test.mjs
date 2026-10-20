import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createRequire } from 'node:module';
import { test } from 'node:test';
import { parseAllDocuments } from 'yaml';

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
  ['pnpm-lock.yaml', (source) => source.replace(/75c775[0-9a-f]+/u, '0'.repeat(64)), /patch lock changed/u],
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

async function rewriteLock(directory, mutate) {
  const lockPath = path.join(directory, 'pnpm-lock.yaml');
  const documents = parseAllDocuments(await readFile(lockPath, 'utf8'));
  const document = documents.find((entry) => entry.getIn(['importers', '.', 'dependencies']));
  assert.ok(document);
  mutate(document);
  await writeFile(lockPath, documents.map((entry) => entry.toString()).join('\n'));
}

for (const representation of ['scalar', 'object']) {
  test(`generation accepts ${representation} patch metadata and optional color peers`, async (t) => {
    const directory = await fixture(t);
    await rewriteLock(directory, (document) => {
      const patchKey = ['patchedDependencies', '@modelcontextprotocol/sdk@1.30.0'];
      const hash = '75c775371ba4b626db950c68d95331c6e8c9a3949d551aba01d9d1332cb82937';
      document.setIn(
        patchKey,
        representation === 'scalar'
          ? hash
          : {
              path: 'patches/@modelcontextprotocol__sdk@1.30.0.patch',
              hash,
            },
      );
      document.setIn(
        ['importers', '.', 'dependencies', '@modelcontextprotocol/sdk', 'version'],
        `1.30.0(patch_hash=${hash})(supports-color@5.5.0)(zod@4.4.3)`,
      );
    });
    await vendorLegacyTransport(directory);
  });
}

for (const [keys, value, expected] of [
  [
    ['patchedDependencies', '@modelcontextprotocol/sdk@1.30.0'],
    {
      hash: '75c775371ba4b626db950c68d95331c6e8c9a3949d551aba01d9d1332cb82937',
      path: 'wrong.patch',
    },
    /patch lock changed/u,
  ],
  [
    ['importers', '.', 'dependencies', '@modelcontextprotocol/sdk', 'specifier'],
    '^1.30.0',
    /SDK installation lock changed/u,
  ],
  [
    ['importers', '.', 'dependencies', '@modelcontextprotocol/sdk', 'version'],
    '1.30.0(zod@4.4.3)',
    /SDK installation lock changed/u,
  ],
  [
    ['importers', '.', 'dependencies', '@modelcontextprotocol/sdk', 'version'],
    '1.30.0(patch_hash=75c775371ba4b626db950c68d95331c6e8c9a3949d551aba01d9d1332cb82937)(supports-color@5.5.0)(zod@4.5.0)',
    /SDK installation lock changed/u,
  ],
]) {
  test(`generation rejects changed parsed lock entry ${keys.join('.')}: ${value}`, async (t) => {
    const directory = await fixture(t);
    await rewriteLock(directory, (document) => document.setIn(keys, value));
    await assert.rejects(vendorLegacyTransport(directory), expected);
  });
}
