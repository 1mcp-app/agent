import { getConfiguredServerTargets } from '@src/config/configuredServerTargets.js';
import { InternalCapabilitiesProvider } from '@src/core/capabilities/internalCapabilitiesProvider.js';
import { LazyLoadingOrchestrator } from '@src/core/capabilities/lazyLoadingOrchestrator.js';
import {
  acquireRuntimeCapabilityCatalog,
  type PreparedToolCall,
} from '@src/core/capabilities/runtimeCapabilityCatalog.js';
import { ToolRegistry } from '@src/core/capabilities/toolRegistry.js';
import { requestLegacyAdapter } from '@src/core/client/legacyAdapterRequest.js';
import { executeWithPostAuthOAuthRecovery } from '@src/core/client/postAuthOAuthRecovery.js';
import {
  getRequestSession,
  resolveCapabilityVisibility,
  resolveLazyCapabilityVisibility,
} from '@src/core/protocol/requestHandlerUtils.js';
import { getDisabledSourceToolError } from '@src/core/server/disabledTools.js';
import { withRuntimeAdmission } from '@src/core/server/runtimeDrain.js';
import { InboundConnection } from '@src/core/types/index.js';
import { SchemaBoundaryError } from '@src/core/validation/schemaBoundary.js';
import { RESPONSE_JSON_VALUE_LIMITS, toJsonValue } from '@src/sdk/contracts/index.js';
import type { Tool } from '@src/sdk/contracts/index.js';
import { type LegacyOutboundConnections } from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import { revalidateLegacyRequestAuthInfo } from '@src/sdk/legacy/server/auth/requestAuthRevalidation.js';
import { getLegacyInboundServer } from '@src/sdk/legacy/server/runtime/legacyInboundConnection.js';
import {
  canonicalBridgeToolRegistrar,
  projectCanonicalToolResult,
  projectLegacyTool,
  projectLegacyToolResult,
  projectLegacyTools,
} from '@src/sdk/legacy/shared/schemaProjection.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@src/sdk/legacy/types.js';
import { withErrorHandling } from '@src/utils/core/errorHandling.js';

import { withPrivateInteractionConnection } from './privateInteractionConnection.js';
import { bindOwnedCatalogConnections, bindOwnedNotificationAuthorization } from './resourceSubscriptions.js';

