import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { finalizeReleaseNotes } = require('../../scripts/finalize-release-notes.cjs') as {
  finalizeReleaseNotes: (args: { content: string; versionTag: string; previousTag: string; npmTag: string }) => string;
};

describe('finalizeReleaseNotes', () => {
  it('keeps prerelease npm instructions on the next tag', () => {
    const content = [
      '> **Pre-release Version**: This is a pre-release build. Use `@next` tag for NPM.',
      'https://github.com/1mcp-app/agent/releases/download/v0.33.0-beta1/1mcp-linux-x64.tar.gz',
      'npm install -g @1mcp/agent@next',
      '**Full Changelog**: https://github.com/1mcp-app/agent/compare/v0.32.2...v0.33.0-beta1',
    ].join('\n');

    const finalized = finalizeReleaseNotes({
      content,
      versionTag: 'v0.33.0-beta1',
      previousTag: 'v0.32.2',
      npmTag: 'next',
    });

    expect(finalized).toContain('Use `@next` tag for NPM');
    expect(finalized).toContain('npm install -g @1mcp/agent@next');
    expect(finalized).not.toContain('@1mcp/agent@beta1');
  });

  it('rejects release notes that point at the wrong download tag', () => {
    expect(() =>
      finalizeReleaseNotes({
        content:
          'https://github.com/1mcp-app/agent/releases/download/v0.32.2/1mcp-linux-x64.tar.gz\n' +
          '**Full Changelog**: https://github.com/1mcp-app/agent/compare/v0.32.2...v0.33.0-beta1',
        versionTag: 'v0.33.0-beta1',
        previousTag: 'v0.32.2',
        npmTag: 'beta1',
      }),
    ).toThrow('Release notes do not link to v0.33.0-beta1 downloads.');
  });

  it('rejects release notes that compare the wrong release range', () => {
    expect(() =>
      finalizeReleaseNotes({
        content:
          'https://github.com/1mcp-app/agent/releases/download/v0.33.0-beta1/1mcp-linux-x64.tar.gz\n' +
          '**Full Changelog**: https://github.com/1mcp-app/agent/compare/v0.32.1...v0.32.2',
        versionTag: 'v0.33.0-beta1',
        previousTag: 'v0.32.2',
        npmTag: 'beta1',
      }),
    ).toThrow('Release notes do not compare v0.32.2...v0.33.0-beta1.');
  });
});
