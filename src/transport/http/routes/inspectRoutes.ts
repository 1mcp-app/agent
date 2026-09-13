import { ConfigManager } from '@src/config/configManager.js';
import { McpConfigManager } from '@src/config/mcpConfigManager.js';
import { CapabilityAggregator } from '@src/core/capabilities/capabilityAggregator.js';
import { createCapabilityVisibility } from '@src/core/capabilities/capabilityVisibility.js';
import { readPublicCapabilityRoute } from '@src/core/capabilities/catalogGeneration.js';
import { acquireRuntimeCapabilityCatalog } from '@src/core/capabilities/runtimeCapabilityCatalog.js';
import { ToolRegistry } from '@src/core/capabilities/toolRegistry.js';
import { requestLegacyAdapter } from '@src/core/client/legacyAdapterRequest.js';
import { FilteringService } from '@src/core/filtering/filteringService.js';
import { LoadingState, type ServerLoadingInfo } from '@src/core/loading/loadingStateTracker.js';
import { McpLoadingManager } from '@src/core/loading/mcpLoadingManager.js';
import { ServerRegistry } from '@src/core/server/adapters/ServerRegistry.js';
import { filterDisabledTools, getDisabledToolError, isSourceToolDisabled } from '@src/core/server/disabledTools.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { applyEffectiveToolDescription } from '@src/core/server/toolDescriptionOverrides.js';
import logger from '@src/logger/logger.js';
import { ErrorCode } from '@src/sdk/contracts/index.js';
import { getAuthInfo } from '@src/transport/http/middlewares/scopeAuthMiddleware.js';
import { MCPError } from '@src/utils/core/errorTypes.js';

import { Request, RequestHandler, Response } from 'express';

import {
  buildFilterConfig,
  deriveServerState,
  type InspectServerPayload,
  type InspectServersPayload,
  type InspectToolPayload,
  matchesFilterConfig,
  parseTarget,
  qualifyToolName,
  resolveConnectionByServerName,
  type ServerSummary,
  summarizeDirectServerTool,
  summarizeToolSchema,
  type ToolSummary,
} from './inspectHelpers.js';
import { ensureRequestContextInitialized } from './inspectRequestContext.js';

export {
  buildFilterConfig,
  ensureRequestContextInitialized,
  matchesFilterConfig,
  parseTarget,
  resolveConnectionByServerName,
};
export type { InspectServerPayload, InspectServersPayload, InspectToolPayload, ServerSummary, ToolSummary };

type FilteredConnections = ReturnType<typeof FilteringService.getFilteredConnections>;
type Tool = Parameters<typeof summarizeDirectServerTool>[1];

type DeclaredServers = ReturnType<ConfigManager['loadDeclaredServerConfigs']>;
type ServerConfigMap =
  ReturnType<typeof McpConfigManager.getInstance> extends { getConfiguredServerTargets(): infer TResult }
    ? TResult
    : never;

function getServerConfigs() {
  const manager = McpConfigManager.getInstance();
  return typeof manager.getConfiguredServerTargets === 'function'
    ? manager.getConfiguredServerTargets()
    : manager.getTransportConfig();
}

function getServerTargetConfigs(declaredServers: DeclaredServers): ServerConfigMap {
  return {
    ...declaredServers.staticServers,
    ...getServerConfigs(),
    ...declaredServers.templateServers,
  };
}

function getLoadingInfo(serverName: string): ServerLoadingInfo | undefined {
  try {
    return McpLoadingManager.current.getStateTracker().getServerState(serverName);
  } catch {
    // Inspect is also used by lightweight unit and compatibility runtimes that
    // have no loading manager. Their connection/adapter state remains valid.
    return undefined;
  }
}

function isLoadTrackedStaticServer(declaredServers: DeclaredServers, serverName: string): boolean {
  return Boolean(declaredServers.staticServers[serverName] && !declaredServers.staticServers[serverName].disabled);
}

