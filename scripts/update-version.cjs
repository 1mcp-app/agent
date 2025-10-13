#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Robust version update script for 1MCP
 * Updates version in both package.json and src/constants/mcp.ts
 *
 * Usage: node scripts/update-version.cjs <version>
 * Example: node scripts/update-version.cjs 1.2.3
 */

function updateVersion(version) {
  // Validate version format (semver-like)
  const versionRegex = /^\d+\.\d+\.\d+(-[\w.]+)?$/;
  if (!versionRegex.test(version)) {
    throw new Error(`Invalid version format: ${version}. Expected format: X.Y.Z or X.Y.Z-suffix`);
  }

  console.log(`\n🔄 Updating version to ${version}...`);

  // Check current package.json version
  const packageJsonPath = path.join(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  const currentPackageVersion = packageJson.version;

  // 1. Update package.json using pnpm
  console.log('\n📦 Updating package.json...');
  console.log(`   Current version: ${currentPackageVersion}`);
  console.log(`   New version: ${version}`);

  if (currentPackageVersion === version) {
    console.log('⚠️  Version is already correct, no changes needed');
  } else {
    try {
      execSync(`pnpm version ${version} --no-git-tag-version`, { stdio: 'inherit' });
      console.log('✅ package.json updated successfully');
    } catch (error) {
      throw new Error(`Failed to update package.json: ${error.message}`);
    }
  }

  // 2. Update src/constants/mcp.ts
  console.log('\n📝 Updating src/constants/mcp.ts...');
  const constantsPath = path.join(__dirname, '..', 'src', 'constants', 'mcp.ts');

  if (!fs.existsSync(constantsPath)) {
    throw new Error(`Constants file not found: ${constantsPath}`);
  }

  let content = fs.readFileSync(constantsPath, 'utf-8');

  // Robust regex that handles single/double quotes and varying whitespace
  const regex = /export const MCP_SERVER_VERSION\s*=\s*['"]([^'"]+)['"]/;
  const match = content.match(regex);

  if (!match) {
    throw new Error('MCP_SERVER_VERSION constant not found in mcp.ts');
  }

  const oldVersion = match[1];
  console.log(`   Current version: ${oldVersion}`);
  console.log(`   New version: ${version}`);

  // Replace the version
  const updatedContent = content.replace(regex, `export const MCP_SERVER_VERSION = '${version}'`);

  // Check if content changed
  if (updatedContent === content) {
    if (oldVersion === version) {
      console.log(`⚠️  Version is already ${version}, no changes needed`);
    } else {
      throw new Error('Version replacement failed - content unchanged');
    }
  } else {
    // Write back the file only if content changed
    fs.writeFileSync(constantsPath, updatedContent, 'utf-8');

    // Final verification
    const verifyContent = fs.readFileSync(constantsPath, 'utf-8');
    const verifyMatch = verifyContent.match(regex);

    if (!verifyMatch || verifyMatch[1] !== version) {
      throw new Error(
        `Version verification failed. Expected ${version}, got ${verifyMatch ? verifyMatch[1] : 'nothing'}`,
      );
    }

    console.log('✅ mcp.ts updated and verified successfully');
  }

  // 3. Summary
  console.log('\n✨ Version update complete!');
  console.log(`   package.json: ${version}`);
  console.log(`   mcp.ts: ${version}`);
  console.log('');
}

// Main execution
if (require.main === module) {
  const version = process.argv[2];

  if (!version) {
    console.error('❌ Error: Version argument required');
    console.error('Usage: node scripts/update-version.cjs <version>');
    console.error('Example: node scripts/update-version.cjs 1.2.3');
    process.exit(1);
  }

  try {
    updateVersion(version);
    process.exit(0);
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { updateVersion };
