import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const require = createRequire(import.meta.url);
const { validateReleaseInputs } = require('../../scripts/validate-release-inputs.cjs') as {
  validateReleaseInputs: (input: { targetRef: string; version: string; tagExists: () => boolean }) => {
    npmTag: string;
  };
};

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
  it('runs actual retained-candidate validation without publishing', () => {
    const step = workflow.jobs.publish.steps.find(
      (item: { name?: string }) => item.name === 'Validate retained candidate',
    );
    const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const inputs: Record<string, string> = {
      release_sha: sha,
      version,
      npm_tag: validateReleaseInputs({ targetRef: 'main', version, tagExists: () => false }).npmTag,
      artifact_run_id: '123456',
    };
    expect(step.env).not.toHaveProperty('APPROVAL_REF');
    expect(step.env).not.toHaveProperty('READINESS_REF');
    const environment = Object.fromEntries(
      Object.entries(step.env).map(([key, value]) => {
        const inputName = String(value).match(/^\$\{\{ inputs\.([a-z_]+) \}\}$/)?.[1];
        if (!inputName || !(inputName in inputs)) throw new Error(`Unexpected validation input: ${value}`);
        return [key, inputs[inputName]];
      }),
    );
    // Only retained-candidate validation runs; publication steps are never invoked.
    const result = spawnSync('bash', ['-e', '-c', step.run], {
      encoding: 'utf8',
      env: { ...process.env, ...environment },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).sha).toBe(sha);
    expect(environment.RELEASE_SHA).toBe(sha);
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
