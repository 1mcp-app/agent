import { constants } from 'node:fs';
import { access, open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import type { ContextData, ProjectSet, ProjectSetMember } from '@src/types/context.js';
import { createContextHash } from '@src/utils/context/contextHash.js';
import { createHash } from '@src/utils/crypto.js';

import { z } from 'zod';

export const projectSetSchema = z
  .object({
    name: z.string().trim().min(1).max(256).optional(),
    projects: z
      .array(z.object({ label: z.string().trim().min(1).max(128), path: z.string().min(1).max(4096) }).strict())
      .min(1)
      .max(32),
    selection: z.array(z.string().trim().min(1).max(128)).min(1).max(32).optional(),
  })
  .strict()
  .superRefine((set, ctx) => {
    const labels = new Set(set.projects.map((project) => project.label));
    if (labels.size !== set.projects.length) {
      ctx.addIssue({ code: 'custom', message: 'Project labels must be unique', path: ['projects'] });
    }
    if (set.selection && new Set(set.selection).size !== set.selection.length) {
      ctx.addIssue({ code: 'custom', message: 'Project Selection labels must be unique', path: ['selection'] });
    }
    for (const label of set.selection ?? []) {
      if (!labels.has(label)) {
        ctx.addIssue({ code: 'custom', message: `Unknown Project Selection label: ${label}`, path: ['selection'] });
      }
    }
  }) satisfies z.ZodType<ProjectSet>;

export type ResolvedProjectSelection =
  | { kind: 'unresolved'; availableLabels: string[] }
  | { kind: 'single'; projects: [ProjectSetMember] }
  | { kind: 'native-set'; projects: ProjectSetMember[] };

export function resolveProjectSelection(
  context: Pick<ContextData, 'project' | 'projectSet'>,
): ResolvedProjectSelection {
  if (!context.projectSet) {
    if (context.project?.path) {
      return { kind: 'single', projects: [{ label: context.project.name ?? 'project', path: context.project.path }] };
    }
    return { kind: 'unresolved', availableLabels: [] };
  }
  const set = projectSetSchema.parse(context.projectSet);
  const selectedLabels = set.selection ?? (set.projects.length === 1 ? [set.projects[0].label] : undefined);
  if (!selectedLabels) return { kind: 'unresolved', availableLabels: set.projects.map((project) => project.label) };
  const selected = selectedLabels.map((label) => set.projects.find((project) => project.label === label)!);
  if (selected.length === 1) return { kind: 'single', projects: [selected[0]] };
  return { kind: 'native-set', projects: selected };
}

export async function canonicalizeProjectSet(value: unknown, baseDirectory: string): Promise<ProjectSet> {
  const set = projectSetSchema.parse(value);
  const projects = await Promise.all(
    set.projects.map(async (project) => ({
      ...project,
      path: await canonicalizeCheckoutPath(project.path, baseDirectory),
    })),
  );
  return { ...set, projects };
}

export async function canonicalizeCheckoutPath(checkout: string, baseDirectory: string): Promise<string> {
  const canonical = await realpath(path.resolve(baseDirectory, checkout));
  if (!(await stat(canonical)).isDirectory()) throw new Error(`Project Checkout is not a directory: ${checkout}`);
  await access(canonical, constants.R_OK | constants.X_OK);
  return canonical;
}

/** The only saved state is a user-selected file; this never updates a runtime-global current project. */
export async function loadProjectSet(file: string, selection?: string[]): Promise<ProjectSet> {
  const filePath = path.resolve(file);
  const handle = await open(filePath, 'r');
  let content: string;
  try {
    const buffer = Buffer.alloc(65537);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    if (size > 65536) throw new Error('Saved Project Set exceeds the 64 KiB limit');
    content = buffer.toString('utf8', 0, size);
  } finally {
    await handle.close();
  }
  const definition: unknown = JSON.parse(content);
  const parsed = projectSetSchema.parse(definition);
  return canonicalizeProjectSet({ ...parsed, ...(selection ? { selection } : {}) }, path.dirname(filePath));
}

export function withProjectSelection(context: ContextData, projectSet: ProjectSet): ContextData {
  const selection = resolveProjectSelection({ project: {}, projectSet });
  if (selection.kind !== 'single') return { ...context, project: {}, projectSet };
  const [selected] = selection.projects;
  return {
    ...context,
    project: { ...context.project, path: selected.path, cwd: selected.path, name: selected.label },
    projectSet,
  };
}

/** Private routing identity. The canonical authentication/transport session remains unchanged. */
export function createProjectBindingId(
  sessionId: string,
  context: ContextData,
  bindingConfiguration?: unknown,
): string {
  // Retained internal callers can supply a partial context without a project namespace.
  if (!context.project && !context.projectSet) return sessionId;
  const selected = resolveProjectSelection(context);
  const target =
    selected.kind === 'unresolved'
      ? { kind: selected.kind, labels: selected.availableLabels }
      : { kind: selected.kind, projects: [...selected.projects].sort((a, b) => a.label.localeCompare(b.label)) };
  const membership = context.projectSet
    ? [...context.projectSet.projects].sort((a, b) => a.label.localeCompare(b.label))
    : undefined;
  return `binding-${createHash(JSON.stringify({ sessionId, target, membership, contextHash: createContextHash({ ...context, sessionId }, { omitWorkingDirectory: true }), bindingConfiguration }))}`;
}

export function requireProjectTarget(
  context: ContextData,
  mode: 'independent' | 'single' | 'native-set',
): ProjectSetMember[] {
  if (mode === 'independent') return [];
  const selection = resolveProjectSelection(context);
  if (selection.kind === 'unresolved') {
    throw new Error(
      `Project Selection is unresolved. Select a target with --project <label>. Available labels: ${selection.availableLabels.join(', ') || '(none)'}`,
    );
  }
  if (mode === 'single' && selection.kind === 'native-set') {
    throw new Error(
      'This backend accepts one Project Checkout. Select one --project label and coordinate separate calls for other checkouts.',
    );
  }
  return selection.projects;
}
