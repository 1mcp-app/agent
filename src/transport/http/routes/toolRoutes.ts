import {
  admitBackendPreparationTool,
  revalidatePreparationAuthentication,
} from '@src/application/backendPreparationAdmission.js';
import { getConfiguredServerTargets } from '@src/config/configuredServerTargets.js';
import { CapabilityCatalog } from '@src/core/capabilities/capabilityCatalog.js';
import {
  type CapabilityVisibility,
  createCapabilityVisibility,
  getCapabilityVisibleServerNames,
} from '@src/core/capabilities/capabilityVisibility.js';
import { acquireRuntimeCapabilityCatalog } from '@src/core/capabilities/runtimeCapabilityCatalog.js';
import { ToolInvokeOutput, ToolListOutput } from '@src/core/capabilities/schemas/metaToolSchemas.js';
import { ToolRegistry } from '@src/core/capabilities/toolRegistry.js';
import { requestLegacyAdapter } from '@src/core/client/legacyAdapterRequest.js';
import { FilteringService } from '@src/core/filtering/filteringService.js';
import { type ServerAdapter, ServerType } from '@src/core/server/adapters/types.js';
import { createConnectionResolver, type TemplateHashProvider } from '@src/core/server/connectionResolver.js';
import { getDisabledToolError } from '@src/core/server/disabledTools.js';
import { runtimeAdmission, RuntimeDrainingError } from '@src/core/server/runtimeDrain.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { ClientStatus, type OutboundConnection } from '@src/core/types/client.js';
import { SchemaBoundaryError } from '@src/core/validation/schemaPolicy.js';
import { schemaInputErrorResult } from '@src/core/validation/toolSchemaBoundary.js';
import { isProjectBackendVisible } from '@src/domains/project-selection/projectPolicy.js';
import { requireProjectTarget } from '@src/domains/project-selection/projectSelection.js';
import {
  createGatewayFailure,
  gatewayFailureFromUnknown,
  gatewayFailureToProblem,
} from '@src/gateway/contracts/gatewayFailure.js';
import logger from '@src/logger/logger.js';
import {
  getAuthInfo,
  getTagFilterMode,
  revalidateAuthInfo,
} from '@src/transport/http/middlewares/scopeAuthMiddleware.js';
import { CONTEXT_HEADERS } from '@src/transport/http/utils/contextExtractor.js';

import { Request, RequestHandler, Response } from 'express';
import { z } from 'zod';

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
  const manager = serverManager.getTemplateServerManager?.();
  const projectContext = sessionId ? manager?.getBindingContext?.(sessionId) : undefined;
  const policies = sessionId ? (manager?.getBindingPolicies?.(sessionId) ?? []) : [];
  return {
    ...createCapabilityVisibility(
      Array.from(filteredConnections.entries())
        .filter(([, connection]) =>
          isProjectBackendVisible(getServerConfigs()[connection.name], projectContext, policies),
        )
        .map(([connectionKey, connection]) => {
          const publicServerName = connection.name || connectionKey.split(':')[0];
          return [connectionKey, publicServerName] as const;
        }),
      sessionId,
    ),
    ...(projectContext ? { projectContext } : {}),
  };
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
    } catch (_err) {
      logger.error('toolRoutes.failed.to.list.tools.736c81c7', { error: _err });
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
  refreshCapabilities?: () => Promise<void>;
  refreshCapabilitiesForRecovery?: () => Promise<void>;
} {
  return (
    !!lazyOrchestrator &&
    typeof (lazyOrchestrator as { getToolRegistry?: unknown }).getToolRegistry === 'function' &&
    typeof (lazyOrchestrator as { getSchemaCache?: unknown }).getSchemaCache === 'function'
  );
}

