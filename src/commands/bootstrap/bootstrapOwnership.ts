import {
  createHookProjectOwner,
  hookProjectOwnerPath,
  type ProjectOwnerTarget,
  readProjectOwnerTargets,
} from '@src/commands/shared/projectOwnerStore.js';
import { getConfigDir } from '@src/constants.js';
import type { GlobalOptions } from '@src/globalOptions.js';

import { z } from 'zod';

interface OwnershipHookOptions extends GlobalOptions {
  client: 'codex' | 'claude';
  event: 'SessionStart' | 'SubagentStart' | 'SessionEnd';
}

const inputSchema = z.object({
  hook_event_name: z.enum(['SessionStart', 'SubagentStart', 'SessionEnd']),
  session_id: z.string().min(1).max(512),
  agent_id: z.string().min(1).max(512).optional(),
});

function identity(options: OwnershipHookOptions, input: string) {
  const parsed = inputSchema.parse(JSON.parse(input));
  if (parsed.hook_event_name !== options.event) throw new Error('Hook event mismatch');
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
  return createHookProjectOwner(getConfigDir(options['config-dir']), identity(options, input));
}

export async function releaseSessionOwner(
  options: OwnershipHookOptions,
  input: string,
  release: (ownerFile: string, target: ProjectOwnerTarget) => Promise<void>,
): Promise<void> {
  if (options.event !== 'SessionEnd') throw new Error('Only verified SessionEnd may release ownership');
  const file = hookProjectOwnerPath(getConfigDir(options['config-dir']), identity(options, input));
  const targets = await readProjectOwnerTargets(file);
  const results = await Promise.allSettled(targets.map((target) => release(file, target)));
  if (results.some((result) => result.status === 'rejected'))
    throw new Error('Session ownership cleanup is incomplete');
}
