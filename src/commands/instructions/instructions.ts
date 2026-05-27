import type { InspectCommandOptions } from '@src/commands/inspect/inspect.js';
import { getInspectResult } from '@src/commands/inspect/inspect.js';
import type { InspectServerInfo } from '@src/commands/inspect/inspectUtils.js';
import { collectInstructionDetails } from '@src/core/instructions/instructionsDistribution.js';
import type { GlobalOptions } from '@src/globalOptions.js';

import { formatInstructionsOutput } from './instructionsUtils.js';

export interface InstructionsCommandOptions extends GlobalOptions {
  url?: string;
  preset?: string;
  filter?: string;
  tags?: string[];
  'tag-filter'?: string;
}

function toInspectOptions(options: InstructionsCommandOptions, target?: string): InspectCommandOptions {
  return { ...options, target };
}

export async function instructionsCommand(options: InstructionsCommandOptions): Promise<void> {
  const allServers = await getInspectResult(toInspectOptions(options), instructionsInspectOptions);
  if (allServers.kind !== 'servers') {
    throw new Error('Unexpected inspect result for server listing.');
  }

  const details = await collectInstructionDetails({
    servers: allServers.servers,
    cachedInstructions: allServers.serverInstructions,
    inspectServer: async (server) => {
      const detailResult = await getInspectResult(toInspectOptions(options, server), instructionsInspectOptions);

      return detailResult.kind === 'server' ? (detailResult as InspectServerInfo) : { kind: detailResult.kind };
    },
  });

  const output = formatInstructionsOutput({
    servers: allServers.servers,
    details,
  });

  if (output.length > 0) {
    process.stdout.write(`${output}\n`);
  }
}

const instructionsInspectOptions = { includeServerInstructions: true, clientSurface: 'instructions' as const };
