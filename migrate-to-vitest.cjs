#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * This script helps migrate Jest tests to Vitest
 * It performs the following operations:
 * 1. Finds all test files
 * 2. Replaces Jest-specific imports and API calls with Vitest equivalents
 */

// Find all test files
const testFiles = execSync('find src -type f -name "*.test.ts"')
  .toString()
  .trim()
  .split('\n')
  .filter(Boolean);

console.log(`Found ${testFiles.length} test files to migrate`);

// Process each test file
let modifiedFiles = 0;

testFiles.forEach(filePath => {
  console.log(`Processing ${filePath}...`);

  let content = fs.readFileSync(filePath, 'utf8');
  let originalContent = content;

  // Replace Jest mocks with Vitest mocks
  content = content.replace(/jest\.mock\(/g, 'vi.mock(');
  content = content.replace(/jest\.fn\(\)/g, 'vi.fn()');
  content = content.replace(/jest\.clearAllMocks\(\)/g, 'vi.clearAllMocks()');
  content = content.replace(/jest\.resetAllMocks\(\)/g, 'vi.resetAllMocks()');
  content = content.replace(/jest\.Mock/g, 'MockInstance');
  content = content.replace(/mockImplementation/g, 'mockImplementation');
  content = content.replace(/mockResolvedValue/g, 'mockResolvedValue');
  content = content.replace(/mockRejectedValue/g, 'mockRejectedValue');

  // Add Vitest import if needed
  if (content.includes('vi.') && !content.includes('import { vi }')) {
    const importStatement = "import { vi, describe, it, expect, beforeEach } from 'vitest';\n";

    // Find a good place to add the import
    const lines = content.split('\n');
    let lastImportLine = -1;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('import ')) {
        lastImportLine = i;
      }
    }

    if (lastImportLine >= 0) {
      lines.splice(lastImportLine + 1, 0, importStatement);
      content = lines.join('\n');
    } else {
      content = importStatement + content;
    }
  }

  // If content was modified, write back to the file
  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf8');
    modifiedFiles++;
    console.log(`✓ Updated ${filePath}`);
  } else {
    console.log(`✓ No changes needed for ${filePath}`);
  }
});

console.log(`\nMigration completed! Modified ${modifiedFiles} files out of ${testFiles.length}.`);
console.log('Some manual adjustments might still be needed. Please review the changes.');
console.log('\nNext steps:');
console.log('1. Run "npm install" to install Vitest dependencies');
console.log('2. Run "npm test" to see if the tests pass with Vitest');
console.log('3. Fix any remaining issues manually');
