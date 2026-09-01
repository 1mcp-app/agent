import { getConfiguredServerTargets } from '@src/config/configuredServerTargets.js';
import { CapabilityCatalog } from '@src/core/capabilities/capabilityCatalog.js';
import {
  type CapabilityVisibility,
  createCapabilityVisibility,
  getCapabilityVisibleServerNames,
} from '@src/core/capabilities/capabilityVisibility.js';
import { ToolInvokeOutput, ToolListOutput } from '@src/core/capabilities/schemas/metaToolSchemas.js';
import { ToolRegistry } from '@src/core/capabilities/toolRegistry.js';
import { requestLegacyAdapter } from '@src/core/client/legacyAdapterRequest.js';
import { FilteringService } from '@src/core/filtering/filteringService.js';
import { type ServerAdapter, ServerType } from '@src/core/server/adapters/types.js';
import { createConnectionResolver, type TemplateHashProvider } from '@src/core/server/connectionResolver.js';
import { getDisabledToolError } from '@src/core/server/disabledTools.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { ClientStatus, type OutboundConnection } from '@src/core/types/client.js';
import logger from '@src/logger/logger.js';
import { CONTEXT_HEADERS } from '@src/transport/http/utils/contextExtractor.js';

import { Request, RequestHandler, Response } from 'express';

import {
  buildFilterConfig,
  ensureRequestContextInitialized,
  parseTarget,
  resolveConnectionByServerName,
} from './inspectRoutes.js';

type Tool = Parameters<typeof ToolRegistry.fromToolsWithServer>[0][number]['tool'];

function getServerConfigs() {
  return getConfiguredServerTargets();
}

function getCapabilityVisibilityFromRequest(
  serverManager: ServerManager,
  res: Response,
  sessionId?: string,
): CapabilityVisibility | undefined {
  const filterConfig = buildFilterConfig(res);
  const hasFilterSelection =
    filterConfig.tagFilterMode !== 'none' || (filterConfig.tags !== undefined && filterConfig.tags.length > 0);
  if (!hasFilterSelection && !sessionId) {
    return undefined;
  }
  const getClients = (serverManager as { getClients?: () => ReturnType<ServerManager['getClients']> }).getClients;
  if (typeof getClients !== 'function') {
    return sessionId ? createCapabilityVisibility([], sessionId) : undefined;
  }
  const allConnections = getClients.call(serverManager);
  const sessionScoped = createConnectionResolver(
    allConnections,
    getTemplateHashProvider(serverManager),
  ).filterForSession(sessionId);
  const filteredConnections = hasFilterSelection
    ? FilteringService.getFilteredConnections(sessionScoped, filterConfig)
    : sessionScoped;
  return createCapabilityVisibility(
    Array.from(filteredConnections.entries(), ([connectionKey, connection]) => {
      const publicServerName = connection.name || connectionKey.split(':')[0];
      return [connectionKey, publicServerName] as const;
    }),
    sessionId,
  );
}

function getTemplateHashProvider(serverManager: ServerManager): TemplateHashProvider | undefined {
  return (
    serverManager as unknown as { getTemplateServerManager?: () => TemplateHashProvider }
  ).getTemplateServerManager?.();
}

interface ServerRegistryLike {
  get?: (name: string) => ServerAdapter | undefined;
  resolveConnection?: (name: string, context?: { sessionId?: string }) => unknown;
}

function getServerRegistry(serverManager: ServerManager): ServerRegistryLike | undefined {
  return (serverManager as { getServerRegistry?: () => ServerRegistryLike }).getServerRegistry?.();
}

function isTemplateTarget(serverManager: ServerManager, serverName: string): boolean {
  return getServerRegistry(serverManager)?.get?.(serverName)?.type === ServerType.Template;
}

function getDisabledToolInvocationError(serverName: string, toolName: string): string | undefined {
  return getDisabledToolError(getServerConfigs(), serverName, toolName)?.message;
}

