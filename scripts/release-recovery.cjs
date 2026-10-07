#!/usr/bin/env node
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { candidate } = require('./release-artifacts.cjs');
const { validateReleaseInputs } = require('./validate-release-inputs.cjs');

function verifyRecoveryRun(run, summary, repository, runId) {
  if (
    run.repository?.full_name !== repository ||
    String(run.id) !== runId ||
    run.path !== '.github/workflows/release-pipeline.yml' ||
    run.event !== 'workflow_dispatch' ||
    run.status !== 'completed' ||
    !Number.isSafeInteger(run.run_attempt) ||
    run.run_attempt < 1
  ) {
    throw new Error('Recovery run is not a completed maintainer-dispatched Release Pipeline in this repository');
  }
  if (
    String(summary.runId) !== runId ||
    String(summary.artifactRunId) !== runId ||
    String(summary.attempt) !== String(run.run_attempt) ||
    summary.runUrl !== `https://github.com/${repository}/actions/runs/${runId}`
  ) {
    throw new Error('Recovery summary does not belong to the selected original run and attempt');
  }
  if (summary.recoveryRunId) throw new Error('Select original artifact-producing run, not a recovery run');
  if (!summary.releaseRef || typeof summary.version !== 'string' || !summary.channel)
    throw new Error('Original summary lacks release identity; stop for maintainer reconciliation');
  const policy = validateReleaseInputs({
    targetRef: summary.releaseRef,
    version: summary.version,
    tagExists: () => false,
  });
  if (!['main', policy.expectedReleaseBranch].includes(run.head_branch))
    throw new Error('Recovery run was dispatched from an unapproved branch');
  if (summary.channel !== policy.npmTag) throw new Error('Recovery candidate channel mismatch');
  const identity = candidate({
    sha: summary.sha,
    actualSha: summary.sha,
    version: summary.version,
    actualVersion: summary.version,
    npmTag: summary.channel,
  });
  if (summary.jobs?.ci?.result !== 'success' || summary.jobs?.['native-security']?.result !== 'success')
    throw new Error('Original release gates did not pass');
  const requiredChecks = [
    'static',
    'unit-admin',
    'test-e2e-parallel',
    'test-e2e-system',
    'test-e2e-browser',
    'test-conformance',
    'test-legacy-upgrade',
    'test-windows-installer',
    'release-lifecycle',
  ];
  const gates = summary.gates;
  if (
    gates?.sha !== identity.sha ||
    gates.ci !== 'success' ||
    gates.infrastructureVerdict !== 'green' ||
    gates.productVerdict !== 'green' ||
    requiredChecks.some((name) => gates.checks?.[name]?.result !== 'success') ||
    Object.values(gates.checks || {}).some((check) => check.result !== 'success')
  )
    throw new Error('Original exact-source release gate evidence is missing or not green');
  return { policy, identity };
}

function resolveDispatch({ runId, targetRef, version }, readRecovery) {
  if (runId) {
    if (!/^[0-9]+$/.test(runId)) throw new Error('Invalid recovery run ID');
    if (version) throw new Error('Recovery uses the original version; leave version empty');
    return readRecovery(runId);
  }
  if (!version) throw new Error('version is required for a new release');
  return { policy: validateReleaseInputs({ targetRef: targetRef || 'main', version }) };
}

function resolveCandidateSource({ sha, version, npmTag, releaseRef }, git) {
  const policy = validateReleaseInputs({ targetRef: releaseRef, version, tagExists: () => false });
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('Invalid candidate SHA');
  const actualSha = git(['rev-parse', `${sha}^{commit}`]).trim();
  // Only parse data from the candidate. Never execute its validation scripts before binding.
  const actualVersion = JSON.parse(git(['show', `${actualSha}:package.json`])).version;
  const actionPath = '.github/actions/setup-node-pnpm/action.yml';
  const policyError =
    'Candidate setup action differs from trusted dispatch revision; owner must align the release branch cache policy before a new release. Recovery must retain the original candidate and stop for owner reconciliation.';
  let candidateAction;
  let trustedAction;
  try {
    candidateAction = git(['show', `${actualSha}:${actionPath}`]);
    trustedAction = git(['show', `HEAD:${actionPath}`]);
  } catch {
    throw new Error(policyError);
  }
  if (!Buffer.from(candidateAction).equals(Buffer.from(trustedAction))) throw new Error(policyError);
  git(['merge-base', '--is-ancestor', actualSha, `refs/remotes/origin/${policy.targetRef}`]);
  return candidate({ sha, actualSha, version, actualVersion, npmTag });
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' }).trim();
}

if (require.main === module) {
  try {
    const command = process.argv[2];
    const runId = process.env.RECOVERY_RUN_ID;
    if (command === 'validate') {
      const { policy, identity } = resolveDispatch(
        { runId, targetRef: process.env.TARGET_REF, version: process.env.VERSION },
        (originalRunId) => {
          const repository = process.env.GITHUB_REPOSITORY;
          const run = JSON.parse(gh(['api', `repos/${repository}/actions/runs/${originalRunId}`]));
          fs.mkdirSync('recovery-evidence', { recursive: true });
          gh([
            'run',
            'download',
            originalRunId,
            '--repo',
            repository,
            '--name',
            'release-summary',
            '--dir',
            'recovery-evidence',
          ]);
          const summary = JSON.parse(fs.readFileSync('recovery-evidence/release-summary.json', 'utf8'));
          return verifyRecoveryRun(run, summary, repository, originalRunId);
        },
      );
      const outputs = {
        version: policy.version,
        version_tag: policy.versionTag,
        release_ref: policy.targetRef,
        expected_release_branch: policy.expectedReleaseBranch,
        is_prerelease: String(policy.isPrerelease),
        npm_tag: policy.npmTag,
        docker_raw_tag: policy.dockerRawTag,
        release_sha: identity?.sha || '',
        artifact_run_id: runId || process.env.GITHUB_RUN_ID,
      };
      fs.appendFileSync(
        process.env.GITHUB_OUTPUT,
        Object.entries(outputs)
          .map(([key, value]) => `${key}=${value}\n`)
          .join(''),
      );
    } else if (command === 'candidate') {
      const identity = resolveCandidateSource(
        {
          sha: process.env.RELEASE_SHA,
          version: process.env.VERSION,
          npmTag: process.env.NPM_TAG,
          releaseRef: process.env.RELEASE_REF,
        },
        (args) => execFileSync('git', args, { encoding: args[0] === 'show' ? null : 'utf8' }),
      );
      fs.appendFileSync(
        process.env.GITHUB_OUTPUT,
        `release_sha=${identity.sha}\nartifact_run_id=${process.env.ARTIFACT_RUN_ID}\n`,
      );
    } else throw new Error('Unknown recovery check');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { resolveDispatch, verifyRecoveryRun, resolveCandidateSource };