function recoveryRefreshCallback(orchestrator: {
  refreshCapabilitiesForRecovery?: () => Promise<unknown>;
  refreshCapabilities?: () => Promise<unknown>;
}): (() => Promise<void>) | undefined {
  if (orchestrator.refreshCapabilitiesForRecovery) {
    return async () => {
      await orchestrator.refreshCapabilitiesForRecovery!();
    };
  }
  if (orchestrator.refreshCapabilities) {
    return async () => {
      await orchestrator.refreshCapabilities!();
    };
  }
  return undefined;
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
          ...(result._meta ? { _meta: result._meta } : {}),
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
          refreshCapabilities: recoveryRefreshCallback(lazyOrchestrator),
        });
        const catalogResult = await catalog.listVisibleTools(
          {
            server,
            pattern,
            limit,
            cursor,
          },
          visibility,
          !cursor && (await catalog.requiresToolListingRecovery(visibility)) ? { refreshIntent: 'force' } : {},
        );
        if (catalogResult.tools.length > 0 || catalogResult.totalCount > 0 || catalogResult._meta) {
          res.json({
            tools: catalogResult.tools,
            totalCount: catalogResult.totalCount,
            hasMore: catalogResult.hasMore,
            ...(catalogResult.nextCursor ? { nextCursor: catalogResult.nextCursor } : {}),
            ...(catalogResult._meta ? { _meta: catalogResult._meta } : {}),
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
        let status = 500;
        if (result.error.type === 'validation') {
          status = 400;
        } else if (result.error.type === 'not_found') {
          status = 404;
        }
        res.status(status).json({ error: result.error.message });
        return;
      }

      res.json(result);
    } catch (_error) {
      logger.error('toolRoutes.api.tools.handler.error.92efa583', { error: _error });
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

const toolInvocationBodySchema = z.object({
  tool: z.string(),
  args: z.record(z.string(), z.unknown()).optional(),
});

export function createToolInvocationsHandler(serverManager: ServerManager): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      return await runtimeAdmission.run(() => invoke(req, res));
    } catch (error) {
      if (!(error instanceof RuntimeDrainingError)) throw error;
      res.setHeader('Retry-After', '1');
      res.status(503).json({ error: error.message, retryable: true });
    }
  };

  async function invoke(req: Request, res: Response): Promise<void> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    req.once?.('aborted', abort);
    res.once?.('close', abort);
    try {
      const parsed = toolInvocationBodySchema.safeParse(req.body);
      if (!parsed.success) {
        const error =
          parsed.error.issues[0]?.path[0] === 'args'
            ? 'Tool arguments must be an object'
            : 'Request body must include a "tool" field as a string.';
        res.status(400).json({ error });
        return;
      }
      const { tool: toolRef, args: toolArgs = {} } = parsed.data;
      const requestSessionId = await initializeRequestContextForApi(serverManager, req, res);

      const target = parseTarget(toolRef);
      if (!target || target.kind !== 'tool') {
        res.status(400).json({ error: 'Invalid tool reference. Use "server/tool" format.' });
        return;
      }

      const projectContext = requestSessionId
        ? serverManager.getTemplateServerManager?.().getBindingContext?.(requestSessionId)
        : undefined;
      const targetConfig = getServerConfigs()[target.serverName];
      if (projectContext) {
        try {
          requireProjectTarget(
            projectContext,
            targetConfig?.projectTarget?.mode ??
              (isTemplateTarget(serverManager, target.serverName) ? 'single' : 'independent'),
          );
        } catch (error) {
          res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
          return;
        }
      }

      const visibility = getCapabilityVisibilityFromRequest(serverManager, res, requestSessionId);
      const visibleServerNames = visibility ? getCapabilityVisibleServerNames(visibility) : undefined;
      const filterConfig = buildFilterConfig(res);
      const hasFilterSelection =
        filterConfig.tagFilterMode !== 'none' || (filterConfig.tags !== undefined && filterConfig.tags.length > 0);

      const lazyOrchestrator = serverManager.getLazyLoadingOrchestrator();

      const auth = getAuthInfo(res);
      const rawOwner = req.headers?.[CONTEXT_HEADERS.SESSION_ID];
      const ownerSessionId = Array.isArray(rawOwner) ? rawOwner[0] : rawOwner;
      let preparation;
      try {
        preparation = await admitBackendPreparationTool({
          serverManager,
          bindingId: requestSessionId,
          ownerSessionId,
          filterConfig: { ...filterConfig, projectFilterMode: getTagFilterMode(res) },
          authentication: auth
            ? [auth.clientId, auth.token, [...auth.grantedScopes].sort(), [...auth.grantedTags].sort()]
            : undefined,
          revalidateAuth: () => revalidatePreparationAuthentication(auth, () => revalidateAuthInfo(auth)),
          request: { name: target.qualifiedName, arguments: toolArgs },
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof SchemaBoundaryError && error.code === 'schema_input_invalid') {
          res.json({ result: schemaInputErrorResult(), server: target.serverName, tool: target.toolName });
          return;
        }
        throw error;
      }

      if (preparation.kind === 'blocked') {
        res.json({ result: preparation.result, server: target.serverName, tool: target.toolName });
        return;
      }
      if (preparation.kind === 'ready' && !(await preparation.revalidate())) {
        res.status(401).json({ error: 'Preparation authorization changed' });
        return;
      }

      if (!lazyOrchestrator) {
        if (visibleServerNames && !visibleServerNames.has(target.serverName)) {
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
          const catalogConnections = Array.from(allConnections.values()).includes(connection)
            ? allConnections
            : new Map([[`\0app.1mcp/resolved/${target.serverName}`, connection]]);
          const snapshot = await acquireRuntimeCapabilityCatalog(
            catalogConnections,
            {
              ...createCapabilityVisibility(
                Array.from(catalogConnections)
                  .filter(([, candidate]) => candidate === connection)
                  .map(([key]) => [key, target.serverName] as const),
                requestSessionId,
              ),
              ...(projectContext ? { projectContext } : {}),
            },
            { serverConfigs: getServerConfigs(), signal: controller.signal },
          );
          const resolved = snapshot.resolve('tools', target.qualifiedName);
          if (!resolved?.connection) {
            res.status(404).json({ error: `Tool not found: ${toolRef}` });
            return;
          }
          const adapter = resolved.connection.adapter;
          const validateOutput = await snapshot.prepareToolCall(target.qualifiedName, toolArgs, controller.signal);
          if (resolved.connection.adapter !== adapter || !snapshot.isCurrent())
            throw new SchemaBoundaryError('schema_evaluation_unavailable', true);
          const disabled = getDisabledToolInvocationError(target.serverName, target.toolName);
          if (disabled) {
            res.status(404).json({ error: disabled });
            return;
          }
          validateOutput.assertCurrent();
          if (preparation.kind === 'ready') {
            const decision = await preparation.beforeDispatch();
            if (decision === false) throw new SchemaBoundaryError('schema_evaluation_unavailable', true);
            if (typeof decision === 'object' && 'result' in decision) {
              res.json({ result: decision.result, server: target.serverName, tool: target.toolName });
              return;
            }
            if (typeof decision === 'object' && 'assertCurrent' in decision && !decision.assertCurrent())
              throw new SchemaBoundaryError('schema_evaluation_unavailable', true);
          }
          validateOutput.assertCurrent();
          if (resolved.connection.adapter !== adapter || !snapshot.isCurrent() || controller.signal.aborted)
            throw new SchemaBoundaryError('schema_evaluation_unavailable', true);
          const upstreamResult = await requestLegacyAdapter(
            adapter,
            'tools/call',
            {
              name: resolved.entry.route.upstreamIdentity,
              arguments: validateOutput.targetArguments as never,
            },
            { signal: controller.signal, timeoutMs: resolved.connection.requestTimeoutMs },
          );
          await validateOutput(upstreamResult);
          res.json({ result: upstreamResult, server: target.serverName, tool: target.toolName });
        } catch (error) {
          if (error instanceof SchemaBoundaryError && error.code === 'schema_input_invalid') {
            res.json({ result: schemaInputErrorResult(), server: target.serverName, tool: target.toolName });
            return;
          }
          const failure =
            error instanceof SchemaBoundaryError
              ? createGatewayFailure({
                  kind: error.phase === 'input' && !error.retryable ? 'invalid-request' : 'protocol',
                  code: error.code,
                  message: error.code,
                })
              : gatewayFailureFromUnknown(error, 'transport');
          logger.error('toolRoutes.direct.tool.invocation.error.ba32e1c5', { error: error });
          const problem = gatewayFailureToProblem(failure);
          const status =
            error instanceof SchemaBoundaryError
              ? schemaFailureStatus(error.code, error.phase === 'input' ? 'validation' : 'upstream')
              : problem.status;
          res.setHeader('Content-Type', 'application/problem+json');
          res.status(status).json({ ...problem, status });
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
          {
            signal: controller.signal,
            beforeDispatch: preparation.kind === 'ready' ? preparation.beforeDispatch : undefined,
          },
        );
        if (!catalogResult.error) {
          res.json({ result: catalogResult.result, server: catalogResult.server, tool: catalogResult.tool });
          return;
        }
        // The catalog may already have executed the Tool. A fallback would duplicate side effects.
        const status = schemaFailureStatus(catalogResult.error.message, catalogResult.error.type);
        let kind: 'invalid-request' | 'transport' | 'internal' = 'internal';
        if (catalogResult.error.type === 'validation') {
          kind = 'invalid-request';
        } else if (catalogResult.error.type === 'upstream') {
          kind = 'transport';
        }
        const problem = gatewayFailureToProblem(
          createGatewayFailure({
            kind,
            code: catalogResult.error.message.startsWith('schema_')
              ? catalogResult.error.message
              : `gateway_${catalogResult.error.type}`,
            message:
              catalogResult.error.type === 'upstream' && !catalogResult.error.message.startsWith('schema_')
                ? 'Tool execution may have occurred; the outcome is unknown'
                : catalogResult.error.message,
          }),
        );
        res.setHeader('Content-Type', 'application/problem+json');
        res.status(status).json({ ...problem, status });
        return;
      }

      const metaArguments = { server: target.serverName, toolName: target.toolName, args: toolArgs };
      let result: ToolInvokeOutput;
      if (preparation.kind === 'ready') {
        result = (await lazyOrchestrator.callMetaTool(
          'tool_invoke',
          metaArguments,
          visibility,
          controller.signal,
          undefined,
          preparation.beforeDispatch,
        )) as ToolInvokeOutput;
      } else {
        result = (await lazyOrchestrator.callMetaTool(
          'tool_invoke',
          metaArguments,
          visibility,
          controller.signal,
        )) as ToolInvokeOutput;
      }

      if (result.error) {
        let status: number;
        if (result.error.message.startsWith('schema_')) {
          status = schemaFailureStatus(result.error.message, result.error.type);
        } else if (result.error.type === 'validation') {
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
    } catch (_error) {
      logger.error('toolRoutes.api.tool.invocations.handler.error.398a77aa', { error: _error });
      res.status(500).json({ error: 'Internal server error' });
    } finally {
      req.off?.('aborted', abort);
      res.off?.('close', abort);
    }
  }
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

function schemaFailureStatus(code: string, type: string): number {
  if (code === 'schema_evaluation_timeout') return 504;
  if (code === 'schema_evaluation_unavailable') return 503;
  if (code === 'schema_budget_exceeded' && type === 'validation') return 413;
  switch (type) {
    case 'validation':
      return 400;
    case 'not_found':
      return 404;
    case 'upstream':
      return 502;
    default:
      return 500;
  }
}
