const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifyManifest, verifyRun } = require('../../scripts/repair-container-latest.cjs');
const expected = { amd64: 'sha256:a', arm64: 'sha256:b' };
const manifest = {
  manifests: Object.entries(expected).map(([architecture, digest]) => ({
    platform: { os: 'linux', architecture },
    digest,
  })),
};
test('accepts only the retained two-platform manifest', () => {
  verifyManifest(manifest, expected);
  assert.throws(() => verifyManifest({ manifests: manifest.manifests.slice(0, 1) }, expected));
  assert.throws(() => verifyManifest(manifest, { ...expected, amd64: 'sha256:c' }));
  assert.throws(() => verifyManifest({ manifests: [manifest.manifests[0], manifest.manifests[0]] }, expected));
});
const run = {
  repository: { full_name: '1mcp-app/agent' },
  path: '.github/workflows/release-pipeline.yml',
  event: 'workflow_dispatch',
  status: 'completed',
  conclusion: 'success',
  head_branch: 'release-0.38',
};
test('rejects failed runs, other branches, prereleases and other minor lines', () => {
  verifyRun(run, '1mcp-app/agent', '0.38.3', 'a'.repeat(40));
  for (const changed of [{ conclusion: 'failure' }, { head_branch: 'main' }, { event: 'pull_request' }])
    assert.throws(() => verifyRun({ ...run, ...changed }, '1mcp-app/agent', '0.38.3', 'a'.repeat(40)));
  for (const version of ['0.39.0', '0.38.3-beta.1'])
    assert.throws(() => verifyRun(run, '1mcp-app/agent', version, 'a'.repeat(40)));
});
