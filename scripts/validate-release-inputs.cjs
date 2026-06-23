#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');

const VERSION_CORE_PART_REGEX = /^(0|[1-9][0-9]*)$/;
const PRERELEASE_IDENTIFIER_REGEX = /^[0-9A-Za-z-]+$/;
const RELEASE_CHANNEL_REGEX = /^[A-Za-z][0-9A-Za-z-]*$/;
const RELEASE_REF_REGEX = /^release-[0-9]+\.[0-9]+$/;
const NEXT_NPM_CHANNEL_REGEX = /^(alpha|beta|rc)([0-9-].*)?$/;

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

function isNumericIdentifier(identifier) {
  return /^[0-9]+$/.test(identifier);
}

function parseVersion(version) {
  const [coreAndPrerelease, buildMetadata] = version.split('+');
  if (buildMetadata !== undefined) {
    return null;
  }

  const prereleaseSeparatorIndex = coreAndPrerelease.indexOf('-');
  const core =
    prereleaseSeparatorIndex === -1 ? coreAndPrerelease : coreAndPrerelease.slice(0, prereleaseSeparatorIndex);
  const prerelease =
    prereleaseSeparatorIndex === -1 ? undefined : coreAndPrerelease.slice(prereleaseSeparatorIndex + 1);

  const coreParts = core.split('.');
  if (coreParts.length !== 3 || coreParts.some((part) => !VERSION_CORE_PART_REGEX.test(part))) {
    return null;
  }

  if (prerelease === undefined) {
    return { major: coreParts[0], minor: coreParts[1], prerelease };
  }

  const identifiers = prerelease.split('.');
  const validIdentifiers = identifiers.every((identifier) => {
    if (!PRERELEASE_IDENTIFIER_REGEX.test(identifier)) {
      return false;
    }

    return !isNumericIdentifier(identifier) || identifier === '0' || !identifier.startsWith('0');
  });

  if (!validIdentifiers) {
    return null;
  }

  return { major: coreParts[0], minor: coreParts[1], prerelease };
}

function resolveNpmTag(releaseChannel) {
  if (!releaseChannel) {
    return 'latest';
  }

  return NEXT_NPM_CHANNEL_REGEX.test(releaseChannel) ? 'next' : releaseChannel;
}

function validateReleaseInputs({ targetRef, version, tagExists = defaultTagExists }) {
  if (targetRef !== 'main' && !RELEASE_REF_REGEX.test(targetRef)) {
    throw new Error('target_ref must be main or release-<major>.<minor>.');
  }

  const parsedVersion = parseVersion(version);
  if (!parsedVersion) {
    throw new Error('version must be X.Y.Z or X.Y.Z-<prerelease>.');
  }

  const { major, minor, prerelease } = parsedVersion;
  const expectedReleaseBranch = `release-${major}.${minor}`;
  const releaseChannel = prerelease?.split('.')[0];
  const isPrerelease = releaseChannel !== undefined;

  if (isPrerelease && !RELEASE_CHANNEL_REGEX.test(releaseChannel)) {
    throw new Error('prerelease channel must start with a letter so it can be used as an npm dist-tag.');
  }

  if (targetRef !== 'main' && targetRef !== expectedReleaseBranch) {
    const releaseType = isPrerelease ? 'Prerelease' : 'Stable';
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
    npmTag: resolveNpmTag(releaseChannel),
    dockerRawTag: isPrerelease ? releaseChannel : 'latest',
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
