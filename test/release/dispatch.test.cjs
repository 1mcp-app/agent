const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const script = path.resolve('scripts/release-recovery.cjs');

function dispatch(t, inputs, summaryOverrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-dispatch-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'outputs');
  const run = {
    id: 123,
    run_attempt: 1,
    repository: { full_name: '1mcp-app/agent' },
    path: '.github/workflows/release-pipeline.yml',
    event: 'workflow_dispatch',
    status: 'completed',
    head_branch: 'main',
  };
  const summary = {
    runId: '123',
    artifactRunId: '123',
    attempt: '1',
    runUrl: 'https://github.com/1mcp-app/agent/actions/runs/123',
    sha: 'a'.repeat(40),
    version: '1.2.3-beta.1',
    channel: 'next',
    releaseRef: 'release-1.2',
    jobs: { ci: { result: 'success' }, 'native-security': { result: 'success' } },
    ...summaryOverrides,
  };
  fs.writeFileSync(
    path.join(directory, 'gh'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'api') console.log(${JSON.stringify(JSON.stringify(run))});
else if (args[0] === 'run' && args[1] === 'download') {
  fs.writeFileSync(args[args.indexOf('--dir') + 1] + '/release-summary.json', ${JSON.stringify(JSON.stringify(summary))});
} else process.exit(99);
`,
    { mode: 0o755 },
  );
  // The real version validator still checks remote tag absence; no network is used.
  fs.writeFileSync(path.join(directory, 'git'), '#!/bin/sh\nexit 2\n', { mode: 0o755 });
  const result = spawnSync(process.execPath, [script, 'validate'], {
    cwd: directory,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${directory}${path.delimiter}${process.env.PATH}`,
      GITHUB_OUTPUT: output,
      GITHUB_RUN_ID: '456',
      GITHUB_REPOSITORY: '1mcp-app/agent',
      RECOVERY_RUN_ID: '',
      VERSION: '',
      TARGET_REF: '',
      ...inputs,
    },
  });
  const outputs = fs.existsSync(output)
    ? Object.fromEntries(
        fs
          .readFileSync(output, 'utf8')
          .trim()
          .split('\n')
          .map((line) => line.split('=')),
      )
    : {};
  return { result, outputs };
}

test('new release CLI needs only a version and emits source/channel/artifact outputs', (t) => {
  const { result, outputs } = dispatch(t, { VERSION: '1.2.3' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(outputs.release_ref, 'main');
  assert.equal(outputs.version_tag, 'v1.2.3');
  assert.equal(outputs.npm_tag, 'latest');
  assert.equal(outputs.release_sha, '');
  assert.equal(outputs.artifact_run_id, '456');
});

test('recovery CLI derives all workflow outputs from the selected original run', (t) => {
  const { result, outputs } = dispatch(t, { RECOVERY_RUN_ID: '123', TARGET_REF: 'main' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(outputs.version, '1.2.3-beta.1');
  assert.equal(outputs.version_tag, 'v1.2.3-beta.1');
  assert.equal(outputs.release_ref, 'release-1.2');
  assert.equal(outputs.expected_release_branch, 'release-1.2');
  assert.equal(outputs.npm_tag, 'next');
  assert.equal(outputs.docker_raw_tag, 'beta');
  assert.equal(outputs.is_prerelease, 'true');
  assert.equal(outputs.release_sha, 'a'.repeat(40));
  assert.equal(outputs.artifact_run_id, '123');
});

test('invalid or historical recovery evidence emits no usable workflow outputs', (t) => {
  for (const overrides of [{ releaseRef: undefined }, { attempt: '2' }, { artifactRunId: '999' }]) {
    const { result, outputs } = dispatch(t, { RECOVERY_RUN_ID: '123' }, overrides);
    assert.equal(result.status, 1);
    assert.deepEqual(outputs, {});
  }
});
