import {
  CallToolRequestSchema,
  CallToolResultSchema,
  CompleteRequest,
  CompleteRequestSchema,
  CreateMessageRequest,
  CreateMessageRequestSchema,
  ElicitRequest,
  ElicitRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequest,
  ListPromptsRequestSchema,
  ListResourcesRequest,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequest,
  ListResourceTemplatesRequestSchema,
  ListRootsRequest,
  ListRootsRequestSchema,
  ListToolsRequest,
  ListToolsRequestSchema,
  PingRequestSchema,
  ReadResourceRequestSchema,
  SetLevelRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { MCP_URI_SEPARATOR } from '@src/constants.js';
import { InternalCapabilitiesProvider } from '@src/core/capabilities/internalCapabilitiesProvider.js';
import { LazyLoadingOrchestrator } from '@src/core/capabilities/lazyLoadingOrchestrator.js';
import { byCapabilities } from '@src/core/filtering/clientFiltering.js';
import { FilteringService } from '@src/core/filtering/filteringService.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { ClientStatus, InboundConnection, OutboundConnection, OutboundConnections } from '@src/core/types/index.js';
import { setLogLevel } from '@src/logger/logger.js';
import logger from '@src/logger/logger.js';
import { withErrorHandling } from '@src/utils/core/errorHandling.js';
import { buildUri, parseUri } from '@src/utils/core/parsing.js';
import { getRequestTimeout } from '@src/utils/core/timeoutUtils.js';
import { handlePagination } from '@src/utils/ui/pagination.js';

/**
 * Extract session ID from inbound connection context
 * @param inboundConn The inbound connection
 * @returns The session ID or undefined
 */
function getRequestSession(inboundConn: InboundConnection): string | undefined {
  return inboundConn.context?.sessionId;
}

/**
 * Resolve outbound connection by client name and session ID.
 * Key format:
 * - Static servers: name (no colon)
 * - Shareable template servers: name:renderedHash
 * - Per-client template servers: name:sessionId
 *
 * Resolution order:
 * 1. Try session-scoped key (for per-client template servers: name:sessionId)
 * 2. Try rendered hash-based key (for shareable template servers: name:renderedHash)
 * 3. Fall back to direct name lookup (for static servers: name)
 *
 * @param clientName The client/server name
 * @param sessionId The session ID (optional)
 * @param outboundConns The outbound connections map
 * @returns The resolved outbound connection or undefined
 */
function resolveOutboundConnection(
  clientName: string,
  sessionId: string | undefined,
  outboundConns: OutboundConnections,
): OutboundConnection | undefined {
  // Try session-scoped key first (for per-client template servers: name:sessionId)
  if (sessionId) {
    const sessionKey = `${clientName}:${sessionId}`;
    const conn = outboundConns.get(sessionKey);
    if (conn) {
      return conn;
    }
  }

  // Try rendered hash-based key (for shareable template servers: name:renderedHash)
  if (sessionId) {
    // Access the session-to-renderedHash mapping from TemplateServerManager
    const templateServerManager = ServerManager.current.getTemplateServerManager();
    if (templateServerManager) {
      const renderedHash = templateServerManager.getRenderedHashForSession(sessionId, clientName);
      if (renderedHash) {
        const hashKey = `${clientName}:${renderedHash}`;
        const conn = outboundConns.get(hashKey);
        if (conn) {
          return conn;
        }
      }
    }
  }

  // Fall back to direct name lookup (for static servers)
  return outboundConns.get(clientName);
}

/**
 * Filter outbound connections for a specific session.
 * Key format:
 * - Static servers: name (no colon) - always included
 * - Shareable template servers: name:renderedHash - included if session uses this hash
 * - Per-client template servers: name:sessionId - only included if session matches
 *
 * @param outboundConns The outbound connections map
 * @param sessionId The session ID (optional)
 * @returns A filtered map of outbound connections
 */
function filterConnectionsForSession(
  outboundConns: OutboundConnections,
  sessionId: string | undefined,
): OutboundConnections {
  const filtered = new Map<string, OutboundConnection>();

  // Get rendered hashes for this session
  const sessionHashes = getSessionRenderedHashes(sessionId);

  for (const [key, conn] of outboundConns.entries()) {
    // Static servers (no : in key) - always include
    if (!key.includes(':')) {
      filtered.set(key, conn);
      continue;
    }

    // Template servers (format: name:xxx)
    const [name, suffix] = key.split(':');

    // Per-client template servers (format: name:sessionId) - only include if session matches
    if (suffix === sessionId) {
      filtered.set(key, conn);
      continue;
    }

    // Shareable template servers (format: name:renderedHash) - include if this session uses this hash
    if (sessionHashes && sessionHashes.has(name) && sessionHashes.get(name) === suffix) {
      filtered.set(key, conn);
    }
  }

  return filtered;
}

/**
 * Get all rendered hashes for a specific session.
 * Used by filterConnectionsForSession to determine which shareable connections to include.
 * @param sessionId The session ID (optional)
 * @returns Map of templateName to renderedHash, or undefined if no session
 */
function getSessionRenderedHashes(sessionId: string | undefined): Map<string, string> | undefined {
  if (!sessionId) return undefined;

  const templateServerManager = ServerManager.current.getTemplateServerManager();
  if (templateServerManager) {
    return templateServerManager.getAllRenderedHashesForSession(sessionId);
  }
  return undefined;
}

/**
 * Type for extended server capabilities that include experimental features
 */
type ExtendedServerCapabilities = Record<string, unknown>;

/**
 * Registers server-specific request handlers
 * @param outboundConns Record of client instances
 * @param serverInfo The MCP server instance
 */
function registerServerRequestHandlers(outboundConns: OutboundConnections, inboundConn: InboundConnection): void {
  Array.from(outboundConns.entries()).forEach(([_, outboundConn]) => {
    const capabilities = outboundConn.capabilities as ExtendedServerCapabilities | undefined;

    // Ping is always supported
    outboundConn.client.setRequestHandler(
      PingRequestSchema,
      withErrorHandling(async () => {
        return ServerManager.current.executeServerOperation(inboundConn, (inboundConn: InboundConnection) =>
          inboundConn.server.ping(),
        );
      }, 'Error pinging'),
    );

    // Only register CreateMessage handler if server supports sampling capability
    if (capabilities?.sampling) {
      outboundConn.client.setRequestHandler(
        CreateMessageRequestSchema,
        withErrorHandling(async (request: CreateMessageRequest) => {
          return ServerManager.current.executeServerOperation(inboundConn, (inboundConn: InboundConnection) =>
            inboundConn.server.createMessage(request.params, {
              timeout: getRequestTimeout(outboundConn.transport),
            }),
          );
        }, 'Error creating message'),
      );
    }

    // Only register ElicitRequest handler if server supports elicitation capability
    if (capabilities?.elicitation) {
      outboundConn.client.setRequestHandler(
        ElicitRequestSchema,
        withErrorHandling(async (request: ElicitRequest) => {
          return ServerManager.current.executeServerOperation(inboundConn, (inboundConn: InboundConnection) =>
            inboundConn.server.elicitInput(request.params, {
              timeout: getRequestTimeout(outboundConn.transport),
            }),
          );
        }, 'Error eliciting input'),
      );
    }

    // Only register ListRoots handler if server supports roots capability
    if (capabilities?.roots) {
      outboundConn.client.setRequestHandler(
        ListRootsRequestSchema,
        withErrorHandling(async (request: ListRootsRequest) => {
          return ServerManager.current.executeServerOperation(inboundConn, (inboundConn: InboundConnection) =>
            inboundConn.server.listRoots(request.params, {
              timeout: getRequestTimeout(outboundConn.transport),
            }),
          );
        }, 'Error listing roots'),
      );
    }
  });
}

/**
 * Registers all request handlers based on available capabilities
 * @param clients Record of client instances
 * @param server The MCP server instance
 * @param capabilities The server capabilities
 * @param tags Array of tags to filter clients by
 */

export function registerRequestHandlers(
  outboundConns: OutboundConnections,
  inboundConn: InboundConnection,
  lazyLoadingOrchestrator?: LazyLoadingOrchestrator,
): void {
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
  registerToolHandlers(outboundConns, inboundConn, lazyLoadingOrchestrator);

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
  const sessionId = getRequestSession(inboundConn);

  // List Resources handler
  inboundConn.server.setRequestHandler(
    ListResourcesRequestSchema,
    withErrorHandling(async (request: ListResourcesRequest) => {
      // Filter connections for this session first
      const sessionFilteredConns = filterConnectionsForSession(outboundConns, sessionId);
      // Then filter by capabilities, then by tags
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

  // List Resource Templates handler
  inboundConn.server.setRequestHandler(
    ListResourceTemplatesRequestSchema,
    withErrorHandling(async (request: ListResourceTemplatesRequest) => {
      // Filter connections for this session first
      const sessionFilteredConns = filterConnectionsForSession(outboundConns, sessionId);
      // Then filter by capabilities, then by tags
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

  // Subscribe Resource handler
  inboundConn.server.setRequestHandler(
    SubscribeRequestSchema,
    withErrorHandling(async (request) => {
      const { clientName, resourceName } = parseUri(request.params.uri, MCP_URI_SEPARATOR);
      const outboundConn = resolveOutboundConnection(clientName, sessionId, outboundConns);
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

  // Unsubscribe Resource handler
  inboundConn.server.setRequestHandler(
    UnsubscribeRequestSchema,
    withErrorHandling(async (request) => {
      const { clientName, resourceName } = parseUri(request.params.uri, MCP_URI_SEPARATOR);
      const outboundConn = resolveOutboundConnection(clientName, sessionId, outboundConns);
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

  // Read Resource handler
  inboundConn.server.setRequestHandler(
    ReadResourceRequestSchema,
    withErrorHandling(async (request) => {
      const { clientName, resourceName } = parseUri(request.params.uri, MCP_URI_SEPARATOR);
      const outboundConn = resolveOutboundConnection(clientName, sessionId, outboundConns);
      if (!outboundConn) {
        throw new Error(`Unknown client: ${clientName}`);
      }
      const resource = await outboundConn.client.readResource(
        { ...request.params, uri: resourceName },
        {
          timeout: getRequestTimeout(outboundConn.transport),
        },
      );

      // Transform resource content URIs to include client name prefix
      const transformedResource = {
        ...resource,
        contents: resource.contents.map((content) => ({
          ...content,
          uri: buildUri(outboundConn.name, content.uri, MCP_URI_SEPARATOR),
        })),
      };

      return transformedResource;
    }, 'Error reading resource'),
  );
}

/**
 * Registers tool-related request handlers
 * @param clients Record of client instances
 * @param serverInfo The MCP server instance
 */
function registerToolHandlers(
  outboundConns: OutboundConnections,
  inboundConn: InboundConnection,
  lazyLoadingOrchestrator?: LazyLoadingOrchestrator,
): void {
  const sessionId = getRequestSession(inboundConn);
  const lazyLoadingEnabled = lazyLoadingOrchestrator?.isEnabled();

  // List Tools handler
  inboundConn.server.setRequestHandler(
    ListToolsRequestSchema,
    withErrorHandling(async (request: ListToolsRequest) => {
      // If lazy loading is enabled, use LazyLoadingOrchestrator for tool listing
      if (lazyLoadingEnabled && lazyLoadingOrchestrator) {
        // Apply the same filtering chain as normal mode
        // Step 1: Filter by session (for template servers like serena)
        const sessionFilteredConns = filterConnectionsForSession(outboundConns, sessionId);
        // Step 2: Filter by capability (servers with tools)
        const capabilityFilteredClients = byCapabilities({ tools: {} })(sessionFilteredConns);
        // Step 3: Filter by preset/tag configuration
        const filteredClients = FilteringService.getFilteredConnections(capabilityFilteredClients, inboundConn);

        // Get the set of filtered server names
        const filteredServerNames = new Set(Array.from(filteredClients.values()).map((conn) => conn.name));

        // Debug logging
        logger.info('Lazy loading: filtered servers', {
          totalOutbound: outboundConns.size,
          sessionFiltered: sessionFilteredConns.size,
          capabilityFiltered: capabilityFilteredClients.size,
          finalFiltered: filteredClients.size,
          filteredServerNames: Array.from(filteredServerNames),
          inboundConfig: {
            tagFilterMode: inboundConn.tagFilterMode,
            tags: inboundConn.tags,
            tagExpression: inboundConn.tagExpression,
          },
        });

        // Get capabilities from orchestrator with filtered servers
        // Store the session filter so that subsequent tool_list meta-tool calls
        // will return only tools from the filtered servers
        const capabilities = await lazyLoadingOrchestrator.getCapabilitiesForFilteredServers(
          filteredServerNames,
          sessionId,
        );

        // Get internal tools (always fully loaded) - filter out lazy tools when lazy loading is enabled
        const internalProvider = InternalCapabilitiesProvider.getInstance();
        await internalProvider.initialize();
        const internalTools = internalProvider.getAvailableTools();

        // Filter out lazy tools since they're provided by the MetaToolProvider
        const lazyToolNames = ['tool_list', 'tool_schema', 'tool_invoke'];
        const nonLazyTools = internalTools.filter((tool) => !lazyToolNames.includes(tool.name));

        // Add internal tools to the result (with 1mcp prefix)
        const internalToolsWithPrefix = nonLazyTools.map((tool) => ({
          ...tool,
          name: buildUri('1mcp', tool.name, MCP_URI_SEPARATOR),
        }));

        // Combine lazy-loaded tools with internal tools
        const allTools = [...capabilities.tools, ...internalToolsWithPrefix];

        return {
          tools: allTools,
        };
      }

      // Normal mode: get tools from external MCP servers
      // Filter connections for this session first
      const sessionFilteredConns = filterConnectionsForSession(outboundConns, sessionId);
      // Then filter by capabilities, then by tags
      const capabilityFilteredClients = byCapabilities({ tools: {} })(sessionFilteredConns);
      const filteredClients = FilteringService.getFilteredConnections(capabilityFilteredClients, inboundConn);

      // Get tools from external MCP servers
      const result = await handlePagination(
        filteredClients,
        request.params || {},
        (client, params, opts) => client.listTools(params as ListToolsRequest['params'], opts),
        (outboundConn, result) =>
          result.tools?.map((tool) => ({
            ...tool,
            name: buildUri(outboundConn.name, tool.name, MCP_URI_SEPARATOR),
          })) ?? [],
        inboundConn.enablePagination ?? false,
      );

      // Get internal tools if enabled
      const internalProvider = InternalCapabilitiesProvider.getInstance();
      await internalProvider.initialize();
      const internalTools = internalProvider.getAvailableTools();

      // Add internal tools to the result (with 1mcp prefix)
      const internalToolsWithPrefix = internalTools.map((tool) => ({
        ...tool,
        name: buildUri('1mcp', tool.name, MCP_URI_SEPARATOR),
      }));

      // Combine external and internal tools
      const allTools = [...result.items, ...internalToolsWithPrefix];

      return {
        tools: allTools,
        nextCursor: result.nextCursor,
      };
    }, 'Error listing tools'),
  );

  // Call Tool handler
  inboundConn.server.setRequestHandler(
    CallToolRequestSchema,
    withErrorHandling(async (request) => {
      const toolName = request.params.name;

      // Check if this is an unprefixed meta-tool call (when lazy loading is enabled)
      const isUnprefixedMetaTool =
        lazyLoadingEnabled && lazyLoadingOrchestrator && lazyLoadingOrchestrator.isMetaTool(toolName);

      if (isUnprefixedMetaTool && lazyLoadingOrchestrator) {
        let result;
        try {
          result = await lazyLoadingOrchestrator.callMetaTool(toolName, request.params.arguments, sessionId);
        } catch (metaToolError) {
          logger.error(`Meta-tool ${toolName} execution failed: ${metaToolError}`);
          throw new Error(
            `Meta-tool ${toolName} failed: ${metaToolError instanceof Error ? metaToolError.message : String(metaToolError)}`,
          );
        }

        // CRITICAL: Do not throw errors for structured error responses
        // Meta-tools return structured errors in the result itself (with error.type and error.message)
        // These should be returned to the client as-is, not thrown as exceptions
        // The client will parse the structured error from the content field

        // Return both content and structuredContent (required by MCP protocol for tools with outputSchema)
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
          structuredContent: result,
        };
      }

      // CRITICAL: Handle unprefixed tool names when lazy loading is enabled
      // If lazy loading is on and the tool name doesn't have the URI separator format,
      // return a proper error instead of throwing during URI parsing
      const isUnprefixedTool = lazyLoadingEnabled && !toolName.includes(MCP_URI_SEPARATOR);
      if (isUnprefixedTool) {
        // Unknown unprefixed tool in lazy loading mode
        const errorResult = {
          error: {
            type: 'not_found',
            message: `Unknown tool: ${toolName}. In lazy loading mode, use meta-tools (tool_list, tool_schema, tool_invoke) to discover and call tools.`,
          },
        };
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(errorResult, null, 2),
            },
          ],
          structuredContent: errorResult,
        };
      }

      const { clientName, resourceName: extractedToolName } = parseUri(toolName, MCP_URI_SEPARATOR);

      // Handle 1mcp tools (includes both internal tools and lazy tools)
      if (clientName === '1mcp') {
        const internalProvider = InternalCapabilitiesProvider.getInstance();
        await internalProvider.initialize();
        const result = await internalProvider.executeTool(extractedToolName, request.params.arguments, sessionId);

        // For tools with output schemas, return both content and structuredContent
        // This is required by the MCP protocol when outputSchema is defined
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
          structuredContent: result,
        };
      }

      // Handle external MCP server tools
      const outboundConn = resolveOutboundConnection(clientName, sessionId, outboundConns);
      if (!outboundConn) {
        throw new Error(`Unknown client: ${clientName}`);
      }
      return outboundConn.client.callTool({ ...request.params, name: extractedToolName }, CallToolResultSchema, {
        timeout: getRequestTimeout(outboundConn.transport),
      });
    }, 'Error calling tool'),
  );
}

/**
 * Registers prompt-related request handlers
 * @param clients Record of client instances
 * @param serverInfo The MCP server instance
 */
function registerPromptHandlers(outboundConns: OutboundConnections, inboundConn: InboundConnection): void {
  const sessionId = getRequestSession(inboundConn);

  // List Prompts handler
  inboundConn.server.setRequestHandler(
    ListPromptsRequestSchema,
    withErrorHandling(async (request: ListPromptsRequest) => {
      // Filter connections for this session first
      const sessionFilteredConns = filterConnectionsForSession(outboundConns, sessionId);
      // Then filter by capabilities, then by tags
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

  // Get Prompt handler
  inboundConn.server.setRequestHandler(
    GetPromptRequestSchema,
    withErrorHandling(async (request) => {
      const { clientName, resourceName: promptName } = parseUri(request.params.name, MCP_URI_SEPARATOR);
      const outboundConn = resolveOutboundConnection(clientName, sessionId, outboundConns);
      if (!outboundConn) {
        throw new Error(`Unknown client: ${clientName}`);
      }
      return outboundConn.client.getPrompt({ ...request.params, name: promptName });
    }, 'Error getting prompt'),
  );
}

/**
 * Registers completion-related request handlers
 * @param clients Record of client instances
 * @param serverInfo The MCP server instance
 */
function registerCompletionHandlers(outboundConns: OutboundConnections, inboundConn: InboundConnection): void {
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
        // This should be caught by the schema validation, but as a safeguard:
        throw new Error(`Unsupported completion reference type: ${(ref as { type: string }).type}`);
      }

      const params = { ...request.params, ref: updatedRef };

      const outboundConn = resolveOutboundConnection(clientName, sessionId, outboundConns);
      if (!outboundConn) {
        throw new Error(`Unknown client: ${clientName}`);
      }
      return outboundConn.client.complete(params, {
        timeout: getRequestTimeout(outboundConn.transport),
      });
    }, 'Error handling completion'),
  );
}
