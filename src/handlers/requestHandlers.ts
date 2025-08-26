import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourceTemplatesRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  SetLevelRequestSchema,
  CallToolResultSchema,
  ListResourcesRequest,
  ListToolsRequest,
  ListPromptsRequest,
  ListResourceTemplatesRequest,
  CreateMessageRequestSchema,
  ListRootsRequestSchema,
  CreateMessageRequest,
  ListRootsRequest,
  ElicitRequestSchema,
  ElicitRequest,
  PingRequestSchema,
  CompleteRequest,
  CompleteRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { setLogLevel } from '../logger/logger.js';
import { MCP_URI_SEPARATOR } from '../constants.js';
import { ClientManager } from '../core/client/clientManager.js';
import { ServerManager } from '../core/server/serverManager.js';
import { parseUri } from '../utils/parsing.js';
import { withErrorHandling } from '../utils/errorHandling.js';
import { filterClients, byCapabilities, byTags, byTagExpression } from '../utils/clientFiltering.js';
import { OutboundConnections, InboundConnection, ClientStatus } from '../core/types/index.js';
import { handlePagination } from '../utils/pagination.js';
import logger from '../logger/logger.js';

/**
 * Get the appropriate tag filter for the inbound connection based on its tag filter mode
 */
function getTagFilter(inboundConn: InboundConnection) {
  if (inboundConn.tagFilterMode === 'advanced' && inboundConn.tagExpression) {
    return byTagExpression(inboundConn.tagExpression);
  } else if (inboundConn.tagFilterMode === 'simple-or' || inboundConn.tags) {
    return getTagFilter(inboundConn);
  } else {
    // No filtering - return function that passes all clients through
    return byTags(undefined);
  }
}

/**
 * Registers server-specific request handlers
 * @param outboundConns Record of client instances
 * @param serverInfo The MCP server instance
 */
function registerServerRequestHandlers(outboundConns: OutboundConnections, inboundConn: InboundConnection): void {
  Array.from(outboundConns.entries()).forEach(([_, outboundConn]) => {
    outboundConn.client.setRequestHandler(
      PingRequestSchema,
      withErrorHandling(async () => {
        return ServerManager.current.executeServerOperation(inboundConn, (inboundConn: InboundConnection) =>
          inboundConn.server.ping(),
        );
      }, 'Error pinging'),
    );

    outboundConn.client.setRequestHandler(
      CreateMessageRequestSchema,
      withErrorHandling(async (request: CreateMessageRequest) => {
        return ServerManager.current.executeServerOperation(inboundConn, (inboundConn: InboundConnection) =>
          inboundConn.server.createMessage(request.params, {
            timeout: outboundConn.transport.timeout,
          }),
        );
      }, 'Error creating message'),
    );

    outboundConn.client.setRequestHandler(
      ElicitRequestSchema,
      withErrorHandling(async (request: ElicitRequest) => {
        return ServerManager.current.executeServerOperation(inboundConn, (inboundConn: InboundConnection) =>
          inboundConn.server.elicitInput(request.params, {
            timeout: outboundConn.transport.timeout,
          }),
        );
      }, 'Error eliciting input'),
    );

    outboundConn.client.setRequestHandler(
      ListRootsRequestSchema,
      withErrorHandling(async (request: ListRootsRequest) => {
        return ServerManager.current.executeServerOperation(inboundConn, (inboundConn: InboundConnection) =>
          inboundConn.server.listRoots(request.params, {
            timeout: outboundConn.transport.timeout,
          }),
        );
      }, 'Error listing roots'),
    );
  });
}

/**
 * Registers all request handlers based on available capabilities
 * @param clients Record of client instances
 * @param server The MCP server instance
 * @param capabilities The server capabilities
 * @param tags Array of tags to filter clients by
 */
