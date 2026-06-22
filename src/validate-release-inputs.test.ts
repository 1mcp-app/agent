import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { validateReleaseInputs } = require('../scripts/validate-release-inputs.cjs') as {
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
    ['1.2.3-alpha.1', 'alpha'],
    ['1.2.3-beta1', 'beta1'],
    ['1.2.3-rc1', 'rc1'],
  ])('accepts semver prerelease version %s', (version, releaseTag) => {
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
      npmTag: releaseTag,
      dockerRawTag: releaseTag,
    });
  });

  it('rejects malformed prerelease identifiers without catastrophic backtracking', () => {
    const startedAt = Date.now();

    expect(() =>
      validateReleaseInputs({
        targetRef: 'main',
        version: `0.0.0-0.${'--.'.repeat(250)}x`,
        tagExists: () => false,
      }),
    ).toThrow('version must be X.Y.Z or X.Y.Z-<prerelease>.');

    expect(Date.now() - startedAt).toBeLessThan(100);
  });
});
