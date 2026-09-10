import { getConfiguredServerTargets } from '@src/config/configuredServerTargets.js';
import { InternalCapabilitiesProvider } from '@src/core/capabilities/internalCapabilitiesProvider.js';
import { LazyLoadingOrchestrator } from '@src/core/capabilities/lazyLoadingOrchestrator.js';
import { acquireRuntimeCapabilityCatalog } from '@src/core/capabilities/runtimeCapabilityCatalog.js';
import { executeWithPostAuthOAuthRecovery } from '@src/core/client/postAuthOAuthRecovery.js';
import {
  getRequestSession,
  resolveCapabilityVisibility,
  resolveLazyCapabilityVisibility,
} from '@src/core/protocol/requestHandlerUtils.js';
import { getDisabledSourceToolError } from '@src/core/server/disabledTools.js';
import { InboundConnection } from '@src/core/types/index.js';
import type { Tool } from '@src/sdk/contracts/index.js';
import {
  type LegacyOutboundConnections,
  requestLegacyOutbound,
} from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import { getLegacyInboundServer } from '@src/sdk/legacy/server/runtime/legacyInboundConnection.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@src/sdk/legacy/types.js';
import { withErrorHandling } from '@src/utils/core/errorHandling.js';

export function registerToolHandlers(
  outboundConns: LegacyOutboundConnections,
  inboundConn: InboundConnection,
  lazyLoadingOrchestrator?: LazyLoadingOrchestrator,
): void {
  const sessionId = getRequestSession(inboundConn);
  const lazy = lazyLoadingOrchestrator?.isEnabled() ?? false;
  const acquire = async (cursor?: string) => {
    const visibility = lazy
      ? resolveLazyCapabilityVisibility(outboundConns, inboundConn, sessionId)
      : resolveCapabilityVisibility(outboundConns, inboundConn, sessionId, 'tools');
    const provider = InternalCapabilitiesProvider.getInstance();
    await provider.initialize();
    const internalTools = provider.getAvailableTools();
    const metaTools =
      lazy && lazyLoadingOrchestrator
        ? (await lazyLoadingOrchestrator.getCapabilitiesForVisibility(visibility)).tools
        : [];
    const serverConfigs = getConfiguredServerTargets();
    const snapshot = await acquireRuntimeCapabilityCatalog(outboundConns, visibility, {
      serverConfigs,
      internalTools: lazy
        ? internalTools.filter((tool) => !['tool_list', 'tool_schema', 'tool_invoke'].includes(tool.name))
        : internalTools,
      unprefixedTools: metaTools,
      continuation: cursor
        ? {
            kind: 'tools',
            cursor,
            enablePagination: inboundConn.enablePagination ?? false,
            internalOnly: lazy,
            filterSelection: { lazy },
          }
        : undefined,
    });
    return { snapshot, visibility, provider, serverConfigs };
  };
  const server = getLegacyInboundServer(inboundConn);
  server.setRequestHandler(
    ListToolsRequestSchema,
    withErrorHandling(async (request) => {
      const { snapshot } = await acquire(request.params?.cursor);
      const result = await snapshot.list<Tool>('tools', {
        cursor: request.params?.cursor,
        enablePagination: inboundConn.enablePagination ?? false,
        filterSelection: { lazy },
        internalOnly: lazy,
      });
      return {
        tools: result.items,
        ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
        ...(result._meta === undefined ? {} : { _meta: result._meta }),
      };
    }, 'Error listing tools'),
  );
  server.setRequestHandler(
    CallToolRequestSchema,
    withErrorHandling(async (request) => {
      const { snapshot, visibility, provider, serverConfigs } = await acquire();
      const resolved = snapshot.resolve('tools', request.params.name);
      if (!resolved) {
        const entry = snapshot.generation.resolve('tools', request.params.name);
        const error =
          entry && getDisabledSourceToolError(serverConfigs, entry.route.server, entry.route.upstreamIdentity);
        if (error) return structuredToolResult({ error });
        throw new Error(`Unknown tool: ${request.params.name}`);
      }
      const { route } = resolved.entry;
      if (route.origin === 'internal') {
        if (lazyLoadingOrchestrator && route.connectionKey === '\0app.1mcp/meta-tools') {
          return structuredToolResult(
            await lazyLoadingOrchestrator.callMetaTool(route.upstreamIdentity, request.params.arguments, visibility),
          );
        }
        return structuredToolResult(
          await provider.executeTool(route.upstreamIdentity, request.params.arguments, lazy ? visibility : undefined),
        );
      }
      if (!resolved.connection) throw new Error(`Server not connected: ${route.server}`);
      const connection = resolved.connection;
      return executeWithPostAuthOAuthRecovery(route.server, connection, () =>
        requestLegacyOutbound(connection, 'tools/call', {
          ...request.params,
          name: route.upstreamIdentity,
        }),
      );
    }, 'Error calling tool'),
  );
}

function structuredToolResult(result: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], structuredContent: result };
}
