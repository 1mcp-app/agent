import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

function readReleasePipelineWorkflow(): string {
  return fs
    .readFileSync(path.join(process.cwd(), '.github', 'workflows', 'release-pipeline.yml'), 'utf8')
    .replace(/\r\n/g, '\n');
}

describe('release-pipeline workflow', () => {
  it('keeps E2E enabled when invoking reusable CI', () => {
    const workflow = readReleasePipelineWorkflow();
    const ciJob = workflow.match(/\n\s{2}ci:\n(?<body>(?:\s{4}.*\n)+)/)?.groups?.body;

    expect(ciJob).toBeDefined();
    expect(ciJob).toContain('uses: ./.github/workflows/test-and-validate.yml');
    expect(ciJob).not.toContain('run_e2e:');
  });

  it('validates the final versioned source before either publication lane starts', () => {
    const { jobs, on } = parse(readReleasePipelineWorkflow());
    expect(on.workflow_dispatch.inputs.target_ref.default).toBe('');
    expect(jobs['update-version'].needs).toBe('validate');
    expect(jobs.ci.needs).toEqual(['validate', 'update-version']);
    expect(jobs.ci.with.checkout_ref).toBe('${{ needs.update-version.outputs.release_sha }}');
    for (const lane of ['binaries', 'docker']) {
      expect(jobs[lane].needs).toContain('ci');
      expect(jobs[lane].with.release_sha).toBe('${{ needs.update-version.outputs.release_sha }}');
    }
    expect(jobs.release.needs).toEqual(expect.arrayContaining(['binaries', 'docker']));
  });

  it('prevents implicit latest tags from letting the lite manifest overwrite the extended channel', () => {
    const { jobs } = parse(fs.readFileSync('.github/workflows/build-docker-images.yml', 'utf8'));
    const metadata = jobs.docker.steps.find((step: { id?: string }) => step.id === 'meta');
    expect(metadata.with.flavor).toBe('latest=false');
    expect(metadata.with.tags).toContain("enable=${{ steps.raw-tag.outputs.publish_raw_tag == 'true' }}");
  });

  it('keeps immutable alias repair separate from version rewriting and publication', () => {
    const { jobs } = parse(readReleasePipelineWorkflow());
    expect(jobs.validate.if).toBe("inputs.repair_container_latest_run_id == ''");
    expect(jobs['repair-container-latest'].if).toBe("inputs.repair_container_latest_run_id != ''");
    expect(jobs['repair-container-latest'].environment).toBe('release');
    expect(
      jobs['repair-container-latest'].steps.some((step: { run?: string }) => step.run?.includes('pnpm build')),
    ).toBe(false);
  });

  it('creates the release branch for prereleases that run from main', () => {
    const workflow = readReleasePipelineWorkflow();
    const finalizeJob = workflow.match(/\n\s{2}finalize:\n(?<body>(?:\s{4}.*\n)+)/)?.groups?.body;

    expect(finalizeJob).toBeDefined();
    expect(finalizeJob).toContain("if: ${{ needs.validate.outputs.release_ref == 'main' }}");
    expect(finalizeJob).not.toContain('is_prerelease');
  });

  it('does not pass secrets: inherit to reusable workflows', () => {
    const workflow = readReleasePipelineWorkflow();

    expect(workflow).not.toContain('secrets: inherit');
  });
});
