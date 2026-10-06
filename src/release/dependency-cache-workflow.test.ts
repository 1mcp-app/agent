import fs from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Step {
  uses?: string;
  if?: string;
  with?: Record<string, unknown>;
}
function workflow(name: string) {
  return parse(fs.readFileSync(`.github/workflows/${name}.yml`, 'utf8'));
}
function nodeSetups(name: string): Step[] {
  return Object.values(workflow(name).jobs)
    .flatMap((job) => (job as { steps?: Step[] }).steps || [])
    .filter((step) => step.uses === './.github/actions/setup-node-pnpm');
}
describe('release candidate dependency cache isolation', () => {
  it('preserves ordinary caching but has an explicit uncached branch with automatic caching disabled', () => {
    const action = parse(fs.readFileSync('.github/actions/setup-node-pnpm/action.yml', 'utf8'));
    expect(action.inputs['cache-deps'].default).toBe('true');
    const setups: Step[] = action.runs.steps.filter((step: Step) => step.uses === 'actions/setup-node@v6');
    expect(setups).toHaveLength(2);
    const cached = setups.find((step) => step.with?.cache === 'pnpm')!;
    const uncached = setups.find((step) => step.with?.cache === undefined)!;
    expect(cached.if).toBe("inputs.cache-deps == 'true'");
    expect(uncached.if).toBe("inputs.cache-deps != 'true'");
    for (const step of setups) expect(step.with?.['package-manager-cache']).toBe(false);
  });
  it.each(['release-pipeline', 'build-binaries', 'publish-to-npm', 'update-version'])(
    'disables cache for every %s release setup',
    (name) => {
      const setups = nodeSetups(name);
      expect(setups.length).toBeGreaterThan(0);
      for (const step of setups) expect(step.with?.['cache-deps']).toBe('false');
    },
  );
  it('disables every selected-source reusable CI dependency cache including uv', () => {
    const ci = workflow('test-and-validate');
    for (const [jobName, job] of Object.entries(ci.jobs)) {
      const setups =
        (job as { steps?: Step[] }).steps?.filter((step) => step.uses === './.github/actions/setup-node-pnpm') || [];
      for (const step of setups)
        expect(step.with?.['cache-deps']).toBe(
          jobName === 'release-result' ? 'false' : '${{ !inputs.checkout_ref && !inputs.release_gate }}',
        );
    }
    const uv = ci.jobs['test-conformance'].steps.find((step: Step) => step.uses === 'astral-sh/setup-uv@v7');
    expect(uv.with['enable-cache']).toBe('${{ !inputs.checkout_ref && !inputs.release_gate }}');
  });
  it.each(['native-credentials', 'cooperative-runtime'])(
    'disables selected-source cache for %s without changing normal CI caching',
    (name) => {
      for (const step of nodeSetups(name)) expect(step.with?.['cache-deps']).toBe('${{ !inputs.checkout_ref }}');
    },
  );
  it('checks maintenance branch setup action bytes before invoking local setup', () => {
    const steps: Step[] = workflow('update-version').jobs['update-version'].steps;
    const setupIndex = steps.findIndex((step) => step.uses === './.github/actions/setup-node-pnpm');
    const guard = steps[setupIndex - 1] as Step & { run?: string; env?: Record<string, string> };
    expect(guard.env?.WORKFLOW_SHA).toBe('${{ github.sha }}');
    expect(guard.run).toContain('git show "HEAD:$action_path"');
    expect(guard.run).toContain('git show "$WORKFLOW_SHA:$action_path"');
    expect(guard.run).toContain('cmp -s');
    expect(guard.run).toContain('owner must align the release branch cache policy');
  });

  it('does not restore or publish shared OCI release build caches', () => {
    const build = workflow('build-docker-images').jobs.docker.steps.find(
      (step: Step) => step.uses === 'docker/build-push-action@v7',
    );
    expect(build.with['no-cache']).toBe(true);
    expect(build.with).not.toHaveProperty('cache-from');
    expect(build.with).not.toHaveProperty('cache-to');
  });
});
