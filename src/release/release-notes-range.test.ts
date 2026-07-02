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
    tagFilterArgs: string;
  };
};

const tempRoots: string[] = [];

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function commitFile(cwd: string, content: string, message: string): string {
  fs.writeFileSync(path.join(cwd, 'file.txt'), `${content}\n`);
  git(cwd, ['add', 'file.txt']);
  git(cwd, ['commit', '-m', message]);
  return git(cwd, ['rev-parse', 'HEAD']);
}

function createPrereleaseFixtureRepository(): { cwd: string; firstPrereleaseSha: string; secondPrereleaseSha: string } {
  fs.mkdirSync(path.join(process.cwd(), '.tmp'), { recursive: true });
  const cwd = fs.mkdtempSync(path.join(process.cwd(), '.tmp', 'release-notes-range-'));
  tempRoots.push(cwd);

  git(cwd, ['init', '--initial-branch', 'main']);
  git(cwd, ['config', 'user.email', 'test@example.com']);
  git(cwd, ['config', 'user.name', 'Test User']);

  commitFile(cwd, 'previous', 'previous release');
  git(cwd, ['tag', 'v1.2.3']);

  const firstPrereleaseSha = commitFile(cwd, 'first prerelease', 'first prerelease');
  git(cwd, ['tag', 'v1.3.0-beta1']);

  const secondPrereleaseSha = commitFile(cwd, 'second prerelease', 'second prerelease');
  git(cwd, ['tag', 'v1.3.0-beta2']);

  return { cwd, firstPrereleaseSha, secondPrereleaseSha };
}

function createStableAfterPrereleasesFixtureRepository(): { cwd: string; releaseSha: string } {
  const { cwd } = createPrereleaseFixtureRepository();

  const releaseSha = commitFile(cwd, 'stable release', 'stable release');
  git(cwd, ['tag', 'v1.3.0']);

  return { cwd, releaseSha };
}

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe('resolveReleaseNotesRange', () => {
  it('resolves prerelease notes from the previous reachable tag to the release SHA', () => {
    const { cwd, firstPrereleaseSha, secondPrereleaseSha } = createPrereleaseFixtureRepository();

    expect(resolveReleaseNotesRange({ cwd, versionTag: 'v1.3.0-beta1', releaseSha: firstPrereleaseSha })).toEqual({
      previousTag: 'v1.2.3',
      range: `v1.2.3..${firstPrereleaseSha}`,
      tagFilterArgs: '',
    });
    expect(resolveReleaseNotesRange({ cwd, versionTag: 'v1.3.0-beta2', releaseSha: secondPrereleaseSha })).toEqual({
      previousTag: 'v1.3.0-beta1',
      range: `v1.3.0-beta1..${secondPrereleaseSha}`,
      tagFilterArgs: '',
    });
  });

  it('resolves stable release notes from the previous stable tag and skips prerelease tags', () => {
    const { cwd, releaseSha } = createStableAfterPrereleasesFixtureRepository();

    expect(resolveReleaseNotesRange({ cwd, versionTag: 'v1.3.0', releaseSha })).toEqual({
      previousTag: 'v1.2.3',
      range: `v1.2.3..${releaseSha}`,
      tagFilterArgs: "--ignore-tags '^v.*-?(alpha|beta|rc|preview|next)[-.0-9]+.*$'",
    });
  });

  it.each([
    ['1.3.0', '0123456789abcdef0123456789abcdef01234567', 'version_tag must be a v-prefixed semver tag.'],
    ['v1.3.0', 'not-a-sha', 'release_sha must be a 40-character lowercase hexadecimal commit SHA.'],
  ])('rejects invalid inputs', (versionTag, releaseSha, expectedError) => {
    expect(() => resolveReleaseNotesRange({ versionTag, releaseSha })).toThrow(expectedError);
  });
});
