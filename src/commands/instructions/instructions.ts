import type { InspectCommandOptions } from '@src/commands/inspect/inspect.js';
import { getInspectResult } from '@src/commands/inspect/inspect.js';
import type { InspectServerInfo } from '@src/commands/inspect/inspectUtils.js';
import type { GlobalOptions } from '@src/globalOptions.js';

import { formatInstructionsOutput, type InstructionsServerDetail } from './instructionsUtils.js';
import { formatStartupDocsOutput, resolveStartupDocTargets, writeStartupDocs } from './startupDocs.js';

export interface InstructionsCommandOptions extends GlobalOptions {
  url?: string;
  preset?: string;
  filter?: string;
  tags?: string[];
  'tag-filter'?: string;
  'write-startup-docs'?: boolean;
  'repo-root'?: string;
  targets?: string;
}

function toInspectOptions(options: InstructionsCommandOptions, target?: string): InspectCommandOptions {
  return { ...options, target };
}

export async function instructionsCommand(options: InstructionsCommandOptions): Promise<void> {
  if (options['write-startup-docs']) {
    const targets = resolveStartupDocTargets(options.targets);
    const results = await writeStartupDocs({
      repoRoot: options['repo-root'] ?? process.cwd(),
      targets,
    });
    process.stdout.write(`${formatStartupDocsOutput(results)}\n`);
    return;
  }

  const allServers = await getInspectResult(toInspectOptions(options), { includeServerInstructions: true });
  if (allServers.kind !== 'servers') {
    throw new Error('Unexpected inspect result for server listing.');
  }

  const details: InstructionsServerDetail[] = [];
  for (const server of allServers.servers) {
    if (server.available === false || server.status === 'disconnected') {
      details.push({
        server: server.server,
        type: server.type,
        status: server.status,
        available: server.available,
        toolCount: server.toolCount,
        hasInstructions: server.hasInstructions,
        instructions: null,
        note: '(unavailable: server is not currently connected)',
      });
      continue;
    }

    const detailResult = await getInspectResult(toInspectOptions(options, server.server), {
      includeServerInstructions: true,
    });

    if (detailResult.kind !== 'server') {
      details.push({
        server: server.server,
        type: server.type,
        status: server.status,
        available: server.available,
        toolCount: server.toolCount,
        hasInstructions: server.hasInstructions,
        instructions: null,
        note: '(unavailable)',
      });
      continue;
    }

    const serverDetail = detailResult as InspectServerInfo;
    details.push({
      server: serverDetail.server,
      type: serverDetail.type,
      status: serverDetail.status,
      available: serverDetail.available,
      toolCount: serverDetail.totalTools ?? serverDetail.tools.length,
      hasInstructions: Boolean(serverDetail.instructions?.trim()),
      instructions: serverDetail.instructions,
      note: serverDetail.instructions ? undefined : '(none provided)',
    });
  }

  const output = formatInstructionsOutput({
    servers: allServers.servers,
    details,
  });

  if (output.length > 0) {
    process.stdout.write(`${output}\n`);
  }
}
