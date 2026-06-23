import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

function readReleasePipelineWorkflow(): string {
  return fs.readFileSync(path.join(process.cwd(), '.github', 'workflows', 'release-pipeline.yml'), 'utf8');
}

describe('release-pipeline workflow', () => {
  it('creates the release branch for prereleases that run from main', () => {
    const workflow = readReleasePipelineWorkflow();
    const finalizeJob = workflow.match(/\n\s{2}finalize:\n(?<body>(?:\s{4}.*\n)+)/)?.groups?.body;

    expect(finalizeJob).toBeDefined();
    expect(finalizeJob).toContain("if: ${{ needs.validate.outputs.release_ref == 'main' }}");
    expect(finalizeJob).not.toContain('is_prerelease');
  });
});