export async function buildServerSummaries(
  filteredConnections: FilteredConnections,
  toolRegistry: ToolRegistry | undefined,
  capabilityAggregator: CapabilityAggregator | undefined,
  serverRegistry: ServerRegistry,
  instructionAggregator: ReturnType<ServerManager['getInstructionAggregator']>,
  declaredServers: ReturnType<ConfigManager['loadDeclaredServerConfigs']>,
  filterConfig: ReturnType<typeof buildFilterConfig>,
  options: {
    includeTemplateInstances?: boolean;
  } = {},
): Promise<ServerSummary[]> {
  const serverConfigs = getServerTargetConfigs(declaredServers);
  const includeTemplateInstances = options.includeTemplateInstances ?? true;
  const summaryConnections = new Map(
    Array.from(filteredConnections.entries()).filter(([name]) => includeTemplateInstances || !name.includes(':')),
  );
  let toolCountByServer: Record<string, number> = {};

  if (toolRegistry) {
    for (const [serverName, tools] of Object.entries(toolRegistry.groupByServer())) {
      toolCountByServer[serverName] = filterDisabledTools(tools, serverConfigs, serverName).length;
    }
  } else if (capabilityAggregator) {
    for (const tool of capabilityAggregator.getCurrentCapabilities().tools) {
      const sn = readPublicCapabilityRoute(tool)?.server;
      if (sn && !filterDisabledTools([tool], serverConfigs, sn).length) continue;
      if (sn) toolCountByServer[sn] = (toolCountByServer[sn] ?? 0) + 1;
    }
  } else {
    await Promise.all(
      Array.from(summaryConnections.entries()).map(async ([name, connection]) => {
        try {
          const result = await requestLegacyAdapter<{ tools: Tool[] }>(connection.adapter, 'tools/list', undefined, {
            timeoutMs: connection.requestTimeoutMs,
          });
          const cleanName = name.includes(':') ? name.split(':')[0] : name;
          const visibleTools = filterDisabledTools(result.tools ?? [], serverConfigs, cleanName);
          toolCountByServer[cleanName] = Math.max(toolCountByServer[cleanName] ?? 0, visibleTools.length);
        } catch (error) {
          const cleanName = name.includes(':') ? name.split(':')[0] : name;
          logger.warn(`Failed to fetch tool count for server '${cleanName}':`, error);
          toolCountByServer[cleanName] = Math.max(toolCountByServer[cleanName] ?? 0, 0);
        }
      }),
    );
  }

  const serverMap = new Map<string, { toolCount: number; hasInstructions: boolean }>();
  for (const [name] of summaryConnections) {
    const cleanName = name.includes(':') ? name.split(':')[0] : name;
    const toolCount = toolCountByServer[cleanName] ?? toolCountByServer[name] ?? 0;
    const hasInstructions = instructionAggregator?.hasInstructions(cleanName) ?? false;
    const existing = serverMap.get(cleanName);
    if (existing) {
      existing.toolCount = Math.max(existing.toolCount, toolCount);
      existing.hasInstructions = existing.hasInstructions || hasInstructions;
    } else {
      serverMap.set(cleanName, { toolCount, hasInstructions });
    }
  }

  for (const registeredName of serverRegistry.getServerNames()) {
    const adapter = serverRegistry.get(registeredName);
    if (!serverMap.has(registeredName) && matchesFilterConfig(adapter?.config.tags, filterConfig)) {
      serverMap.set(registeredName, {
        toolCount: 0,
        hasInstructions: instructionAggregator?.hasInstructions(registeredName) ?? false,
      });
    }
  }

  for (const [name, config] of Object.entries({
    ...declaredServers.staticServers,
    ...declaredServers.templateServers,
  })) {
    if (!serverMap.has(name) && matchesFilterConfig(config.tags, filterConfig)) {
      serverMap.set(name, {
        toolCount: 0,
        hasInstructions: instructionAggregator?.hasInstructions(name) ?? false,
      });
    }
  }

  const servers: ServerSummary[] = [];
  for (const [cleanName, info] of serverMap) {
    const adapter = serverRegistry.get(cleanName);
    const connection = resolveConnectionByServerName(summaryConnections, cleanName);
    const loadingInfo = getLoadingInfo(cleanName);
    const state = deriveServerState(adapter?.getStatus(), adapter?.isAvailable(), connection, loadingInfo);
    const type = adapter?.type ?? (declaredServers.templateServers[cleanName] ? 'template' : 'external');

    servers.push({
      server: cleanName,
      type: String(type),
      status: state.status,
      available: state.available,
      loadTracked: isLoadTrackedStaticServer(declaredServers, cleanName),
      toolCount: info.toolCount,
      hasInstructions: info.hasInstructions,
    });
  }

  servers.sort((a, b) => a.server.localeCompare(b.server));
  return servers;
}

