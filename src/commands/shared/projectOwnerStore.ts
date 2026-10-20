import { createHash, randomBytes } from 'node:crypto';
import { link, lstat, mkdir, open, readdir, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';

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
  await withProjectOwnerLock(ownerFile, async () => {
    await assertOwnerActive(ownerFile);
    await recordProjectOwnerTargetUnlocked(ownerFile, input);
  });
}

async function recordProjectOwnerTargetUnlocked(ownerFile: string, input: ProjectOwnerTarget): Promise<void> {
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
async function recordProjectOwnerSelectionUnlocked(
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
  await recordProjectOwnerTargetUnlocked(ownerFile, {
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

/** Only verified terminal hooks may call this. Unknown files keep recovery state intact. */
export async function removeProjectOwner(ownerFile: string): Promise<void> {
  await readProjectOwner(ownerFile);
  const directory = `${ownerFile}.targets`;
  let names: string[] = [];
  try {
    await assertPrivateDirectory(directory);
    names = await readdir(directory);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  if (names.some((name) => !/^[a-f0-9]{64}(\.selection)?\.json$/.test(name))) {
    throw new Error('Unrecognized owner records; terminal cleanup requires inspection');
  }
  const terminal = await open(`${ownerFile}.ended`, credentialReadFlags(), 0o600);
  let ended: { identity?: HookOwnerIdentity };
  try {
    ended = z
      .object({ version: z.literal(1), identity: hookOwnerIdentitySchema.optional() })
      .strict()
      .parse(JSON.parse(await terminal.readFile('utf8')));
  } finally {
    await terminal.close();
  }
  let locatorFile: string | undefined;
  if (ended.identity) {
    const storageDirectory = path.dirname(path.dirname(ownerFile));
    const thread = ended.identity.agentId ?? ended.identity.sessionId;
    const locator = await readHookThreadLocator(storageDirectory, ended.identity.client, thread);
    if (locator && locator.ownerFile !== ownerFile) throw new Error('Terminal locator and owner disagree');
    if (locator) locatorFile = hookThreadLocatorPath(storageDirectory, ended.identity.client, thread);
  }
  for (const name of names) await unlink(path.join(directory, name));
  await rmdir(directory).catch((error: unknown) => {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  });
  for (const suffix of ['.assignment.json', '.worker']) {
    await unlink(`${ownerFile}${suffix}`).catch((error: unknown) => {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    });
  }
  if (locatorFile) await unlink(locatorFile);
  await unlink(ownerFile);
  await unlink(`${ownerFile}.ended`).catch((error: unknown) => {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  });
}

const assignmentSchema = z
  .object({
    version: z.literal(1),
    worker: z.boolean(),
    project: z.array(z.string().min(1)).min(1).max(32).optional(),
    'project-set': z.string().refine(path.isAbsolute).optional(),
  })
  .strict()
  .refine(
    (value) =>
      Boolean(value['project-set']) ||
      !value.project ||
      (value.project.length === 1 && path.isAbsolute(value.project[0])),
    'Worker assignment must name one absolute checkout or a project set',
  );
export type ProjectOwnerAssignment = z.infer<typeof assignmentSchema>;

export async function recordProjectOwnerAssignment(
  ownerFile: string,
  assignment: ProjectOwnerAssignment,
): Promise<void> {
  await withProjectOwnerLock(ownerFile, async () => {
    await assertOwnerActive(ownerFile);
    await recordProjectOwnerAssignmentUnlocked(ownerFile, assignment);
  });
}

async function recordProjectOwnerAssignmentUnlocked(
  ownerFile: string,
  assignment: ProjectOwnerAssignment,
): Promise<void> {
  await readProjectOwner(ownerFile);
  // An unresolved startup can be followed by the worker's explicit dispatch assignment.
  // Do not publish a default until dispatch actually provides it.
  if (!assignment.project && !assignment['project-set']) {
    if (assignment.worker) await publishPrivateRecord(`${ownerFile}.worker`, '{}');
    return;
  }
  if (assignment.worker) await publishPrivateRecord(`${ownerFile}.worker`, '{}');
  const content = JSON.stringify(assignmentSchema.parse(assignment));
  await publishPrivateRecord(`${ownerFile}.assignment.json`, content);
  const existing = await readProjectOwnerAssignment(ownerFile);
  if (assignment.worker && JSON.stringify(existing) !== content)
    throw new Error('Worker assignment already exists; use a per-call --project override');
}

export async function readProjectOwnerAssignment(ownerFile: string): Promise<ProjectOwnerAssignment | undefined> {
  await readProjectOwner(ownerFile);
  try {
    const handle = await open(`${ownerFile}.assignment.json`, credentialReadFlags(), 0o600);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > 65536 || !hasSafeCredentialPermissions(info, 0o077))
        throw new Error('Invalid worker assignment');
      return assignmentSchema.parse(JSON.parse(await handle.readFile('utf8')));
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  try {
    const info = await lstat(`${ownerFile}.worker`);
    if (!info.isFile() || info.isSymbolicLink() || !hasSafeCredentialPermissions(info, 0o077))
      throw new Error('Invalid worker marker');
    return { version: 1, worker: true };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function recordProjectOwnerSelection(
  ownerFile: string,
  target: Omit<ProjectOwnerTarget, 'project' | 'project-set'>,
  projects: ProjectSetMember[],
): Promise<void> {
  await withProjectOwnerLock(ownerFile, async () => {
    await assertOwnerActive(ownerFile);
    await recordProjectOwnerSelectionUnlocked(ownerFile, target, projects);
  });
}

/** A stale lock is retained for inspection, never cleared by age or process guesses. */
export async function withProjectOwnerLock<T>(ownerFile: string, action: () => Promise<T>): Promise<T> {
  await assertPrivateDirectory(path.dirname(ownerFile));
  const lock = `${ownerFile}.lock`;
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      await mkdir(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      if (Date.now() >= deadline)
        throw new Error('Owner state is busy or has an abandoned lock; inspect before recovery');
      await setTimeout(25);
    }
  }
  try {
    return await action();
  } finally {
    await rmdir(lock);
  }
}

export async function markProjectOwnerEnded(ownerFile: string, identity?: HookOwnerIdentity): Promise<void> {
  await readProjectOwner(ownerFile);
  await publishPrivateRecord(`${ownerFile}.ended`, JSON.stringify({ version: 1, ...(identity ? { identity } : {}) }));
}

export async function isProjectOwnerEnded(ownerFile: string): Promise<boolean> {
  try {
    const handle = await open(`${ownerFile}.ended`, credentialReadFlags(), 0o600);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > 16384 || !hasSafeCredentialPermissions(info, 0o077))
        throw new Error('Invalid terminal owner record');
      z.object({ version: z.literal(1), identity: hookOwnerIdentitySchema.optional() })
        .strict()
        .parse(JSON.parse(await handle.readFile('utf8')));
      return true;
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function assertOwnerActive(ownerFile: string): Promise<void> {
  if (await isProjectOwnerEnded(ownerFile))
    throw new Error('Session has ended; use project recover to retry recorded cleanup');
}

const hookOwnerIdentitySchema = z
  .object({
    client: z.enum(['codex', 'claude']),
    sessionId: z.string().min(1).max(512),
    agentId: z.string().min(1).max(512).optional(),
  })
  .strict();
const threadLocatorSchema = z
  .object({
    version: z.literal(1),
    identity: hookOwnerIdentitySchema,
    ownerFile: z.string().refine(path.isAbsolute),
  })
  .strict();

export function hookThreadLocatorPath(
  storageDirectory: string,
  client: HookOwnerIdentity['client'],
  threadId: string,
): string {
  const key = createHash('sha256')
    .update(JSON.stringify([client, threadId]))
    .digest('hex');
  return path.resolve(storageDirectory, 'project-owners', `${key}.thread.json`);
}

/** Only trusted hook input writes a locator; shell environment can only read it. */
export async function recordHookThreadLocator(
  storageDirectory: string,
  identity: HookOwnerIdentity,
  ownerFile: string,
): Promise<void> {
  await readProjectOwner(ownerFile);
  if (ownerFile !== hookProjectOwnerPath(storageDirectory, identity))
    throw new Error('Hook identity and explicit owner disagree');
  const file = hookThreadLocatorPath(storageDirectory, identity.client, identity.agentId ?? identity.sessionId);
  const content = JSON.stringify(threadLocatorSchema.parse({ version: 1, identity, ownerFile }));
  await publishPrivateRecord(file, content);
  const existing = await readHookThreadLocator(
    storageDirectory,
    identity.client,
    identity.agentId ?? identity.sessionId,
  );
  if (JSON.stringify(existing) !== content) throw new Error('Hook thread identity records disagree');
}

export async function readHookThreadLocator(
  storageDirectory: string,
  client: HookOwnerIdentity['client'],
  threadId: string,
): Promise<z.infer<typeof threadLocatorSchema> | undefined> {
  const file = hookThreadLocatorPath(storageDirectory, client, threadId);
  let handle;
  try {
    await assertPrivateDirectory(path.dirname(file));
    handle = await open(file, credentialReadFlags(), 0o600);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 16384 || !hasSafeCredentialPermissions(info, 0o077))
      throw new Error('Invalid private thread locator');
    const record = threadLocatorSchema.parse(JSON.parse(await handle.readFile('utf8')));
    if (record.identity.client !== client || (record.identity.agentId ?? record.identity.sessionId) !== threadId)
      throw new Error('Thread locator identity mismatch');
    if (record.ownerFile !== hookProjectOwnerPath(storageDirectory, record.identity))
      throw new Error('Thread locator owner mismatch');
    await readProjectOwner(record.ownerFile);
    return record;
  } finally {
    await handle.close();
  }
}