export function registerRequestHandlers(outboundConns: OutboundConnections, inboundConn: InboundConnection): void {
  // Register logging level handler
  inboundConn.server.setRequestHandler(SetLevelRequestSchema, async (request) => {
    setLogLevel(request.params.level);
    return {};
  });

  // Register ping handler
  inboundConn.server.setRequestHandler(
    PingRequestSchema,
    withErrorHandling(async () => {
      // Health check all connected upstream clients
      const healthCheckPromises = Array.from(outboundConns.entries()).map(async ([clientName, outboundConn]) => {
        if (outboundConn.status === ClientStatus.Connected && outboundConn.client.transport) {
          try {
            await outboundConn.client.ping();
            logger.info(`Health check successful for client: ${clientName}`);
          } catch (error) {
            logger.warn(`Health check failed for client ${clientName}: ${error}`);
          }
        }
      });

      // Wait for all health checks to complete (but don't fail if some fail)
      await Promise.allSettled(healthCheckPromises);

      // Always return successful pong response
      return {};
    }, 'Error handling ping'),
  );

  // Register resource-related handlers
  registerResourceHandlers(outboundConns, inboundConn);

  // Register tool-related handlers
  registerToolHandlers(outboundConns, inboundConn);

  // Register prompt-related handlers
  registerPromptHandlers(outboundConns, inboundConn);

  // Register completion-related handlers
  registerCompletionHandlers(outboundConns, inboundConn);

  // Register server-specific request handlers
  registerServerRequestHandlers(outboundConns, inboundConn);
}

/**
 * Registers resource-related request handlers
 * @param clients Record of client instances
 * @param serverInfo The MCP server instance
 */
function registerResourceHandlers(outboundConns: OutboundConnections, inboundConn: InboundConnection): void {
  // List Resources handler
  inboundConn.server.setRequestHandler(
    ListResourcesRequestSchema,
    withErrorHandling(async (request: ListResourcesRequest) => {
      const filteredClients = filterClients(
        byCapabilities({ resources: {} }),
        getTagFilter(inboundConn),
      )(outboundConns);

      const result = await handlePagination(
        filteredClients,
        request.params || {},
        (client, params, opts) => client.listResources(params as ListResourcesRequest['params'], opts),
        (outboundConn, result) =>
          result.resources?.map((resource) => ({
            uri: `${outboundConn.name}${MCP_URI_SEPARATOR}${resource.uri}`,
            name: resource.name,
            description: resource.description,
            mimeType: resource.mimeType,
          })) ?? [],
        inboundConn.enablePagination ?? false,
      );

      return {
        resources: result.items,
        nextCursor: result.nextCursor,
      };
    }, 'Error listing resources'),
  );

  // List Resource Templates handler
  inboundConn.server.setRequestHandler(
    ListResourceTemplatesRequestSchema,
    withErrorHandling(async (request: ListResourceTemplatesRequest) => {
      const filteredClients = filterClients(
        byCapabilities({ resources: {} }),
        getTagFilter(inboundConn),
      )(outboundConns);

      const result = await handlePagination(
        filteredClients,
        request.params || {},
        (client, params, opts) => client.listResourceTemplates(params as ListResourceTemplatesRequest['params'], opts),
        (outboundConn, result) =>
          result.resourceTemplates?.map((template) => ({
            uriTemplate: `${outboundConn.name}${MCP_URI_SEPARATOR}${template.uriTemplate}`,
            name: template.name,
            description: template.description,
            mimeType: template.mimeType,
          })) ?? [],
        inboundConn.enablePagination ?? false,
      );

      return {
        resourceTemplates: result.items,
        nextCursor: result.nextCursor,
      };
    }, 'Error listing resource templates'),
  );

  // Subscribe Resource handler
  inboundConn.server.setRequestHandler(
    SubscribeRequestSchema,
    withErrorHandling(async (request) => {
      const { clientName, resourceName } = parseUri(request.params.uri, MCP_URI_SEPARATOR);
      return ClientManager.current.executeClientOperation(clientName, (outboundConn) =>
        outboundConn.client.subscribeResource(
          { ...request.params, uri: resourceName },
          {
            timeout: outboundConn.transport.timeout,
          },
        ),
      );
    }, 'Error subscribing to resource'),
  );

  // Unsubscribe Resource handler
  inboundConn.server.setRequestHandler(
    UnsubscribeRequestSchema,
    withErrorHandling(async (request) => {
      const { clientName, resourceName } = parseUri(request.params.uri, MCP_URI_SEPARATOR);
      return ClientManager.current.executeClientOperation(clientName, (outboundConn) =>
        outboundConn.client.unsubscribeResource(
          { ...request.params, uri: resourceName },
          {
            timeout: outboundConn.transport.timeout,
          },
        ),
      );
    }, 'Error unsubscribing from resource'),
  );

  // Read Resource handler
  inboundConn.server.setRequestHandler(
    ReadResourceRequestSchema,
    withErrorHandling(async (request) => {
      const { clientName, resourceName } = parseUri(request.params.uri, MCP_URI_SEPARATOR);
      return ClientManager.current.executeClientOperation(clientName, (outboundConn) =>
        outboundConn.client.readResource(
          { ...request.params, uri: resourceName },
          {
            timeout: outboundConn.transport.timeout,
          },
        ),
      );
    }, 'Error reading resource'),
  );
}

