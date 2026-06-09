import {
  CompleteRequest,
  CompleteRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequest,
  ListPromptsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { MCP_URI_SEPARATOR } from '@src/constants.js';
import { byCapabilities } from '@src/core/filtering/clientFiltering.js';
import { FilteringService } from '@src/core/filtering/filteringService.js';
import { InboundConnection, OutboundConnections } from '@src/core/types/index.js';
import { withErrorHandling } from '@src/utils/core/errorHandling.js';
import { buildUri, parseUri } from '@src/utils/core/parsing.js';
import { getRequestTimeout } from '@src/utils/core/timeoutUtils.js';
import { handlePagination } from '@src/utils/ui/pagination.js';

import { filterConnectionsForSession, getRequestSession, resolveOutboundConnection } from './requestHandlerUtils.js';

export function registerPromptHandlers(outboundConns: OutboundConnections, inboundConn: InboundConnection): void {
  const sessionId = getRequestSession(inboundConn);

  inboundConn.server.setRequestHandler(
    ListPromptsRequestSchema,
    withErrorHandling(async (request: ListPromptsRequest) => {
      const sessionFilteredConns = filterConnectionsForSession(outboundConns, sessionId);
      const capabilityFilteredClients = byCapabilities({ prompts: {} })(sessionFilteredConns);
      const filteredClients = FilteringService.getFilteredConnections(capabilityFilteredClients, inboundConn);

      const result = await handlePagination(
        filteredClients,
        request.params || {},
        (client, params, opts) => client.listPrompts(params as ListPromptsRequest['params'], opts),
        (outboundConn, result) =>
          result.prompts?.map((prompt) => ({
            ...prompt,
            name: buildUri(outboundConn.name, prompt.name, MCP_URI_SEPARATOR),
          })) ?? [],
        inboundConn.enablePagination ?? false,
      );

      return {
        prompts: result.items,
        nextCursor: result.nextCursor,
      };
    }, 'Error listing prompts'),
  );

  inboundConn.server.setRequestHandler(
    GetPromptRequestSchema,
    withErrorHandling(async (request) => {
      const { clientName, resourceName: promptName } = parseUri(request.params.name, MCP_URI_SEPARATOR);
      const outboundConn = resolveOutboundConnection(clientName, sessionId, outboundConns, inboundConn);
      if (!outboundConn) {
        throw new Error(`Unknown client: ${clientName}`);
      }
      return outboundConn.client.getPrompt(
        { ...request.params, name: promptName },
        {
          timeout: getRequestTimeout(outboundConn.transport),
        },
      );
    }, 'Error getting prompt'),
  );
}

export function registerCompletionHandlers(outboundConns: OutboundConnections, inboundConn: InboundConnection): void {
  const sessionId = getRequestSession(inboundConn);

  inboundConn.server.setRequestHandler(
    CompleteRequestSchema,
    withErrorHandling(async (request: CompleteRequest) => {
      const { ref } = request.params;
      let clientName: string;
      let updatedRef: typeof ref;

      if (ref.type === 'ref/prompt') {
        const { clientName: cn, resourceName } = parseUri(ref.name, MCP_URI_SEPARATOR);
        clientName = cn;
        updatedRef = { ...ref, name: resourceName };
      } else if (ref.type === 'ref/resource') {
        const { clientName: cn, resourceName } = parseUri(ref.uri, MCP_URI_SEPARATOR);
        clientName = cn;
        updatedRef = { ...ref, uri: resourceName };
      } else {
        throw new Error(`Unsupported completion reference type: ${(ref as { type: string }).type}`);
      }

      const outboundConn = resolveOutboundConnection(clientName, sessionId, outboundConns, inboundConn);
      if (!outboundConn) {
        throw new Error(`Unknown client: ${clientName}`);
      }
      return outboundConn.client.complete(
        { ...request.params, ref: updatedRef },
        {
          timeout: getRequestTimeout(outboundConn.transport),
        },
      );
    }, 'Error handling completion'),
  );
}