async function createFallbackCapabilityCatalog(
  serverManager: ServerManager,
): Promise<{ catalog: CapabilityCatalog; degradedServers: string[] }> {
  const clients = serverManager.getClients();
  const registryTools: Array<{ tool: Tool; server: string; connectionKey: string; tags: string[] }> = [];
  const degradedServers: string[] = [];

  for (const [connectionKey, conn] of clients) {
    if (conn.status !== ClientStatus.Connected) continue;
    try {
      const logicalServerName =
        conn.name || (connectionKey.includes(':') ? connectionKey.split(':')[0] : connectionKey);
      const result = await requestLegacyAdapter<{ tools: Tool[] }>(conn.adapter, 'tools/list', undefined, {
        timeoutMs: conn.requestTimeoutMs,
      });
      const tags = conn.tags;
      registryTools.push(
        ...(result.tools ?? []).map((tool) => ({ tool, server: logicalServerName, connectionKey, tags })),
      );
    } catch (err) {
      logger.error(`Failed to list tools for ${connectionKey}:`, err);
      degradedServers.push(connectionKey);
    }
  }

  const catalog = new CapabilityCatalog({
    getToolRegistry: () => ToolRegistry.fromToolsWithServer(registryTools),
    schemaCache: {
      getIfCached: () => null,
      getOrLoad: async (_server: string, _toolName: string) => {
        throw new Error('Schema loading is not available without lazy loading');
      },
    } as never,
    outboundConnections: clients,
    getServerConfigs,
    templateHashProvider: getTemplateHashProvider(serverManager),
  });
  return { catalog, degradedServers };
}

function hasCatalogAccess(lazyOrchestrator: unknown): lazyOrchestrator is {
  getToolRegistry: () => ToolRegistry;
  getSchemaCache: () => never;
  callMetaTool: (...args: never[]) => Promise<unknown>;
} {
  return (
    !!lazyOrchestrator &&
    typeof (lazyOrchestrator as { getToolRegistry?: unknown }).getToolRegistry === 'function' &&
    typeof (lazyOrchestrator as { getSchemaCache?: unknown }).getSchemaCache === 'function'
  );
}

