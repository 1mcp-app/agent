import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { validateReleaseInputs } = require('../../scripts/validate-release-inputs.cjs') as {
  validateReleaseInputs: (args: { targetRef: string; version: string; tagExists?: (tagName: string) => boolean }) => {
    version: string;
    versionTag: string;
    targetRef: string;
    expectedReleaseBranch: string;
    isPrerelease: boolean;
    npmTag: string;
    dockerRawTag: string;
  };
};

describe('validateReleaseInputs', () => {
  it.each([
    ['1.2.3-alpha.1', 'next', 'alpha'],
    ['1.2.3-alpha-build.1', 'next', 'alpha-build'],
    ['1.2.3-beta1', 'next', 'beta1'],
    ['1.2.3-beta.1', 'next', 'beta'],
    ['1.2.3-rc1', 'next', 'rc1'],
    ['1.2.3-canary.1', 'next', 'canary'],
    ['1.2.3-preview.1', 'next', 'preview'],
    ['1.2.3-candidate.1', 'next', 'candidate'],
  ])('maps semver prerelease version %s to npm tag %s', (version, npmTag, dockerRawTag) => {
    const result = validateReleaseInputs({
      targetRef: 'main',
      version,
      tagExists: () => false,
    });

    expect(result).toMatchObject({
      version,
      versionTag: `v${version}`,
      expectedReleaseBranch: 'release-1.2',
      isPrerelease: true,
      npmTag,
      dockerRawTag,
    });
  });

  it.each(['latest', 'lite', 'v1', 'v1-lite', 'v12'])('rejects reserved prerelease channel %s', (channel) => {
    expect(() =>
      validateReleaseInputs({ targetRef: 'main', version: `1.2.3-${channel}.1`, tagExists: () => false }),
    ).toThrow('reserved for stable');
  });

  it('rejects invalid release channels without catastrophic backtracking', () => {
    const startedAt = Date.now();

    expect(() =>
      validateReleaseInputs({
        targetRef: 'main',
        version: `0.0.0-0.${'--.'.repeat(250)}x`,
        tagExists: () => false,
      }),
    ).toThrow('prerelease channel must start with a letter so it can be used as a Docker tag.');

    expect(Date.now() - startedAt).toBeLessThan(100);
  });
});

describe('maintenance branch naming', () => {
  it.each(['main', 'release-1.2'])('accepts %s and targets release-1.2', (targetRef) => {
    expect(validateReleaseInputs({ targetRef, version: '1.2.3', tagExists: () => false }).expectedReleaseBranch).toBe(
      'release-1.2',
    );
  });
  it.each(['release-1.3', 'release-v1.2', 'release-1.2.3'])('rejects mismatched source %s', (targetRef) => {
    expect(() => validateReleaseInputs({ targetRef, version: '1.2.3', tagExists: () => false })).toThrow();
  });
});
