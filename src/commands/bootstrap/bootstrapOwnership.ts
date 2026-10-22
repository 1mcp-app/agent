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
  hookProjectOwnerPath,
  isProjectOwnerEnded,
  markProjectOwnerEnded,
  markProjectOwnerReleased,
  type ProjectOwnerTarget,
  readProjectOwner,
  readProjectOwnerTargets,
  readProjectOwnerTerminal,
  recordHookThreadLocator,
  recordProjectOwnerAssignment,
  removeProjectOwner,
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

function identity(options: OwnershipHookOptions, input: string) {
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
  let file = options['project-owner'];
  if (!file) {
    if (!hookIdentity || !storage) throw new Error('Missing hook owner identity');
    if (storage === temporaryProjectOwnerStorage(getConfigDir(options['config-dir'])))
      await createProjectOwnerStorage(storage);
    file = await createHookProjectOwner(storage, hookIdentity);
  }
  await readProjectOwner(file);
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
  if (hookIdentity && storage) await recordHookThreadLocator(storage, hookIdentity, file);
  return file;
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
  const file = hookProjectOwnerPath(storage, hookIdentity);
  if (!(await hasProjectOwnerState(storage, hookIdentity.client, hookIdentity.sessionId, hookIdentity.sessionId))) {
    await assertProjectOwnerAbsent(file, hookIdentity);
    return;
  }
  await withProjectOwnerLock(file, async () => {
    if ((await readProjectOwnerTerminal(file))?.released) {
      await removeProjectOwner(file);
      return;
    }
    let targets: ProjectOwnerTarget[];
    try {
      targets = await readProjectOwnerTargets(file);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        await assertProjectOwnerAbsent(file, identity(options, input));
        return;
      }
      throw error;
    }
    await markProjectOwnerEnded(file, identity(options, input));
    await releaseTargets(file, targets, release);
  });
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
