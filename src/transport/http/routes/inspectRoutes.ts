import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { ConfigManager } from '@src/config/configManager.js';
import { McpConfigManager } from '@src/config/mcpConfigManager.js';
import { CapabilityAggregator } from '@src/core/capabilities/capabilityAggregator.js';
import { ToolRegistry } from '@src/core/capabilities/toolRegistry.js';
import { FilteringService } from '@src/core/filtering/filteringService.js';
import { LoadingState, type ServerLoadingInfo } from '@src/core/loading/loadingStateTracker.js';
import { McpLoadingManager } from '@src/core/loading/mcpLoadingManager.js';
import { ServerRegistry } from '@src/core/server/adapters/ServerRegistry.js';
import { ServerType } from '@src/core/server/adapters/types.js';
import type { TemplateHashProvider } from '@src/core/server/connectionResolver.js';
import {
  filterDisabledTools,
  getDisabledToolError,
  getDisabledToolsForServer,
} from '@src/core/server/disabledTools.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import type { OutboundConnection } from '@src/core/types/client.js';
import logger from '@src/logger/logger.js';

import { Request, RequestHandler, Response } from 'express';

import {
  buildFilterConfig,
  deriveServerState,
  getServerName,
  getToolName,
  type InspectServerPayload,
  type InspectServersPayload,
  type InspectToolPayload,
  matchesFilterConfig,
  parseTarget,
  qualifyToolName,
  resolveConnectionByServerName,
  scopeConnectionsToSession,
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
  scopeConnectionsToSession,
};
export type { InspectServerPayload, InspectServersPayload, InspectToolPayload, ServerSummary, ToolSummary };

type FilteredConnections = ReturnType<typeof FilteringService.getFilteredConnections>;
type FilteredConnection = NonNullable<FilteredConnections extends Map<unknown, infer TValue> ? TValue : never>;

interface DirectListToolsResult {
  tools?: Tool[];
  totalCount?: number;
  hasMore?: boolean;
  nextCursor?: string;
}

type DeclaredServers = ReturnType<ConfigManager['loadDeclaredServerConfigs']>;
type ServerConfigMap =
  ReturnType<typeof McpConfigManager.getInstance> extends { getTransportConfig(): infer TResult } ? TResult : never;

async function listDirectServerTools(
  connection: FilteredConnection,
  options: { limit: number; cursor?: string },
): Promise<DirectListToolsResult> {
  const client = connection.client as {
    listTools(args?: { limit?: number; cursor?: string }): Promise<DirectListToolsResult>;
  };

  return client.listTools({
    limit: options.limit,
    cursor: options.cursor,
  });
}

function getServerConfigs() {
  return McpConfigManager.getInstance().getTransportConfig();
}

function getTemplateHashProvider(serverManager: ServerManager): TemplateHashProvider | undefined {
  return (
    serverManager as unknown as { getTemplateServerManager?: () => TemplateHashProvider }
  ).getTemplateServerManager?.();
}

function getScopedConnections(
  serverManager: ServerManager,
  filterConfig: ReturnType<typeof buildFilterConfig>,
  sessionId?: string,
): FilteredConnections {
  const getClients = (serverManager as { getClients?: () => ReturnType<ServerManager['getClients']> }).getClients;
  const sessionScoped = scopeConnectionsToSession(
    typeof getClients === 'function' ? getClients.call(serverManager) : new Map<string, OutboundConnection>(),
    sessionId,
    getTemplateHashProvider(serverManager),
  );
  return FilteringService.getFilteredConnections(sessionScoped, filterConfig);
}

function isTemplateConnection(connectionKey: string): boolean {
  return connectionKey.includes(':');
}

function findConnectionEntry(
  connections: FilteredConnections,
  serverName: string,
): [string, FilteredConnection] | undefined {
  const direct = connections.get(serverName);
  if (direct) return [serverName, direct];

  for (const [connectionKey, connection] of connections) {
    if (connectionKey.split(':')[0] === serverName || connection.name === serverName) {
      return [connectionKey, connection];
    }
  }

  return undefined;
}

