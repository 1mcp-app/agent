import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { isContextData } from '@src/transport/http/utils/contextExtractor.js';
import type { ContextData } from '@src/types/context.js';
import { createContextHash } from '@src/utils/context/contextHash.js';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getProjectBinding, withProjectBinding } from './projectBindingScope.js';
import { isProjectBackendVisible, projectToolArguments, resolveProjectPolicies } from './projectPolicy.js';
import {
  canonicalizeProjectSet,
  createProjectBindingId,
  loadProjectSet,
  projectSetSchema,
  requireProjectTarget,
  resolveProjectSelection,
  withProjectSelection,
} from './projectSelection.js';

describe('explicit Project Sets', () => {
  let directory: string;
  let context: ContextData;

  beforeEach(async () => {
    directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'project-selection-')));
    await Promise.all(['frontend', 'backend'].map((label) => mkdir(path.join(directory, label))));
    context = {
      project: {},
      user: {},
      environment: {},
      sessionId: 'shared-agent',
      projectSet: {
        projects: ['frontend', 'backend'].map((label) => ({ label, path: path.join(directory, label) })),
      },
    };
  });
  afterEach(async () => rm(directory, { recursive: true, force: true }));

  it('keeps a multi-member set unresolved without selecting its first member', () => {
    expect(resolveProjectSelection(context)).toEqual({ kind: 'unresolved', availableLabels: ['frontend', 'backend'] });
    expect(withProjectSelection({ ...context, project: { path: '/parent' } }, context.projectSet!).project).toEqual({});
    expect(() => requireProjectTarget(context, 'single')).toThrow('frontend, backend');
    expect(requireProjectTarget(context, 'independent')).toEqual([]);
  });

  it('preserves a single checkout default and explicitly selects combined members', () => {
    expect(requireProjectTarget({ ...context, projectSet: undefined, project: { path: '/legacy' } }, 'single')).toEqual(
      [{ label: 'project', path: '/legacy' }],
    );
    const selected = { ...context, projectSet: { ...context.projectSet!, selection: ['backend', 'frontend'] } };
    expect(requireProjectTarget(selected, 'native-set').map((project) => project.label)).toEqual([
      'backend',
      'frontend',
    ]);
    expect(() => requireProjectTarget(selected, 'single')).toThrow('one Project Checkout');
  });

  it('rejects unknown and duplicate selection labels and client policy assertions', () => {
    expect(
      projectSetSchema.safeParse({
        projects: [
          { label: 'same', path: directory },
          { label: 'same', path: directory },
        ],
      }).success,
    ).toBe(false);
    expect(projectSetSchema.safeParse({ ...context.projectSet, selection: ['unknown'] }).success).toBe(false);
    expect(projectSetSchema.safeParse({ ...context.projectSet, selection: ['frontend', 'frontend'] }).success).toBe(
      false,
    );
    expect(isContextData({ ...context, bindingId: 'client-asserted' })).toBe(false);
    expect(isContextData({ ...context, projectSet: { ...context.projectSet, effectiveFilters: [] } })).toBe(false);
  });

  it('loads a user-selected saved definition relative to that file and checks accessible canonical directories', async () => {
    await symlink(path.join(directory, 'frontend'), path.join(directory, 'alias'));
    const file = path.join(directory, 'feature.json');
    await writeFile(
      file,
      JSON.stringify({
        name: 'feature',
        projects: [
          { label: 'frontend', path: './alias' },
          { label: 'backend', path: './backend' },
        ],
      }),
    );
    const definition = await loadProjectSet(file, ['backend']);
    expect(definition.projects[0].path).toBe(path.join(directory, 'frontend'));
    expect(resolveProjectSelection({ project: {}, projectSet: definition })).toMatchObject({
      kind: 'single',
      projects: [{ label: 'backend' }],
    });
    await expect(
      canonicalizeProjectSet({ projects: [{ label: 'missing', path: './missing' }] }, directory),
    ).rejects.toThrow();
    await expect(
      canonicalizeProjectSet({ projects: [{ label: 'file', path: './feature.json' }] }, directory),
    ).rejects.toThrow('not a directory');
  });

  it('bounds saved definitions and member cardinality before filesystem traversal', async () => {
    const file = path.join(directory, 'oversized.json');
    await writeFile(file, ' '.repeat(65537));
    await expect(loadProjectSet(file)).rejects.toThrow('64 KiB');
    expect(
      projectSetSchema.safeParse({
        projects: Array.from({ length: 33 }, (_, index) => ({ label: `member-${index}`, path: directory })),
      }).success,
    ).toBe(false);
    expect(projectSetSchema.safeParse({ projects: [{ label: 'x'.repeat(129), path: directory }] }).success).toBe(false);
  });

  it('partitions proofs, cache hashes and bindings by target without changing the canonical session', async () => {
    const frontend = withProjectSelection(context, { ...context.projectSet!, selection: ['frontend'] });
    const backend = withProjectSelection(context, { ...context.projectSet!, selection: ['backend'] });
    expect(createContextHash(frontend)).not.toBe(createContextHash(backend));
    const frontendId = createProjectBindingId('shared-agent', frontend);
    const backendId = createProjectBindingId('shared-agent', backend);
    expect(frontendId).not.toBe(backendId);
    const observed = await Promise.all(
      [frontend, backend].map((selected) =>
        withProjectBinding(createProjectBindingId('shared-agent', selected), selected, async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, 5));
          return getProjectBinding();
        }),
      ),
    );
    expect(observed.map((value) => value?.context?.project.name)).toEqual(['frontend', 'backend']);
    expect(observed.map((value) => value?.bindingId)).toEqual([frontendId, backendId]);
    expect(getProjectBinding()).toBeUndefined();
    expect(context.sessionId).toBe('shared-agent');
  });

  it('derives combined visibility from every checkout policy and injects only explicitly selected paths', async () => {
    await writeFile(path.join(directory, 'frontend', '.1mcprc'), JSON.stringify({ tags: ['frontend'] }));
    await writeFile(path.join(directory, 'backend', '.1mcprc'), JSON.stringify({ tags: ['backend'] }));
    const selected = withProjectSelection(context, { ...context.projectSet!, selection: ['frontend', 'backend'] });
    const policies = await resolveProjectPolicies(selected);
    const config = {
      type: 'stdio' as const,
      command: 'native',
      projectTarget: { mode: 'native-set' as const, argument: 'projects' },
      tags: ['frontend'],
    };
    expect(isProjectBackendVisible(config, selected, policies)).toBe(false);
    expect(isProjectBackendVisible({ ...config, tags: ['frontend', 'backend'] }, selected, policies)).toBe(true);
    expect(isProjectBackendVisible(config, context, [])).toBe(false);
    expect(projectToolArguments(config, selected, { query: 'symbol' })).toEqual({
      query: 'symbol',
      projects: selected.projectSet!.projects.map((project) => project.path),
    });
    expect(() => projectToolArguments(config, selected, { projects: ['/other'] })).toThrow('conflicts');
    expect(() => projectToolArguments(config, context, {})).toThrow('frontend, backend');
  });

  it('preserves explicit single-checkout filter overrides while combined selection keeps member restrictions', async () => {
    await writeFile(path.join(directory, 'frontend', '.1mcprc'), JSON.stringify({ tags: ['frontend'] }));
    const single = withProjectSelection(context, { ...context.projectSet!, selection: ['frontend'] });
    const backendTemplate = { type: 'stdio' as const, command: 'node', tags: ['backend'], template: {} };
    const requestFilter = { tags: ['backend'], tagFilterMode: 'simple-or' as const };
    expect(isProjectBackendVisible(backendTemplate, single, await resolveProjectPolicies(single))).toBe(false);
    expect(isProjectBackendVisible(backendTemplate, single, await resolveProjectPolicies(single, requestFilter))).toBe(
      true,
    );
    const combined = withProjectSelection(context, { ...context.projectSet!, selection: ['frontend', 'backend'] });
    expect(
      isProjectBackendVisible(
        { ...backendTemplate, projectTarget: { mode: 'native-set', argument: 'projects' } },
        combined,
        await resolveProjectPolicies(combined, requestFilter),
      ),
    ).toBe(false);
  });
});
