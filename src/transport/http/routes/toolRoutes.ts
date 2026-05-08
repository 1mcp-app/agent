import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { McpConfigManager } from '@src/config/mcpConfigManager.js';
import { ToolInvokeOutput, ToolListOutput } from '@src/core/capabilities/schemas/metaToolSchemas.js';
import { ToolRegistry } from '@src/core/capabilities/toolRegistry.js';
import { FilteringService } from '@src/core/filtering/filteringService.js';
import { filterDisabledTools, getDisabledToolError } from '@src/core/server/disabledTools.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import logger from '@src/logger/logger.js';
import { CONTEXT_HEADERS, extractRequestContext } from '@src/transport/http/utils/contextExtractor.js';

import { Request, RequestHandler, Response } from 'express';

import {
  buildFilterConfig,
  ensureRequestContextInitialized,
  parseTarget,
  resolveConnectionByServerName,
} from './inspectRoutes.js';

function getServerConfigs() {
  return McpConfigManager.getInstance().getTransportConfig();
}

function getAllowedServersFromRequest(serverManager: ServerManager, res: Response): Set<string> | undefined {
  const filterConfig = buildFilterConfig(res);
  if (filterConfig.tagFilterMode === 'none' && (!filterConfig.tags || filterConfig.tags.length === 0)) {
    return undefined;
  }
  const allConnections = serverManager.getClients();
  const filteredConnections = FilteringService.getFilteredConnections(allConnections, filterConfig);
  return new Set(
    Array.from(filteredConnections.entries()).flatMap(([key, connection]) => {
      const logicalName = key.includes(':') ? key.split(':')[0] : key;
      return connection.name && connection.name !== logicalName
        ? [key, logicalName, connection.name]
        : [key, logicalName];
    }),
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
      const allowedServers = getAllowedServersFromRequest(serverManager, res);
      const lazyOrchestrator = serverManager.getLazyLoadingOrchestrator();

      if (!lazyOrchestrator) {
        const clients = serverManager.getClients();
        const toolsByServer = new Map<string, Tool[]>();
        for (const [serverName, conn] of clients) {
          if (allowedServers && !allowedServers.has(serverName)) continue;
          if (server && serverName !== server) continue;
          if (conn.status !== 'connected') continue;
          try {
            const logicalServerName = conn.name || (serverName.includes(':') ? serverName.split(':')[0] : serverName);
            const result = await conn.client.listTools();
            toolsByServer.set(
              logicalServerName,
              filterDisabledTools(result.tools ?? [], getServerConfigs(), logicalServerName),
            );
          } catch (err) {
            logger.error(`Failed to list tools for ${serverName}:`, err);
          }
        }

        const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
        const result = ToolRegistry.fromToolsMap(toolsByServer).listTools({
          server,
          pattern,
          limit,
          cursor,
        });
        const servers = Array.from(new Set(result.tools.map((tool) => tool.server))).sort();

        res.json({
          ...result,
          servers,
        });
        return;
      }

      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;

      const result = (await lazyOrchestrator.callMetaTool(
        'tool_list',
        {
          server,
          pattern,
          limit,
          cursor,
        },
        requestSessionId,
        allowedServers,
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

      const allowedServers = getAllowedServersFromRequest(serverManager, res);

      const disabledError = getDisabledToolError(getServerConfigs(), target.serverName, target.toolName);
      if (disabledError) {
        res.status(404).json({ error: disabledError.message });
        return;
      }

      const lazyOrchestrator = serverManager.getLazyLoadingOrchestrator();
      if (!lazyOrchestrator) {
        if (allowedServers && !allowedServers.has(target.serverName)) {
          res.status(404).json({ error: `Server not found: ${target.serverName}` });
          return;
        }
        const allConnections = serverManager.getClients();
        const filteredConnections =
          allowedServers === undefined
            ? allConnections
            : FilteringService.getFilteredConnections(allConnections, buildFilterConfig(res));
        const sessionConnection = requestSessionId
          ? (
              serverManager as {
                getServerRegistry?: () => {
                  resolveConnection: (name: string, context?: { sessionId?: string }) => unknown;
                };
              }
            )
              .getServerRegistry?.()
              ?.resolveConnection(target.serverName, { sessionId: requestSessionId })
          : undefined;
        const connection = (sessionConnection ??
          resolveConnectionByServerName(filteredConnections, target.serverName) ??
          serverManager.getClient(target.serverName)) as
          | { client?: { callTool: (input: { name: string; arguments: Record<string, unknown> }) => Promise<unknown> } }
          | undefined;
        if (!connection || !connection.client) {
          res.status(503).json({ error: `Server not connected: ${target.serverName}` });
          return;
        }
        try {
          const upstreamResult = await connection.client.callTool({
            name: target.toolName,
            arguments: toolArgs,
          });
          res.json({ result: upstreamResult, server: target.serverName, tool: target.toolName });
        } catch (error) {
          logger.error('Direct tool invocation error:', error);
          const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Upstream error';
          res.status(502).json({ error: `Upstream error: ${message}` });
        }
        return;
      }

      const result = (await lazyOrchestrator.callMetaTool(
        'tool_invoke',
        {
          server: target.serverName,
          toolName: target.toolName,
          args: toolArgs,
        },
        requestSessionId,
        allowedServers,
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
  if (!extractRequestContext(req)) {
    const headerSessionId = req.headers?.[CONTEXT_HEADERS.SESSION_ID];
    return Array.isArray(headerSessionId) ? headerSessionId[0] : headerSessionId;
  }

  return ensureRequestContextInitialized(serverManager, req, res, filterConfig);
}
