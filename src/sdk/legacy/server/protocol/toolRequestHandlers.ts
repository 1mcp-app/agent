import {
  CallToolRequestSchema,
  CallToolResultSchema,
  ListToolsRequest,
  ListToolsRequestSchema,
  type Tool,
} from '@src/sdk/legacy/types.js';

import { getConfiguredServerTargets } from '@src/config/configuredServerTargets.js';
import { MCP_URI_SEPARATOR } from '@src/constants.js';
import {
  publishCompleteConfiguredToolTargetSnapshots,
  publishConfiguredToolPage,
} from '@src/core/capabilities/configuredToolSnapshot.js';
import { InternalCapabilitiesProvider } from '@src/core/capabilities/internalCapabilitiesProvider.js';
import { LazyLoadingOrchestrator } from '@src/core/capabilities/lazyLoadingOrchestrator.js';
import { executeWithPostAuthOAuthRecovery } from '@src/core/client/postAuthOAuthRecovery.js';
import { getDisabledToolError } from '@src/core/server/disabledTools.js';
import { applyEffectiveToolDescription } from '@src/core/server/toolDescriptionOverrides.js';
import { InboundConnection, OutboundConnections } from '@src/core/types/index.js';
import type { MCPServerParams } from '@src/core/types/transport.js';
import logger, { infoIf } from '@src/logger/logger.js';
import { withErrorHandling } from '@src/utils/core/errorHandling.js';
import { buildUri, parseUri } from '@src/utils/core/parsing.js';
import { getRequestTimeout } from '@src/utils/core/timeoutUtils.js';

import {
  createProtocolCapabilityCatalog,
  getRequestSession,
  resolveCapabilityVisibility,
  resolveLazyCapabilityVisibility,
  resolveOutboundConnection,
} from '@src/core/protocol/requestHandlerUtils.js';

