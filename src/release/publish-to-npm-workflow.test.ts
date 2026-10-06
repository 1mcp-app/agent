import fs from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflow = parse(fs.readFileSync('.github/workflows/publish-to-npm.yml', 'utf8'));
describe('publish-to-npm workflow', () => {
  it('publishes retained artifacts, preserves provenance and never rebuilds', () => {
    const publish = workflow.jobs.publish;
    expect(publish.environment).toBe('release');
    expect(publish.permissions['id-token']).toBe('write');
    const step = publish.steps.find((item: { name?: string }) => item.name?.startsWith('Publish missing'));
    expect(step.run).toContain('export GITHUB_SHA="$RELEASE_SHA"');
    expect(step.run).toContain('node scripts/release-publications.cjs versions');
    expect(JSON.stringify(workflow)).not.toContain('pnpm build');
    const downloads = publish.steps.filter((item: { uses?: string }) => item.uses === 'actions/download-artifact@v8');
    expect(
      downloads.map((item: { with: { name?: string; pattern?: string } }) => item.with.name || item.with.pattern),
    ).toEqual(['npm-candidate', '1mcp-*-*', 'docker-*']);
    expect(
      publish.steps.some((item: { with?: { args?: string } }) =>
        item.with?.args?.includes('${{ steps.release-notes-range.outputs.tag_filter_args }}'),
      ),
    ).toBe(true);
  });
  it('promotes only after required versioned publications, preserving protected paths and partial evidence', () => {
    expect(workflow.jobs.promote.needs).toBe('publish');
    expect(workflow.jobs.promote.environment).toBe('release');
    for (const job of ['publish', 'promote']) {
      expect(workflow.jobs[job].steps.at(-1).if).toBe('always()');
      expect(workflow.jobs[job].steps.at(-1).with['retention-days']).toBe(30);
    }
    expect(workflow.concurrency['cancel-in-progress']).toBe(false);
  });
});
