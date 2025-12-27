import {
  cleanupSearchHandler,
  handleSearchMCPServers,
  SearchMCPServersResult,
} from '@src/core/tools/handlers/searchHandler.js';
import {
  formatDate,
  formatRegistryTypesPlain,
  formatStatus,
  formatTransportTypesPlain,
  truncateString,
} from '@src/domains/registry/formatters/commonFormatters.js';
import { SearchMCPServersArgs } from '@src/domains/registry/mcpToolSchemas.js';
import { OFFICIAL_REGISTRY_KEY, RegistryOptions } from '@src/domains/registry/types.js';
import { GlobalOptions } from '@src/globalOptions.js';
import logger from '@src/logger/logger.js';
import printer from '@src/utils/ui/printer.js';

import chalk from 'chalk';
import type { Arguments, Argv } from 'yargs';

import { RegistryYargsOptions } from './options.js';

export interface SearchCommandArgs extends Arguments, GlobalOptions, RegistryYargsOptions {
  query?: string;
  status?: 'active' | 'archived' | 'deprecated' | 'all';
  type?: 'npm' | 'pypi' | 'docker';
  transport?: 'stdio' | 'sse' | 'http';
  limit?: number;
  cursor?: string;
  format?: 'table' | 'list' | 'json';
}

/**
 * Build search command with options
 */
export function buildSearchCommand(searchYargs: Argv): Argv {
  return searchYargs
    .positional('query', {
      describe: 'Search query to match against server names and descriptions',
      type: 'string',
    })
    .options({
      status: {
        describe: 'Filter by server status',
        type: 'string' as const,
        choices: ['active', 'archived', 'deprecated', 'all'] as const,
        default: 'active' as const,
      },
      type: {
        describe: 'Filter by package registry type',
        type: 'string' as const,
        choices: ['npm', 'pypi', 'docker'] as const,
      },
      transport: {
        describe: 'Filter by transport method',
        type: 'string' as const,
        choices: ['stdio', 'sse', 'http'] as const,
      },
      limit: {
        describe: 'Maximum number of results to return',
        type: 'number' as const,
        default: 20,
      },
      cursor: {
        describe: 'Pagination cursor for retrieving next page of results',
        type: 'string' as const,
      },
      format: {
        describe: 'Output format for search results',
        type: 'string' as const,
        choices: ['table', 'list', 'json'] as const,
        default: 'table' as const,
      },
    })
    .example('$0 registry search', 'List all active MCP servers (table format)')
    .example('$0 registry search "file system"', 'Search for file system related servers')
    .example('$0 registry search --format=list', 'Display results in list format with colors')
    .example('$0 registry search --type=npm --transport=stdio', 'Find npm packages with stdio transport')
    .example(
      '$0 registry search database --limit=5 --format=json',
      'Search for database servers, limit to 5, output JSON',
    )
    .example('$0 registry search --cursor=next-page-cursor', 'Get next page of results using cursor');
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
      cursor: argv.cursor,
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
      printer.raw(JSON.stringify(results, null, 2));
      return;
    }

    if (results.servers.length === 0) {
      printer.warn('No MCP servers found matching your criteria.');
      printer.info('Try a different search query or remove filters.');
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
    printer.error(`Error searching MCP registry: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  } finally {
    // Cleanup resources to ensure process exits
    cleanupSearchHandler();
  }
}

/**
 * Display results in table format
 */
function displayTableFormat(results: SearchMCPServersResult, searchArgs: SearchMCPServersArgs): void {
  const resultsCount = results.servers.length;
  const plural = resultsCount === 1 ? '' : 's';
  printer.blank();
  printer.success(`Found ${resultsCount} MCP server${plural}:`);

  if (searchArgs.query) {
    printer.info(`Query: "${searchArgs.query}"`);
  }
  printer.blank();

  // Create table data
  const tableData = results.servers.map((server) => ({
    Name: server.name,
    Description: truncateString(server.description, 45),
    Status: (server._meta?.[OFFICIAL_REGISTRY_KEY]?.status || server.status || 'unknown').toUpperCase(),
    Version: server.version,
    'Registry ID': server.name,
    'Registry Type': formatRegistryTypesPlain(server.packages),
    Transport: formatTransportTypesPlain(server.packages),
    'Last Updated': formatDate(server._meta?.[OFFICIAL_REGISTRY_KEY]?.updatedAt),
  }));

  printer.table({
    columns: Object.keys(tableData[0] ?? {}).map((name) => ({ name })),
    rows: tableData,
  });
}

/**
 * Display results in list format
 */
function displayListFormat(results: SearchMCPServersResult, searchArgs: SearchMCPServersArgs): void {
  const resultsCount = results.servers.length;
  const plural = resultsCount === 1 ? '' : 's';
  printer.blank();
  printer.success(`Found ${resultsCount} MCP server${plural}:`);

  if (searchArgs.query) {
    printer.info(`Query: "${searchArgs.query}"`);
  }
  printer.blank();

  // Display results in a clean list format
  results.servers.forEach((server, index) => {
    const meta = server._meta[OFFICIAL_REGISTRY_KEY];
    printer.raw(`${chalk.gray((index + 1).toString().padStart(2))}. ${chalk.cyan.bold(server.name)}`);
    printer.raw(`    ${chalk.white(truncateString(server.description, 70))}`);
    printer.raw(
      `    ${chalk.green('Status:')} ${formatStatus(server._meta?.[OFFICIAL_REGISTRY_KEY]?.status || server.status || 'unknown')}  ${chalk.blue('Version:')} ${server.version}`,
    );
    printer.raw(
      `    ${chalk.yellow('Registry ID:')} ${chalk.gray(server.name)} ${chalk.dim('(use this for installation)')}`,
    );
    printer.raw(
      `    ${chalk.magenta('Transport:')} ${formatTransportTypesPlain(server.packages)} • ${chalk.red('Type:')} ${formatRegistryTypesPlain(server.packages)}`,
    );
    printer.raw(`    ${chalk.gray('Updated:')} ${formatDate(meta?.updatedAt)}`);
    printer.blank();
  });
}

/**
 * Display common footer information
 */
function displayFooter(results: SearchMCPServersResult, searchArgs: SearchMCPServersArgs): void {
  const resultsCount = results.servers.length;

  printer.blank();
  printer.title('Installation:');
  printer.raw('   • Install server: ' + chalk.yellow('1mcp mcp install <registry-id>'));
  printer.info('   Use the exact Registry ID shown above');
  printer.raw('   • Interactive mode: ' + chalk.yellow('1mcp mcp install --interactive'));
  printer.raw('   • Server details: ' + chalk.yellow('1mcp registry show <registry-id>'));
  printer.raw('   • List versions: ' + chalk.yellow('1mcp registry versions <registry-id>'));
  printer.raw('   • Get JSON output: ' + chalk.yellow('1mcp registry search --json'));

  if (resultsCount >= 20) {
    printer.blank();
    printer.title('Search Tips:');
    printer.info('   • Use specific keywords to narrow results');
    printer.info('   • Filter by --status, --type, or --transport');
    printer.info('   • Use --cursor for pagination');
  }

  if (results.next_cursor) {
    printer.blank();
    printer.title('Pagination:');
    printer.info('   • Next page: ' + chalk.yellow(`1mcp registry search --cursor=${results.next_cursor}`));
  }

  if (searchArgs.limit && results.servers.length === searchArgs.limit) {
    printer.blank();
    printer.info(`Showing ${searchArgs.limit} results. Use --cursor for pagination.`);
  }
}
