import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
    expect(step.env).not.toHaveProperty('GITHUB_SHA');
    expect(step.env).not.toHaveProperty('GITHUB_REF');
    expect(step.run).not.toMatch(/\bGITHUB_(?:SHA|REF)\s*=/);
    expect(step.run).toContain('node .release-policy/scripts/release-publications.cjs versions');
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
  it('validates retained source using trusted scripts without executing historical candidate scripts', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'trusted-publication-'));
    try {
      fs.mkdirSync(path.join(cwd, '.release-policy/scripts'), { recursive: true });
      for (const file of ['release-artifacts.cjs', 'validate-release-inputs.cjs']) {
        fs.copyFileSync(path.join('scripts', file), path.join(cwd, '.release-policy/scripts', file));
      }
      fs.mkdirSync(path.join(cwd, 'scripts'));
      fs.writeFileSync(
        path.join(cwd, 'scripts/release-artifacts.cjs'),
        "throw new Error('historical policy executed');",
      );
      fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ version: '1.2.3-canary.1' }));
      const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
      git('init');
      git('config', 'user.name', 'Release test');
      git('config', 'user.email', 'test@example.com');
      git('add', 'package.json', 'scripts');
      git('commit', '-m', 'historical candidate');
      const step = workflow.jobs.publish.steps.find(
        (item: { name?: string }) => item.name === 'Validate retained candidate',
      );
      const version = '1.2.3-canary.1';
      const sha = git('rev-parse', 'HEAD');
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
        cwd,
        encoding: 'utf8',
        env: { ...process.env, ...environment },
      });
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ sha, version, channel: 'next' });
      fs.mkdirSync(path.join(cwd, 'artifacts'));
      fs.writeFileSync(path.join(cwd, 'artifacts/package.tgz'), 'retained tested bytes');
      execFileSync(process.execPath, ['.release-policy/scripts/release-artifacts.cjs', 'record', 'artifacts'], {
        cwd,
        env: { ...process.env, ...environment, ARTIFACT_KIND: 'npm' },
      });
      expect(JSON.parse(fs.readFileSync(path.join(cwd, 'artifacts/npm.json'), 'utf8'))).toMatchObject({
        sha,
        version,
        channel: 'next',
      });
      expect(environment.RELEASE_SHA).toBe(sha);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
  it.each(['publish', 'promote'])('%s uses dispatch publication policy with retained candidate identity', (job) => {
    const steps = workflow.jobs[job].steps;
    expect(steps[0].with.ref).toBe('${{ inputs.release_sha }}');
    expect(steps[1].with).toMatchObject({
      ref: '${{ github.sha }}',
      path: '.release-policy',
      'sparse-checkout': 'scripts',
      'persist-credentials': false,
    });
    const publication = steps.find((step: { run?: string }) => step.run?.includes('release-publications.cjs'));
    expect(publication.run).toContain('node .release-policy/scripts/release-publications.cjs');
    expect(publication.env.RELEASE_SHA).toBe('${{ inputs.release_sha }}');
    expect(publication).not.toHaveProperty('working-directory');
  });
  it.each([
    ['release-pipeline.yml', 'package'],
    ['build-binaries.yml', 'binaries'],
    ['build-docker-images.yml', 'docker'],
  ])('%s records artifacts with the trusted channel policy', (file, job) => {
    const artifactWorkflow = parse(fs.readFileSync(`.github/workflows/${file}`, 'utf8'));
    const steps = artifactWorkflow.jobs[job].steps;
    const policyIndex = steps.findIndex((step: { with?: { path?: string } }) => step.with?.path === '.release-policy');
    expect(policyIndex).toBeGreaterThan(-1);
    expect(steps[policyIndex].with.ref).toBe('${{ github.sha }}');
    const records = steps.filter((step: { run?: string }) => step.run?.includes('release-artifacts.cjs'));
    expect(records.length).toBeGreaterThan(0);
    for (const step of records) {
      expect(steps.indexOf(step)).toBeGreaterThan(policyIndex);
      expect(step.run).toContain('node .release-policy/scripts/release-artifacts.cjs');
      expect(step.run).not.toContain('node scripts/release-artifacts.cjs');
    }
  });
  it('excludes tags on other release branches when rendering the resolved changelog range', () => {
    const generate = workflow.jobs.publish.steps.find(
      (item: { name?: string }) => item.name === 'Generate release changelog',
    );
    expect(generate.with.args).toContain('--use-branch-tags');
    expect(generate.with.args).toContain('${{ steps.release-notes-range.outputs.range }}');
    expect(generate.with.args).toContain('${{ steps.release-notes-range.outputs.tag_filter_args }}');
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
