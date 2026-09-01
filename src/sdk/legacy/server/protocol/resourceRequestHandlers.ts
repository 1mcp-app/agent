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
import { InboundConnection, OutboundConnections } from '@src/core/types/index.js';
import { withErrorHandling } from '@src/utils/core/errorHandling.js';
import { buildUri, parseUri } from '@src/utils/core/parsing.js';
import { getRequestTimeout } from '@src/utils/core/timeoutUtils.js';

import {
  createProtocolCapabilityCatalog,
  getRequestSession,
  resolveCapabilityVisibility,
  resolveOutboundConnection,
} from '@src/core/protocol/requestHandlerUtils.js';

export function registerResourceHandlers(outboundConns: OutboundConnections, inboundConn: InboundConnection): void {
  const sessionId = getRequestSession(inboundConn);
  const catalog = createProtocolCapabilityCatalog(outboundConns);

  inboundConn.server.setRequestHandler(
    ListResourcesRequestSchema,
    withErrorHandling(async (request: ListResourcesRequest) => {
      const visibility = resolveCapabilityVisibility(outboundConns, inboundConn, sessionId, 'resources');
      const result = await catalog.listVisibleCapabilityPages<Resource>({
        kind: 'resources',
        visibility,
        cursor: request.params?.cursor,
        list: async (outboundConn, cursor, serverName) => {
          const upstream = await outboundConn.client.listResources(
            { cursor },
            { timeout: getRequestTimeout(outboundConn.transport) },
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

  inboundConn.server.setRequestHandler(
    ListResourceTemplatesRequestSchema,
    withErrorHandling(async (request: ListResourceTemplatesRequest) => {
      const visibility = resolveCapabilityVisibility(outboundConns, inboundConn, sessionId, 'resources');
      const result = await catalog.listVisibleCapabilityPages<ResourceTemplate>({
        kind: 'resourceTemplates',
        visibility,
        cursor: request.params?.cursor,
        list: async (outboundConn, cursor, serverName) => {
          const upstream = await outboundConn.client.listResourceTemplates(
            { cursor },
            { timeout: getRequestTimeout(outboundConn.transport) },
          );
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

  inboundConn.server.setRequestHandler(
    SubscribeRequestSchema,
    withErrorHandling(async (request) => {
      const { clientName, resourceName } = parseUri(request.params.uri, MCP_URI_SEPARATOR);
      const outboundConn = resolveOutboundConnection(clientName, sessionId, outboundConns, inboundConn);
      if (!outboundConn) {
        throw new Error(`Unknown client: ${clientName}`);
      }
      return outboundConn.client.subscribeResource(
        { ...request.params, uri: resourceName },
        {
          timeout: getRequestTimeout(outboundConn.transport),
        },
      );
    }, 'Error subscribing to resource'),
  );

  inboundConn.server.setRequestHandler(
    UnsubscribeRequestSchema,
    withErrorHandling(async (request) => {
      const { clientName, resourceName } = parseUri(request.params.uri, MCP_URI_SEPARATOR);
      const outboundConn = resolveOutboundConnection(clientName, sessionId, outboundConns, inboundConn);
      if (!outboundConn) {
        throw new Error(`Unknown client: ${clientName}`);
      }
      return outboundConn.client.unsubscribeResource(
        { ...request.params, uri: resourceName },
        {
          timeout: getRequestTimeout(outboundConn.transport),
        },
      );
    }, 'Error unsubscribing from resource'),
  );

  inboundConn.server.setRequestHandler(
    ReadResourceRequestSchema,
    withErrorHandling(async (request) => {
      const { clientName, resourceName } = parseUri(request.params.uri, MCP_URI_SEPARATOR);
      const outboundConn = resolveOutboundConnection(clientName, sessionId, outboundConns, inboundConn);
      if (!outboundConn) {
        throw new Error(`Unknown client: ${clientName}`);
      }
      const resource = await outboundConn.client.readResource(
        { ...request.params, uri: resourceName },
        {
          timeout: getRequestTimeout(outboundConn.transport),
        },
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
