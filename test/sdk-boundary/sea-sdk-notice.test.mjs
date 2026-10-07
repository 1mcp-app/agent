import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Script } from 'node:vm';

import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { retainLegacySdkNotice } = require('../../scripts/build-sea.cjs');
const sdkRoot = path.resolve(
  path.dirname(require.resolve('@modelcontextprotocol/sdk/server/streamableHttp.js')),
  '../../..',
);
const license = await readFile(path.join(sdkRoot, 'LICENSE'), 'utf8');
const licenseSha256 = createHash('sha256').update(license).digest('hex');

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), '1mcp-sea-notice-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const island = path.join(root, 'build/sdk/legacy/server/retained-sdk');
  await mkdir(island, { recursive: true });
  await writeFile(path.join(island, 'LICENSE'), license);
  const provenance = `${JSON.stringify({ package: '@modelcontextprotocol/sdk', version: '1.30.0', licenseSha256, files: {} }, null, 2)}\n`;
  await writeFile(path.join(island, 'provenance.json'), provenance);
  return { root, island, provenance };
}

for (const code of ['"use strict";\n42;\n', '#!/usr/bin/env node\n"use strict";\n42;\n']) {
  test(`SEA source retains the complete exact SDK notice and provenance; shebang=${code.startsWith('#!')}`, async (t) => {
    const { root, provenance } = await fixture(t);
    const generated = retainLegacySdkNotice(code, root);
    assert.ok(generated.includes(license));
    assert.ok(generated.includes(provenance));
    assert.equal(new Script(generated).runInNewContext(), 42);
    assert.equal(retainLegacySdkNotice(code, root), generated);
    assert.equal(generated.startsWith('#!'), code.startsWith('#!'));
  });
}

test('SEA refuses a changed upstream copyright or permission notice', async (t) => {
  const { root, island } = await fixture(t);
  await writeFile(path.join(island, 'LICENSE'), license.replace('Anthropic, PBC', 'changed owner'));
  assert.throws(() => retainLegacySdkNotice('42;', root), /license changed/u);
});

test('SEA refuses inconsistent license provenance', async (t) => {
  const { root, island, provenance } = await fixture(t);
  await writeFile(path.join(island, 'provenance.json'), provenance.replace(licenseSha256, '0'.repeat(64)));
  assert.throws(() => retainLegacySdkNotice('42;', root), /license changed/u);
});

test('SEA refuses injected comment terminators in provenance', async (t) => {
  const { root, island, provenance } = await fixture(t);
  await writeFile(path.join(island, 'provenance.json'), provenance.replace('"files": {}', '"files": {"*/": "unsafe"}'));
  assert.throws(() => retainLegacySdkNotice('42;', root), /comment terminator/u);
});