export function createServersHandler(serverManager: ServerManager): RequestHandler {
  return async (_req: Request, res: Response): Promise<void> => {
    try {
      const filterConfig = buildFilterConfig(res);
      await ensureRequestContextInitialized(serverManager, _req, res, filterConfig);
      const filteredConnections = FilteringService.getFilteredConnections(serverManager.getClients(), filterConfig);
      const lazyOrchestrator = serverManager.getLazyLoadingOrchestrator();
      const declaredServers = ConfigManager.getInstance().loadDeclaredServerConfigs();

      const servers = await buildServerSummaries(
        filteredConnections,
        lazyOrchestrator?.getToolRegistry(),
        lazyOrchestrator?.getCapabilityAggregator(),
        serverManager.getServerRegistry(),
        serverManager.getInstructionAggregator(),
        declaredServers,
        filterConfig,
      );

      const payload: InspectServersPayload = { kind: 'servers', servers };
      res.json(payload);
    } catch (error) {
      logger.error('API servers handler error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

export function createInspectHandler(serverManager: ServerManager): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const targetRaw = typeof req.query.target === 'string' ? req.query.target : undefined;
      const limitParam = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 20;
      const cursorParam = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
      const allParam = req.query.all === 'true' || req.query.all === '1';

      const limit = allParam ? 5000 : Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 20;

      const filterConfig = buildFilterConfig(res);
      const instructionAggregator = serverManager.getInstructionAggregator();
      const declaredServers = ConfigManager.getInstance().loadDeclaredServerConfigs();
      const serverConfigs = getServerTargetConfigs(declaredServers);

      // No target: list all filtered servers
      if (!targetRaw) {
        const filteredConnections = FilteringService.getFilteredConnections(serverManager.getClients(), filterConfig);
        const lazyOrchestrator = serverManager.getLazyLoadingOrchestrator();

        const servers = await buildServerSummaries(
          filteredConnections,
          lazyOrchestrator?.getToolRegistry(),
          lazyOrchestrator?.getCapabilityAggregator(),
          serverManager.getServerRegistry(),
          instructionAggregator,
          declaredServers,
          filterConfig,
          { includeTemplateInstances: false },
        );

        const serverInstructions = Object.fromEntries(
          servers.flatMap((server) => {
            const instructions = instructionAggregator?.getServerInstructions(server.server);
            return instructions ? [[server.server, instructions]] : [];
          }),
        );

        const payload: InspectServersPayload = {
          kind: 'servers',
          servers,
          ...(Object.keys(serverInstructions).length > 0 ? { serverInstructions } : {}),
        };
        res.json(payload);
        return;
      }

      const requestSessionId = await ensureRequestContextInitialized(serverManager, req, res, filterConfig);
      const filteredConnections = FilteringService.getFilteredConnections(serverManager.getClients(), filterConfig);
      const serverRegistry: ServerRegistry = serverManager.getServerRegistry();
      const auth = getAuthInfo(res);
      const selection = {
        destination: 'rest-inspect',
        filterConfig,
        authority: auth
          ? { clientId: auth.clientId, scopes: [...auth.grantedScopes].sort(), tags: [...auth.grantedTags].sort() }
          : undefined,
      };
      const acquireServerSnapshot = async (
        connection: NonNullable<FilteredConnections extends Map<unknown, infer T> ? T : never>,
        serverName: string,
        continuation = false,
      ) => {
        const connections = serverManager.getClients();
        const key = [...connections].find(([, candidate]) => candidate === connection)?.[0];
        if (key === undefined) throw new Error('Tool inventory backend is no longer current');
        const visibility = createCapabilityVisibility([[key, serverName]], requestSessionId, selection);
        return acquireRuntimeCapabilityCatalog(connections, visibility, {
          serverConfigs,
          continuation:
            continuation && cursorParam !== undefined
              ? {
                  kind: 'tools',
                  cursor: cursorParam,
                  enablePagination: !allParam,
                  pageSize: limit,
                  filterSelection: selection,
                }
              : undefined,
        });
      };
      const target = parseTarget(targetRaw);
      if (!target) {
        res.status(400).json({ error: 'Invalid target format. Use <server> or <server>/<tool>.' });
        return;
      }

      // Tool target
      if (target.kind === 'tool') {
        const { serverName, toolName, qualifiedName } = target;
        const disabledError = getDisabledToolError(serverConfigs, serverName, toolName);
        if (disabledError) {
          res.status(404).json({ error: disabledError.message });
          return;
        }

        const filteredConnection = resolveConnectionByServerName(filteredConnections, serverName);
        const sessionConnection = requestSessionId
          ? serverRegistry.resolveConnection(serverName, { sessionId: requestSessionId })
          : undefined;
        const adapter = serverRegistry.get(serverName);
        const declaredConfig = declaredServers.templateServers[serverName] ?? declaredServers.staticServers[serverName];
        const targetAllowed =
          !!filteredConnection ||
          !!sessionConnection ||
          matchesFilterConfig(adapter?.config.tags, filterConfig) ||
          matchesFilterConfig(declaredConfig?.tags, filterConfig);

        if (!targetAllowed) {
          res.status(404).json({ error: `Tool not found: ${targetRaw}` });
          return;
        }

        let found: Tool | undefined;
        const connection = sessionConnection ?? filteredConnection;
        if (connection) {
          try {
            const snapshot = await acquireServerSnapshot(connection, serverName);
            // A failed enumeration must not turn a previously cached schema into a current result.
            await snapshot.list('tools', { enablePagination: false });
            found = snapshot.resolve('tools', qualifiedName)?.entry.publicObject as unknown as Tool | undefined;
          } catch {
            res.status(503).json({ error: 'Tool inventory not available for this server' });
            return;
          }
        }

        if (!found) {
          res.status(404).json({ error: `Tool not found: ${targetRaw}` });
          return;
        }

        const effectiveTool = applyEffectiveToolDescription(
          found,
          serverConfigs[serverName],
          serverName,
        ) as unknown as {
          description?: unknown;
          inputSchema?: unknown;
          outputSchema?: unknown;
        };
        const payload: InspectToolPayload = {
          kind: 'tool',
          server: serverName,
          tool: toolName,
          qualifiedName: found.name === qualifiedName ? qualifiedName : qualifyToolName(serverName, found.name),
          description: typeof effectiveTool.description === 'string' ? effectiveTool.description : undefined,
          inputSchema: (effectiveTool.inputSchema as Record<string, unknown>) ?? {},
          outputSchema: effectiveTool.outputSchema as Record<string, unknown> | undefined,
        };
        res.json(payload);
        return;
      }

      // Server target
      const { serverName } = target;

      const adapter = serverRegistry.get(serverName);
      const sessionConnection = requestSessionId
        ? serverRegistry.resolveConnection(serverName, { sessionId: requestSessionId })
        : undefined;
      const connection = sessionConnection ?? resolveConnectionByServerName(filteredConnections, serverName);
      const declaredTemplateConfig = declaredServers.templateServers[serverName];
      const declaredStaticConfig = declaredServers.staticServers[serverName];

      if (!adapter && !connection && !declaredTemplateConfig && !declaredStaticConfig) {
        res.status(404).json({ error: `Server not found: ${serverName}` });
        return;
      }

      const declaredConfig = declaredTemplateConfig ?? declaredStaticConfig;
      const targetAllowed =
        !!connection ||
        matchesFilterConfig(adapter?.config.tags, filterConfig) ||
        matchesFilterConfig(declaredConfig?.tags, filterConfig);
      if (!targetAllowed) {
        res.status(404).json({ error: `Server not found: ${serverName}` });
        return;
      }

      const loadingInfo = getLoadingInfo(serverName);
      const state = deriveServerState(
        adapter?.getStatus(requestSessionId ? { sessionId: requestSessionId } : undefined),
        adapter?.isAvailable(requestSessionId ? { sessionId: requestSessionId } : undefined),
        connection,
        loadingInfo,
      );
      const type = adapter?.type ?? (declaredTemplateConfig ? 'template' : 'external');
      const instructions = instructionAggregator?.getServerInstructions(serverName) ?? null;
      const loadTracked = isLoadTrackedStaticServer(declaredServers, serverName);

      // Static startup targets remain inspectable before the first atomic
      // capability snapshot. Do not force a direct tools/list call while the
      // loading tracker says the backend is not ready.
      if (declaredStaticConfig && (!connection || (loadingInfo && loadingInfo.state !== LoadingState.Ready))) {
        const payload: InspectServerPayload = {
          kind: 'server',
          server: serverName,
          type: String(type),
          status: state.status,
          available: state.available,
          loadTracked,
          instructions,
          ...(loadingInfo?.authorizationUrl ? { authorizationUrl: loadingInfo.authorizationUrl } : {}),
          ...(loadingInfo?.error ? { error: loadingInfo.error.message } : {}),
          tools: [],
          totalTools: 0,
          hasMore: false,
        };
        res.json(payload);
        return;
      }

      if (!connection) {
        res.status(503).json({ error: `Server '${serverName}' is not currently connected` });
        return;
      }

      let toolsResult: {
        tools: ToolSummary[];
        totalTools: number;
        hasMore: boolean;
        nextCursor?: string;
        _meta?: Record<string, unknown>;
      };

      try {
        const snapshot = await acquireServerSnapshot(connection, serverName, true);
        const page = await snapshot.list<Tool>('tools', {
          cursor: cursorParam,
          enablePagination: !allParam,
          pageSize: limit,
          filterSelection: selection,
        });
        toolsResult = {
          tools: page.items.map(summarizeToolSchema),
          totalTools: snapshot.generation.entries.filter(
            (entry) =>
              entry.route.kind === 'tools' &&
              !isSourceToolDisabled(serverConfigs, serverName, entry.route.upstreamIdentity),
          ).length,
          hasMore: page.nextCursor !== undefined,
          nextCursor: page.nextCursor,
          _meta: page._meta,
        };
      } catch (error) {
        if (error instanceof MCPError && error.code === ErrorCode.InvalidParams) {
          res.status(400).json({ error: error.message, code: error.code, data: error.data });
          return;
        }
        // A failed authoritative inventory cannot become a successful stale or empty view.
        res.status(503).json({ error: 'Tool inventory not available for this server' });
        return;
      }

      const payload: InspectServerPayload = {
        kind: 'server',
        server: serverName,
        type: String(type),
        status: state.status,
        available: state.available,
        loadTracked,
        instructions,
        ...(loadingInfo?.authorizationUrl ? { authorizationUrl: loadingInfo.authorizationUrl } : {}),
        ...(loadingInfo?.error ? { error: loadingInfo.error.message } : {}),
        tools: toolsResult.tools,
        totalTools: toolsResult.totalTools,
        hasMore: toolsResult.hasMore,
        nextCursor: toolsResult.nextCursor,
        ...(toolsResult._meta === undefined ? {} : { _meta: toolsResult._meta }),
      };
      res.json(payload);
    } catch (error) {
      logger.error('API inspect handler error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
