import type { Arguments } from 'yargs';
import { handleSearchMCPServers, cleanupSearchHandler } from '../../core/tools/handlers/searchHandler.js';
import { SearchMCPServersArgs } from '../../utils/mcpToolSchemas.js';
import { RegistryOptions } from '../../core/registry/types.js';
import logger from '../../logger/logger.js';
import { GlobalOptions } from '../../globalOptions.js';

export interface SearchCommandArgs extends Arguments, GlobalOptions {
  query?: string;
  status?: 'active' | 'archived' | 'deprecated' | 'all';
  type?: 'npm' | 'pypi' | 'docker';
  transport?: 'stdio' | 'sse' | 'webhook';
  limit?: number;
  offset?: number;
  json?: boolean;
  // Registry options
  url?: string;
  timeout?: number;
  'cache-ttl'?: number;
  'cache-max-size'?: number;
  'cache-cleanup-interval'?: number;
  proxy?: string;
  'proxy-auth'?: string;
}

/**
 * Search MCP servers in the registry
 */
export async function searchCommand(argv: SearchCommandArgs): Promise<void> {
  try {
    const searchArgs: SearchMCPServersArgs = {
      query: argv.query,
      status: argv.status || 'active',
      registry_type: argv.type,
      transport: argv.transport,
      limit: Math.min(argv.limit || 20, 100),
      offset: Math.max(argv.offset || 0, 0),
    };

    // Extract registry configuration from CLI options
    const registryOptions: RegistryOptions = {
      url: argv['url'],
      timeout: argv['timeout'],
      cacheTtl: argv['cache-ttl'],
      cacheMaxSize: argv['cache-max-size'],
      cacheCleanupInterval: argv['cache-cleanup-interval'],
      proxy: argv['proxy'],
      proxyAuth: argv['proxy-auth'],
    };

    logger.info('Searching MCP registry...', searchArgs);
    const results = await handleSearchMCPServers(searchArgs, registryOptions);

    if (argv.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (results.length === 0) {
      console.log('No MCP servers found matching your criteria.');
      return;
    }

    // Format results for table display
    console.log(`\nFound ${results.length} MCP server${results.length === 1 ? '' : 's'}:\n`);

    const tableData = results.map((server) => ({
      Name: server.name,
      Description: truncateString(server.description, 50),
      Status: server.status,
      Version: server.version,
      'Registry Type': server.packages.map((p) => p.registry_type).join(', '),
      Transport: server.packages.map((p) => p.transport).join(', '),
      'Last Updated': formatDate(server.lastUpdated),
    }));

    console.table(tableData);

    // Show pagination info if applicable
    if (searchArgs.limit && results.length === searchArgs.limit) {
      console.log(`\nShowing first ${searchArgs.limit} results. Use --offset and --limit for pagination.`);
    }
  } catch (error) {
    logger.error('Search command failed:', error);
    console.error(`Error searching MCP registry: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  } finally {
    // Cleanup resources to ensure process exits
    cleanupSearchHandler();
  }
}

/**
 * Truncate string to specified length with ellipsis
 */
function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * Format ISO date string to readable format
 */
function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return isoString;
  }
}
