import {
  ListResourcesRequest,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequest,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
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

export function registerResourceHandlers(outboundConns: OutboundConnections, inboundConn: InboundConnection): void {
  const sessionId = getRequestSession(inboundConn);

  inboundConn.server.setRequestHandler(
    ListResourcesRequestSchema,
    withErrorHandling(async (request: ListResourcesRequest) => {
      const sessionFilteredConns = filterConnectionsForSession(outboundConns, sessionId);
      const capabilityFilteredClients = byCapabilities({ resources: {} })(sessionFilteredConns);
      const filteredClients = FilteringService.getFilteredConnections(capabilityFilteredClients, inboundConn);

      const result = await handlePagination(
        filteredClients,
        request.params || {},
        (client, params, opts) => client.listResources(params as ListResourcesRequest['params'], opts),
        (outboundConn, result) =>
          result.resources?.map((resource) => ({
            ...resource,
            uri: buildUri(outboundConn.name, resource.uri, MCP_URI_SEPARATOR),
          })) ?? [],
        inboundConn.enablePagination ?? false,
      );

      return {
        resources: result.items,
        nextCursor: result.nextCursor,
      };
    }, 'Error listing resources'),
  );

  inboundConn.server.setRequestHandler(
    ListResourceTemplatesRequestSchema,
    withErrorHandling(async (request: ListResourceTemplatesRequest) => {
      const sessionFilteredConns = filterConnectionsForSession(outboundConns, sessionId);
      const capabilityFilteredClients = byCapabilities({ resources: {} })(sessionFilteredConns);
      const filteredClients = FilteringService.getFilteredConnections(capabilityFilteredClients, inboundConn);

      const result = await handlePagination(
        filteredClients,
        request.params || {},
        (client, params, opts) => client.listResourceTemplates(params as ListResourceTemplatesRequest['params'], opts),
        (outboundConn, result) =>
          result.resourceTemplates?.map((template) => ({
            ...template,
            uriTemplate: buildUri(outboundConn.name, template.uriTemplate, MCP_URI_SEPARATOR),
          })) ?? [],
        inboundConn.enablePagination ?? false,
      );

      return {
        resourceTemplates: result.items,
        nextCursor: result.nextCursor,
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
