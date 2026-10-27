const assert = require('node:assert/strict');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

test('distribution evidence rejects changed bytes and unsupported contract versions', async () => {
  const { artifactRecord, verifyArtifacts } = await import('../../scripts/product-telemetry-artifacts.mjs');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'telemetry-manifest-'));
  try {
    const file = path.join(directory, 'producer.js');
    await writeFile(file, 'packaged production bytes');
    const manifest = { schemaVersion: 1, artifacts: [await artifactRecord('installed-producer', file)] };
    await verifyArtifacts(manifest);
    await assert.rejects(verifyArtifacts({ ...manifest, schemaVersion: 2 }), /Unsupported/);
    await writeFile(file, 'changed after acceptance');
    await assert.rejects(verifyArtifacts(manifest), /Artifact changed/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
