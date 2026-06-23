import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { createRequire } from 'module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { resolveReleaseNotesRange } = require('../../scripts/resolve-release-notes-range.cjs') as {
  resolveReleaseNotesRange: (args: { versionTag: string; releaseSha: string; cwd?: string }) => {
    previousTag: string;
    range: string;
  };
};

const tempRoots: string[] = [];

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function createFixtureRepository(): { cwd: string; releaseSha: string } {
  fs.mkdirSync(path.join(process.cwd(), '.tmp'), { recursive: true });
  const cwd = fs.mkdtempSync(path.join(process.cwd(), '.tmp', 'release-notes-range-'));
  tempRoots.push(cwd);

  git(cwd, ['init', '--initial-branch', 'main']);
  git(cwd, ['config', 'user.email', 'test@example.com']);
  git(cwd, ['config', 'user.name', 'Test User']);

  fs.writeFileSync(path.join(cwd, 'file.txt'), 'previous\n');
  git(cwd, ['add', 'file.txt']);
  git(cwd, ['commit', '-m', 'previous release']);
  git(cwd, ['tag', 'v1.2.3']);

  fs.writeFileSync(path.join(cwd, 'file.txt'), 'current\n');
  git(cwd, ['add', 'file.txt']);
  git(cwd, ['commit', '-m', 'current release']);
  const releaseSha = git(cwd, ['rev-parse', 'HEAD']);
  git(cwd, ['tag', 'v1.3.0-beta1']);

  return { cwd, releaseSha };
}

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe('resolveReleaseNotesRange', () => {
  it('resolves release notes from the previous reachable tag to the release SHA', () => {
    const { cwd, releaseSha } = createFixtureRepository();

    expect(resolveReleaseNotesRange({ cwd, versionTag: 'v1.3.0-beta1', releaseSha })).toEqual({
      previousTag: 'v1.2.3',
      range: `v1.2.3..${releaseSha}`,
    });
  });

  it.each([
    ['1.3.0', '0123456789abcdef0123456789abcdef01234567', 'version_tag must be a v-prefixed semver tag.'],
    ['v1.3.0', 'not-a-sha', 'release_sha must be a 40-character lowercase hexadecimal commit SHA.'],
  ])('rejects invalid inputs', (versionTag, releaseSha, expectedError) => {
    expect(() => resolveReleaseNotesRange({ versionTag, releaseSha })).toThrow(expectedError);
  });
});
