import { randomBytes } from 'node:crypto';
import path from 'node:path';

import {
  createProjectOwnerStorage,
  hasProjectOwnerState,
  resolveProjectOwnerStorage,
  temporaryProjectOwnerStorage,
} from '@src/commands/shared/projectOwnerStorage.js';
import {
  assertNoProjectOwnerCalls,
  assertProjectOwnerAbsent,
  createHookProjectOwner,
  type HookOwnerIdentity,
  hookProjectOwnerPath,
  isProjectOwnerEnded,
  markProjectOwnerEnded,
  markProjectOwnerReleased,
  type ProjectOwnerTarget,
  readHookThreadLocatorRecord,
  readProjectOwner,
  readProjectOwnerTargets,
  readProjectOwnerTerminal,
  recordHookThreadLocator,
  recordProjectOwnerAssignment,
  removeProjectOwner,
  withHookIdentityLock,
  withProjectOwnerLock,
} from '@src/commands/shared/projectOwnerStore.js';
import type { ProjectSelectionOptions } from '@src/commands/shared/projectSelectionOptions.js';
import { resolveProjectContext } from '@src/config/projectConfigLoader.js';
import { getConfigDir } from '@src/constants.js';
import { canonicalizeCheckoutPath } from '@src/domains/project-selection/projectSelection.js';
import type { GlobalOptions } from '@src/globalOptions.js';

import { z } from 'zod';

interface OwnershipHookOptions extends GlobalOptions, ProjectSelectionOptions {
  client: 'codex' | 'claude';
  event: 'SessionStart' | 'SubagentStart' | 'SessionEnd';
}

const inputSchema = z.object({
  hook_event_name: z.enum(['SessionStart', 'SubagentStart', 'SessionEnd']),
  session_id: z.string().min(1).max(512),
  agent_id: z.string().min(1).max(512).optional(),
  cwd: z.string().refine(path.isAbsolute).optional(),
});

function identity(options: OwnershipHookOptions, input: string): HookOwnerIdentity {
  const parsed = inputSchema.parse(JSON.parse(input));
  if (parsed.hook_event_name !== options.event) throw new Error('Hook event mismatch');
  if (options.event === 'SessionStart' && parsed.agent_id)
    throw new Error('SessionStart cannot establish worker assignment; use SubagentStart');
  if (options.event === 'SubagentStart' && !parsed.agent_id) throw new Error('Worker identity is missing');
  if (options.event === 'SessionEnd' && parsed.agent_id)
    throw new Error('SessionEnd does not verify worker termination');
  return {
    client: options.client,
    sessionId: parsed.session_id,
    ...(parsed.agent_id ? { agentId: parsed.agent_id } : {}),
  };
}

export async function bootstrapOwner(options: OwnershipHookOptions, input: string): Promise<string> {
  if (options.event === 'SessionEnd') throw new Error('End events cannot create ownership');
  const hookIdentity = input.trim() ? identity(options, input) : undefined;
  const storage = hookIdentity
    ? await resolveProjectOwnerStorage(
        getConfigDir(options['config-dir']),
        hookIdentity.client,
        hookIdentity.agentId ?? hookIdentity.sessionId,
        hookIdentity.sessionId,
      )
    : undefined;
  const establish = async () => {
    let file = options['project-owner'];
    let ownerIdentity = hookIdentity;
    if (!file) {
      if (!hookIdentity || !storage) throw new Error('Missing hook owner identity');
      const locator = await readHookThreadLocatorRecord(
        storage,
        hookIdentity.client,
        hookIdentity.agentId ?? hookIdentity.sessionId,
      );
      if (
        locator &&
        (locator.identity.sessionId !== hookIdentity.sessionId || locator.identity.agentId !== hookIdentity.agentId)
      )
        throw new Error('Hook thread identity records disagree');
      ownerIdentity = locator?.identity ?? hookIdentity;
      const previous = locator?.ownerFile ?? hookProjectOwnerPath(storage, hookIdentity);
      if (await isProjectOwnerEnded(previous))
        ownerIdentity = { ...hookIdentity, generation: randomBytes(16).toString('hex') };
      if (locator) await readProjectOwner(previous);
      file = await createHookProjectOwner(storage, ownerIdentity);
    }
    await readProjectOwner(file);
    if (await isProjectOwnerEnded(file))
      throw new Error('Session has ended; use project recover to retry recorded cleanup');
    const parsed = input.trim() ? inputSchema.parse(JSON.parse(input)) : undefined;
    let project = options.project;
    if (options.event === 'SessionStart' && !project && !options['project-set'] && parsed?.cwd) {
      project = [await canonicalizeCheckoutPath((await resolveProjectContext(parsed.cwd)).projectRoot, parsed.cwd)];
    }
    await recordProjectOwnerAssignment(file, {
      version: 1,
      worker: options.event === 'SubagentStart',
      ...(project ? { project } : {}),
      ...(options['project-set'] ? { 'project-set': options['project-set'] } : {}),
    });
    if (ownerIdentity && storage) await recordHookThreadLocator(storage, ownerIdentity, file);
    return file;
  };
  if (!hookIdentity || !storage) return establish();
  if (storage === temporaryProjectOwnerStorage(getConfigDir(options['config-dir'])))
    await createProjectOwnerStorage(storage);
  return withHookIdentityLock(storage, hookIdentity, establish);
}

