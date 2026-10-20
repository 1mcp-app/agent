import { createHash, randomBytes } from 'node:crypto';
import { link, lstat, mkdir, open, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';

import { projectSetSchema } from '@src/domains/project-selection/projectSelection.js';
import type { ProjectSetMember } from '@src/types/context.js';
import { credentialReadFlags, hasSafeCredentialPermissions } from '@src/utils/filePermissions.js';

import { z } from 'zod';

const credentialSchema = z.object({ version: z.literal(1), token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const targetSchema = z
  .object({
    project: z.array(z.string().refine(path.isAbsolute)).min(1).max(32),
    'project-set': z.string().refine(path.isAbsolute).optional(),
    'config-dir': z.string().refine(path.isAbsolute),
    runtimeScopeId: z.string().min(1),
    config: z.string().refine(path.isAbsolute).optional(),
    context: z.string().optional(),
    url: z.string().url().optional(),
  })
  .strict()
  .refine((target) => target.project.length === 1 || Boolean(target['project-set']), {
    message: 'Native-set cleanup requires an immutable selection snapshot',
  });
export type ProjectOwnerTarget = z.infer<typeof targetSchema>;

export interface HookOwnerIdentity {
  client: 'codex' | 'claude';
  sessionId: string;
  agentId?: string;
}

export function hookProjectOwnerPath(storageDirectory: string, identity: HookOwnerIdentity): string {
  if (!identity.sessionId || identity.agentId === '') throw new Error('Missing hook owner identity');
  const key = createHash('sha256')
    .update(JSON.stringify([identity.client, identity.sessionId, identity.agentId ?? null]))
    .digest('hex');
  return path.resolve(storageDirectory, 'project-owners', `${key}.json`);
}

/** A host identifier locates a private credential; it is never itself runtime authority. */
export async function createHookProjectOwner(storageDirectory: string, identity: HookOwnerIdentity): Promise<string> {
  const file = hookProjectOwnerPath(storageDirectory, identity);
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await assertPrivateDirectory(directory);
  await publishPrivateRecord(file, JSON.stringify({ version: 1, token: randomBytes(32).toString('hex') }));
  await readProjectOwner(file);
  return file;
}

export async function readProjectOwner(file: string): Promise<string> {
  if (!path.isAbsolute(file)) throw new Error('Project owner credential must be an absolute path');
  await assertPrivateDirectory(path.dirname(file));
  const handle = await open(file, credentialReadFlags(), 0o600);
  try {
    const info = await handle.stat();
    if (!info.isFile() || !hasSafeCredentialPermissions(info, 0o077)) {
      throw new Error('Project owner credential must be a private owner-only file');
    }
    if (info.size > 4096) throw new Error('Invalid project owner credential');
    return credentialSchema.parse(JSON.parse(await handle.readFile('utf8'))).token;
  } finally {
    await handle.close();
  }
}

export function projectOwnerId(token: string): string {
  const bytes = createHash('sha256').update(token).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function recordProjectOwnerTarget(ownerFile: string, input: ProjectOwnerTarget): Promise<void> {
  await readProjectOwner(ownerFile);
  const target = targetSchema.parse(input);
  const directory = `${ownerFile}.targets`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await assertPrivateDirectory(directory);
  const content = JSON.stringify(target);
  const file = path.join(directory, `${createHash('sha256').update(content).digest('hex')}.json`);
  await publishPrivateRecord(file, content);
}

/** Snapshot only the canonical selected members, independent of the original definition file. */
export async function recordProjectOwnerSelection(
  ownerFile: string,
  target: Omit<ProjectOwnerTarget, 'project' | 'project-set'>,
  projects: ProjectSetMember[],
): Promise<void> {
  await readProjectOwner(ownerFile);
  const selection = projectSetSchema.parse({ projects, selection: projects.map((project) => project.label) });
  const directory = `${ownerFile}.targets`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await assertPrivateDirectory(directory);
  const content = JSON.stringify(selection);
  const snapshot = path.join(directory, `${createHash('sha256').update(content).digest('hex')}.selection.json`);
  await publishPrivateRecord(snapshot, content);
  await recordProjectOwnerTarget(ownerFile, {
    ...target,
    project: projects.map((project) => project.path),
    'project-set': snapshot,
  });
}

export async function readProjectOwnerTargets(ownerFile: string): Promise<ProjectOwnerTarget[]> {
  await readProjectOwner(ownerFile);
  const directory = `${ownerFile}.targets`;
  let names: string[];
  try {
    await assertPrivateDirectory(directory);
    names = await readdir(directory);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
  const targets: ProjectOwnerTarget[] = [];
  for (const name of names.filter((entry) => /^[a-f0-9]{64}\.json$/.test(entry)).sort()) {
    const handle = await open(path.join(directory, name), credentialReadFlags(), 0o600);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > 16384 || !hasSafeCredentialPermissions(info, 0o077))
        throw new Error('Invalid project owner target');
      targets.push(targetSchema.parse(JSON.parse(await handle.readFile('utf8'))));
    } finally {
      await handle.close();
    }
  }
  return targets;
}

async function assertPrivateDirectory(directory: string): Promise<void> {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || !hasSafeCredentialPermissions(info, 0o077)) {
    throw new Error('Project owner credentials require a private owner-only directory');
  }
}

/** Publish complete records without replacing a concurrent hook's credential or target. */
async function publishPrivateRecord(file: string, content: string): Promise<void> {
  const temporary = `${file}.${randomBytes(12).toString('hex')}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(content);
    } finally {
      await handle.close();
    }
    await link(temporary, file);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    });
  }
}
