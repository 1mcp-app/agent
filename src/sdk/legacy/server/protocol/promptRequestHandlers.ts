import { MCP_URI_SEPARATOR } from '@src/constants.js';
import {
  createProtocolCapabilityCatalog,
  getRequestSession,
  resolveCapabilityVisibility,
  resolveOutboundConnection,
} from '@src/core/protocol/requestHandlerUtils.js';
import { InboundConnection } from '@src/core/types/index.js';
import {
  type LegacyOutboundConnections,
  requestLegacyOutbound,
} from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import { getLegacyInboundServer } from '@src/sdk/legacy/server/runtime/legacyInboundConnection.js';
import {
  CompleteRequest,
  CompleteRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequest,
  ListPromptsRequestSchema,
  type Prompt,
} from '@src/sdk/legacy/types.js';
import { withErrorHandling } from '@src/utils/core/errorHandling.js';
import { buildUri, parseUri } from '@src/utils/core/parsing.js';

export function registerPromptHandlers(outboundConns: LegacyOutboundConnections, inboundConn: InboundConnection): void {
  const sessionId = getRequestSession(inboundConn);
  const catalog = createProtocolCapabilityCatalog(outboundConns);

  getLegacyInboundServer(inboundConn).setRequestHandler(
    ListPromptsRequestSchema,
    withErrorHandling(async (request: ListPromptsRequest) => {
      const visibility = resolveCapabilityVisibility(outboundConns, inboundConn, sessionId, 'prompts');
      const result = await catalog.listVisibleCapabilityPages<Prompt>({
        kind: 'prompts',
        visibility,
        cursor: request.params?.cursor,
        list: async (outboundConn, cursor, serverName) => {
          const upstream = await requestLegacyOutbound<{ prompts: Prompt[]; nextCursor?: string }>(
            outboundConn,
            'prompts/list',
            cursor === undefined ? undefined : { cursor },
          );
          return {
            items: (upstream.prompts ?? []).map((prompt) => ({
              ...prompt,
              name: buildUri(serverName, prompt.name, MCP_URI_SEPARATOR),
            })),
            nextCursor: upstream.nextCursor,
          };
        },
        enablePagination: inboundConn.enablePagination ?? false,
      });

      return {
        prompts: result.items,
        nextCursor: result.nextCursor,
        _meta: result._meta,
      };
    }, 'Error listing prompts'),
  );

  getLegacyInboundServer(inboundConn).setRequestHandler(
    GetPromptRequestSchema,
    withErrorHandling(async (request) => {
      const { clientName, resourceName: promptName } = parseUri(request.params.name, MCP_URI_SEPARATOR);
      const outboundConn = resolveOutboundConnection(clientName, sessionId, outboundConns, inboundConn);
      if (!outboundConn) {
        throw new Error(`Unknown client: ${clientName}`);
      }
      return requestLegacyOutbound(outboundConn, 'prompts/get', { ...request.params, name: promptName });
    }, 'Error getting prompt'),
  );
}

export function registerCompletionHandlers(
  outboundConns: LegacyOutboundConnections,
  inboundConn: InboundConnection,
): void {
  const sessionId = getRequestSession(inboundConn);

  getLegacyInboundServer(inboundConn).setRequestHandler(
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
      return requestLegacyOutbound(outboundConn, 'completion/complete', { ...request.params, ref: updatedRef });
    }, 'Error handling completion'),
  );
}
