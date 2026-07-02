import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

function readPublishWorkflow(): string {
  return fs.readFileSync(path.join(process.cwd(), '.github', 'workflows', 'publish-to-npm.yml'), 'utf8');
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
});
