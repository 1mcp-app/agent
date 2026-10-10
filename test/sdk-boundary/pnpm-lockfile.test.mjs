import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import test from 'node:test';

import { parsePnpmDependencyLockfile } from '../../scripts/pnpm-lockfile.mjs';

const dependencyDocument = `lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      zod:
        specifier: 4.4.3
        version: 4.4.3
`;
const managerDocument = `lockfileVersion: '9.0'
importers:
  .:
    configDependencies: {}
    packageManagerDependencies:
      pnpm:
        specifier: 12.10.1
        version: 12.10.1
`;

test('reads dependency versions from both pnpm 10 and pnpm 12 lockfiles', () => {
  const legacy = parsePnpmDependencyLockfile(dependencyDocument);
  const modern = parsePnpmDependencyLockfile(`---\n${managerDocument}---\n${dependencyDocument}`);
  assert.deepEqual(modern, legacy);
  assert.equal(modern.importers['.'].dependencies.zod.version, '4.4.3');
});

test('reads the checked-out dependency document rather than pnpm tool dependencies', async () => {
  const lock = parsePnpmDependencyLockfile(await readFile(new URL('../../pnpm-lock.yaml', import.meta.url), 'utf8'));
  const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(lock.importers['.'].dependencies.zod.specifier, manifest.dependencies.zod);
  assert.equal(lock.importers['.'].packageManagerDependencies, undefined);
});

test('rejects malformed YAML even in the package-manager document', () => {
  assert.throws(() => parsePnpmDependencyLockfile(`broken: [\n---\n${dependencyDocument}`));
});

test('rejects missing or ambiguous dependency documents', () => {
  for (const source of ['', managerDocument, `${dependencyDocument}---\n${dependencyDocument}`]) {
    assert.throws(() => parsePnpmDependencyLockfile(source), /Expected one pnpm dependency lockfile document/u);
  }
});
