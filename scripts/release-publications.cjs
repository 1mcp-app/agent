#!/usr/bin/env node
// Three fixed publication readbacks and explicit owner resume; never rebuilds.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { candidate, currentCandidate, checksum, loadArtifacts } = require('./release-artifacts.cjs');
function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function ghApi(endpoint) {
  try {
    return JSON.parse(run('gh', ['api', endpoint]));
  } catch (error) {
    if (String(error.stderr).includes('(HTTP 404)')) return null;
    throw new Error(`GitHub readback ambiguous: ${endpoint}`);
  }
}
async function npmReadback(version, timeoutMs = 30000) {
  const response = await fetch(`https://registry.npmjs.org/@1mcp%2fagent/${encodeURIComponent(version)}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`npm readback ambiguous: HTTP ${response.status}`);
  const metadata = await response.json();
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata))
    throw new Error('npm readback ambiguous: malformed registry metadata');
  return metadata;
}
function dockerReadback(reference, execute = run) {
  try {
    return JSON.parse(execute('docker', ['buildx', 'imagetools', 'inspect', reference, '--raw']));
  } catch (error) {
    const message = String(error.stderr);
    if (message.includes('manifest unknown') || message.includes('MANIFEST_UNKNOWN')) return null;
    if (message.trim() === `ERROR: ${reference}: not found`) return null;
    throw new Error('OCI readback ambiguous');
  }
}
function verifyNpm(observed, identity, artifact) {
  if (observed === null || observed === undefined)
    throw new Error('npm immutable identity mismatch or ambiguity: version absent');
  for (const [field, actual, expected] of [
    ['name', observed.name, '@1mcp/agent'],
    ['version', observed.version, identity.version],
    ['gitHead', observed.gitHead, identity.sha],
    ['integrity', observed.dist?.integrity, artifact.integrity],
  ]) {
    if (actual !== expected) throw new Error(`npm immutable identity mismatch or ambiguity: ${field} differs`);
  }
}

async function pollNpmReadback(readback, ready, failure, wait = delay) {
  const deadline = Date.now() + 10 * 60 * 1000;
  for (let attempt = 0; attempt < 40; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(failure);
    const observed = await readback(Math.min(30000, remaining));
    if (ready(observed)) return;
    if (attempt === 39) throw new Error(failure);
    await wait(Math.max(0, Math.min(15000, deadline - Date.now())));
  }
}
async function waitForPublishedNpm(readNpm, identity, artifact, wait) {
  // npm accepted this write. Poll only readback; never replay the publish command.
  await pollNpmReadback(
    (timeoutMs) => readNpm(identity.version, timeoutMs),
    (observed) => {
      if (observed === null) return false;
      verifyNpm(observed, identity, artifact);
      return true;
    },
    'npm immutable identity mismatch or ambiguity: version absent',
    wait,
  );
}
async function npmTagsReadback(timeoutMs = 30000) {
  const response = await fetch('https://registry.npmjs.org/@1mcp%2fagent', {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'Cache-Control': 'no-cache' },
  });
  if (!response.ok) throw new Error(`npm tag readback ambiguous: HTTP ${response.status}`);
  const metadata = await response.json();
  const tags = metadata?.['dist-tags'];
  if (
    !tags ||
    typeof tags !== 'object' ||
    Array.isArray(tags) ||
    Object.values(tags).some((version) => typeof version !== 'string' || !version)
  )
    throw new Error('npm tag readback ambiguous: malformed registry metadata');
  return tags;
}
async function waitForNpmAlias(readTags, identity, previous, wait) {
  await pollNpmReadback(
    readTags,
    (tags) => {
      const observed = tags[identity.channel];
      if (observed === identity.version) return true;
      if (observed !== previous) throw new Error('npm alias readback conflict');
      return false;
    },
    'npm alias readback mismatch after propagation deadline',
    wait,
  );
}
function verifyOci(observed, identity, digests) {
  const expected = [...digests].sort();
  const actual = observed?.manifests?.map((manifest) => manifest.digest).sort();
  if (
    !observed ||
    observed.annotations?.['org.opencontainers.image.revision'] !== identity.sha ||
    observed.annotations?.['org.opencontainers.image.version'] !== identity.version ||
    JSON.stringify(actual) !== JSON.stringify(expected)
  ) {
    throw new Error('OCI immutable identity mismatch or ambiguity');
  }
  const platforms = observed.manifests
    .map((manifest) => `${manifest.platform?.os}/${manifest.platform?.architecture}`)
    .sort();
  if (JSON.stringify(platforms) !== JSON.stringify(['linux/amd64', 'linux/arm64']))
    throw new Error('OCI platform identity mismatch');
}
function aliasNames(identity, target) {
  candidate({ ...identity, actualSha: identity.sha, actualVersion: identity.version, npmTag: identity.channel });
  if (identity.version.includes('-'))
    return target === 'extended' ? [identity.version.slice(identity.version.indexOf('-') + 1).split('.')[0]] : [];
  const [major, minor] = identity.version.split('.');
  const suffix = target === 'basic' ? '-lite' : '';
  return [target === 'basic' ? 'lite' : 'latest', `v${major}${suffix}`, `v${major}.${minor}${suffix}`];
}
function publicationDecision(observed, recovery) {
  if (observed === null) return 'publish-missing';
  if (!recovery) throw new Error('Publication already exists; select explicit owner recovery');
  return 'verify-existing';
}
async function main(command, options = {}) {
  const statePath = options.statePath || 'publication-state.json';
  const readbackDirectory = options.readbackDirectory || 'readback';
  const identity = options.identity || currentCandidate();
  const records = options.records || loadArtifacts('artifacts', identity);
  const execute = options.run || run;
  const readNpm = options.npmReadback || npmReadback;
  const readTags = options.npmTagsReadback || npmTagsReadback;
  const readOci = options.dockerReadback || dockerReadback;
  const readGithub = options.ghApi || ghApi;
  const repository = options.repository || process.env.GITHUB_REPOSITORY;
  const image = `ghcr.io/${repository.toLowerCase()}`;
  const recovery = options.recovery ?? process.env.RECOVERY === 'true';
  const state = fs.existsSync(statePath)
    ? JSON.parse(fs.readFileSync(statePath, 'utf8'))
    : { ...identity, publications: {}, aliases: {}, recovery, status: 'in-progress' };
  state.phase = command;
  const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
  const mark = (section, name, value) => {
    state[section][name] = value;
    save();
  };
  const npm = records.find((record) => record.kind === 'npm');
  const packageFile = path.join(path.dirname(npm.manifestPath), npm.files[0].name);
  const endpoint = `repos/${repository}`;
  async function verifyVersions() {
    verifyNpm(await readNpm(identity.version), identity, npm.files[0]);
    mark('publications', 'npm', {
      status: 'verified',
      integrity: npm.files[0].integrity,
      url: `https://www.npmjs.com/package/@1mcp/agent/v/${identity.version}`,
    });
    for (const target of ['basic', 'extended']) {
      const tag = identity.versionTag + (target === 'basic' ? '-lite' : '');
      const digests = records
        .filter((record) => record.kind.startsWith(`oci-${target}-`))
        .map((record) => record.digest);
      const observed = readOci(`${image}:${tag}`);
      verifyOci(observed, identity, digests);
      const digest =
        'sha256:' +
        execute('docker', [
          'buildx',
          'imagetools',
          'inspect',
          `${image}:${tag}`,
          '--format',
          '{{.Manifest.Digest}}',
        ]).replace(/^sha256:/, '');
      if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error('Invalid published OCI index digest');
      // The immutable reference must itself describe the same tested platforms.
      verifyOci(readOci(`${image}@${digest}`), identity, digests);
      mark('publications', `oci-${target}`, {
        status: 'verified',
        digest,
        platforms: digests,
        reference: `${image}@${digest}`,
      });
    }
    const release = readGithub(`${endpoint}/releases/tags/${identity.versionTag}`);
    let tag = readGithub(`${endpoint}/git/ref/tags/${identity.versionTag}`);
    if (tag?.object?.type === 'tag') tag = { object: readGithub(`${endpoint}/git/tags/${tag.object.sha}`)?.object };
    if (
      !release ||
      release.draft ||
      release.prerelease !== identity.version.includes('-') ||
      tag?.object?.type !== 'commit' ||
      tag.object.sha !== identity.sha
    )
      throw new Error('GitHub release/tag identity mismatch or ambiguity');
    for (const record of records.filter((item) => item.kind.startsWith('sea-'))) {
      for (const file of record.files) {
        const assets = release.assets.filter((asset) => asset.name === file.name);
        if (assets.length !== 1) throw new Error('GitHub binary asset missing or ambiguous');
        const local = path.join(readbackDirectory, file.name);
        fs.mkdirSync(readbackDirectory, { recursive: true });
        execute('gh', [
          'release',
          'download',
          identity.versionTag,
          '--repo',
          repository,
          '--pattern',
          file.name,
          '--dir',
          readbackDirectory,
          '--clobber',
        ]);
        if (checksum(local) !== file.sha256) throw new Error('GitHub binary checksum mismatch');
      }
    }
    mark('publications', 'github', {
      status: 'verified',
      url: release.html_url,
      tagSha: tag.object.sha,
      assets: release.assets.map((asset) => ({ name: asset.name, digest: asset.digest })),
    });
  }
  try {
    save();
    if (command === 'versions') {
      // Preflight all existing identities before any write. A readback error is never absence.
      const observedNpm = await readNpm(identity.version);
      const npmDecision = publicationDecision(observedNpm, recovery);
      if (observedNpm) verifyNpm(observedNpm, identity, npm.files[0]);
      const oci = ['basic', 'extended'].map((target) => {
        const tag = identity.versionTag + (target === 'basic' ? '-lite' : '');
        const digests = records
          .filter((record) => record.kind.startsWith(`oci-${target}-`))
          .map((record) => record.digest);
        const observed = readOci(`${image}:${tag}`);
        const decision = publicationDecision(observed, recovery);
        if (observed) verifyOci(observed, identity, digests);
        return { target, tag, digests, decision };
      });
      const release = readGithub(`${endpoint}/releases/tags/${identity.versionTag}`);
      const tag = readGithub(`${endpoint}/git/ref/tags/${identity.versionTag}`);
      if (release || tag) {
        if (!recovery || !release || !tag) throw new Error('Existing GitHub identity ambiguous; owner action required');
        let object = tag.object;
        if (object.type === 'tag') object = readGithub(`${endpoint}/git/tags/${object.sha}`)?.object;
        if (
          object?.type !== 'commit' ||
          object.sha !== identity.sha ||
          release.draft ||
          release.prerelease !== identity.version.includes('-')
        )
          throw new Error('Existing GitHub candidate mismatch');
        // Existing assets must match. Missing assets may be uploaded explicitly in recovery.
        for (const record of records.filter((item) => item.kind.startsWith('sea-'))) {
          for (const file of record.files) {
            const assets = release.assets.filter((asset) => asset.name === file.name);
            if (assets.length > 1) throw new Error('Ambiguous GitHub assets');
            if (assets.length === 1) {
              fs.mkdirSync(readbackDirectory, { recursive: true });
              execute('gh', [
                'release',
                'download',
                identity.versionTag,
                '--repo',
                repository,
                '--pattern',
                file.name,
                '--dir',
                readbackDirectory,
                '--clobber',
              ]);
              if (checksum(path.join(readbackDirectory, file.name)) !== file.sha256)
                throw new Error('Existing GitHub asset mismatch');
            }
          }
        }
      }
      if (npmDecision === 'publish-missing') {
        mark('publications', 'npm', { status: 'attempting' });
        const output = execute('npm', [
          'publish',
          packageFile,
          '--access',
          'public',
          '--provenance',
          '--tag',
          `candidate-${identity.version.replace(/[^A-Za-z0-9-]/g, '-')}`,
        ]);
        // Record command completion without copying npm inventories or credential-bearing diagnostics.
        mark('publications', 'npm', {
          status: 'attempting',
          commandCompleted: true,
          acknowledged: String(output).trim() === `+ @1mcp/agent@${identity.version}`,
        });
        await waitForPublishedNpm(readNpm, identity, npm.files[0], options.waitForNpmReadback);
        mark('publications', 'npm', { status: 'verified', integrity: npm.files[0].integrity });
      }
      for (const item of oci) {
        if (item.decision === 'publish-missing') {
          mark('publications', `oci-${item.target}`, { status: 'attempting' });
          execute('docker', [
            'buildx',
            'imagetools',
            'create',
            '--annotation',
            `index:org.opencontainers.image.revision=${identity.sha}`,
            '--annotation',
            `index:org.opencontainers.image.version=${identity.version}`,
            '--tag',
            `${image}:${item.tag}`,
            ...item.digests.map((digest) => `${image}@${digest}`),
          ]);
          verifyOci(readOci(`${image}:${item.tag}`), identity, item.digests);
          mark('publications', `oci-${item.target}`, { status: 'verified', platforms: item.digests });
        }
      }
      mark('publications', 'github', { status: release ? 'resuming-missing-assets' : 'attempting' });
      if (!release)
        execute('gh', [
          'release',
          'create',
          identity.versionTag,
          '--repo',
          repository,
          '--target',
          identity.sha,
          '--title',
          `Release ${identity.versionTag}`,
          '--notes-file',
          'release-notes.md',
          ...(identity.version.includes('-') ? ['--prerelease'] : ['--latest=false']),
        ]);
      for (const record of records.filter((item) => item.kind.startsWith('sea-'))) {
        for (const file of record.files) {
          if (!release?.assets.some((asset) => asset.name === file.name))
            execute('gh', [
              'release',
              'upload',
              identity.versionTag,
              path.join(path.dirname(record.manifestPath), file.name),
              '--repo',
              repository,
            ]);
        }
      }
      await verifyVersions();
    } else if (command === 'verify') await verifyVersions();
    else if (command === 'promote') {
      // Re-query every versioned identity immediately before aliases, including recovery.
      await verifyVersions();
      const priorNpmTags = await readTags();
      if (priorNpmTags[identity.channel] !== identity.version) {
        mark('aliases', 'npm', { status: 'attempting', tag: identity.channel });
        execute('npm', ['dist-tag', 'add', `@1mcp/agent@${identity.version}`, identity.channel]);
      }
      await waitForNpmAlias(readTags, identity, priorNpmTags[identity.channel], options.waitForNpmReadback);
      mark('aliases', 'npm', { status: 'verified', tag: identity.channel, version: identity.version });
      for (const target of ['basic', 'extended']) {
        const digest = state.publications[`oci-${target}`].digest;
        for (const alias of aliasNames(identity, target)) {
          const priorAlias = readOci(`${image}:${alias}`);
          const priorDigest = priorAlias
            ? execute('docker', [
                'buildx',
                'imagetools',
                'inspect',
                `${image}:${alias}`,
                '--format',
                '{{.Manifest.Digest}}',
              ])
            : null;
          if (priorDigest !== digest) {
            mark('aliases', `oci-${alias}`, { status: 'attempting', digest });
            execute('docker', ['buildx', 'imagetools', 'create', '--tag', `${image}:${alias}`, `${image}@${digest}`]);
          }
          const observedDigest = execute('docker', [
            'buildx',
            'imagetools',
            'inspect',
            `${image}:${alias}`,
            '--format',
            '{{.Manifest.Digest}}',
          ]);
          if (observedDigest !== digest) throw new Error('OCI alias readback mismatch');
          mark('aliases', `oci-${alias}`, { status: 'verified', digest });
        }
      }
      if (!identity.version.includes('-')) {
        if (readGithub(`${endpoint}/releases/latest`)?.tag_name !== identity.versionTag) {
          mark('aliases', 'github-latest', { status: 'attempting' });
          execute('gh', ['release', 'edit', identity.versionTag, '--repo', repository, '--latest']);
        }
        const latest = readGithub(`${endpoint}/releases/latest`);
        if (latest?.tag_name !== identity.versionTag) throw new Error('GitHub latest readback mismatch');
        mark('aliases', 'github-latest', { status: 'verified', tag: identity.versionTag });
      }
    } else throw new Error('Unknown publication step');
    state.status = 'success';
    save();
  } catch (error) {
    state.status = 'partial-or-failed';
    state.error = error.message;
    // 'attempting' deliberately means outcome uncertain: read back before any resume.
    save();
    throw error;
  }
}
if (require.main === module)
  main(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { dockerReadback, main, verifyNpm, verifyOci, aliasNames, publicationDecision };
