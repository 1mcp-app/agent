import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const [binaryPath, archivePath] = process.argv.slice(2);
if (!binaryPath || !archivePath) throw new Error('Usage: sea-notice-proof.mjs binary archive.tar.gz');
const island = path.join(process.cwd(), 'build/sdk/legacy/server/retained-sdk');
const license = await readFile(path.join(island, 'LICENSE'));
const provenance = await readFile(path.join(island, 'provenance.json'));
const binary = await readFile(binaryPath);
assert.equal(
  createHash('sha256').update(license).digest('hex'),
  '5e13dbbc1d120fc2a03cecde7c91424ae2d7de11b63d58ded2f4431e261ee50d',
);
assert.ok(binary.includes(license), 'Native SEA binary must contain the complete exact upstream MIT notice');
assert.ok(binary.includes(provenance), 'Native SEA binary must contain exact retained source provenance');
const entries = execFileSync('tar', ['-tzf', archivePath], { encoding: 'utf8' }).trim().split('\n');
assert.deepEqual(entries, [path.basename(binaryPath)]);
const archivedBinary = execFileSync('tar', ['-xOzf', archivePath, entries[0]], { maxBuffer: binary.length + 1024 });
assert.deepEqual(archivedBinary, binary);
assert.ok(archivedBinary.includes(license));
assert.ok(archivedBinary.includes(provenance));
console.log(
  JSON.stringify({
    binarySha256: createHash('sha256').update(binary).digest('hex'),
    archiveSha256: createHash('sha256')
      .update(await readFile(archivePath))
      .digest('hex'),
    completeMitNotice: true,
    exactSourceProvenance: true,
    archiveEntries: entries,
    passed: true,
  }),
);
