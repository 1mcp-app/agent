#!/usr/bin/env node
const fs = require('node:fs');
const { filesIn } = require('./release-artifacts.cjs');
function summarize({
  sha,
  version,
  channel,
  jobs,
  records,
  runUrl,
  releaseUrl,
  releaseRef,
  dispatchActor,
  triggeringActor,
  recoveryRunId,
  artifactRunId,
  runId,
  attempt,
}) {
  const publication = records
    .filter((record) => record.publications)
    .sort((a, b) => Number(a.phase === 'promote') - Number(b.phase === 'promote'))
    .at(-1);
  return {
    schemaVersion: 2,
    releaseRef: releaseRef || null,
    authorization: { method: 'workflow_dispatch', dispatchActor, triggeringActor, runUrl },
    sha: sha || null,
    version,
    channel: channel || null,
    runId,
    attempt,
    runUrl,
    releaseUrl,
    artifactRunId,
    recoveryRunId: recoveryRunId || null,
    gateRunUrl: runUrl,
    gates: records.find((record) => record.checks && record.ci) || null,
    jobs,
    artifacts: records.filter((record) => record.kind),
    publications: publication?.publications || {},
    aliases: publication?.aliases || {},
    publicationStatus: publication?.status || 'not-attempted-or-evidence-unavailable',
    error: publication?.error || null,
    outcome:
      Object.values(jobs).every((job) => ['success', 'skipped'].includes(job.result)) &&
      jobs.release?.result === 'success'
        ? 'complete'
        : 'incomplete',
    recovery: 'Owner must re-query exact identities; attempting means uncertain, never replay blindly',
    evidenceAttachment: 'not-attempted',
  };
}
if (require.main === module) {
  const records = fs.existsSync('summary-evidence')
    ? filesIn('summary-evidence')
        .filter((file) => file.endsWith('.json'))
        .flatMap((file) => {
          try {
            return [JSON.parse(fs.readFileSync(file, 'utf8'))];
          } catch {
            return [];
          }
        })
    : [];
  const repository = process.env.GITHUB_REPOSITORY;
  const runUrl = `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  const summary = summarize({
    sha: process.env.RELEASE_SHA,
    version: process.env.VERSION,
    channel: process.env.NPM_TAG,
    jobs: JSON.parse(process.env.JOB_RESULTS),
    records,
    runUrl,
    releaseUrl: `https://github.com/${repository}/releases/tag/v${process.env.VERSION}`,
    releaseRef: process.env.RELEASE_REF,
    dispatchActor: process.env.DISPATCH_ACTOR,
    triggeringActor: process.env.TRIGGERING_ACTOR,
    recoveryRunId: process.env.RECOVERY_RUN_ID,
    artifactRunId: process.env.ARTIFACT_RUN_ID,
    runId: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
  });
  const save = () => fs.writeFileSync('release-summary.json', JSON.stringify(summary, null, 2) + '\n');
  save();
  if (summary.publications.github?.status === 'verified') {
    const assetName = `release-summary-${summary.runId}-${summary.attempt}.json`;
    summary.evidenceAssetUrl = `${summary.releaseUrl.replace('/tag/', '/download/')}/${assetName}`;
    summary.evidenceAttachment = 'delegated to protected attach-summary job; inspect its outcome';
    save();
  }
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `github_verified=${summary.publications.github?.status === 'verified'}\n`,
    );
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `Release evidence: [run](${runUrl}), [release](${summary.releaseUrl}); outcome: ${summary.outcome}.\n`,
  );
}
module.exports = { summarize };
