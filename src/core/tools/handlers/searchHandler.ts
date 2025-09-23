import { createRegistryClient } from '../../registry/mcpRegistryClient.js';
import { createSearchEngine } from '../../../utils/searchFiltering.js';
import { withErrorHandling } from '../../../utils/errorHandling.js';
import { MCPServerSearchResult, OFFICIAL_REGISTRY_KEY, RegistryOptions } from '../../registry/types.js';
import { SearchMCPServersArgs } from '../../../utils/mcpToolSchemas.js';
import logger from '../../../logger/logger.js';

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
 * Handle search_mcp_servers tool calls
 */
export async function handleSearchMCPServers(
  args: SearchMCPServersArgs,
  registryOptions?: RegistryOptions,
): Promise<MCPServerSearchResult[]> {
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
      packages: (() => {
        // If server has packages, use them
        if (server.packages && server.packages.length > 0) {
          return server.packages.map((pkg) => ({
            registry_type: pkg.registry_type,
            identifier: pkg.identifier,
            version: pkg.version || server.version,
            transport: pkg.transport?.type || 'stdio',
          }));
        }

        // If server has remotes, use them
        if (server.remotes && server.remotes.length > 0) {
          return server.remotes.map((remote) => ({
            registry_type: 'remote', // Remote servers
            identifier: remote.url,
            version: server.version,
            transport: remote.type,
          }));
        }

        // Fallback for servers with no packages or remotes
        return [
          {
            registry_type: 'github', // Most servers are from GitHub
            identifier: server.repository.url,
            version: server.version,
            transport: 'stdio', // Default transport for most MCP servers
          },
        ];
      })(),
      lastUpdated: server._meta[OFFICIAL_REGISTRY_KEY]?.updatedAt || '',
      registryId: server._meta[OFFICIAL_REGISTRY_KEY]?.serverId || '',
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
