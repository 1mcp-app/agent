import { cleanupShowHandler, handleShowMCPServer } from '@src/core/tools/handlers/showHandler.js';
import { formatServerDetails } from '@src/domains/registry/formatters/serverDetailFormatter.js';
import { OutputFormat, RegistryOptions, ShowCommandArgs } from '@src/domains/registry/types.js';
import { GlobalOptions } from '@src/globalOptions.js';
import logger from '@src/logger/logger.js';

import type { Arguments, Argv } from 'yargs';

import { RegistryYargsOptions } from './options.js';

export interface ShowCommandCliArgs extends Arguments, GlobalOptions, RegistryYargsOptions {
  serverId: string;
  ver?: string;
  v?: string; // alias
  format?: OutputFormat;
}

/**
 * Build the show command configuration
 */
export function buildShowCommand(yargs: Argv) {
  return yargs
    .positional('server-id', {
      describe: 'MCP server identifier (e.g., io.github.containers/kubernetes-mcp-server)',
      type: 'string',
      demandOption: true,
    })
    .option('ver', {
      describe: 'Show specific version of the server',
      type: 'string',
      alias: 'v',
    })
    .option('format', {
      describe: 'Output format',
      type: 'string',
      choices: ['table', 'json', 'detailed'],
      default: 'detailed',
    })
    .example(
      '$0 registry show bcee55b5-2316-4f92-8b66-db907496714b',
      'Show server details (detailed format by default)',
    )
    .example('$0 registry show bcee55b5-2316-4f92-8b66-db907496714b --ver 1.0.0', 'Show specific version')
    .example('$0 registry show bcee55b5-2316-4f92-8b66-db907496714b -v 1.0.0', 'Show specific version (short alias)')
    .example('$0 registry show bcee55b5-2316-4f92-8b66-db907496714b --format table', 'Show in compact table format')
    .example('$0 registry show bcee55b5-2316-4f92-8b66-db907496714b --format json', 'Output JSON for scripting');
}

/**
 * Show detailed information about a specific MCP server
 */
export async function showCommand(argv: ShowCommandCliArgs): Promise<void> {
  try {
    const showArgs: ShowCommandArgs = {
      serverId: argv.serverId,
      version: argv.ver || argv.v,
      format: argv.format || 'detailed',
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

    logger.info(
      `Fetching MCP server details: ${showArgs.serverId}${showArgs.version ? ` (v${showArgs.version})` : ''}`,
    );
    const server = await handleShowMCPServer(showArgs, registryOptions);

    // Format and display the server details
    const output = formatServerDetails(server, showArgs.format);

    if (showArgs.format === 'json') {
      console.log(output);
    } else if (showArgs.format === 'detailed') {
      console.log(output);
    } else {
      // For table format, the formatServerDetails handles console.table calls internally
      // Just ensure we have proper spacing
      console.log(output);
    }
  } catch (error) {
    logger.error('Show command failed:', error);

    // Check if it's a 404 error and provide helpful message
    if (error instanceof Error && error.message.includes('404')) {
      console.error(`❌ Server not found: ${argv.serverId}`);
      console.error('   Make sure the server ID is correct and the server exists in the registry.');
      if (argv.version) {
        console.error(`   Also check if version "${argv.version}" exists for this server.`);
      }
    } else {
      console.error(`❌ Error fetching MCP server details: ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exit(1);
  } finally {
    // Cleanup resources to ensure process exits
    cleanupShowHandler();
  }
}
