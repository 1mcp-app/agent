import fs from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflow = parse(fs.readFileSync('.github/workflows/release-pipeline.yml', 'utf8'));
describe('release-pipeline workflow', () => {
  it('checks the final version SHA with the existing full quality and native-security workflows', () => {
    expect(workflow.jobs['update-version'].needs).toBe('validate');
    expect(workflow.jobs.ci.needs).toBe('candidate');
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
    expect(workflow.on.workflow_dispatch.inputs.approval_ref.required).toBe(true);
    expect(workflow.on.workflow_dispatch.inputs.readiness_ref.required).toBe(true);
  });
  it('creates maintenance branches for prereleases and retains always-run evidence', () => {
    expect(workflow.jobs.finalize.if).toBe("${{ needs.validate.outputs.release_ref == 'main' }}");
    expect(workflow.jobs.summary.if).toBe('always()');
    expect(workflow.jobs.summary.permissions.contents).toBe('read');
    expect(workflow.jobs['attach-summary'].environment).toBe('release');
    expect(workflow.jobs['attach-summary'].permissions.contents).toBe('write');
    expect(workflow.jobs.summary.needs).toContain('release');
    expect(workflow.concurrency['cancel-in-progress']).toBe(false);
    expect(JSON.stringify(workflow)).not.toContain('secrets: inherit');
  });
});
