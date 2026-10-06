#!/usr/bin/env node
// Only invoked by the protected release environment, never by always-run collection.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const summary = JSON.parse(fs.readFileSync('release-summary.json', 'utf8'));
const repository = process.env.GITHUB_REPOSITORY;
function query(endpoint) {
  return JSON.parse(execFileSync('gh', ['api', `repos/${repository}/${endpoint}`], { encoding: 'utf8' }));
}
try {
  if (summary.publications.github?.status !== 'verified')
    throw new Error('No verified release for evidence attachment');
  const release = query(`releases/tags/v${summary.version}`);
  let object = query(`git/ref/tags/v${summary.version}`).object;
  if (object.type === 'tag') object = query(`git/tags/${object.sha}`).object;
  if (
    object.type !== 'commit' ||
    object.sha !== summary.sha ||
    release.draft ||
    release.prerelease !== summary.version.includes('-')
  )
    throw new Error('Release identity changed before summary attachment');
  const assetName = `release-summary-${summary.runId}-${summary.attempt}.json`;
  const asset = release.assets.find((item) => item.name === assetName);
  if (asset) throw new Error('Summary asset already exists; owner must verify existing evidence');
  summary.evidenceAttachment = 'upload attempted from protected attach-summary job; job outcome is authoritative';
  fs.writeFileSync(assetName, JSON.stringify(summary, null, 2) + '\n');
  execFileSync('gh', ['release', 'upload', `v${summary.version}`, assetName, '--repo', repository], {
    stdio: 'inherit',
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
