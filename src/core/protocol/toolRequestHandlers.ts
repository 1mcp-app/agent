import {
  CallToolRequestSchema,
  CallToolResultSchema,
  ListToolsRequest,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { McpConfigManager } from '@src/config/mcpConfigManager.js';
import { MCP_URI_SEPARATOR } from '@src/constants.js';
import { InternalCapabilitiesProvider } from '@src/core/capabilities/internalCapabilitiesProvider.js';
import { LazyLoadingOrchestrator } from '@src/core/capabilities/lazyLoadingOrchestrator.js';
import { byCapabilities } from '@src/core/filtering/clientFiltering.js';
import { FilteringService } from '@src/core/filtering/filteringService.js';
import { getDisabledToolError } from '@src/core/server/disabledTools.js';
import { InboundConnection, OutboundConnections } from '@src/core/types/index.js';
import type { MCPServerParams } from '@src/core/types/transport.js';
import logger from '@src/logger/logger.js';
import { withErrorHandling } from '@src/utils/core/errorHandling.js';
import { buildUri, parseUri } from '@src/utils/core/parsing.js';
import { getRequestTimeout } from '@src/utils/core/timeoutUtils.js';

import {
  createCapabilityCatalogFromConnections,
  filterConnectionsForSession,
  getRequestSession,
  resolveOutboundConnection,
} from './requestHandlerUtils.js';

export function registerToolHandlers(
  outboundConns: OutboundConnections,
  inboundConn: InboundConnection,
  lazyLoadingOrchestrator?: LazyLoadingOrchestrator,
): void {
  const sessionId = getRequestSession(inboundConn);
  const lazyLoadingEnabled = lazyLoadingOrchestrator?.isEnabled();
  const getServerConfigs = (): Record<string, MCPServerParams> => McpConfigManager.getInstance().getTransportConfig();

  inboundConn.server.setRequestHandler(
    ListToolsRequestSchema,
    withErrorHandling(async (request: ListToolsRequest) => {
      if (lazyLoadingEnabled && lazyLoadingOrchestrator) {
        const sessionFilteredConns = filterConnectionsForSession(outboundConns, sessionId);
        const capabilityFilteredClients = byCapabilities({ tools: {} })(sessionFilteredConns);
        const filteredClients = FilteringService.getFilteredConnections(capabilityFilteredClients, inboundConn);

        const filteredServerNames = new Set(Array.from(filteredClients.values()).map((conn) => conn.name));

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

        const capabilities = await lazyLoadingOrchestrator.getCapabilitiesForFilteredServers(
          filteredServerNames,
          sessionId,
        );

        const internalProvider = InternalCapabilitiesProvider.getInstance();
        await internalProvider.initialize();
        const internalTools = internalProvider.getAvailableTools();

        const lazyToolNames = ['tool_list', 'tool_schema', 'tool_invoke'];
        const nonLazyTools = internalTools.filter((tool) => !lazyToolNames.includes(tool.name));
        const internalToolsWithPrefix = nonLazyTools.map((tool) => ({
          ...tool,
          name: buildUri('1mcp', tool.name, MCP_URI_SEPARATOR),
        }));

        return {
          tools: [...capabilities.tools, ...internalToolsWithPrefix],
        };
      }

      const sessionFilteredConns = filterConnectionsForSession(outboundConns, sessionId);
      const capabilityFilteredClients = byCapabilities({ tools: {} })(sessionFilteredConns);
      const filteredClients = FilteringService.getFilteredConnections(capabilityFilteredClients, inboundConn);

      const catalog = await createCapabilityCatalogFromConnections(filteredClients, getServerConfigs);
      const result = await catalog.listVisibleTools(request.params || {}, sessionId);

      const internalProvider = InternalCapabilitiesProvider.getInstance();
      await internalProvider.initialize();
      const internalTools = internalProvider.getAvailableTools();

      const internalToolsWithPrefix = internalTools.map((tool) => ({
        ...tool,
        name: buildUri('1mcp', tool.name, MCP_URI_SEPARATOR),
      }));

      const externalTools = result.tools.map((tool) => ({
        ...tool,
        name: buildUri(tool.server, tool.name, MCP_URI_SEPARATOR),
        inputSchema: tool.inputSchema ?? { type: 'object' },
      }));

      return {
        tools: [...externalTools, ...internalToolsWithPrefix],
        nextCursor: result.nextCursor,
      };
    }, 'Error listing tools'),
  );

  inboundConn.server.setRequestHandler(
    CallToolRequestSchema,
    withErrorHandling(async (request) => {
      const toolName = request.params.name;
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

        return structuredToolResult(result);
      }

      if (lazyLoadingEnabled && !toolName.includes(MCP_URI_SEPARATOR)) {
        return structuredToolResult({
          error: {
            type: 'not_found',
            message: `Unknown tool: ${toolName}. In lazy loading mode, use meta-tools (tool_list, tool_schema, tool_invoke) to discover and call tools.`,
          },
        });
      }

      const { clientName, resourceName: extractedToolName } = parseUri(toolName, MCP_URI_SEPARATOR);

      if (clientName === '1mcp') {
        const internalProvider = InternalCapabilitiesProvider.getInstance();
        await internalProvider.initialize();
        const result = await internalProvider.executeTool(extractedToolName, request.params.arguments, sessionId);
        return structuredToolResult(result);
      }

      const disabledError = getDisabledToolError(getServerConfigs(), clientName, extractedToolName);
      if (disabledError) {
        return structuredToolResult({
          error: {
            type: disabledError.type,
            message: disabledError.message,
          },
        });
      }

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

function structuredToolResult(result: unknown) {
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
