#!/usr/bin/env node
// macOS provides exact process arguments through native APIs, not ps output.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function buildProcessEvidence() {
  if (process.platform !== 'darwin') return;
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'build/native/process-evidence-darwin');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  execFileSync(
    'clang',
    [
      '-Os',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-arch',
      'arm64',
      '-arch',
      'x86_64',
      '-mmacosx-version-min=11.0',
      path.join(root, 'native/process-evidence-darwin.c'),
      '-o',
      output,
    ],
    { stdio: 'inherit' },
  );
  fs.chmodSync(output, 0o755);
}

if (require.main === module) buildProcessEvidence();
module.exports = { buildProcessEvidence };
