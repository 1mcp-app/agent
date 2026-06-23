#!/usr/bin/env node

const fs = require('fs');

const VERSION_TAG_REGEX = /^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;
const NPM_TAG_REGEX = /^[A-Za-z][0-9A-Za-z-]*$|^latest$/;

function validateInputs({ versionTag, previousTag, npmTag }) {
  if (!VERSION_TAG_REGEX.test(versionTag)) {
    throw new Error('version_tag must be a v-prefixed semver tag.');
  }

  if (!VERSION_TAG_REGEX.test(previousTag)) {
    throw new Error('previous_tag must be a v-prefixed semver tag.');
  }

  if (!NPM_TAG_REGEX.test(npmTag)) {
    throw new Error('npm_tag must be latest or a valid npm dist-tag.');
  }
}

function finalizeReleaseNotes({ content, versionTag, previousTag, npmTag }) {
  validateInputs({ versionTag, previousTag, npmTag });

  if (!content.includes(`releases/download/${versionTag}`)) {
    throw new Error(`Release notes do not link to ${versionTag} downloads.`);
  }

  if (!content.includes(`compare/${previousTag}...${versionTag}`)) {
    throw new Error(`Release notes do not compare ${previousTag}...${versionTag}.`);
  }

  return content
    .replace(/Use `@next` tag for NPM/g, `Use \`@${npmTag}\` tag for NPM`)
    .replace(/@1mcp\/agent@next/g, `@1mcp/agent@${npmTag}`);
}

if (require.main === module) {
  const [inputPath, outputPath, versionTag, previousTag, npmTag] = process.argv.slice(2);

  if (!inputPath || !outputPath || !versionTag || !previousTag || !npmTag) {
    console.error(
      'Usage: node scripts/finalize-release-notes.cjs <input_path> <output_path> <version_tag> <previous_tag> <npm_tag>',
    );
    process.exit(1);
  }

  try {
    const content = fs.readFileSync(inputPath, 'utf8');
    const finalized = finalizeReleaseNotes({ content, versionTag, previousTag, npmTag });
    fs.writeFileSync(outputPath, finalized, 'utf8');
    console.log(`Finalized release notes for ${versionTag}.`);
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}

module.exports = { finalizeReleaseNotes };
