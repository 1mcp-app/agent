import { randomUUID } from 'node:crypto';

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { SDKOAuthServerProvider } from '@src/auth/sdkOAuthServerProvider.js';
import { McpConfigManager } from '@src/config/mcpConfigManager.js';
import { AUTH_CONFIG, MCP_URI_SEPARATOR } from '@src/constants.js';
import { CapabilityAggregator } from '@src/core/capabilities/capabilityAggregator.js';
import { ToolRegistry } from '@src/core/capabilities/toolRegistry.js';
import { FilteringService } from '@src/core/filtering/filteringService.js';
import { ServerRegistry } from '@src/core/server/adapters/ServerRegistry.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { InboundConnectionConfig } from '@src/core/types/index.js';
import { TagQueryEvaluator } from '@src/domains/preset/parsers/tagQueryEvaluator.js';
import { TagQueryParser } from '@src/domains/preset/parsers/tagQueryParser.js';
import logger from '@src/logger/logger.js';
import {
  getPresetName,
  getTagExpression,
  getTagFilterMode,
  getTagQuery,
  getValidatedTags,
} from '@src/transport/http/middlewares/scopeAuthMiddleware.js';
import tagsExtractor from '@src/transport/http/middlewares/tagsExtractor.js';
import { buildUri, parseUri } from '@src/utils/core/parsing.js';
import { normalizeTag } from '@src/utils/validation/sanitization.js';
import { tagsToScopes } from '@src/utils/validation/scopeValidation.js';

import { Request, RequestHandler, Response, Router } from 'express';

// ---- Response payload types ----

export interface ServerSummary {
  server: string;
  type: string;
  status: string;
  available: boolean;
  toolCount: number;
  hasInstructions: boolean;
}

export interface InspectServersPayload {
  kind: 'servers';
  servers: ServerSummary[];
}

export interface InspectServerPayload {
  kind: 'server';
  server: string;
  type: string;
  status: string;
  available: boolean;
  instructions: string | null;
  tools: Array<{
    tool: string;
    qualifiedName: string;
    description: string;
    requiredArgs: number;
    optionalArgs: number;
  }>;
  totalTools: number;
  hasMore: boolean;
  nextCursor?: string;
}

export interface InspectToolPayload {
  kind: 'tool';
  server: string;
  tool: string;
  qualifiedName: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

// ---- Helpers ----

function buildFilterConfig(res: Response): InboundConnectionConfig {
  return {
    tags: getValidatedTags(res),
    tagExpression: getTagExpression(res),
    tagQuery: getTagQuery(res),
    tagFilterMode: getTagFilterMode(res),
    presetName: getPresetName(res),
  };
}

function parseTarget(
  raw: string,
):
  | { kind: 'server'; serverName: string }
  | { kind: 'tool'; serverName: string; toolName: string; qualifiedName: string }
  | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!trimmed.includes('/')) {
    return { kind: 'server', serverName: trimmed };
  }
  const parts = trimmed.split('/');
  if (parts.length !== 2 || parts.some((p) => p.trim().length === 0)) return null;
  const [serverName, toolName] = parts.map((p) => p.trim());
  return {
    kind: 'tool',
    serverName,
    toolName,
    qualifiedName: `${serverName}${MCP_URI_SEPARATOR}${toolName}`,
  };
}

function getServerName(qualifiedName: string): string {
  try {
    return parseUri(qualifiedName, MCP_URI_SEPARATOR).clientName;
  } catch {
    return '';
  }
}

function getToolName(qualifiedName: string): string {
  try {
    return parseUri(qualifiedName, MCP_URI_SEPARATOR).resourceName;
  } catch {
    return qualifiedName;
  }
}

function qualifyToolName(serverName: string, toolName: string): string {
  return buildUri(serverName, toolName, MCP_URI_SEPARATOR);
}

function summarizeToolSchema(tool: Tool): {
  tool: string;
  qualifiedName: string;
  description: string;
  requiredArgs: number;
  optionalArgs: number;
} {
  const inputSchema =
    tool.inputSchema && typeof tool.inputSchema === 'object' ? (tool.inputSchema as Record<string, unknown>) : {};
  const properties =
    inputSchema.properties && typeof inputSchema.properties === 'object'
      ? (inputSchema.properties as Record<string, unknown>)
      : {};
  const required =
    Array.isArray(inputSchema.required) &&
    inputSchema.required.every((value): value is string => typeof value === 'string' && value.length > 0)
      ? inputSchema.required
      : [];

  return {
    tool: getToolName(tool.name),
    qualifiedName: tool.name,
    description: tool.description ?? '',
    requiredArgs: required.length,
    optionalArgs: Math.max(Object.keys(properties).length - required.length, 0),
  };
}

function summarizeDirectServerTool(serverName: string, tool: Tool) {
  return summarizeToolSchema({
    ...tool,
    name: getServerName(tool.name) === serverName ? tool.name : qualifyToolName(serverName, tool.name),
  });
}

