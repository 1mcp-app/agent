import { acquireRuntimeCapabilityCatalog } from '@src/core/capabilities/runtimeCapabilityCatalog.js';
import { getRequestSession, resolveCapabilityVisibility } from '@src/core/protocol/requestHandlerUtils.js';
import { InboundConnection } from '@src/core/types/index.js';
import {
  type LegacyOutboundConnections,
  requestLegacyOutbound,
} from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import { getLegacyInboundServer } from '@src/sdk/legacy/server/runtime/legacyInboundConnection.js';
import { projectResourceUri, resolveResourceRoute } from '@src/sdk/legacy/shared/resourceTemplateRouting.js';
import {
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@src/sdk/legacy/types.js';
import { withErrorHandling } from '@src/utils/core/errorHandling.js';

export function registerResourceHandlers(
  outboundConns: LegacyOutboundConnections,
  inboundConn: InboundConnection,
): void {
  const acquire = (cursor?: string, kind: 'resources' | 'resourceTemplates' = 'resources') =>
    acquireRuntimeCapabilityCatalog(
      outboundConns,
      resolveCapabilityVisibility(outboundConns, inboundConn, getRequestSession(inboundConn), 'resources'),
      { continuation: cursor ? { kind, cursor, enablePagination: inboundConn.enablePagination ?? false } : undefined },
    );
  const server = getLegacyInboundServer(inboundConn);
  server.setRequestHandler(
    ListResourcesRequestSchema,
    withErrorHandling(async (request) => {
      const snapshot = await acquire(request.params?.cursor);
      const result = await snapshot.list('resources', {
        cursor: request.params?.cursor,
        enablePagination: inboundConn.enablePagination ?? false,
      });
      return {
        resources: result.items,
        ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
        ...(result._meta === undefined ? {} : { _meta: result._meta }),
      };
    }, 'Error listing resources'),
  );
  server.setRequestHandler(
    ListResourceTemplatesRequestSchema,
    withErrorHandling(async (request) => {
      const snapshot = await acquire(request.params?.cursor, 'resourceTemplates');
      const result = await snapshot.list('resourceTemplates', {
        cursor: request.params?.cursor,
        enablePagination: inboundConn.enablePagination ?? false,
      });
      return {
        resourceTemplates: result.items,
        ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
        ...(result._meta === undefined ? {} : { _meta: result._meta }),
      };
    }, 'Error listing resource templates'),
  );
  server.setRequestHandler(
    SubscribeRequestSchema,
    withErrorHandling(async (request) => {
      const route = resolveResourceRoute(await acquire(), request.params.uri);
      return requestLegacyOutbound(route.connection, 'resources/subscribe', {
        ...request.params,
        uri: route.upstreamIdentity,
      });
    }, 'Error subscribing to resource'),
  );
  server.setRequestHandler(
    UnsubscribeRequestSchema,
    withErrorHandling(async (request) => {
      const route = resolveResourceRoute(await acquire(), request.params.uri);
      return requestLegacyOutbound(route.connection, 'resources/unsubscribe', {
        ...request.params,
        uri: route.upstreamIdentity,
      });
    }, 'Error unsubscribing from resource'),
  );
  server.setRequestHandler(
    ReadResourceRequestSchema,
    withErrorHandling(async (request) => {
      const snapshot = await acquire();
      const route = resolveResourceRoute(snapshot, request.params.uri);
      const result = await requestLegacyOutbound<{ contents: Array<{ uri: string; [key: string]: unknown }> }>(
        route.connection,
        'resources/read',
        { ...request.params, uri: route.upstreamIdentity },
      );
      return {
        ...result,
        contents: result.contents.map((content) => ({
          ...content,
          uri: projectResourceUri(snapshot, route.entry.route.connectionKey, content.uri, route.entry),
        })),
      };
    }, 'Error reading resource'),
  );
}
