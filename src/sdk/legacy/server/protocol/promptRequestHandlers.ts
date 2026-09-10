import { acquireRuntimeCapabilityCatalog } from '@src/core/capabilities/runtimeCapabilityCatalog.js';
import { getRequestSession, resolveCapabilityVisibility } from '@src/core/protocol/requestHandlerUtils.js';
import { InboundConnection } from '@src/core/types/index.js';
import {
  type LegacyOutboundConnections,
  requestLegacyOutbound,
} from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import { getLegacyInboundServer } from '@src/sdk/legacy/server/runtime/legacyInboundConnection.js';
import { CompleteRequestSchema, GetPromptRequestSchema, ListPromptsRequestSchema } from '@src/sdk/legacy/types.js';
import { withErrorHandling } from '@src/utils/core/errorHandling.js';

export function registerPromptHandlers(outboundConns: LegacyOutboundConnections, inboundConn: InboundConnection): void {
  const acquire = (cursor?: string) =>
    acquireRuntimeCapabilityCatalog(
      outboundConns,
      resolveCapabilityVisibility(outboundConns, inboundConn, getRequestSession(inboundConn), 'prompts'),
      {
        continuation: cursor
          ? { kind: 'prompts', cursor, enablePagination: inboundConn.enablePagination ?? false }
          : undefined,
      },
    );
  const server = getLegacyInboundServer(inboundConn);
  server.setRequestHandler(
    ListPromptsRequestSchema,
    withErrorHandling(async (request) => {
      const result = await (
        await acquire(request.params?.cursor)
      ).list('prompts', { cursor: request.params?.cursor, enablePagination: inboundConn.enablePagination ?? false });
      return {
        prompts: result.items,
        ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
        ...(result._meta === undefined ? {} : { _meta: result._meta }),
      };
    }, 'Error listing prompts'),
  );
  server.setRequestHandler(
    GetPromptRequestSchema,
    withErrorHandling(async (request) => {
      const route = (await acquire()).resolve('prompts', request.params.name);
      if (!route?.connection) throw new Error(`Unknown prompt: ${request.params.name}`);
      return requestLegacyOutbound(route.connection, 'prompts/get', {
        ...request.params,
        name: route.entry.route.upstreamIdentity,
      });
    }, 'Error getting prompt'),
  );
}

export function registerCompletionHandlers(
  outboundConns: LegacyOutboundConnections,
  inboundConn: InboundConnection,
): void {
  getLegacyInboundServer(inboundConn).setRequestHandler(
    CompleteRequestSchema,
    withErrorHandling(async (request) => {
      const ref = request.params.ref;
      const prompt = ref.type === 'ref/prompt';
      const snapshot = await acquireRuntimeCapabilityCatalog(
        outboundConns,
        resolveCapabilityVisibility(
          outboundConns,
          inboundConn,
          getRequestSession(inboundConn),
          prompt ? 'prompts' : 'resources',
        ),
      );
      const identity = prompt ? ref.name : ref.uri;
      const route =
        snapshot.resolve(prompt ? 'prompts' : 'resourceTemplates', identity) ??
        (!prompt ? snapshot.resolve('resources', identity) : undefined);
      if (!route?.connection) throw new Error(`Unknown completion reference: ${identity}`);
      return requestLegacyOutbound(route.connection, 'completion/complete', {
        ...request.params,
        ref: prompt
          ? { ...ref, name: route.entry.route.upstreamIdentity }
          : { ...ref, uri: route.entry.route.upstreamIdentity },
      });
    }, 'Error handling completion'),
  );
}
