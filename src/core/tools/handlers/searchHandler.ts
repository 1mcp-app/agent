import { createRegistryClient } from '@src/domains/registry/mcpRegistryClient.js';
import { SearchMCPServersArgs } from '@src/domains/registry/mcpToolSchemas.js';
import { createSearchEngine } from '@src/domains/registry/searchFiltering.js';
import {
  OFFICIAL_REGISTRY_KEY,
  RegistryExtensions,
  RegistryOptions,
  RegistryServer,
  ServerMeta,
} from '@src/domains/registry/types.js';
import logger from '@src/logger/logger.js';
import { withErrorHandling } from '@src/utils/core/errorHandling.js';

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
 * Search result with pagination metadata
 */
export interface SearchMCPServersResult {
  servers: (RegistryServer & { registryId: string; lastUpdated: string })[];
  next_cursor?: string;
  count: number;
}

/**
 * Transform server data for search results
 */
function transformServerForSearch(
  server: RegistryServer,
): RegistryServer & { registryId: string; lastUpdated: string } {
  const meta = server._meta[OFFICIAL_REGISTRY_KEY] as RegistryExtensions;
  if (!meta) {
    throw new Error('Missing registry metadata for server');
  }
  return {
    ...server,
    registryId: server.name || '',
    packages: server.packages || [],
    lastUpdated: meta.updatedAt || '',
    repository: server.repository,
  };
}

/**
 * Handle search_mcp_servers tool calls
 */
export async function handleSearchMCPServers(
  args: SearchMCPServersArgs,
  registryOptions?: RegistryOptions,
): Promise<SearchMCPServersResult> {
  const handler = withErrorHandling(async () => {
    logger.debug('Processing search_mcp_servers request', args);

    const client = getRegistryClient(registryOptions);
    const engine = getSearchEngine();

    // Validate and set defaults
    const limit = Math.min(args.limit || 20, 100);
    const status = args.status || 'active';

    // Build API parameters - pass search to API for server-side filtering
    const apiParams: Record<string, string | number> = {
      limit,
    };

    if (args.query) {
      apiParams.search = args.query;
    }

    if (args.cursor) {
      apiParams.cursor = args.cursor;
    }

    // Get servers from registry with API-side search and metadata
    const response = await client.getServersWithMetadata(apiParams);

    // Apply client-side filtering for parameters not supported by API
    const servers = response.servers || [];
    // Extract RegistryServer objects from ServerResponse objects and preserve metadata
    const registryServers = servers.map((sr) => ({
      ...sr.server,
      _meta: sr._meta as ServerMeta, // Preserve the metadata from ServerResponse with proper type assertion
    }));

    const filteredServers = engine.applyFilters(registryServers, {
      query: undefined, // Already handled by API - no need for client-side search
      status: status === 'all' ? undefined : status,
      registry_type: args.registry_type,
      transport: args.transport,
    });

    // Transform results for search response
    const transformedResults = filteredServers.map(transformServerForSearch);

    logger.debug(`Found ${transformedResults.length} servers matching search criteria`);

    // Return with pagination metadata
    return {
      servers: transformedResults,
      next_cursor: response.metadata.nextCursor,
      count: response.metadata.count,
    };
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