export async function releaseSessionOwner(
  options: OwnershipHookOptions,
  input: string,
  release: (ownerFile: string, target: ProjectOwnerTarget) => Promise<void>,
): Promise<void> {
  if (options.event !== 'SessionEnd') throw new Error('Only verified SessionEnd may release ownership');
  const hookIdentity = identity(options, input);
  const storage = await resolveProjectOwnerStorage(
    getConfigDir(options['config-dir']),
    hookIdentity.client,
    hookIdentity.sessionId,
    hookIdentity.sessionId,
  );
  // Pin the generation before waiting for another lifecycle hook; cleanup never follows a newer locator.
  const locator = await readHookThreadLocatorRecord(storage, hookIdentity.client, hookIdentity.sessionId);
  const ownerIdentity = locator?.identity ?? hookIdentity;
  const file = locator?.ownerFile ?? hookProjectOwnerPath(storage, hookIdentity);
  if (!(await hasProjectOwnerState(storage, hookIdentity.client, hookIdentity.sessionId, hookIdentity.sessionId))) {
    await assertProjectOwnerAbsent(file, hookIdentity);
    return;
  }
  const selectedCredential = await readProjectOwner(file).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  });
  const selected = await withHookIdentityLock(storage, hookIdentity, async () => {
    const currentCredential = await readProjectOwner(file).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (currentCredential !== selectedCredential)
      throw new Error('Session owner changed during terminal selection; no cleanup performed');
    // An already-ended owner may be waiting on remote cleanup. Do not wait for its
    // owner lock while holding the identity lock needed by a resumed startup.
    if (await isProjectOwnerEnded(file)) return true;
    return withProjectOwnerLock(file, async () => {
      if (!currentCredential) {
        await assertProjectOwnerAbsent(file, ownerIdentity);
        return false;
      }
      await readProjectOwnerTargets(file);
      await markProjectOwnerEnded(file, ownerIdentity);
      return true;
    });
  });
  if (selected) await recoverEndedSessionOwner(file, release);
}

/** Recovery requires prior verified SessionEnd evidence, never age or a parent's lifetime. */
export async function recoverEndedSessionOwner(
  file: string,
  release: (ownerFile: string, target: ProjectOwnerTarget) => Promise<void>,
): Promise<void> {
  await withProjectOwnerLock(file, async () => {
    if ((await readProjectOwnerTerminal(file))?.released) {
      await removeProjectOwner(file);
      return;
    }
    if (!(await isProjectOwnerEnded(file)))
      throw new Error('No verified terminal record; active or abandoned owners cannot be recovered automatically');
    const targets = await readProjectOwnerTargets(file);
    await releaseTargets(file, targets, release);
  });
}

async function releaseTargets(
  file: string,
  targets: ProjectOwnerTarget[],
  release: (ownerFile: string, target: ProjectOwnerTarget) => Promise<void>,
): Promise<void> {
  await assertNoProjectOwnerCalls(file);
  const results = await Promise.allSettled(targets.map((target) => release(file, target)));
  if (results.some((result) => result.status === 'rejected'))
    throw new Error('Session ownership cleanup is incomplete');
  await markProjectOwnerReleased(file);
  await removeProjectOwner(file);
}
