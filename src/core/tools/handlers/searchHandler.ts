import logger from '../../../logger/logger.js';
import { withErrorHandling } from '../../../utils/core/errorHandling.js';
import { SearchMCPServersArgs } from '../../../utils/mcpToolSchemas.js';
import { createSearchEngine } from '../../../utils/searchFiltering.js';
import { createRegistryClient } from '../../registry/mcpRegistryClient.js';
import { OFFICIAL_REGISTRY_KEY, RegistryOptions, RegistryServer } from '../../registry/types.js';

// Singleton instances
let registryClient: ReturnType<typeof createRegistryClient> | null = null;
let searchEngine: ReturnType<typeof createSearchEngine> | null = null;
let currentRegistryConfig: RegistryOptions | undefined = undefined;

/**
 * Get or create registry client instance
 */
function getRegistryClient(registryOptions?: RegistryOptions) {
  // Recreate client if config changed
  if (!registryClient || JSON.stringify(currentRegistryConfig) !== JSON.stringify(registryOptions)) {
    if (registryClient) {
      registryClient.destroy();
    }
    registryClient = createRegistryClient(registryOptions);
    currentRegistryConfig = registryOptions;
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
 * Transform server data for search results
 */
function transformServerForSearch(server: RegistryServer): any {
  const meta = server._meta[OFFICIAL_REGISTRY_KEY];
  return {
    ...server,
    registryId: meta.serverId,
    packages: server.packages || [],
    lastUpdated: meta.updatedAt,
    repository: server.repository,
  };
}

/**
 * Handle search_mcp_servers tool calls
 */
export async function handleSearchMCPServers(
  args: SearchMCPServersArgs,
  registryOptions?: RegistryOptions,
): Promise<RegistryServer[]> {
  const handler = withErrorHandling(async () => {
    logger.debug('Processing search_mcp_servers request', args);

    const client = getRegistryClient(registryOptions);
    const engine = getSearchEngine();

    // Validate and set defaults
    const limit = Math.min(args.limit || 20, 100);
    const offset = Math.max(args.offset || 0, 0);
    const status = args.status || 'active';

    // Get servers from registry
    const servers = await client.getServers({ limit: 100 }); // API max limit

    // Apply client-side filtering and search
    const filteredServers = engine.applyFilters(servers, {
      query: args.query,
      status: status === 'all' ? undefined : status,
      registry_type: args.registry_type,
      transport: args.transport,
    });

    // Apply pagination
    const results = filteredServers.slice(offset, offset + limit);

    // Transform results for search response
    const transformedResults = results.map(transformServerForSearch);

    logger.debug(`Found ${transformedResults.length} servers matching search criteria`);
    return transformedResults;
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