export function registerToolHandlers(
  outboundConns: OutboundConnections,
  inboundConn: InboundConnection,
  lazyLoadingOrchestrator?: LazyLoadingOrchestrator,
): void {
  const sessionId = getRequestSession(inboundConn);
  const lazyLoadingEnabled = lazyLoadingOrchestrator?.isEnabled();
  const getServerConfigs = (): Record<string, MCPServerParams> => getConfiguredServerTargets();
  const catalog = createProtocolCapabilityCatalog(outboundConns, getServerConfigs);

  inboundConn.server.setRequestHandler(
    ListToolsRequestSchema,
    withErrorHandling(async (request: ListToolsRequest) => {
      if (lazyLoadingEnabled && lazyLoadingOrchestrator) {
        const visibility = resolveLazyCapabilityVisibility(outboundConns, inboundConn, sessionId);
        const visibleServerNames = Array.from(new Set(visibility.serverCandidates.values()));

        infoIf(() => ({
          message: 'Lazy loading: filtered servers',
          meta: {
            totalOutbound: outboundConns.size,
            finalFiltered: visibility.serverCandidates.size,
            visibleServerNames,
            inboundConfig: {
              tagFilterMode: inboundConn.tagFilterMode,
              tags: inboundConn.tags,
              tagExpression: inboundConn.tagExpression,
            },
          },
        }));

        const capabilities = await lazyLoadingOrchestrator.getCapabilitiesForVisibility(visibility);

        const internalProvider = InternalCapabilitiesProvider.getInstance();
        await internalProvider.initialize();
        const internalTools = internalProvider.getAvailableTools();

        const lazyToolNames = ['tool_list', 'tool_schema', 'tool_invoke'];
        const nonLazyTools = internalTools.filter((tool) => !lazyToolNames.includes(tool.name));
        const paginationFacts = createToolPaginationFacts(internalTools, getServerConfigs());
        const internalToolsWithPrefix = nonLazyTools.map((tool) => ({
          ...tool,
          name: buildUri('1mcp', tool.name, MCP_URI_SEPARATOR),
        }));

        const tools = [...capabilities.tools, ...internalToolsWithPrefix].sort((left, right) =>
          left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
        );
        const result = await catalog.listVisibleCapabilityPages<Tool>({
          kind: 'tools',
          visibility,
          cursor: request.params?.cursor,
          list: async () => ({ items: [] }),
          internalPages: [{ id: '\0app.1mcp/lazy-tools', name: '1mcp', items: tools }],
          includeExternal: false,
          filterSelection: { lazy: true, ...paginationFacts },
          generationSignature: paginationFacts,
          enablePagination: inboundConn.enablePagination ?? false,
        });

        return {
          tools: result.items,
          nextCursor: result.nextCursor,
          _meta: result._meta,
        };
      }

      const visibility = resolveCapabilityVisibility(outboundConns, inboundConn, sessionId, 'tools');
      const internalProvider = InternalCapabilitiesProvider.getInstance();
      await internalProvider.initialize();
      const internalTools = internalProvider.getAvailableTools();
      const serverConfigs = getServerConfigs();
      const paginationFacts = createToolPaginationFacts(internalTools, serverConfigs);
      const result = await catalog.listVisibleCapabilityPages<Tool>({
        kind: 'tools',
        visibility,
        cursor: request.params?.cursor,
        list: async (outboundConn, cursor) => {
          const upstream = await outboundConn.client.listTools(
            { cursor },
            { timeout: getRequestTimeout(outboundConn.transport) },
          );
          publishConfiguredToolPage(outboundConn, upstream.tools ?? [], cursor, upstream.nextCursor);
          if (upstream.nextCursor === undefined) {
            publishCompleteConfiguredToolTargetSnapshots(outboundConns);
          }
          return {
            items: upstream.tools ?? [],
            nextCursor: upstream.nextCursor,
          };
        },
        mapItem: (tool, serverName) => ({
          ...applyEffectiveToolDescription(tool, serverConfigs[serverName], serverName),
          name: buildUri(serverName, tool.name, MCP_URI_SEPARATOR),
          inputSchema: tool.inputSchema ?? { type: 'object' },
        }),
        internalPages: [
          {
            id: '\0app.1mcp/internal-tools',
            name: '1mcp',
            items: internalTools.map((tool) => ({
              ...tool,
              name: buildUri('1mcp', tool.name, MCP_URI_SEPARATOR),
            })),
          },
        ],
        filterSelection: paginationFacts,
        generationSignature: paginationFacts,
        serverConfigs,
        enablePagination: inboundConn.enablePagination ?? false,
      });

      return {
        tools: result.items,
        nextCursor: result.nextCursor,
        _meta: result._meta,
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
          const visibility = resolveLazyCapabilityVisibility(outboundConns, inboundConn, sessionId);
          result = await lazyLoadingOrchestrator.callMetaTool(toolName, request.params.arguments, visibility);
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
        const visibility = lazyLoadingEnabled
          ? resolveLazyCapabilityVisibility(outboundConns, inboundConn, sessionId)
          : undefined;
        const result = await internalProvider.executeTool(extractedToolName, request.params.arguments, visibility);
        return structuredToolResult(result);
      }

      const outboundConn = resolveOutboundConnection(clientName, sessionId, outboundConns, inboundConn);
      if (!outboundConn) {
        throw new Error(`Unknown client: ${clientName}`);
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
      return executeWithPostAuthOAuthRecovery(clientName, outboundConn, () =>
        outboundConn.client.callTool({ ...request.params, name: extractedToolName }, CallToolResultSchema, {
          timeout: getRequestTimeout(outboundConn.transport),
        }),
      );
    }, 'Error calling tool'),
  );
}

function createToolPaginationFacts(
  internalTools: Tool[],
  serverConfigs: Record<string, MCPServerParams>,
): {
  disabledTools: Record<string, string[]>;
  toolDescriptionOverrides: Record<string, Record<string, string>>;
  internalTools: string[];
} {
  return {
    disabledTools: Object.fromEntries(
      Object.entries(serverConfigs)
        .filter(([, config]) => config.disabledTools?.length)
        .map(([name, config]) => [name, [...(config.disabledTools ?? [])].sort()]),
    ),
    toolDescriptionOverrides: Object.fromEntries(
      Object.entries(serverConfigs)
        .filter(([, config]) => Object.keys(config.toolDescriptionOverrides ?? {}).length > 0)
        .map(([name, config]) => [
          name,
          Object.fromEntries(
            Object.entries(config.toolDescriptionOverrides ?? {}).sort(([left], [right]) => left.localeCompare(right)),
          ),
        ]),
    ),
    internalTools: internalTools.map((tool) => tool.name).sort(),
  };
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
