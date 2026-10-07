const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parse } = require('yaml');

const script = path.resolve('scripts/release-recovery.cjs');

test('publication preserves signed dispatch identity when candidate preparation advances HEAD', (t) => {
  const workflow = parse(fs.readFileSync('.github/workflows/publish-to-npm.yml', 'utf8'));
  const publish = workflow.jobs.publish.steps.find((step) => step.run?.includes('release-publications.cjs versions'));
  assert.ok(publish);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-provenance-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const node = path.join(directory, 'node');
  fs.writeFileSync(node, '#!/bin/sh\nprintf "%s\\n" "$GITHUB_SHA" "$GITHUB_REF" "$RELEASE_SHA"\n', { mode: 0o755 });
  const dispatchSha = 'a'.repeat(40);
  const candidateSha = 'b'.repeat(40);
  const result = spawnSync('bash', ['-e', '-c', publish.run], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${directory}${path.delimiter}${process.env.PATH}`,
      GITHUB_SHA: dispatchSha,
      GITHUB_REF: 'refs/heads/main',
      RELEASE_SHA: candidateSha,
      RELEASE_REF: 'main',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split('\n'), [dispatchSha, 'refs/heads/main', candidateSha]);
});

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
  // Preload the command boundary in the child Node process, avoiding platform-specific executables.
  const preload = path.join(directory, 'fake-tools.cjs');
  fs.writeFileSync(
    preload,
    `const fs = require('node:fs');
const path = require('node:path');
require('node:child_process').execFileSync = (command, args) => {
  if (command === 'git' && args[0] === 'ls-remote') {
    const error = new Error('Tag absent');
    error.status = 2;
    throw error;
  }
  if (command === 'gh' && args[0] === 'api') return ${JSON.stringify(JSON.stringify(run))};
  if (command === 'gh' && args[0] === 'run' && args[1] === 'download') {
    fs.writeFileSync(path.join(args[args.indexOf('--dir') + 1], 'release-summary.json'), ${JSON.stringify(JSON.stringify(summary))});
    return '';
  }
  throw new Error('Unexpected external command');
};
`,
  );
  const result = spawnSync(process.execPath, ['--require', preload, script, 'validate'], {
    cwd: directory,
    encoding: 'utf8',
    env: {
      ...process.env,
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
