#!/usr/bin/env node
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { candidate } = require('./release-artifacts.cjs');
const { validateReleaseInputs } = require('./validate-release-inputs.cjs');
function validateOwnerInputs({ approval, readiness, runId, sha }) {
  for (const reference of [approval, readiness]) {
    if (
      typeof reference !== 'string' ||
      !/^https:\/\/github\.com\/1mcp-app\/agent\/(issues|pull)\/[0-9]+(?:#[-A-Za-z0-9]+)?$/.test(reference)
    ) {
      throw new Error('Required owner approval and approved #485 evidence references must be repository issue/PR URLs');
    }
  }
  if (Boolean(runId) !== Boolean(sha))
    throw new Error('Recovery requires original run ID and exact candidate SHA together');
  if (runId && (!/^[0-9]+$/.test(runId) || !/^[0-9a-f]{40}$/.test(sha))) throw new Error('Invalid recovery identity');
}
function verifyRecoveryRun(run, summary, identity, repository) {
  if (
    run.repository.full_name !== repository ||
    run.path !== '.github/workflows/release-pipeline.yml' ||
    run.event !== 'workflow_dispatch' ||
    run.status !== 'completed' ||
    ![
      'main',
      validateReleaseInputs({ targetRef: 'main', version: identity.version, tagExists: () => false })
        .expectedReleaseBranch,
    ].includes(run.head_branch)
  ) {
    throw new Error('Recovery run is not a completed owner-dispatched Release Pipeline in this repository');
  }
  if (summary.sha !== identity.sha || summary.version !== identity.version || summary.channel !== identity.channel)
    throw new Error('Recovery candidate identity mismatch');
  if (summary.jobs.ci.result !== 'success' || summary.jobs['native-security'].result !== 'success')
    throw new Error('Original release gates did not pass');
  if (summary.recoveryRunId) throw new Error('Select original artifact-producing run, not a recovery run');
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
    if (command === 'validate')
      validateOwnerInputs({
        approval: process.env.APPROVAL_REF,
        readiness: process.env.READINESS_REF,
        runId: process.env.RECOVERY_RUN_ID,
        sha: process.env.RELEASE_SHA,
      });
    else if (command === 'candidate') {
      let identity = candidate({
        sha: process.env.RELEASE_SHA,
        actualSha: process.env.RELEASE_SHA,
        version: process.env.VERSION,
        actualVersion: process.env.VERSION,
        npmTag: process.env.NPM_TAG,
      });
      const runId = process.env.RECOVERY_RUN_ID;
      if (runId) {
        const run = JSON.parse(gh(['api', `repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${runId}`]));
        fs.mkdirSync('recovery-evidence', { recursive: true });
        gh([
          'run',
          'download',
          runId,
          '--repo',
          process.env.GITHUB_REPOSITORY,
          '--name',
          'release-summary',
          '--dir',
          'recovery-evidence',
        ]);
        const summary = JSON.parse(fs.readFileSync('recovery-evidence/release-summary.json'));
        verifyRecoveryRun(run, summary, identity, process.env.GITHUB_REPOSITORY);
        // Select the verified original-run identity, not the raw dispatch string.
        identity = { ...identity, sha: summary.sha };
      }
      identity = resolveCandidateSource(
        { sha: identity.sha, version: identity.version, npmTag: identity.channel, releaseRef: process.env.RELEASE_REF },
        (args) => execFileSync('git', args, { encoding: args[0] === 'show' ? null : 'utf8' }),
      );
      fs.appendFileSync(
        process.env.GITHUB_OUTPUT,
        `release_sha=${identity.sha}\nartifact_run_id=${runId || process.env.GITHUB_RUN_ID}\n`,
      );
    } else throw new Error('Unknown recovery check');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { validateOwnerInputs, verifyRecoveryRun, resolveCandidateSource };
