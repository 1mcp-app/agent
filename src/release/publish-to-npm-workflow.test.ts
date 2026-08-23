import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

function readPublishWorkflow(): string {
  return fs
    .readFileSync(path.join(process.cwd(), '.github', 'workflows', 'publish-to-npm.yml'), 'utf8')
    .replace(/\r\n/g, '\n');
}

describe('publish-to-npm workflow', () => {
  it('downloads only binary artifacts before attaching release assets', () => {
    const workflow = readPublishWorkflow();

    expect(workflow).toContain('pattern: 1mcp-*-*');
  });

  it('passes release tag filtering arguments to git-cliff', () => {
    const workflow = readPublishWorkflow();

    expect(workflow).toContain('${{ steps.release-notes-range.outputs.tag_filter_args }}');
  });

  it('attaches only compressed binary archives to GitHub releases', () => {
    const workflow = readPublishWorkflow();

    expect(workflow).toContain('binaries/**/*.tar.gz');
    expect(workflow).toContain('binaries/**/*.zip');
    expect(workflow).not.toContain('files: binaries/*/*');
  });

  it('passes npm_tag via environment variable rather than direct shell interpolation', () => {
    const workflow = readPublishWorkflow();

    expect(workflow).not.toContain(
      'pnpm publish --no-git-checks --access public --provenance --tag ${{ inputs.npm_tag }}',
    );
    expect(workflow).toContain('NPM_TAG: ${{ inputs.npm_tag }}');
    expect(workflow).toContain('pnpm publish --no-git-checks --access public --provenance --tag "$NPM_TAG"');
  });
});
