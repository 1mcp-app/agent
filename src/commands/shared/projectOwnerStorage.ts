import { createHash } from 'node:crypto';
import { lstat, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { hasSafeCredentialPermissions } from '@src/utils/filePermissions.js';

import { type HookOwnerIdentity, hookProjectOwnerPath, hookThreadLocatorPath } from './projectOwnerStore.js';

/** Keep writable caller state separate from runtime configuration, scoped to the OS user and runtime. */
export function temporaryProjectOwnerStorage(configDirectory: string): string {
  const key = createHash('sha256')
    .update(JSON.stringify([os.userInfo().username, path.resolve(configDirectory)]))
    .digest('hex');
  return path.join(os.tmpdir(), `1mcp-owners-${key}`);
}

export async function hasProjectOwnerState(
  storage: string,
  client: HookOwnerIdentity['client'],
  threadId: string,
  sessionId?: string,
): Promise<boolean> {
  const identities: HookOwnerIdentity[] = [{ client, sessionId: sessionId ?? threadId }];
  if (sessionId && threadId !== sessionId) identities.push({ client, sessionId, agentId: threadId });
  const files = [hookThreadLocatorPath(storage, client, threadId)];
  if (sessionId && sessionId !== threadId) files.push(hookThreadLocatorPath(storage, client, sessionId));
  for (const identity of identities) {
    const owner = hookProjectOwnerPath(storage, identity);
    for (const suffix of ['', '.assignment.json', '.worker', '.targets', '.calls', '.ended', '.lock']) {
      files.push(`${owner}${suffix}`);
    }
  }
  for (const file of files) {
    try {
      await lstat(file);
      return true;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
  }
  return false;
}

/** Existing sessions stay at their original location; never fork a live credential or its recovery records. */
export async function resolveProjectOwnerStorage(
  configDirectory: string,
  client: HookOwnerIdentity['client'],
  threadId: string,
  sessionId?: string,
): Promise<string> {
  const temporary = temporaryProjectOwnerStorage(configDirectory);
  try {
    const info = await lstat(temporary);
    if (!info.isDirectory() || info.isSymbolicLink() || !hasSafeCredentialPermissions(info, 0o077))
      throw new Error('Temporary owner storage must be a private owner-only directory');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const current = await hasProjectOwnerState(temporary, client, threadId, sessionId);
  const legacy = await hasProjectOwnerState(configDirectory, client, threadId, sessionId);
  if (current && legacy) throw new Error('Conflicting temporary and legacy owner records; inspect session ownership');
  return legacy ? configDirectory : temporary;
}

export async function createProjectOwnerStorage(storage: string): Promise<void> {
  await mkdir(storage, { recursive: true, mode: 0o700 });
  const info = await lstat(storage);
  if (!info.isDirectory() || info.isSymbolicLink() || !hasSafeCredentialPermissions(info, 0o077))
    throw new Error('Temporary owner storage must be a private owner-only directory');
}
