#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');

const VERSION_REGEX = /^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-beta\.([0-9]+))?$/;
const RELEASE_REF_REGEX = /^release-[0-9]+\.[0-9]+$/;

function defaultTagExists(tagName) {
  try {
    execFileSync('git', ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tagName}`], {
      stdio: 'ignore',
    });
    return true;
  } catch (error) {
    if (typeof error.status === 'number' && error.status === 2) {
      return false;
    }

    throw new Error(`Unable to check whether tag ${tagName} exists.`);
  }
}

function validateReleaseInputs({ targetRef, version, tagExists = defaultTagExists }) {
  if (targetRef !== 'main' && !RELEASE_REF_REGEX.test(targetRef)) {
    throw new Error('target_ref must be main or release-<major>.<minor>.');
  }

  const match = version.match(VERSION_REGEX);
  if (!match) {
    throw new Error('version must be X.Y.Z or X.Y.Z-beta.N.');
  }

  const [, major, minor, , betaNumber] = match;
  const expectedReleaseBranch = `release-${major}.${minor}`;
  const isPrerelease = betaNumber !== undefined;

  if (targetRef !== 'main' && targetRef !== expectedReleaseBranch) {
    const releaseType = isPrerelease ? 'Beta' : 'Stable';
    throw new Error(`${releaseType} release ${version} must run from main or ${expectedReleaseBranch}.`);
  }

  const versionTag = `v${version}`;
  if (tagExists(versionTag)) {
    throw new Error(`Release tag ${versionTag} already exists.`);
  }

  return {
    version,
    versionTag,
    targetRef,
    expectedReleaseBranch,
    isPrerelease,
    npmTag: isPrerelease ? 'beta' : 'latest',
    dockerRawTag: isPrerelease ? 'beta' : 'latest',
  };
}

function writeGitHubOutputs(outputs, outputPath) {
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
  fs.appendFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
}

if (require.main === module) {
  const [targetRef, version] = process.argv.slice(2);

  if (!targetRef || !version) {
    console.error('Usage: node scripts/validate-release-inputs.cjs <target_ref> <version>');
    process.exit(1);
  }

  try {
    const outputs = validateReleaseInputs({ targetRef, version });
    const githubOutput = process.env.GITHUB_OUTPUT;

    if (githubOutput) {
      writeGitHubOutputs(
        {
          version: outputs.version,
          version_tag: outputs.versionTag,
          release_ref: outputs.targetRef,
          expected_release_branch: outputs.expectedReleaseBranch,
          is_prerelease: String(outputs.isPrerelease),
          npm_tag: outputs.npmTag,
          docker_raw_tag: outputs.dockerRawTag,
        },
        githubOutput,
      );
    }

    console.log(`Validated release ${outputs.versionTag} from ${outputs.targetRef}.`);
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}

module.exports = { validateReleaseInputs };
