import path from 'node:path';

import { getRuntimeParentEnvironment } from '@src/config/runtimeBootstrap.js';
import { getConfigDir } from '@src/constants.js';
import type { GlobalOptions } from '@src/globalOptions.js';

import { hasProjectOwnerState, resolveProjectOwnerStorage } from './projectOwnerStorage.js';
import {
  hookProjectOwnerPath,
  isProjectOwnerEnded,
  readHookThreadLocator,
  readProjectOwner,
  readProjectOwnerAssignment,
} from './projectOwnerStore.js';

/** Host IDs locate an existing private credential. They never create runtime authority. */
export async function resolveAgentSessionOptions<T extends GlobalOptions>(options: T): Promise<T> {
  let ownerFile = options['project-owner'];
  let worker = false;
  const automatic = !ownerFile;
  if (!ownerFile) {
    const environment = getRuntimeParentEnvironment();
    const sessionId = environment.CODEX_SESSION_ID || undefined;
    const threadId = environment.CODEX_THREAD_ID || undefined;
    if (!sessionId && !threadId) return options;
    const storageDirectory = await resolveProjectOwnerStorage(
      getConfigDir(options['config-dir']),
      'codex',
      threadId ?? sessionId!,
      sessionId,
    );
    if (!threadId) {
      if (!(await hasProjectOwnerState(storageDirectory, 'codex', sessionId!, sessionId))) return unintegrated(options);
      throw new Error(
        'Automatic Codex ownership needs CODEX_THREAD_ID or your own bootstrap --project-owner reference',
      );
    }
    const locator = await readHookThreadLocator(storageDirectory, 'codex', threadId);
    if (locator) {
      if (sessionId && sessionId !== locator.identity.sessionId)
        throw new Error('Codex environment and private hook identity disagree');
      ownerFile = locator.ownerFile;
      worker = Boolean(locator.identity.agentId);
    } else {
      if (!(await hasProjectOwnerState(storageDirectory, 'codex', threadId, sessionId))) return unintegrated(options);
      if (!sessionId)
        throw new Error('No private hook thread locator; retain your own bootstrap --project-owner reference');
      worker = threadId !== sessionId;
      ownerFile = hookProjectOwnerPath(storageDirectory, {
        client: 'codex',
        sessionId,
        ...(worker ? { agentId: threadId } : {}),
      });
    }
  }
  try {
    await readProjectOwner(ownerFile);
  } catch (error) {
    throw new Error(
      'Session owner credential unavailable or not private. Run the trusted startup hook or supply your own --project-owner file. Check scoped sandbox permissions for the owner directory.',
      { cause: error },
    );
  }
  if (await isProjectOwnerEnded(ownerFile)) {
    const action = 'action' in options ? options.action : undefined;
    if (action !== 'release' && action !== 'recover')
      throw new Error('Session has ended; use project recover to retry recorded cleanup');
  }
  const resolved = { ...options, 'project-owner': ownerFile };
  if (options['project-set']) return resolved;
  const assignment = await readProjectOwnerAssignment(ownerFile);
  if (options.project) {
    if (assignment?.['project-set'] && !options.project.some(path.isAbsolute)) {
      return { ...resolved, 'project-set': assignment['project-set'] };
    }
    return resolved;
  }
  if (!assignment && !worker && !automatic) return resolved;
  if (!assignment?.project && !assignment?.['project-set']) {
    throw new Error(
      `${worker || assignment?.worker ? 'Worker' : 'Session'} Project Assignment unresolved. Rerun bootstrap for this session or worker with your own --project-owner and an explicit absolute --project or --project-set assignment.`,
    );
  }
  return { ...resolved, project: assignment.project, 'project-set': assignment['project-set'] };
}

function unintegrated<T extends GlobalOptions>(options: T): T {
  process.stderr.write(
    'Ownership coverage gap: no hook-written session record; continuing without session defaults.\n',
  );
  return options;
}
