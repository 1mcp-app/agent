import type { InspectCommandOptions } from '@src/commands/inspect/inspect.js';
import { getInspectResult } from '@src/commands/inspect/inspect.js';
import type { InspectServerInfo } from '@src/commands/inspect/inspectUtils.js';
import { ApiClient } from '@src/commands/shared/apiClient.js';
import {
  attachReusableClientSurface,
  type ClientSurfaceAttachmentContext,
  type ClientSurfaceRestResponse,
  formatClientSurfaceAuthRequiredMessage,
} from '@src/commands/shared/clientSurfaceAttachment.js';
import { buildFilterSelectionQuery } from '@src/commands/shared/filterSelectionQuery.js';
import { API_INSTRUCTIONS_ENDPOINT } from '@src/constants/api.js';
import {
  collectInstructionDetails,
  type InstructionsRenderResponse,
  instructionsRenderResponseSchema,
} from '@src/core/instructions/instructionsDistribution.js';
import type { GlobalOptions } from '@src/globalOptions.js';

import { formatInstructionsOutput } from './instructionsUtils.js';

export interface InstructionsCommandOptions extends GlobalOptions {
  url?: string;
  context?: string;
  preset?: string;
  filter?: string;
  tags?: string[];
  'tag-filter'?: string;
}

function toInspectOptions(options: InstructionsCommandOptions, target?: string): InspectCommandOptions {
  return { ...options, target };
}

export async function instructionsCommand(options: InstructionsCommandOptions): Promise<void> {
  const attachment = await attachReusableClientSurface<InstructionsCommandOptions, InstructionsAttachmentValue>({
    clientSurface: 'instructions',
    version: 'instructions',
    options,
    alwaysTryRest: true,
    rest: requestRenderedInstructions,
    mcp: async () => ({ status: 'success', value: { kind: 'legacy_runtime' as const } }),
  });

  if (attachment.status !== 'success') {
    throw new Error(attachment.message);
  }

  if (attachment.value.kind === 'rendered') {
    const output = attachment.value.response.formatting
      ? formatInstructionsOutput(attachment.value.response.formatting)
      : attachment.value.response.rendered;
    if (output.length > 0) {
      process.stdout.write(`${output}\n`);
    }
    return;
  }

  await renderLegacyInstructions(options);
}

type InstructionsAttachmentValue =
  { kind: 'rendered'; response: InstructionsRenderResponse } | { kind: 'legacy_runtime' };

async function requestRenderedInstructions(
  context: ClientSurfaceAttachmentContext<InstructionsCommandOptions>,
): Promise<ClientSurfaceRestResponse<InstructionsAttachmentValue>> {
  const response = await new ApiClient({
    baseUrl: context.baseUrl,
    bearerToken: context.bearerToken,
    sessionId: context.sessionId,
    context: context.context,
    contextProof: context.contextProof,
  }).get<unknown>(API_INSTRUCTIONS_ENDPOINT, buildFilterSelectionQuery(context.options));

  if (response.ok) {
    const parsed = instructionsRenderResponseSchema.safeParse(response.data);
    if (!parsed.success) {
      return { status: 'error', message: 'Runtime returned an invalid instructions response.' };
    }
    return {
      status: 'success',
      sessionId: response.sessionId ?? context.sessionId,
      value: { kind: 'rendered', response: parsed.data },
    };
  }

  if (response.status === 401 || response.status === 403) {
    return { status: 'auth_required', message: formatClientSurfaceAuthRequiredMessage(context) };
  }

  if (response.status === 404 || response.status === 405) {
    // Keep REST capability caching intact because older runtimes may still expose inspect.
    return { status: 'fallback', reason: 'mcp_required' };
  }

  return { status: 'error', message: response.error || `Server returned HTTP ${response.status}` };
}

async function renderLegacyInstructions(options: InstructionsCommandOptions): Promise<void> {
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
