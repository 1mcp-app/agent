import type { Arguments } from 'yargs';
import { handleSearchMCPServers, cleanupSearchHandler } from '../../core/tools/handlers/searchHandler.js';
import { SearchMCPServersArgs } from '../../utils/mcpToolSchemas.js';
import {
  OFFICIAL_REGISTRY_KEY,
  RegistryOptions,
  RegistryServer,
  ServerPackage,
  Transport,
} from '../../core/registry/types.js';
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
  format?: 'table' | 'list' | 'json';
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

    // Determine output format
    const outputFormat = argv.format || 'table';

    if (outputFormat === 'json') {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (results.length === 0) {
      console.log(chalk.yellow('🔍 No MCP servers found matching your criteria.'));
      console.log(chalk.gray('   Try a different search query or remove filters.'));
      return;
    }

    // Display results based on format
    if (outputFormat === 'table') {
      displayTableFormat(results, searchArgs);
    } else if (outputFormat === 'list') {
      displayListFormat(results, searchArgs);
    }

    // Show common footer
    displayFooter(results, searchArgs);
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
 * Display results in table format
 */
function displayTableFormat(results: RegistryServer[], searchArgs: SearchMCPServersArgs): void {
  // Enhanced header with colors
  const resultsCount = results.length;
  const plural = resultsCount === 1 ? '' : 's';
  console.log(chalk.green(`\n✅ Found ${chalk.bold(resultsCount)} MCP server${plural}:`));

  if (searchArgs.query) {
    console.log(chalk.gray(`   Query: "${searchArgs.query}"`));
  }
  console.log(); // Empty line for spacing

  // Create table data
  const tableData = results.map((server) => ({
    Name: server.name,
    Description: truncateString(server.description, 45),
    Status: server.status.toUpperCase(),
    Version: server.version,
    'Server ID': server._meta[OFFICIAL_REGISTRY_KEY].serverId,
    'Registry Type': formatRegistryTypesPlain(server.packages),
    Transport: formatTransportTypesPlain(server.packages),
    'Last Updated': formatDate(server._meta[OFFICIAL_REGISTRY_KEY].updatedAt),
  }));

  console.table(tableData);
}

/**
 * Display results in list format
 */
function displayListFormat(results: RegistryServer[], searchArgs: SearchMCPServersArgs): void {
  // Enhanced header with colors
  const resultsCount = results.length;
  const plural = resultsCount === 1 ? '' : 's';
  console.log(chalk.green(`\n✅ Found ${chalk.bold(resultsCount)} MCP server${plural}:`));

  if (searchArgs.query) {
    console.log(chalk.gray(`   Query: "${searchArgs.query}"`));
  }
  console.log(); // Empty line for spacing

  // Display results in a clean list format
  results.forEach((server, index) => {
    const meta = server._meta[OFFICIAL_REGISTRY_KEY];
    console.log(`${chalk.gray((index + 1).toString().padStart(2))}. ${chalk.cyan.bold(server.name)}`);
    console.log(`    ${chalk.white(truncateString(server.description, 70))}`);
    console.log(
      `    ${chalk.green('Status:')} ${formatStatus(server.status)}  ${chalk.blue('Version:')} ${server.version}`,
    );
    console.log(`    ${chalk.yellow('ID:')} ${chalk.gray(meta.serverId)}`);
    console.log(
      `    ${chalk.magenta('Transport:')} ${formatTransportTypesPlain(server.packages)} • ${chalk.red('Type:')} ${formatRegistryTypesPlain(server.packages)}`,
    );
    console.log(`    ${chalk.gray('Updated:')} ${formatDate(meta.updatedAt)}`);
    console.log(); // Empty line between entries
  });
}

/**
 * Display common footer information
 */
function displayFooter(results: any[], searchArgs: any): void {
  const resultsCount = results.length;

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
function formatTransport(transport?: Transport): string {
  if (!transport) return '';
  if (typeof transport === 'string') return transport;
  if (typeof transport === 'object') {
    // Handle case where transport is an object
    return transport.type || String(transport);
  }
  return String(transport);
}

/**
 * Format status with colors
 */
function formatStatus(status: string): string {
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
}

/**
 * Format registry types without colors (for table display)
 */
function formatRegistryTypesPlain(packages: ServerPackage[] = []): string {
  const types = packages.map((p) => p.registryType || 'unknown').filter(Boolean);
  const uniqueTypes = [...new Set(types)];

  if (uniqueTypes.length === 0) return 'unknown';

  return uniqueTypes.join(', ');
}

/**
 * Format transport types without colors (for table display)
 */
function formatTransportTypesPlain(packages: ServerPackage[] = []): string {
  const transports = packages.map((p) => formatTransport(p.transport)).filter(Boolean);
  const uniqueTransports = [...new Set(transports)];

  if (uniqueTransports.length === 0) return 'stdio';

  return uniqueTransports.join(', ');
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