export function registerToolHandlers(
  outboundConns: LegacyOutboundConnections,
  inboundConn: InboundConnection,
  lazyLoadingOrchestrator?: LazyLoadingOrchestrator,
): void {
  const sessionId = getRequestSession(inboundConn);
  const lazy = lazyLoadingOrchestrator?.isEnabled() ?? false;
  const acquire = async (cursor?: string, signal?: AbortSignal, { upstream = true } = {}) => {
    const resolved = lazy
      ? resolveLazyCapabilityVisibility(outboundConns, inboundConn, sessionId)
      : resolveCapabilityVisibility(outboundConns, inboundConn, sessionId, 'tools');
    // Lazy discovery lists only gateway tools, so it must not wait on upstream enumeration.
    const visibility = upstream ? resolved : { ...resolved, serverCandidates: new Map<string, string>() };
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
      signal,
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
    return { snapshot, visibility: resolved, provider, serverConfigs };
  };
  const server = getLegacyInboundServer(inboundConn);
  server.setRequestHandler(
    ListToolsRequestSchema,
    withErrorHandling(
      withRuntimeAdmission(async (request, extra) => {
        bindOwnedCatalogConnections(outboundConns, inboundConn, 'tools');
        if (extra?.authInfo)
          bindOwnedNotificationAuthorization(outboundConns, inboundConn, () =>
            revalidateLegacyRequestAuthInfo(extra.authInfo),
          );
        const { snapshot } = await acquire(request.params?.cursor, extra?.signal, { upstream: !lazy });
        const result = await snapshot.list<Tool>('tools', {
          cursor: request.params?.cursor,
          enablePagination: inboundConn.enablePagination ?? false,
          filterSelection: { lazy },
          internalOnly: lazy,
          responseBudget: {
            limits: RESPONSE_JSON_VALUE_LIMITS,
            ...(inboundConn.canonicalSchemaProjection ? {} : { project: projectLegacyTool }),
          },
        });
        const listed = {
          tools: result.items,
          ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
          ...(result._meta === undefined ? {} : { _meta: result._meta }),
        };
        return inboundConn.canonicalSchemaProjection
          ? listed
          : projectLegacyTools(
              toJsonValue(listed, RESPONSE_JSON_VALUE_LIMITS) as import('@src/sdk/contracts/index.js').JsonObject,
            );
      }),
      'Error listing tools',
    ),
  );
  const registerToolCall = inboundConn.canonicalSchemaProjection
    ? canonicalBridgeToolRegistrar(server)
    : server.setRequestHandler.bind(server);
  registerToolCall(
    CallToolRequestSchema,
    withErrorHandling(
      withRuntimeAdmission(async (request, extra) => {
        const args = request.params.arguments;
        const toolListContinuation =
          lazy &&
          request.params.name === 'tool_list' &&
          args &&
          typeof args === 'object' &&
          typeof args.cursor === 'string';
        const { snapshot, visibility, provider, serverConfigs } = await acquire(undefined, extra?.signal, {
          upstream: !toolListContinuation,
        });
        const resolved = snapshot.resolve('tools', request.params.name);
        if (!resolved) {
          const entry = snapshot.generation.resolve('tools', request.params.name);
          const error =
            entry && getDisabledSourceToolError(serverConfigs, entry.route.server, entry.route.upstreamIdentity);
          if (error) return structuredToolResult({ error });
          throw new Error(`Unknown tool: ${request.params.name}`);
        }
        const adapter = resolved.connection?.adapter;
        let validateOutput: PreparedToolCall;
        try {
          validateOutput = await snapshot.prepareToolCall(request.params.name, request.params.arguments, extra?.signal);
        } catch (error) {
          if (error instanceof SchemaBoundaryError && error.code === 'schema_input_invalid') {
            const route = resolved.entry.route;
            if (route.origin === 'internal' && route.connectionKey === '\0app.1mcp/meta-tools') {
              const detail = { type: 'validation', message: error.code };
              switch (route.upstreamIdentity) {
                case 'tool_list':
                  return structuredToolResult({ tools: [], totalCount: 0, servers: [], hasMore: false, error: detail });
                case 'tool_schema':
                  return structuredToolResult({ schema: {}, error: detail });
                case 'tool_invoke':
                  return structuredToolResult({ result: {}, server: '', tool: '', error: detail });
              }
            }
            return { isError: true, content: [{ type: 'text' as const, text: error.code }] };
          }
          throw error;
        }
        const finish = async <T>(result: T) => {
          await validateOutput(result);
          return (inboundConn.canonicalSchemaProjection ? projectCanonicalToolResult : projectLegacyToolResult)(
            result,
            resolved.entry.sourceObject.outputSchema as Record<string, unknown> | undefined,
          ) as T;
        };
        if (extra?.signal?.aborted) throw new SchemaBoundaryError('schema_evaluation_unavailable', true);
        const { route } = resolved.entry;
        validateOutput.assertCurrent();
        if (route.origin === 'internal') {
          if (lazyLoadingOrchestrator && route.connectionKey === '\0app.1mcp/meta-tools') {
            return finish(
              structuredToolResult(
                await lazyLoadingOrchestrator.callMetaTool(
                  route.upstreamIdentity,
                  request.params.arguments,
                  visibility,
                  extra?.signal,
                  // This request already enumerated its visible backends; answer from that
                  // snapshot rather than a shared registry that may be stale or partial.
                  toolListContinuation ? undefined : ToolRegistry.fromCapabilitySnapshot(snapshot),
                ),
              ),
            );
          }
          return finish(
            structuredToolResult(
              await provider.executeTool(
                route.upstreamIdentity,
                request.params.arguments,
                lazy ? visibility : undefined,
              ),
            ),
          );
        }
        if (!resolved.connection) throw new Error(`Server not connected: ${route.server}`);
        const connection = resolved.connection;
        if (connection.adapter !== adapter || !snapshot.isCurrent())
          throw new SchemaBoundaryError('schema_evaluation_unavailable', true);
        const disabled = getDisabledSourceToolError(getConfiguredServerTargets(), route.server, route.upstreamIdentity);
        if (disabled) return structuredToolResult({ error: disabled });
        return finish(
          await withPrivateInteractionConnection(
            connection,
            inboundConn,
            extra,
            resolved.entry,
            (selected) => {
              const selectedAdapter = selected.adapter;
              return executeWithPostAuthOAuthRecovery(route.server, selected, () =>
                requestLegacyAdapter(
                  selectedAdapter,
                  'tools/call',
                  toJsonValue({
                    name: route.upstreamIdentity,
                    ...(request.params.arguments === undefined ? {} : { arguments: request.params.arguments }),
                  }),
                  { signal: extra?.signal, timeoutMs: selected.requestTimeoutMs },
                ),
              );
            },
            validateOutput.assertCurrent,
          ),
        );
      }),
      'Error calling tool',
    ),
  );
}

function structuredToolResult(result: unknown) {
  const isError = result !== null && typeof result === 'object' && 'error' in result && result.error !== undefined;
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
    ...(isError ? { isError: true } : {}),
  };
}
