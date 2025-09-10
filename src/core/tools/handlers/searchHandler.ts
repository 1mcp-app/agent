import { createRegistryClient } from '../../registry/mcpRegistryClient.js';
import { createSearchEngine } from '../../../utils/searchFiltering.js';
import { withErrorHandling } from '../../../utils/errorHandling.js';
import { MCPServerSearchResult } from '../../registry/types.js';
import { SearchMCPServersArgs } from '../../../utils/mcpToolSchemas.js';
import logger from '../../../logger/logger.js';

// Singleton instances
let registryClient: ReturnType<typeof createRegistryClient> | null = null;
let searchEngine: ReturnType<typeof createSearchEngine> | null = null;

/**
 * Get or create registry client instance
 */
function getRegistryClient() {
  if (!registryClient) {
    registryClient = createRegistryClient();
  }
  return registryClient;
}

/**
 * Get or create search engine instance
 */
function getSearchEngine() {
  if (!searchEngine) {
    searchEngine = createSearchEngine();
  }
  return searchEngine;
}

/**
 * Handle search_mcp_servers tool calls
 */
export async function handleSearchMCPServers(args: SearchMCPServersArgs): Promise<MCPServerSearchResult[]> {
  const handler = withErrorHandling(async () => {
    logger.debug('Processing search_mcp_servers request', args);

    const client = getRegistryClient();
    const engine = getSearchEngine();

    // Validate and set defaults
    const limit = Math.min(args.limit || 20, 100);
    const offset = Math.max(args.offset || 0, 0);
    const status = args.status || 'active';

    // Get servers from registry
    const servers = await client.getServers({ limit: 1000 }); // Get more to filter locally

    // Apply client-side filtering and search
    const filteredServers = engine.applyFilters(servers, {
      query: args.query,
      status: status === 'all' ? undefined : status,
      registry_type: args.registry_type,
      transport: args.transport,
    });

    // Apply pagination
    const paginatedServers = filteredServers.slice(offset, offset + limit);

    // Transform to search result format
    const results: MCPServerSearchResult[] = paginatedServers.map((server) => ({
      name: server.name,
      description: server.description,
      status: server.status,
      version: server.version,
      repository: {
        url: server.repository.url,
        source: server.repository.source,
        subfolder: server.repository.subfolder,
      },
      packages: server.packages.map((pkg) => ({
        registry_type: pkg.registry_type,
        identifier: pkg.identifier,
        version: pkg.version,
        transport: pkg.transport,
      })),
      lastUpdated: server._meta.updated_at,
      registryId: server._meta.id,
    }));

    logger.debug(`Found ${results.length} servers matching search criteria`);
    return results;
  }, 'Failed to search MCP servers');

  return await handler();
}

/**
 * Cleanup resources
 */
export function cleanupSearchHandler(): void {
  if (registryClient) {
    registryClient.destroy();
    registryClient = null;
  }
}