function getScopedInstructions(
  serverName: string,
  connectionKey: string | undefined,
  connection: FilteredConnection | undefined,
  instructionAggregator: ReturnType<ServerManager['getInstructionAggregator']>,
): string | null {
  if (connection?.instructions?.trim()) {
    return connection.instructions;
  }

  return connectionKey && isTemplateConnection(connectionKey)
    ? null
    : instructionAggregator?.getServerInstructions(serverName) ?? null;
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

function hasDisabledTools(serverConfigs: ServerConfigMap, serverName: string): boolean {
  return getDisabledToolsForServer(serverConfigs, serverName).length > 0;
}

function summarizeRegistryTools(tools: ReturnType<ToolRegistry['listTools']>['tools']): ToolSummary[] {
  return tools.map((tool) => ({
    tool: getToolName(tool.name),
    qualifiedName: tool.name,
    description: tool.description,
    requiredArgs: 0,
    optionalArgs: 0,
  }));
}

function buildRegistryToolsResult(
  serverName: string,
  result: ReturnType<ToolRegistry['listTools']>,
  serverConfigs: ServerConfigMap,
): { tools: ToolSummary[]; totalTools: number; hasMore: boolean; nextCursor?: string } {
  const filteredTools = filterDisabledTools(result.tools, serverConfigs, serverName);
  const disabledToolsConfigured = hasDisabledTools(serverConfigs, serverName);

  return {
    tools: summarizeRegistryTools(filteredTools),
    totalTools: disabledToolsConfigured ? filteredTools.length : result.totalCount,
    hasMore: disabledToolsConfigured ? false : result.hasMore,
    nextCursor: disabledToolsConfigured ? undefined : result.nextCursor,
  };
}

function buildDirectToolsResult(
  serverName: string,
  directResult: DirectListToolsResult,
  serverConfigs: ServerConfigMap,
): { tools: ToolSummary[]; totalTools: number; hasMore: boolean; nextCursor?: string } {
  const rawTools = directResult.tools ?? [];
  const directTools = filterDisabledTools(rawTools, serverConfigs, serverName);
  const disabledToolsConfigured = hasDisabledTools(serverConfigs, serverName);

  return {
    tools: directTools.map((tool) => summarizeDirectServerTool(serverName, tool)),
    totalTools: disabledToolsConfigured ? directTools.length : (directResult.totalCount ?? directTools.length),
    hasMore: disabledToolsConfigured ? false : (directResult.hasMore ?? Boolean(directResult.nextCursor)),
    nextCursor: disabledToolsConfigured ? undefined : directResult.nextCursor,
  };
}

async function buildServerSummaries(
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
  const visibleConnectionKeys = new Set(summaryConnections.keys());
  const visibleServerNames = new Set(
    Array.from(summaryConnections.entries(), ([connectionKey, connection]) => connection.name || connectionKey.split(':')[0]),
  );
  const visibleTemplateServerNames = new Set(
    Array.from(summaryConnections.entries())
      .filter(([connectionKey]) => isTemplateConnection(connectionKey))
      .map(([connectionKey, connection]) => connection.name || connectionKey.split(':')[0]),
  );
  let toolCountByServer: Record<string, number> = {};

  if (toolRegistry) {
    for (const [serverName, tools] of Object.entries(toolRegistry.groupByServer())) {
      if (visibleTemplateServerNames.has(serverName)) continue;
      const visibleTools = tools.filter(
        (tool) =>
          (tool.connectionKey ? visibleConnectionKeys.has(tool.connectionKey) : visibleServerNames.has(serverName)),
      );
      toolCountByServer[serverName] = filterDisabledTools(visibleTools, serverConfigs, serverName).length;
    }
  } else if (capabilityAggregator) {
    for (const tool of capabilityAggregator.getCurrentCapabilities().tools) {
      const sn = getServerName(tool.name);
      if (sn && visibleTemplateServerNames.has(sn)) continue;
      if (sn && !filterDisabledTools([tool], serverConfigs, sn).length) continue;
      if (sn) toolCountByServer[sn] = (toolCountByServer[sn] ?? 0) + 1;
    }
  }

  if (!toolRegistry && !capabilityAggregator || visibleTemplateServerNames.size > 0) {
    const directConnections = Array.from(summaryConnections.entries()).filter(
      ([connectionKey]) => !toolRegistry && !capabilityAggregator || isTemplateConnection(connectionKey),
    );
    await Promise.all(
      directConnections.map(async ([name, connection]) => {
        if (!connection.client) return;
        try {
          const result = await connection.client.listTools();
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
  for (const [name, connection] of summaryConnections) {
    const cleanName = name.includes(':') ? name.split(':')[0] : name;
    const toolCount = toolCountByServer[cleanName] ?? toolCountByServer[name] ?? 0;
    const hasInstructions = Boolean(connection.instructions?.trim()) ||
      (!isTemplateConnection(name) && (instructionAggregator?.hasInstructions(cleanName) ?? false));
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
    if (adapter?.type === ServerType.Template && !visibleServerNames.has(registeredName)) continue;
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
    if (declaredServers.templateServers[name] && !visibleServerNames.has(name)) continue;
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
      const requestSessionId = await ensureRequestContextInitialized(serverManager, _req, res, filterConfig);
      const filteredConnections = getScopedConnections(serverManager, filterConfig, requestSessionId);
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
      const requestSessionId = await ensureRequestContextInitialized(serverManager, req, res, filterConfig);
      const filteredConnections = getScopedConnections(serverManager, filterConfig, requestSessionId);

      // No target: list all filtered servers
      if (!targetRaw) {
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
            const connectionEntry = findConnectionEntry(filteredConnections, server.server);
            const instructions = getScopedInstructions(
              server.server,
              connectionEntry?.[0],
              connectionEntry?.[1],
              instructionAggregator,
            );
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

      const lazyOrchestrator = serverManager.getLazyLoadingOrchestrator();
      const toolRegistry: ToolRegistry | undefined = lazyOrchestrator?.getToolRegistry();
      const capabilityAggregator: CapabilityAggregator | undefined = lazyOrchestrator?.getCapabilityAggregator();
      const serverRegistry: ServerRegistry = serverManager.getServerRegistry();
      const target = parseTarget(targetRaw);
      if (!target) {
        res.status(400).json({ error: 'Invalid target format. Use <server> or <server>/<tool>.' });
        return;
      }

      // Tool target
      if (target.kind === 'tool') {
        const { serverName, toolName, qualifiedName } = target;
        const connectionEntry = findConnectionEntry(filteredConnections, serverName);
        const connection = connectionEntry?.[1];
        const adapter = serverRegistry.get(serverName);
        const declaredTemplateConfig = declaredServers.templateServers[serverName];
        const declaredConfig = declaredTemplateConfig ?? declaredServers.staticServers[serverName];
        const templateTarget = adapter?.type === ServerType.Template || Boolean(declaredTemplateConfig);

        // Template metadata is owned by a session. Do this check before any
        // global capability snapshot or instruction lookup can reveal it.
        if (templateTarget && !connection) {
          res.status(404).json({ error: `Tool not found: ${targetRaw}` });
          return;
        }

        const targetAllowed =
          !!connection ||
          (!templateTarget &&
            (matchesFilterConfig(adapter?.config.tags, filterConfig) || matchesFilterConfig(declaredConfig?.tags, filterConfig)));

        if (!targetAllowed) {
          res.status(404).json({ error: `Tool not found: ${targetRaw}` });
          return;
        }

        const disabledError = getDisabledToolError(serverConfigs, serverName, toolName);
        if (disabledError) {
          res.status(404).json({ error: disabledError.message });
          return;
        }

        let found: import('@modelcontextprotocol/sdk/types.js').Tool | undefined;

        if (capabilityAggregator && !templateTarget) {
          found = capabilityAggregator
            .getCurrentCapabilities()
            .tools.find((t) => t.name === qualifiedName && getServerName(t.name) === serverName);
        }

        if (!found) {
          if (connection?.client) {
            try {
              const result = await connection.client.listTools();
              found = filterDisabledTools(result.tools ?? [], serverConfigs, serverName).find(
                (t) => t.name === qualifiedName || t.name === toolName,
              );
            } catch (error) {
              logger.warn(`Failed to list tools for server '${serverName}' while resolving tool '${toolName}':`, error);
            }
          }
        }

        if (!found) {
          res.status(404).json({ error: `Tool not found: ${targetRaw}` });
          return;
        }

        const payload: InspectToolPayload = {
          kind: 'tool',
          server: serverName,
          tool: toolName,
          qualifiedName: found.name === qualifiedName ? qualifiedName : qualifyToolName(serverName, found.name),
          description: found.description,
          inputSchema: (found.inputSchema as Record<string, unknown>) ?? {},
          outputSchema: found.outputSchema as Record<string, unknown> | undefined,
        };
        res.json(payload);
        return;
      }

      // Server target
      const { serverName } = target;

      const adapter = serverRegistry.get(serverName);
      const connectionEntry = findConnectionEntry(filteredConnections, serverName);
      const connectionKey = connectionEntry?.[0];
      const connection = connectionEntry?.[1];
      const declaredTemplateConfig = declaredServers.templateServers[serverName];
      const declaredStaticConfig = declaredServers.staticServers[serverName];
      const templateTarget = adapter?.type === ServerType.Template || Boolean(declaredTemplateConfig);

      if (templateTarget && !connection) {
        res.status(404).json({ error: `Server not found: ${serverName}` });
        return;
      }

      if (!adapter && !connection && !declaredTemplateConfig && !declaredStaticConfig) {
        res.status(404).json({ error: `Server not found: ${serverName}` });
        return;
      }

      const declaredConfig = declaredTemplateConfig ?? declaredStaticConfig;
      const targetAllowed =
        !!connection ||
        (!templateTarget &&
          (matchesFilterConfig(adapter?.config.tags, filterConfig) || matchesFilterConfig(declaredConfig?.tags, filterConfig)));
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
      const instructions = getScopedInstructions(serverName, connectionKey, connection, instructionAggregator);
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

      let toolsResult: { tools: ToolSummary[]; totalTools: number; hasMore: boolean; nextCursor?: string };

      if (toolRegistry) {
        try {
          const directResult = await listDirectServerTools(connection, { limit, cursor: cursorParam });
          toolsResult = buildDirectToolsResult(serverName, directResult, serverConfigs);
        } catch {
          if (templateTarget) {
            res.status(503).json({ error: 'Tool inventory not available for this server' });
            return;
          }
          const result = toolRegistry.listTools({ server: serverName, limit, cursor: cursorParam });
          toolsResult = buildRegistryToolsResult(serverName, result, serverConfigs);
        }
      } else if (capabilityAggregator) {
        if (templateTarget) {
          try {
            const directResult = await listDirectServerTools(connection, { limit, cursor: cursorParam });
            toolsResult = buildDirectToolsResult(serverName, directResult, serverConfigs);
          } catch {
            res.status(503).json({ error: 'Tool inventory not available for this server' });
            return;
          }
        } else {
          const capTools = filterDisabledTools(
            capabilityAggregator.getCurrentCapabilities().tools.filter((t) => getServerName(t.name) === serverName),
            serverConfigs,
            serverName,
          );
          toolsResult = {
            tools: capTools.map(summarizeToolSchema),
            totalTools: capTools.length,
            hasMore: false,
          };
        }
      } else {
        try {
          const directResult = await listDirectServerTools(connection, { limit, cursor: cursorParam });
          toolsResult = buildDirectToolsResult(serverName, directResult, serverConfigs);
        } catch {
          res.status(503).json({ error: 'Tool inventory not available for this server' });
          return;
        }
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
      };
      res.json(payload);
    } catch (error) {
      logger.error('API inspect handler error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