export function createToolsHandler(serverManager: ServerManager): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const server = typeof req.query.server === 'string' ? req.query.server : undefined;
      const pattern = typeof req.query.pattern === 'string' ? req.query.pattern : undefined;
      const limitParam = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;
      const limit = limitParam !== undefined && Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined;

      const requestSessionId = await initializeRequestContextForApi(serverManager, req, res);
      const visibility = getCapabilityVisibilityFromRequest(serverManager, res, requestSessionId);
      const lazyOrchestrator = serverManager.getLazyLoadingOrchestrator();

      if (!lazyOrchestrator) {
        const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
        const { catalog, degradedServers } = await createFallbackCapabilityCatalog(serverManager);
        const result = await catalog.listVisibleTools(
          {
            server,
            pattern,
            limit,
            cursor,
          },
          visibility,
        );

        res.json({
          tools: result.tools,
          totalCount: result.totalCount,
          hasMore: result.hasMore,
          ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
          servers: result.servers,
          ...(degradedServers.length > 0 ? { degradedServers } : {}),
        });
        return;
      }

      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
      if (hasCatalogAccess(lazyOrchestrator)) {
        const catalog = new CapabilityCatalog({
          getToolRegistry: () => lazyOrchestrator.getToolRegistry(),
          schemaCache: lazyOrchestrator.getSchemaCache(),
          outboundConnections: serverManager.getClients(),
          getServerConfigs,
          templateHashProvider: getTemplateHashProvider(serverManager),
        });
        const catalogResult = await catalog.listVisibleTools(
          {
            server,
            pattern,
            limit,
            cursor,
          },
          visibility,
        );
        if (catalogResult.tools.length > 0 || catalogResult.totalCount > 0) {
          res.json({
            tools: catalogResult.tools,
            totalCount: catalogResult.totalCount,
            hasMore: catalogResult.hasMore,
            ...(catalogResult.nextCursor ? { nextCursor: catalogResult.nextCursor } : {}),
            servers: catalogResult.servers,
          });
          return;
        }
      }

      const result = (await lazyOrchestrator.callMetaTool(
        'tool_list',
        {
          server,
          pattern,
          limit,
          cursor,
        },
        visibility,
      )) as ToolListOutput;

      if (result.error) {
        const status = result.error.type === 'validation' ? 400 : result.error.type === 'not_found' ? 404 : 500;
        res.status(status).json({ error: result.error.message });
        return;
      }

      res.json(result);
    } catch (error) {
      logger.error('API tools handler error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

export function createToolInvocationsHandler(serverManager: ServerManager): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const requestSessionId = await initializeRequestContextForApi(serverManager, req, res);
      const body = req.body as unknown;
      if (
        !body ||
        typeof body !== 'object' ||
        !('tool' in body) ||
        typeof (body as Record<string, unknown>).tool !== 'string'
      ) {
        res.status(400).json({ error: 'Request body must include a "tool" field as a string.' });
        return;
      }

      const toolRef = (body as Record<string, unknown>).tool as string;
      const args = (body as Record<string, unknown>).args;
      const toolArgs =
        args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {};

      const target = parseTarget(toolRef);
      if (!target || target.kind !== 'tool') {
        res.status(400).json({ error: 'Invalid tool reference. Use "server/tool" format.' });
        return;
      }

      const visibility = getCapabilityVisibilityFromRequest(serverManager, res, requestSessionId);
      const visibleServerNames = visibility ? getCapabilityVisibleServerNames(visibility) : undefined;
      const filterConfig = buildFilterConfig(res);
      const hasFilterSelection =
        filterConfig.tagFilterMode !== 'none' || (filterConfig.tags !== undefined && filterConfig.tags.length > 0);

      const lazyOrchestrator = serverManager.getLazyLoadingOrchestrator();

      if (!lazyOrchestrator) {
        if (hasFilterSelection && visibleServerNames && !visibleServerNames.has(target.serverName)) {
          res.status(404).json({ error: `Server not found: ${target.serverName}` });
          return;
        }
        const disabledToolError = getDisabledToolInvocationError(target.serverName, target.toolName);
        if (disabledToolError) {
          res.status(404).json({ error: disabledToolError });
          return;
        }
        const allConnections = serverManager.getClients();
        const filteredConnections = FilteringService.getFilteredConnections(allConnections, buildFilterConfig(res));
        const serverRegistry = getServerRegistry(serverManager);
        const sessionConnection = requestSessionId
          ? serverRegistry?.resolveConnection?.(target.serverName, { sessionId: requestSessionId })
          : undefined;
        const allowGenericFallback = !requestSessionId || !isTemplateTarget(serverManager, target.serverName);
        const connection = (sessionConnection ??
          (allowGenericFallback ? resolveConnectionByServerName(filteredConnections, target.serverName) : undefined) ??
          (allowGenericFallback ? serverManager.getClient(target.serverName) : undefined)) as
          OutboundConnection | undefined;
        if (!connection || connection.status !== ClientStatus.Connected) {
          res.status(503).json({ error: `Server not connected: ${target.serverName}` });
          return;
        }
        try {
          const upstreamResult = await requestLegacyAdapter(connection.adapter, 'tools/call', {
            name: target.toolName,
            arguments: toolArgs as never,
          });
          res.json({ result: upstreamResult, server: target.serverName, tool: target.toolName });
        } catch (error) {
          logger.error('Direct tool invocation error:', error);
          const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Upstream error';
          res.status(502).json({ error: `Upstream error: ${message}` });
        }
        return;
      }

      if (!hasFilterSelection || !visibleServerNames || visibleServerNames.has(target.serverName)) {
        const disabledToolError = getDisabledToolInvocationError(target.serverName, target.toolName);
        if (disabledToolError) {
          res.status(404).json({ error: disabledToolError });
          return;
        }
      }

      if (hasCatalogAccess(lazyOrchestrator)) {
        const catalog = new CapabilityCatalog({
          getToolRegistry: () => lazyOrchestrator.getToolRegistry(),
          schemaCache: lazyOrchestrator.getSchemaCache(),
          outboundConnections: serverManager.getClients(),
          getServerConfigs,
          templateHashProvider: getTemplateHashProvider(serverManager),
        });
        const catalogResult = await catalog.invokeVisibleTool(
          { server: target.serverName, toolName: target.toolName, args: toolArgs },
          visibility,
        );
        if (!catalogResult.error) {
          res.json({ result: catalogResult.result, server: catalogResult.server, tool: catalogResult.tool });
          return;
        }
        if (catalogResult.error.message.includes('Tool is disabled')) {
          res.status(404).json({ error: catalogResult.error.message });
          return;
        }
      }

      const result = (await lazyOrchestrator.callMetaTool(
        'tool_invoke',
        {
          server: target.serverName,
          toolName: target.toolName,
          args: toolArgs,
        },
        visibility,
      )) as ToolInvokeOutput;

      if (result.error) {
        let status: number;
        if (result.error.type === 'validation') {
          status = 400;
        } else if (result.error.type === 'not_found') {
          status = 404;
        } else if (result.error.type === 'upstream' && result.error.message.toLowerCase().includes('not connected')) {
          status = 503;
        } else if (result.error.type === 'upstream') {
          status = 502;
        } else {
          status = 500;
        }
        res.status(status).json({ error: result.error.message });
        return;
      }

      res.json(result);
    } catch (error) {
      logger.error('API tool-invocations handler error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

async function initializeRequestContextForApi(
  serverManager: ServerManager,
  req: Request,
  res: Response,
): Promise<string | undefined> {
  const filterConfig = buildFilterConfig(res);
  const result = await ensureRequestContextInitialized(serverManager, req, res, filterConfig);
  if (result) {
    return result;
  }

  const headerSessionId = req.headers?.[CONTEXT_HEADERS.SESSION_ID];
  return Array.isArray(headerSessionId) ? headerSessionId[0] : headerSessionId;
}
