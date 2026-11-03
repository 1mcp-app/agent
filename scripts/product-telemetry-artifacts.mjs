import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function artifactRecord(role, file) {
  const bytes = await readFile(file);
  return {
    role,
    file: path.resolve(file),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

/** Recheck evidence inputs before accepting a distribution pair. */
export async function verifyArtifacts(manifest) {
  assert.equal(manifest.schemaVersion, 1, 'Unsupported product telemetry schema');
  for (const artifact of manifest.artifacts) {
    const actual = await artifactRecord(artifact.role, artifact.file);
    assert.equal(actual.sha256, artifact.sha256, `Artifact changed: ${artifact.role}`);
    assert.equal(actual.bytes, artifact.bytes, `Artifact changed: ${artifact.role}`);
  }
}
