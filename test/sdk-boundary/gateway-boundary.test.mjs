import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

import { test } from 'node:test';

const root = process.cwd();

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : extname(entry.name) === '.ts' ? [path] : [];
  });
}

test('shared gateway layers remain independent of protocol SDK implementations', () => {
  const sharedRoots = ['contracts', 'core', 'ports'].map((directory) => join(root, 'src/gateway', directory));
  const violations = sharedRoots
    .flatMap(filesBelow)
    .filter((path) => /from\s+['"](?:@modelcontextprotocol\/|@src\/sdk\/legacy\/)/u.test(readFileSync(path, 'utf8')))
    .map((path) => relative(root, path));

  assert.deepEqual(violations, []);
});

test('modern gateway adapters remain disconnected from production entry points', () => {
  const violations = filesBelow(join(root, 'src'))
    .filter((path) => !path.includes('/src/gateway/'))
    .filter((path) => /gateway\/adapters\/modern/u.test(readFileSync(path, 'utf8')))
    .map((path) => relative(root, path));

  assert.deepEqual(violations, []);
});
