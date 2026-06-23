#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');

const VERSION_TAG_REGEX = /^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;
const RELEASE_SHA_REGEX = /^[0-9a-f]{40}$/;

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function resolveReleaseNotesRange({ versionTag, releaseSha, cwd = process.cwd() }) {
  if (!VERSION_TAG_REGEX.test(versionTag)) {
    throw new Error('version_tag must be a v-prefixed semver tag.');
  }

  if (!RELEASE_SHA_REGEX.test(releaseSha)) {
    throw new Error('release_sha must be a 40-character lowercase hexadecimal commit SHA.');
  }

  let previousTag;
  try {
    previousTag = git(cwd, ['describe', '--tags', '--abbrev=0', `${releaseSha}^`]);
  } catch {
    throw new Error(`Unable to resolve previous release tag before ${versionTag}.`);
  }

  return {
    previousTag,
    range: `${previousTag}..${releaseSha}`,
  };
}

function writeGitHubOutputs(outputs, outputPath) {
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
  fs.appendFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
}

if (require.main === module) {
  const [versionTag, releaseSha] = process.argv.slice(2);

  if (!versionTag || !releaseSha) {
    console.error('Usage: node scripts/resolve-release-notes-range.cjs <version_tag> <release_sha>');
    process.exit(1);
  }

  try {
    const outputs = resolveReleaseNotesRange({ versionTag, releaseSha });
    const githubOutput = process.env.GITHUB_OUTPUT;

    if (githubOutput) {
      writeGitHubOutputs(
        {
          previous_tag: outputs.previousTag,
          range: outputs.range,
        },
        githubOutput,
      );
    }

    console.log(`Resolved release notes range ${outputs.range} for ${versionTag}.`);
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}

module.exports = { resolveReleaseNotesRange };
