import type { Arguments } from 'yargs';
import { handleSearchMCPServers, cleanupSearchHandler } from '../../core/tools/handlers/searchHandler.js';
import { SearchMCPServersArgs } from '../../utils/mcpToolSchemas.js';
import { RegistryOptions } from '../../core/registry/types.js';
import logger from '../../logger/logger.js';
import { GlobalOptions } from '../../globalOptions.js';
import chalk from 'chalk';

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
      console.log(chalk.yellow('🔍 No MCP servers found matching your criteria.'));
      console.log(chalk.gray('   Try a different search query or remove filters.'));
      return;
    }

    // Enhanced header with colors
    const resultsCount = results.length;
    const plural = resultsCount === 1 ? '' : 's';
    console.log(chalk.green(`\n✅ Found ${chalk.bold(resultsCount)} MCP server${plural}:`));

    if (searchArgs.query) {
      console.log(chalk.gray(`   Query: "${searchArgs.query}"`));
    }
    console.log(); // Empty line for spacing

    const tableData = results.map((server) => {
      // Color-code status
      const getStatusDisplay = (status: string) => {
        switch (status) {
          case 'active':
            return chalk.green('● ACTIVE');
          case 'deprecated':
            return chalk.yellow('● DEPRECATED');
          case 'archived':
            return chalk.red('● ARCHIVED');
          default:
            return chalk.gray(`● ${status.toUpperCase()}`);
        }
      };

      return {
        Name: chalk.cyan.bold(server.name),
        Description: chalk.white(truncateString(server.description, 45)),
        Status: getStatusDisplay(server.status),
        Version: chalk.blue(server.version),
        'Server ID': chalk.gray(truncateString(server.registryId, 8) + '...'), // Show first 8 chars + ellipsis
        'Registry Type': formatRegistryTypes(server.packages),
        Transport: formatTransportTypes(server.packages),
        'Last Updated': chalk.gray(formatDate(server.lastUpdated)),
      };
    });

    console.table(tableData);

    // Enhanced usage instructions with colors
    console.log(chalk.cyan.bold('\n💡 Next Steps:'));
    console.log(chalk.white('   • View detailed information: ') + chalk.yellow('1mcp registry show <server-id>'));
    console.log(chalk.white('   • List all versions: ') + chalk.yellow('1mcp registry versions <server-id>'));
    console.log(chalk.white('   • Get full Server IDs: ') + chalk.yellow('1mcp registry search --json'));

    // Show search tips if results are limited
    if (resultsCount >= 20) {
      console.log(chalk.cyan.bold('\n🔍 Search Tips:'));
      console.log(chalk.gray('   • Use specific keywords to narrow results'));
      console.log(chalk.gray('   • Filter by --status, --type, or --transport'));
      console.log(chalk.gray('   • Use --limit and --offset for pagination'));
    }

    // Show pagination info if applicable
    if (searchArgs.limit && results.length === searchArgs.limit) {
      console.log(`Showing first ${searchArgs.limit} results. Use --offset and --limit for pagination.`);
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
 * Format transport value to handle objects and undefined values
 */
function formatTransport(transport: any): string {
  if (!transport) return '';
  if (typeof transport === 'string') return transport;
  if (typeof transport === 'object') {
    // Handle case where transport is an object
    return transport.type || transport.name || String(transport);
  }
  return String(transport);
}

/**
 * Format registry types with colors
 */
function formatRegistryTypes(packages: any[]): string {
  const types = packages.map((p) => p.registry_type || 'unknown').filter(Boolean);
  const uniqueTypes = [...new Set(types)];

  if (uniqueTypes.length === 0) return chalk.gray('unknown');

  return uniqueTypes
    .map((type) => {
      switch (type) {
        case 'npm':
          return chalk.red('npm');
        case 'pypi':
          return chalk.blue('pypi');
        case 'docker':
          return chalk.cyan('docker');
        default:
          return chalk.gray(type);
      }
    })
    .join(', ');
}

/**
 * Format transport types with colors
 */
function formatTransportTypes(packages: any[]): string {
  const transports = packages.map((p) => formatTransport(p.transport)).filter(Boolean);
  const uniqueTransports = [...new Set(transports)];

  if (uniqueTransports.length === 0) return chalk.gray('stdio');

  return uniqueTransports
    .map((transport) => {
      switch (transport) {
        case 'stdio':
          return chalk.green('stdio');
        case 'sse':
          return chalk.magenta('sse');
        case 'webhook':
          return chalk.yellow('webhook');
        default:
          return chalk.gray(transport);
      }
    })
    .join(', ');
}

/**
 * Format ISO date string to readable format
 */
function formatDate(isoString: string): string {
  if (!isoString || typeof isoString !== 'string') {
    return 'Unknown';
  }
  try {
    const date = new Date(isoString);
    // Check if date is valid
    if (isNaN(date.getTime())) {
      return 'Invalid Date';
    }
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return 'Invalid Date';
  }
}