function matchesFilterConfig(tags: string[] | undefined, filterConfig: InboundConnectionConfig): boolean {
  const serverTags = tags ?? [];

  if (!filterConfig.tagFilterMode || filterConfig.tagFilterMode === 'none') {
    return true;
  }

  if (filterConfig.tagFilterMode === 'preset' && filterConfig.tagQuery) {
    return TagQueryEvaluator.evaluate(filterConfig.tagQuery, serverTags);
  }

  if (filterConfig.tagFilterMode === 'advanced' && filterConfig.tagExpression) {
    return TagQueryParser.evaluate(filterConfig.tagExpression, serverTags);
  }

  if (filterConfig.tags?.length) {
    const normalizedServerTags = serverTags.map((tag) => normalizeTag(tag));
    const normalizedFilterTags = filterConfig.tags.map((tag) => normalizeTag(tag));
    return normalizedServerTags.some((tag) => normalizedFilterTags.includes(tag));
  }

  return true;
}

// ---- Route factory ----

export function createApiRoutes(serverManager: ServerManager, scopeAuthMiddleware: RequestHandler): Router {
  const router = Router();
  const inspectHandler = createInspectHandler(serverManager);

  router.get('/inspect', tagsExtractor, scopeAuthMiddleware, inspectHandler);

  return router;
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
      const allConnections = serverManager.getClients();
      const filteredConnections = FilteringService.getFilteredConnections(allConnections, filterConfig);

      const instructionAggregator = serverManager.getInstructionAggregator();
      const lazyOrchestrator = serverManager.getLazyLoadingOrchestrator();
      const toolRegistry: ToolRegistry | undefined = lazyOrchestrator?.getToolRegistry();
      const capabilityAggregator: CapabilityAggregator | undefined = lazyOrchestrator?.getCapabilityAggregator();
      const serverRegistry: ServerRegistry = serverManager.getServerRegistry();

      // No target: list all filtered servers
      if (!targetRaw) {
        let toolCountByServer: Record<string, number> = {};

        if (toolRegistry) {
          toolCountByServer = toolRegistry.getToolCountByServer();
        } else if (capabilityAggregator) {
          for (const tool of capabilityAggregator.getCurrentCapabilities().tools) {
            const sn = getServerName(tool.name);
            if (sn) toolCountByServer[sn] = (toolCountByServer[sn] ?? 0) + 1;
          }
        } else {
          // Non-lazy mode: query each connected client directly
          for (const [name, connection] of filteredConnections) {
            if (connection.client) {
              try {
                const result = await connection.client.listTools();
                toolCountByServer[name] = (result.tools ?? []).length;
              } catch {
                toolCountByServer[name] = 0;
              }
            }
          }
        }

        // Deduplicate template instances: "serena:hash1", "serena:hash2" → "serena"
        const serverMap = new Map<string, { toolCount: number; hasInstructions: boolean }>();
        for (const [name] of filteredConnections) {
          const cleanName = name.includes(':') ? name.split(':')[0] : name;
          const toolCount = toolCountByServer[name] ?? 0;
          const hasInstructions = instructionAggregator?.hasInstructions(cleanName) ?? false;
          const existing = serverMap.get(cleanName);
          if (existing) {
            existing.toolCount = Math.max(existing.toolCount, toolCount);
            existing.hasInstructions = existing.hasInstructions || hasInstructions;
          } else {
            serverMap.set(cleanName, { toolCount, hasInstructions });
          }
        }

        // Also include registered servers with no active connections (e.g. template servers
        // that haven't been instantiated yet), but only if they match the current filter.
        for (const registeredName of serverRegistry.getServerNames()) {
          const adapter = serverRegistry.get(registeredName);
          if (!serverMap.has(registeredName) && matchesFilterConfig(adapter?.config.tags, filterConfig)) {
            serverMap.set(registeredName, {
              toolCount: 0,
              hasInstructions: instructionAggregator?.hasInstructions(registeredName) ?? false,
            });
          }
        }

        const servers: ServerSummary[] = [];
        for (const [cleanName, info] of serverMap) {
          const adapter = serverRegistry.get(cleanName);
          // FilteringService guarantees only Connected entries pass through;
          // for servers not in filteredConnections, use the adapter status directly.
          const status = adapter?.getStatus() ?? 'connected';
          const available = adapter?.isAvailable() ?? true;
          const type = adapter?.type ?? 'external';

          servers.push({
            server: cleanName,
            type: String(type),
            status: String(status),
            available,
            toolCount: info.toolCount,
            hasInstructions: info.hasInstructions,
          });
        }

        servers.sort((a, b) => a.server.localeCompare(b.server));

        const payload: InspectServersPayload = { kind: 'servers', servers };
        res.json(payload);
        return;
      }

      const target = parseTarget(targetRaw);
      if (!target) {
        res.status(400).json({ error: 'Invalid target format. Use <server> or <server>/<tool>.' });
        return;
      }

      // Tool target
      if (target.kind === 'tool') {
        const { serverName, toolName, qualifiedName } = target;

        // Look up full schema — try capability aggregator first, then direct client query
        let found: import('@modelcontextprotocol/sdk/types.js').Tool | undefined;

        if (capabilityAggregator) {
          found = capabilityAggregator.getCurrentCapabilities().tools.find((t) => t.name === qualifiedName);
        }

        if (!found) {
          const connection = filteredConnections.get(serverName) ?? serverManager.getClient(serverName);
          if (connection?.client) {
            try {
              const result = await connection.client.listTools();
              found = (result.tools ?? []).find((t) => t.name === qualifiedName || t.name === toolName);
            } catch {
              // ignore
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
      const connection = filteredConnections.get(serverName);

      if (!adapter && !connection) {
        res.status(404).json({ error: `Server not found: ${serverName}` });
        return;
      }

      if (!connection) {
        // Server is registered but not currently connected — tell CLI to fall back to MCP
        res.status(503).json({ error: `Server '${serverName}' is not currently connected` });
        return;
      }

      const status = adapter?.getStatus() ?? 'unknown';
      const available = adapter?.isAvailable() ?? false;
      const type = adapter?.type ?? 'external';
      const instructions = instructionAggregator?.getServerInstructions(serverName) ?? null;

      let toolsResult: {
        tools: Array<{
          tool: string;
          qualifiedName: string;
          description: string;
          requiredArgs: number;
          optionalArgs: number;
        }>;
        totalTools: number;
        hasMore: boolean;
        nextCursor?: string;
      };

      if (toolRegistry) {
        if (connection?.client) {
          try {
            const directResult = await connection.client.listTools();
            const directTools = directResult.tools ?? [];
            toolsResult = {
              tools: directTools.map((tool) => summarizeDirectServerTool(serverName, tool)),
              totalTools: directTools.length,
              hasMore: false,
            };
          } catch {
            const result = toolRegistry.listTools({ server: serverName, limit, cursor: cursorParam });
            toolsResult = {
              tools: result.tools.map((t) => ({
                tool: getToolName(t.name),
                qualifiedName: t.name,
                description: t.description,
                requiredArgs: 0,
                optionalArgs: 0,
              })),
              totalTools: result.totalCount,
              hasMore: result.hasMore,
              nextCursor: result.nextCursor,
            };
          }
        } else {
          const result = toolRegistry.listTools({ server: serverName, limit, cursor: cursorParam });
          toolsResult = {
            tools: result.tools.map((t) => ({
              tool: getToolName(t.name),
              qualifiedName: t.name,
              description: t.description,
              requiredArgs: 0,
              optionalArgs: 0,
            })),
            totalTools: result.totalCount,
            hasMore: result.hasMore,
            nextCursor: result.nextCursor,
          };
        }
      } else if (capabilityAggregator) {
        const capTools = capabilityAggregator
          .getCurrentCapabilities()
          .tools.filter((t) => getServerName(t.name) === serverName);
        toolsResult = {
          tools: capTools.map(summarizeToolSchema),
          totalTools: capTools.length,
          hasMore: false,
        };
      } else {
        try {
          const directResult = await connection.client.listTools();
          const directTools = directResult.tools ?? [];
          toolsResult = {
            tools: directTools.map((tool) => summarizeDirectServerTool(serverName, tool)),
            totalTools: directTools.length,
            hasMore: false,
          };
        } catch {
          res.status(503).json({ error: 'Tool inventory not available for this server' });
          return;
        }
      }

      const payload: InspectServerPayload = {
        kind: 'server',
        server: serverName,
        type: String(type),
        status: String(status),
        available,
        instructions,
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

export function createCliTokenRoute(oauthProvider: SDKOAuthServerProvider): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    // Must use socket address (not req.ip) to prevent X-Forwarded-For spoofing
    const remoteAddr = req.socket.remoteAddress;
    const isLocalhost = remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1';

    if (!isLocalhost) {
      res.status(403).json({ error: 'This endpoint is only available from localhost' });
      return;
    }

    const agentConfig = AgentConfigManager.getInstance();

    if (!agentConfig.get('features').auth) {
      res.json({ authRequired: false, message: 'Auth is disabled on this server' });
      return;
    }

    const tokenId = randomUUID();
    const accessToken = AUTH_CONFIG.SERVER.TOKEN.ID_PREFIX + tokenId;
    const ttlMs = agentConfig.get('auth').oauthTokenTtlMs;

    const mcpConfig = McpConfigManager.getInstance();
    const allScopes = tagsToScopes(mcpConfig.getAvailableTags());

    oauthProvider.oauthStorage.sessionRepository.createWithId(tokenId, 'cli', '', allScopes, ttlMs);

    logger.info('CLI token generated for localhost', { tokenId: tokenId.substring(0, 8) + '...' });

    res.json({
      authRequired: true,
      token: accessToken,
      expiresIn: Math.floor(ttlMs / 1000),
    });
  };
}

export default createApiRoutes;
