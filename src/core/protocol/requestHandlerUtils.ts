import { getConfiguredServerTargets } from '@src/config/configuredServerTargets.js';
import { CapabilityCatalog } from '@src/core/capabilities/capabilityCatalog.js';
import { type CapabilityVisibility, createCapabilityVisibility } from '@src/core/capabilities/capabilityVisibility.js';
import { acquireRuntimeCapabilityCatalog } from '@src/core/capabilities/runtimeCapabilityCatalog.js';
import { SchemaCache } from '@src/core/capabilities/schemaCache.js';
import { ToolRegistry } from '@src/core/capabilities/toolRegistry.js';
import { byCapabilities } from '@src/core/filtering/clientFiltering.js';
import { FilteringService } from '@src/core/filtering/filteringService.js';
import { createConnectionResolver } from '@src/core/server/connectionResolver.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { InboundConnection, OutboundConnection, OutboundConnections } from '@src/core/types/index.js';
import type { MCPServerParams } from '@src/core/types/transport.js';

export function getRequestSession(inboundConn: InboundConnection): string | undefined {
  return inboundConn.context?.sessionId;
}

export async function createCapabilityCatalogFromConnections(
  connections: OutboundConnections,
  getServerConfigs: () => Record<string, MCPServerParams> = getConfiguredServerTargets,
): Promise<CapabilityCatalog> {
  const snapshot = await acquireRuntimeCapabilityCatalog(connections, undefined, { serverConfigs: getServerConfigs() });
  const registry = ToolRegistry.fromGeneration(
    snapshot.generation,
    new Map(Array.from(snapshot.connections, ([key, connection]) => [key, connection.tags])),
    snapshot.connections,
    snapshot.isCurrent,
  );

  return new CapabilityCatalog({
    getToolRegistry: () => registry,
    schemaCache: new SchemaCache({ maxEntries: 100 }),
    outboundConnections: new Map(snapshot.connections),
    getServerConfigs,
    templateHashProvider: ServerManager.current.getTemplateServerManager(),
  });
}

/** Create the runtime Capability Catalog used by protocol capability walks. */
export function createProtocolCapabilityCatalog(
  connections: OutboundConnections,
  getServerConfigs: () => Record<string, MCPServerParams> = getConfiguredServerTargets,
): CapabilityCatalog {
  return new CapabilityCatalog({
    getToolRegistry: ToolRegistry.empty,
    schemaCache: new SchemaCache({ maxEntries: 100 }),
    outboundConnections: connections,
    getServerConfigs,
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

/** Resolve request-time Filter Selection into a Server Candidate Set. */
export function resolveLazyCapabilityVisibility(
  outboundConns: OutboundConnections,
  inboundConn: InboundConnection,
  sessionId: string | undefined,
): CapabilityVisibility {
  return resolveCapabilityVisibility(outboundConns, inboundConn, sessionId, 'tools');
}

/** Resolve request-time Filter Selection into a catalog-enforced Server Candidate Set. */
export function resolveCapabilityVisibility(
  outboundConns: OutboundConnections,
  inboundConn: InboundConnection,
  sessionId: string | undefined,
  capability: 'tools' | 'resources' | 'prompts',
): CapabilityVisibility {
  // Scope template instances before applying client filters and availability.
  const sessionScoped = filterConnectionsForSession(outboundConns, sessionId);
  const tagAndPresetScoped = FilteringService.getFilteredConnections(sessionScoped, inboundConn);
  const capabilityRequirement =
    capability === 'tools' ? { tools: {} } : capability === 'resources' ? { resources: {} } : { prompts: {} };
  const capable = byCapabilities(capabilityRequirement)(tagAndPresetScoped);

  return createCapabilityVisibility(
    Array.from(
      capable.entries(),
      ([connectionKey, connection]) => [connectionKey, connection.name || connectionKey.split(':')[0]] as const,
    ),
    sessionId,
    {
      tagFilterMode: inboundConn.tagFilterMode,
      tags: inboundConn.tags,
      tagExpression: inboundConn.tagExpression,
      tagQuery: inboundConn.tagQuery,
      presetName: inboundConn.presetName,
    },
  );
}
