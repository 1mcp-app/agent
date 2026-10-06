#!/usr/bin/env node
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { currentCandidate } = require('./release-artifacts.cjs');
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
    run.status !== 'completed'
  ) {
    throw new Error('Recovery run is not a completed owner-dispatched Release Pipeline in this repository');
  }
  if (summary.sha !== identity.sha || summary.version !== identity.version || summary.channel !== identity.channel)
    throw new Error('Recovery candidate identity mismatch');
  if (summary.jobs.ci.result !== 'success' || summary.jobs['native-security'].result !== 'success')
    throw new Error('Original release gates did not pass');
  if (summary.recoveryRunId) throw new Error('Select original artifact-producing run, not a recovery run');
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
      const identity = currentCandidate();
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
      }
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
module.exports = { validateOwnerInputs, verifyRecoveryRun };
