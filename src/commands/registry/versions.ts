import { cleanupVersionsHandler, handleListMCPServerVersions } from '@src/core/tools/handlers/versionsHandler.js';
import { formatServerVersions } from '@src/domains/registry/formatters/versionsFormatter.js';
import { OutputFormat, RegistryOptions, VersionsCommandArgs } from '@src/domains/registry/types.js';
import { GlobalOptions } from '@src/globalOptions.js';
import logger from '@src/logger/logger.js';
import printer from '@src/utils/ui/printer.js';

import type { Arguments, Argv } from 'yargs';

import { RegistryYargsOptions } from './options.js';

export interface VersionsCommandCliArgs extends Arguments, GlobalOptions, RegistryYargsOptions {
  serverId: string;
  format?: OutputFormat;
}

/**
 * Build the versions command configuration
 */
export function buildVersionsCommand(yargs: Argv) {
  return yargs
    .positional('server-id', {
      describe: 'MCP server identifier (e.g., io.github.containers/kubernetes-mcp-server)',
      type: 'string',
      demandOption: true,
    })
    .option('format', {
      describe: 'Output format',
      type: 'string',
      choices: ['table', 'json', 'detailed'],
      default: 'table',
    })
    .example('$0 registry versions io.github.containers/kubernetes-mcp-server', 'List all versions in table format')
    .example(
      '$0 registry versions io.github.containers/kubernetes-mcp-server --format detailed',
      'Show enhanced version details',
    )
    .example(
      '$0 registry versions io.github.containers/kubernetes-mcp-server --format json',
      'Output JSON for automation',
    );
}

/**
 * List all versions for a specific MCP server
 */
export async function versionsCommand(argv: VersionsCommandCliArgs): Promise<void> {
  try {
    const versionsArgs: VersionsCommandArgs = {
      serverId: argv.serverId,
      format: argv.format || 'table',
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

    logger.info(`Fetching versions for MCP server: ${versionsArgs.serverId}`);
    const versionsResponse = await handleListMCPServerVersions(versionsArgs, registryOptions);

    // Format and display the versions
    const output = formatServerVersions(versionsResponse, versionsArgs.format);

    if (versionsArgs.format === 'json') {
      printer.raw(output);
    } else if (versionsArgs.format === 'detailed') {
      printer.raw(output);
    } else {
      // For table format, the formatServerVersions handles console.table calls internally
      printer.raw(output);
    }
  } catch (error) {
    logger.error('Versions command failed:', error);

    // Check if it's a 404 error and provide helpful message
    if (error instanceof Error && error.message.includes('404')) {
      printer.error(`Server not found: ${argv.serverId}`);
      printer.info('   Make sure the server ID is correct and the server exists in the registry.');
      printer.info('   Use "registry search" to find available servers.');
    } else {
      printer.error(`Error fetching MCP server versions: ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exit(1);
  } finally {
    // Cleanup resources to ensure process exits
    cleanupVersionsHandler();
  }
}