/**
 * Registers tool-related request handlers
 * @param clients Record of client instances
 * @param serverInfo The MCP server instance
 */
function registerToolHandlers(outboundConns: OutboundConnections, inboundConn: InboundConnection): void {
  // List Tools handler
  inboundConn.server.setRequestHandler(
    ListToolsRequestSchema,
    withErrorHandling(async (request: ListToolsRequest) => {
      const filteredClients = filterClients(byCapabilities({ tools: {} }), getTagFilter(inboundConn))(outboundConns);

      const result = await handlePagination(
        filteredClients,
        request.params || {},
        (client, params, opts) => client.listTools(params as ListToolsRequest['params'], opts),
        (outboundConn, result) =>
          result.tools?.map((tool) => ({
            name: `${outboundConn.name}${MCP_URI_SEPARATOR}${tool.name}`,
            description: tool.description,
            inputSchema: tool.inputSchema,
            outputSchema: tool.outputSchema,
            annotations: tool.annotations,
          })) ?? [],
        inboundConn.enablePagination ?? false,
      );

      return {
        tools: result.items,
        nextCursor: result.nextCursor,
      };
    }, 'Error listing tools'),
  );

  // Call Tool handler
  inboundConn.server.setRequestHandler(
    CallToolRequestSchema,
    withErrorHandling(async (request) => {
      const { clientName, resourceName: toolName } = parseUri(request.params.name, MCP_URI_SEPARATOR);
      return ClientManager.current.executeClientOperation(clientName, (outboundConn) =>
        outboundConn.client.callTool({ ...request.params, name: toolName }, CallToolResultSchema, {
          timeout: outboundConn.transport.timeout,
        }),
      );
    }, 'Error calling tool'),
  );
}

/**
 * Registers prompt-related request handlers
 * @param clients Record of client instances
 * @param serverInfo The MCP server instance
 */
function registerPromptHandlers(outboundConns: OutboundConnections, inboundConn: InboundConnection): void {
  // List Prompts handler
  inboundConn.server.setRequestHandler(
    ListPromptsRequestSchema,
    withErrorHandling(async (request: ListPromptsRequest) => {
      const filteredClients = filterClients(byCapabilities({ prompts: {} }), getTagFilter(inboundConn))(outboundConns);

      const result = await handlePagination(
        filteredClients,
        request.params || {},
        (client, params, opts) => client.listPrompts(params as ListPromptsRequest['params'], opts),
        (outboundConn, result) =>
          result.prompts?.map((prompt) => ({
            name: `${outboundConn.name}${MCP_URI_SEPARATOR}${prompt.name}`,
            description: prompt.description,
            arguments: prompt.arguments,
          })) ?? [],
        inboundConn.enablePagination ?? false,
      );

      return {
        prompts: result.items,
        nextCursor: result.nextCursor,
      };
    }, 'Error listing prompts'),
  );

  // Get Prompt handler
  inboundConn.server.setRequestHandler(
    GetPromptRequestSchema,
    withErrorHandling(async (request) => {
      const { clientName, resourceName: promptName } = parseUri(request.params.name, MCP_URI_SEPARATOR);
      return ClientManager.current.executeClientOperation(clientName, (outboundConn) =>
        outboundConn.client.getPrompt({ ...request.params, name: promptName }),
      );
    }, 'Error getting prompt'),
  );
}

/**
 * Registers completion-related request handlers
 * @param clients Record of client instances
 * @param serverInfo The MCP server instance
 */
function registerCompletionHandlers(outboundConns: OutboundConnections, inboundConn: InboundConnection): void {
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
        // This should be caught by the schema validation, but as a safeguard:
        throw new Error(`Unsupported completion reference type: ${(ref as any).type}`);
      }

      const params = { ...request.params, ref: updatedRef };

      return ClientManager.current.executeClientOperation(
        clientName,
        (outboundConn) =>
          outboundConn.client.complete(params, {
            timeout: outboundConn.transport.timeout,
          }),
        {},
        'completions',
      );
    }, 'Error handling completion'),
  );
}
