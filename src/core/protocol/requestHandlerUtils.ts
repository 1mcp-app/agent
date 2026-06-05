import { McpConfigManager } from '@src/config/mcpConfigManager.js';
import { CapabilityCatalog } from '@src/core/capabilities/capabilityCatalog.js';
import { SchemaCache } from '@src/core/capabilities/schemaCache.js';
import { ToolRegistry } from '@src/core/capabilities/toolRegistry.js';
import { FilteringService } from '@src/core/filtering/filteringService.js';
import { createConnectionResolver } from '@src/core/server/connectionResolver.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { ClientStatus, InboundConnection, OutboundConnection, OutboundConnections } from '@src/core/types/index.js';
import type { MCPServerParams } from '@src/core/types/transport.js';
import { getRequestTimeout } from '@src/utils/core/timeoutUtils.js';

export function getRequestSession(inboundConn: InboundConnection): string | undefined {
  return inboundConn.context?.sessionId;
}

export async function createCapabilityCatalogFromConnections(
  connections: OutboundConnections,
  getServerConfigs: () => Record<string, MCPServerParams> = () => McpConfigManager.getInstance().getTransportConfig(),
): Promise<CapabilityCatalog> {
  const toolsByServer = new Map<string, Awaited<ReturnType<OutboundConnection['client']['listTools']>>['tools']>();
  const tagsByServer = new Map<string, string[]>();

  await Promise.all(
    Array.from(connections.entries()).map(async ([connectionKey, connection]) => {
      if (connection.status !== ClientStatus.Connected) return;
      const serverName = connection.name || (connectionKey.includes(':') ? connectionKey.split(':')[0] : connectionKey);
      const result = await connection.client.listTools(undefined, {
        timeout: getRequestTimeout(connection.transport),
      });
      toolsByServer.set(serverName, result.tools ?? []);
      tagsByServer.set(
        serverName,
        Array.isArray((connection.transport as { tags?: unknown }).tags)
          ? ((connection.transport as { tags?: unknown }).tags as unknown[]).filter(
              (tag): tag is string => typeof tag === 'string',
            )
          : [],
      );
    }),
  );

  return new CapabilityCatalog({
    getToolRegistry: () => ToolRegistry.fromToolsMap(toolsByServer, tagsByServer),
    schemaCache: new SchemaCache({ maxEntries: 100 }),
    outboundConnections: connections,
    getServerConfigs,
    templateHashProvider: ServerManager.current.getTemplateServerManager(),
  });
}

export function resolveOutboundConnection(
  clientName: string,
  sessionId: string | undefined,
  outboundConns: OutboundConnections,
  inboundConn?: InboundConnection,
): OutboundConnection | undefined {
  const scopedConns = filterConnectionsForSession(outboundConns, sessionId);
  const filteredConns = inboundConn ? FilteringService.getFilteredConnections(scopedConns, inboundConn) : scopedConns;
  const templateServerManager = ServerManager.current.getTemplateServerManager();
  const resolver = createConnectionResolver(filteredConns, templateServerManager);
  return resolver.resolve(clientName, sessionId);
}

export function filterConnectionsForSession(
  outboundConns: OutboundConnections,
  sessionId: string | undefined,
): OutboundConnections {
  const templateServerManager = ServerManager.current.getTemplateServerManager();
  const resolver = createConnectionResolver(outboundConns, templateServerManager);
  return resolver.filterForSession(sessionId);
}
