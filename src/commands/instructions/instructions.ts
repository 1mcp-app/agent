import type { InspectCommandOptions } from '@src/commands/inspect/inspect.js';
import { getInspectResult } from '@src/commands/inspect/inspect.js';
import type { InspectServerInfo, InspectServerSummary } from '@src/commands/inspect/inspectUtils.js';
import {
  assembleInstructionDetail,
  shouldEagerlyInspectServer,
} from '@src/core/instructions/instructionsDistribution.js';
import type { GlobalOptions } from '@src/globalOptions.js';

import { formatInstructionsOutput, type InstructionsServerDetail } from './instructionsUtils.js';

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
  const allServers = await getInspectResult(toInspectOptions(options), { includeServerInstructions: true });
  if (allServers.kind !== 'servers') {
    throw new Error('Unexpected inspect result for server listing.');
  }

  const serverInstructions = allServers.serverInstructions ?? {};
  const details: InstructionsServerDetail[] = [];
  for (const server of allServers.servers) {
    if (!shouldEagerlyInspectServer(server)) {
      details.push(
        assembleInstructionDetail({ summary: server, cachedInstructions: serverInstructions[server.server] }),
      );
      continue;
    }

    try {
      const detailResult = await getInspectResult(toInspectOptions(options, server.server), {
        includeServerInstructions: true,
      });

      if (detailResult.kind !== 'server') {
        details.push(assembleUnavailableDetail(server));
        continue;
      }

      const serverDetail = detailResult as InspectServerInfo;
      details.push(assembleInstructionDetail({ summary: server, inspected: serverDetail }));
    } catch {
      details.push(assembleInstructionDetail({ summary: server, inspectFailed: true }));
    }
  }

  const output = formatInstructionsOutput({
    servers: allServers.servers,
    details,
  });

  if (output.length > 0) {
    process.stdout.write(`${output}\n`);
  }
}

function assembleUnavailableDetail(server: InspectServerSummary): InstructionsServerDetail {
  return {
    server: server.server,
    type: server.type,
    status: server.status,
    available: server.available,
    toolCount: server.toolCount,
    hasInstructions: server.hasInstructions,
    instructions: null,
    note: '(unavailable)',
  };
}
