import {
  ListResourcesRequest,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequest,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  type Resource,
  type ResourceTemplate,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@src/sdk/legacy/types.js';

import { MCP_URI_SEPARATOR } from '@src/constants.js';
import { InboundConnection } from '@src/core/types/index.js';
import { withErrorHandling } from '@src/utils/core/errorHandling.js';
import { getLegacyInboundServer } from '@src/sdk/legacy/server/runtime/legacyInboundConnection.js';
import {
  requestLegacyOutbound,
  type LegacyOutboundConnections,
} from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import { buildUri, parseUri } from '@src/utils/core/parsing.js';

import {
  createProtocolCapabilityCatalog,
  getRequestSession,
  resolveCapabilityVisibility,
  resolveOutboundConnection,
} from '@src/core/protocol/requestHandlerUtils.js';

export function registerResourceHandlers(
  outboundConns: LegacyOutboundConnections,
  inboundConn: InboundConnection,
): void {
  const sessionId = getRequestSession(inboundConn);
  const catalog = createProtocolCapabilityCatalog(outboundConns);

  getLegacyInboundServer(inboundConn).setRequestHandler(
    ListResourcesRequestSchema,
    withErrorHandling(async (request: ListResourcesRequest) => {
      const visibility = resolveCapabilityVisibility(outboundConns, inboundConn, sessionId, 'resources');
      const result = await catalog.listVisibleCapabilityPages<Resource>({
        kind: 'resources',
        visibility,
        cursor: request.params?.cursor,
        list: async (outboundConn, cursor, serverName) => {
          const upstream = await requestLegacyOutbound<{ resources: Resource[]; nextCursor?: string }>(
            outboundConn,
            'resources/list',
            cursor === undefined ? undefined : { cursor },
          );
          return {
            items: (upstream.resources ?? []).map((resource) => ({
              ...resource,
              uri: buildUri(serverName, resource.uri, MCP_URI_SEPARATOR),
            })),
            nextCursor: upstream.nextCursor,
          };
        },
        enablePagination: inboundConn.enablePagination ?? false,
      });

      return {
        resources: result.items,
        nextCursor: result.nextCursor,
        _meta: result._meta,
      };
    }, 'Error listing resources'),
  );

  getLegacyInboundServer(inboundConn).setRequestHandler(
    ListResourceTemplatesRequestSchema,
    withErrorHandling(async (request: ListResourceTemplatesRequest) => {
      const visibility = resolveCapabilityVisibility(outboundConns, inboundConn, sessionId, 'resources');
      const result = await catalog.listVisibleCapabilityPages<ResourceTemplate>({
        kind: 'resourceTemplates',
        visibility,
        cursor: request.params?.cursor,
        list: async (outboundConn, cursor, serverName) => {
          const upstream = await requestLegacyOutbound<{
            resourceTemplates: ResourceTemplate[];
            nextCursor?: string;
          }>(outboundConn, 'resources/templates/list', cursor === undefined ? undefined : { cursor });
          return {
            items: (upstream.resourceTemplates ?? []).map((template) => ({
              ...template,
              uriTemplate: buildUri(serverName, template.uriTemplate, MCP_URI_SEPARATOR),
            })),
            nextCursor: upstream.nextCursor,
          };
        },
        enablePagination: inboundConn.enablePagination ?? false,
      });

      return {
        resourceTemplates: result.items,
        nextCursor: result.nextCursor,
        _meta: result._meta,
      };
    }, 'Error listing resource templates'),
  );

  getLegacyInboundServer(inboundConn).setRequestHandler(
    SubscribeRequestSchema,
    withErrorHandling(async (request) => {
      const { clientName, resourceName } = parseUri(request.params.uri, MCP_URI_SEPARATOR);
      const outboundConn = resolveOutboundConnection(clientName, sessionId, outboundConns, inboundConn);
      if (!outboundConn) {
        throw new Error(`Unknown client: ${clientName}`);
      }
      return requestLegacyOutbound(outboundConn, 'resources/subscribe', { ...request.params, uri: resourceName });
    }, 'Error subscribing to resource'),
  );

  getLegacyInboundServer(inboundConn).setRequestHandler(
    UnsubscribeRequestSchema,
    withErrorHandling(async (request) => {
      const { clientName, resourceName } = parseUri(request.params.uri, MCP_URI_SEPARATOR);
      const outboundConn = resolveOutboundConnection(clientName, sessionId, outboundConns, inboundConn);
      if (!outboundConn) {
        throw new Error(`Unknown client: ${clientName}`);
      }
      return requestLegacyOutbound(outboundConn, 'resources/unsubscribe', { ...request.params, uri: resourceName });
    }, 'Error unsubscribing from resource'),
  );

  getLegacyInboundServer(inboundConn).setRequestHandler(
    ReadResourceRequestSchema,
    withErrorHandling(async (request) => {
      const { clientName, resourceName } = parseUri(request.params.uri, MCP_URI_SEPARATOR);
      const outboundConn = resolveOutboundConnection(clientName, sessionId, outboundConns, inboundConn);
      if (!outboundConn) {
        throw new Error(`Unknown client: ${clientName}`);
      }
      const resource = await requestLegacyOutbound<{ contents: Array<Record<string, unknown>> }>(
        outboundConn,
        'resources/read',
        { ...request.params, uri: resourceName },
      );

      return {
        ...resource,
        contents: resource.contents.map((content) => ({
          ...content,
          uri: buildUri(outboundConn.name, content.uri, MCP_URI_SEPARATOR),
        })),
      };
    }, 'Error reading resource'),
  );
}
