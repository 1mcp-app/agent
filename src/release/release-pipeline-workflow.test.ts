import fs from 'node:fs';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflow = parse(fs.readFileSync('.github/workflows/release-pipeline.yml', 'utf8'));
function jobRuns(
  condition: string | undefined,
  needs: Record<string, unknown>,
  cancelled = false,
  implicitSuccess = false,
): boolean {
  if (!condition) return implicitSuccess;
  const expression = condition.replace(/^\$\{\{\s*|\s*\}\}$/g, '');
  if (!/\b(?:always|cancelled|success|failure)\(/.test(expression) && !implicitSuccess) return false;
  return Boolean(runInNewContext(expression, { needs, cancelled: () => cancelled }, { timeout: 1000 }));
}
describe('release-pipeline workflow', () => {
  it('checks the final version SHA with the existing full quality and native-security workflows', () => {
    expect(workflow.jobs['update-version'].needs).toBe('validate');
    expect(workflow.jobs.ci.needs).toBe('candidate');
    expect(workflow.jobs.candidate.steps[0].with.ref).toBe('${{ github.sha }}');
    expect(workflow.jobs.candidate.steps[0].with['fetch-depth']).toBe(0);
    expect(workflow.jobs.candidate.steps[1].env.RELEASE_REF).toBe('${{ needs.validate.outputs.release_ref }}');
    expect(workflow.jobs.ci.with).toEqual({
      checkout_ref: '${{ needs.candidate.outputs.release_sha }}',
      release_gate: true,
    });
    expect(workflow.jobs['native-security'].with.checkout_ref).toBe(workflow.jobs.ci.with.checkout_ref);
    for (const job of ['package', 'binaries', 'docker'])
      expect(workflow.jobs[job].needs).toEqual(['validate', 'candidate', 'ci', 'native-security']);
  });
  it('requires all artifact jobs or explicit owner recovery before publication', () => {
    expect(workflow.jobs.release.needs).toContain('package');
    expect(workflow.jobs.release.if).toContain("needs.ci.result == 'success'");
    expect(workflow.jobs.release.if).toContain("needs.native-security.result == 'success'");
    expect(workflow.jobs.release.with.artifact_run_id).toBe('${{ needs.candidate.outputs.artifact_run_id }}');
    expect(Object.keys(workflow.on.workflow_dispatch.inputs)).toEqual(['target_ref', 'version', 'recovery_run_id']);
    expect(workflow.on.workflow_dispatch.inputs.version.required).toBe(false);
    expect(workflow.on.workflow_dispatch.inputs.target_ref.default).toBe('main');
    expect(workflow.jobs.validate.permissions.actions).toBe('read');
    expect(workflow.jobs.candidate.steps[1].env.RELEASE_SHA).toBe(
      '${{ needs.validate.outputs.release_sha || needs.update-version.outputs.release_sha }}',
    );
    expect(workflow.jobs.summary.steps.find((step: { id?: string }) => step.id === 'summary').env.VERSION).toBe(
      '${{ needs.validate.outputs.version }}',
    );
  });
  it.each(['ci', 'native-security'])(
    '%s checks run after successful recovery candidate despite skipped version update',
    (job) => {
      expect(workflow.jobs[job].if).toBe("${{ !cancelled() && needs.candidate.result == 'success' }}");
      const needs = { candidate: { result: 'success' }, 'update-version': { result: 'skipped' } };
      expect(jobRuns(workflow.jobs[job].if, needs)).toBe(true);
      for (const result of ['failure', 'cancelled', 'skipped'])
        expect(jobRuns(workflow.jobs[job].if, { candidate: { result } })).toBe(false);
      expect(jobRuns(workflow.jobs[job].if, needs, true)).toBe(false);
    },
  );
  it('finalizes successful recovery from main despite skipped ancestors and stops failed/cancelled releases', () => {
    const needs = {
      release: { result: 'success' },
      validate: { outputs: { release_ref: 'main' } },
      'update-version': { result: 'skipped' },
    };
    expect(jobRuns(workflow.jobs.finalize.if, needs)).toBe(true);
    expect(jobRuns(workflow.jobs.finalize.if, needs, true)).toBe(false);
    for (const result of ['failure', 'cancelled', 'skipped'])
      expect(jobRuns(workflow.jobs.finalize.if, { ...needs, release: { result } })).toBe(false);
    expect(
      jobRuns(workflow.jobs.finalize.if, { ...needs, validate: { outputs: { release_ref: 'release-1.2' } } }),
    ).toBe(false);
  });
  it('creates maintenance branches for prereleases and retains always-run evidence', () => {
    expect(workflow.jobs.finalize.if).toBe(
      "${{ !cancelled() && needs.release.result == 'success' && needs.validate.outputs.release_ref == 'main' }}",
    );
    expect(workflow.jobs.summary.if).toBe('always()');
    expect(workflow.jobs.summary.steps[0].with.ref).toBe('${{ github.sha }}');
    expect(workflow.jobs.summary.permissions.contents).toBe('read');
    expect(workflow.jobs['attach-summary'].environment).toBe('release');
    expect(workflow.jobs['attach-summary'].permissions.contents).toBe('write');
    expect(workflow.jobs.summary.needs).toContain('release');
    expect(workflow.concurrency['cancel-in-progress']).toBe(false);
    expect(JSON.stringify(workflow)).not.toContain('secrets: inherit');
  });
});
