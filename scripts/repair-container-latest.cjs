#!/usr/bin/env node
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const path = require('node:path');

function manifestDigest(raw) {
  return 'sha256:' + createHash('sha256').update(raw).digest('hex');
}
function verifyManifest(manifest, expected) {
  const observed = manifest.manifests || [];
  if (observed.length !== 2) throw new Error('Expected exactly two image platforms');
  for (const architecture of ['amd64', 'arm64']) {
    const entries = observed.filter(
      (entry) => entry.platform?.os === 'linux' && entry.platform.architecture === architecture,
    );
    if (entries.length !== 1 || entries[0].digest !== expected[architecture])
      throw new Error('Published manifest differs from retained platform digests');
  }
}
function verifyRun(run, repository, version, tagSha) {
  if (!/^0\.38\.(0|[1-9][0-9]*)$/.test(version)) throw new Error('Only stable 0.38 maintenance releases are supported');
  if (
    run.repository?.full_name !== repository ||
    run.path !== '.github/workflows/release-pipeline.yml' ||
    run.event !== 'workflow_dispatch' ||
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    run.head_branch !== 'release-0.38'
  )
    throw new Error('Original maintenance release run did not pass');
  if (!/^[a-f0-9]{40}$/.test(tagSha)) throw new Error('Published release tag is not a commit');
}
function readback(image) {
  const raw = execFileSync('docker', ['buildx', 'imagetools', 'inspect', image, '--raw']);
  return { raw, digest: manifestDigest(raw), manifest: JSON.parse(raw) };
}
function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' }).trim();
}

if (require.main === module) {
  try {
    const repository = process.env.GITHUB_REPOSITORY;
    const image = `ghcr.io/${repository}`;
    if (process.argv[2] === 'validate') {
      const runId = process.env.RELEASE_RUN_ID;
      const version = process.env.VERSION;
      if (!/^[0-9]+$/.test(runId)) throw new Error('Invalid release run ID');
      const run = JSON.parse(gh(['api', `repos/${repository}/actions/runs/${runId}`]));
      const tag = JSON.parse(gh(['api', `repos/${repository}/git/ref/tags/v${version}`]));
      verifyRun(run, repository, version, tag.object.type === 'commit' ? tag.object.sha : '');
      const release = JSON.parse(gh(['api', `repos/${repository}/releases/tags/v${version}`]));
      if (release.draft || release.prerelease || release.target_commitish !== tag.object.sha)
        throw new Error('Published release identity mismatch');
      const latestRelease = JSON.parse(gh(['api', `repos/${repository}/releases/latest`]));
      if (latestRelease.tag_name !== `v${version}`) throw new Error('Refuse to move latest to an older release');
      const expected = {};
      for (const target of ['basic', 'extended']) {
        expected[target] = {};
        for (const architecture of ['amd64', 'arm64']) {
          const dir = path.join('repair-evidence', `${target}-${architecture}`);
          gh([
            'run',
            'download',
            runId,
            '--repo',
            repository,
            '--name',
            `docker-${target}-${architecture}`,
            '--dir',
            dir,
          ]);
          const files = fs.readdirSync(path.join(dir, 'digests'));
          if (files.length !== 1 || !/^[a-f0-9]{64}$/.test(files[0]))
            throw new Error('Retained digest missing or ambiguous');
          expected[target][architecture] = 'sha256:' + files[0];
        }
      }
      const extended = readback(`${image}:v${version}`);
      const basic = readback(`${image}:v${version}-lite`);
      verifyManifest(extended.manifest, expected.extended);
      verifyManifest(basic.manifest, expected.basic);
      const current = readback(`${image}:latest`);
      if (![extended.digest, basic.digest].includes(current.digest))
        throw new Error('Current latest is an unexpected version; stop for reconciliation');
      fs.writeFileSync(
        'container-repair.json',
        JSON.stringify({
          image,
          version,
          sha: tag.object.sha,
          runId,
          desired: extended.digest,
          previous: current.digest,
        }),
      );
    } else if (process.argv[2] === 'promote') {
      const identity = JSON.parse(fs.readFileSync('container-repair.json'));
      const version = readback(`${image}:v${identity.version}`);
      const current = readback(`${image}:latest`);
      if (version.digest !== identity.desired || ![identity.previous, identity.desired].includes(current.digest))
        throw new Error('Registry identity changed before promotion');
      if (current.digest !== identity.desired)
        execFileSync(
          'docker',
          ['buildx', 'imagetools', 'create', '--tag', `${image}:latest`, `${image}@${identity.desired}`],
          { stdio: 'inherit' },
        );
      if (readback(`${image}:latest`).digest !== identity.desired) throw new Error('Latest readback mismatch');
      fs.appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `Verified latest = ${image}@${identity.desired} from release run ${identity.runId}. No artifacts rebuilt.\n`,
      );
    } else throw new Error('Unknown repair phase');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { manifestDigest, verifyManifest, verifyRun };
