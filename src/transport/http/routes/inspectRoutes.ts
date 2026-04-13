import { CapabilityAggregator } from '@src/core/capabilities/capabilityAggregator.js';
import { ToolRegistry } from '@src/core/capabilities/toolRegistry.js';
import { FilteringService } from '@src/core/filtering/filteringService.js';
import { ServerRegistry } from '@src/core/server/adapters/ServerRegistry.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import logger from '@src/logger/logger.js';

import { Request, RequestHandler, Response } from 'express';

import {
  buildFilterConfig,
  getServerName,
  getToolName,
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

export type { InspectServerPayload, InspectServersPayload, InspectToolPayload, ServerSummary, ToolSummary };
export { buildFilterConfig, matchesFilterConfig, parseTarget, resolveConnectionByServerName };

export function createServersHandler(serverManager: ServerManager): RequestHandler {
  return async (_req: Request, res: Response): Promise<void> => {
    try {
      const filterConfig = buildFilterConfig(res);
      const allConnections = serverManager.getClients();
      const filteredConnections = FilteringService.getFilteredConnections(allConnections, filterConfig);

      const instructionAggregator = serverManager.getInstructionAggregator();
      const lazyOrchestrator = serverManager.getLazyLoadingOrchestrator();
      const toolRegistry: ToolRegistry | undefined = lazyOrchestrator?.getToolRegistry();
      const capabilityAggregator: CapabilityAggregator | undefined = lazyOrchestrator?.getCapabilityAggregator();
      const serverRegistry = serverManager.getServerRegistry();

      let toolCountByServer: Record<string, number> = {};

      if (toolRegistry) {
        toolCountByServer = toolRegistry.getToolCountByServer();
      } else if (capabilityAggregator) {
        for (const tool of capabilityAggregator.getCurrentCapabilities().tools) {
          const sn = getServerName(tool.name);
          if (sn) toolCountByServer[sn] = (toolCountByServer[sn] ?? 0) + 1;
        }
      } else {
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

        let found: import('@modelcontextprotocol/sdk/types.js').Tool | undefined;

        if (capabilityAggregator) {
          found = capabilityAggregator.getCurrentCapabilities().tools.find((t) => t.name === qualifiedName);
        }

        if (!found) {
          const connection =
            resolveConnectionByServerName(filteredConnections, serverName) ?? serverManager.getClient(serverName);
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
      const connection = resolveConnectionByServerName(filteredConnections, serverName);

      if (!adapter && !connection) {
        res.status(404).json({ error: `Server not found: ${serverName}` });
        return;
      }

      if (!connection) {
        res.status(503).json({ error: `Server '${serverName}' is not currently connected` });
        return;
      }

      const status = adapter?.getStatus() ?? 'unknown';
      const available = adapter?.isAvailable() ?? false;
      const type = adapter?.type ?? 'external';
      const instructions = instructionAggregator?.getServerInstructions(serverName) ?? null;

      let toolsResult: { tools: ToolSummary[]; totalTools: number; hasMore: boolean; nextCursor?: string };

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
