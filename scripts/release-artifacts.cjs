#!/usr/bin/env node
// Bounded release identity checks. No network or publication side effects.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { validateReleaseInputs } = require('./validate-release-inputs.cjs');

function candidate({ sha, actualSha, version, actualVersion, npmTag }) {
  if (!/^[0-9a-f]{40}$/.test(sha) || sha !== actualSha) throw new Error('Candidate SHA mismatch');
  if (version !== actualVersion) throw new Error('Candidate version mismatch');
  const policy = validateReleaseInputs({ targetRef: 'main', version, tagExists: () => false });
  if (npmTag && policy.npmTag !== npmTag) throw new Error('Candidate channel mismatch');
  return { sha, version, channel: policy.npmTag, versionTag: policy.versionTag };
}
function checksum(file, algorithm = 'sha256') {
  return createHash(algorithm)
    .update(fs.readFileSync(file))
    .digest(algorithm === 'sha512' ? 'base64' : 'hex');
}
function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(file) : [file];
  });
}
function loadArtifacts(directory, expected) {
  const manifests = filesIn(directory).filter((file) => /(?:npm|sea-|oci-).*\.json$/.test(path.basename(file)));
  const records = manifests.map((file) => {
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    candidate({ ...expected, actualSha: record.sha, actualVersion: record.version, npmTag: record.channel });
    if (record.smoke !== 'passed') throw new Error('Untested artifact');
    for (const artifact of record.files || []) {
      const artifactPath = path.join(path.dirname(file), artifact.name);
      if (checksum(artifactPath) !== artifact.sha256) throw new Error('Artifact checksum mismatch');
      if (artifact.integrity && `sha512-${checksum(artifactPath, 'sha512')}` !== artifact.integrity) {
        throw new Error('Package integrity mismatch');
      }
    }
    if (record.kind.startsWith('oci-') && !/^sha256:[0-9a-f]{64}$/.test(record.digest))
      throw new Error('Invalid OCI digest');
    return { ...record, manifestPath: file };
  });
  const required = [
    'npm',
    'sea-linux-x64',
    'sea-linux-arm64',
    'sea-win32-x64',
    'sea-darwin-x64',
    'sea-darwin-arm64',
    'oci-basic-amd64',
    'oci-basic-arm64',
    'oci-extended-amd64',
    'oci-extended-arm64',
  ];
  if (
    records.length !== required.length ||
    required.some((kind) => records.filter((record) => record.kind === kind).length !== 1)
  ) {
    throw new Error('Missing or duplicate tested artifact identities');
  }
  return records;
}
function recordArtifacts(directory, kind, identity) {
  fs.mkdirSync(directory, { recursive: true });
  const files = fs
    .readdirSync(directory)
    .filter((file) => /\.(tgz|tar\.gz|zip)$/.test(file))
    .sort()
    .map((name) => ({
      name,
      sha256: checksum(path.join(directory, name)),
      ...(kind === 'npm' ? { integrity: `sha512-${checksum(path.join(directory, name), 'sha512')}` } : {}),
    }));
  if (files.length !== 1) throw new Error('Expected exactly one retained archive');
  const record = { ...identity, kind, smoke: 'passed', files };
  fs.writeFileSync(path.join(directory, `${kind}.json`), JSON.stringify(record, null, 2) + '\n');
  return record;
}
function currentCandidate() {
  return candidate({
    sha: process.env.RELEASE_SHA,
    version: process.env.VERSION,
    actualSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    actualVersion: JSON.parse(fs.readFileSync('package.json', 'utf8')).version,
    npmTag: process.env.NPM_TAG,
  });
}
if (require.main === module) {
  try {
    const [command, directory] = process.argv.slice(2);
    const identity = currentCandidate();
    if (command === 'candidate') console.log(JSON.stringify(identity));
    else if (command === 'record') recordArtifacts(directory, process.env.ARTIFACT_KIND, identity);
    else if (command === 'record-digest') {
      const digest = process.env.BUILD_DIGEST;
      if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error('Invalid OCI digest');
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(
        path.join(directory, `${process.env.ARTIFACT_KIND}.json`),
        JSON.stringify({ ...identity, kind: process.env.ARTIFACT_KIND, digest, smoke: 'passed' }) + '\n',
      );
    } else throw new Error('Unknown release identity command');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = {
  candidate,
  checksum,
  filesIn,
  loadArtifacts,
  recordArtifacts,
  currentCandidate,
};
