// Import builder functions from command implementations
import { globalOptions } from '@src/globalOptions.js';

import type { Argv } from 'yargs';

import { buildSearchCommand as buildRegistrySearchCommand } from '../registry/search.js';
import { buildAddCommand } from './add.js';
import { buildDisableCommand, buildEnableCommand } from './enable.js';
import { buildInstallCommand } from './install.js';
import { buildListCommand } from './list.js';
import { buildRemoveCommand } from './remove.js';
import { buildStatusCommand } from './status.js';
import { buildTokensCommand } from './tokens.js';
import { buildUninstallCommand } from './uninstall.js';
import { buildUpdateCommand } from './update.js';

/**
 * MCP command group entry point.
 *
 * Manages MCP server configurations, allowing users to add, remove, update,
 * enable/disable, list, and check status of MCP servers in their 1mcp configuration.
 */

/**
 * Register MCP command group and subcommands
 */
export function setupMcpCommands(yargs: Argv): Argv {
  return yargs.command(
    'mcp',
    'Manage MCP server configurations',
    (yargs) => {
      return yargs
        .options(globalOptions || {})
        .command({
          command: 'add <name>',
          describe: 'Add a new MCP server to the configuration',
          builder: buildAddCommand,
          handler: async (argv) => {
            const { addCommand } = await import('./add.js');
            const { parseDoubleHyphenArgs, hasDoubleHyphen, mergeDoubleHyphenArgs } = await import(
              './utils/doubleHyphenParser.js'
            );

            // Check if " -- " pattern is used
            if (hasDoubleHyphen(process.argv)) {
              const doubleHyphenResult = parseDoubleHyphenArgs(process.argv);
              const mergedArgv = mergeDoubleHyphenArgs(argv, doubleHyphenResult);
              await addCommand(mergedArgv);
            } else {
              await addCommand(argv);
            }
          },
        })
        .command({
          command: 'install [serverName]',
          describe: 'Install an MCP server from the registry (interactive wizard if no serverName)',
          builder: buildInstallCommand,
          handler: async (argv) => {
            const { installCommand } = await import('./install.js');
            await installCommand(argv);
          },
        })
        .command({
          command: 'remove <name>',
          describe: 'Remove an MCP server from the configuration',
          builder: buildRemoveCommand,
          handler: async (argv) => {
            const { removeCommand } = await import('./remove.js');
            await removeCommand(argv);
          },
        })
        .command({
          command: 'uninstall <serverName>',
          describe: 'Uninstall an MCP server',
          builder: buildUninstallCommand,
          handler: async (argv) => {
            const { uninstallCommand } = await import('./uninstall.js');
            await uninstallCommand(argv);
          },
        })
        .command({
          command: 'update <name>',
          describe: 'Update an existing MCP server configuration',
          builder: buildUpdateCommand,
          handler: async (argv) => {
            const { updateCommand } = await import('./update.js');
            const { parseDoubleHyphenArgs, hasDoubleHyphen, mergeDoubleHyphenArgs } = await import(
              './utils/doubleHyphenParser.js'
            );

            // Check if " -- " pattern is used
            if (hasDoubleHyphen(process.argv)) {
              const doubleHyphenResult = parseDoubleHyphenArgs(process.argv);
              const mergedArgv = mergeDoubleHyphenArgs(argv, doubleHyphenResult);
              await updateCommand(mergedArgv);
            } else {
              await updateCommand(argv);
            }
          },
        })
        .command({
          command: 'enable <name>',
          describe: 'Enable a disabled MCP server',
          builder: buildEnableCommand,
          handler: async (argv) => {
            const { enableCommand } = await import('./enable.js');
            await enableCommand(argv);
          },
        })
        .command({
          command: 'disable <name>',
          describe: 'Disable an MCP server without removing it',
          builder: buildDisableCommand,
          handler: async (argv) => {
            const { disableCommand } = await import('./enable.js');
            await disableCommand(argv);
          },
        })
        .command({
          command: 'list',
          describe: 'List all configured MCP servers',
          builder: buildListCommand,
          handler: async (argv) => {
            const { listCommand } = await import('./list.js');
            await listCommand(argv);
          },
        })
        .command({
          command: 'status [name]',
          describe: 'Show status and details of MCP servers',
          builder: buildStatusCommand,
          handler: async (argv) => {
            const { statusCommand } = await import('./status.js');
            await statusCommand(argv);
          },
        })
        .command({
          command: 'tokens',
          describe: 'Estimate MCP token usage for server capabilities',
          builder: buildTokensCommand,
          handler: async (argv) => {
            const { tokensCommand } = await import('./tokens.js');
            await tokensCommand(argv);
          },
        })
        .command({
          command: 'search [query]',
          describe: 'Search registry for MCP servers (alias for registry search)',
          builder: (yargs) => buildRegistrySearchCommand(yargs),
          handler: async (argv) => {
            // Delegate to registry search command
            const { searchCommand } = await import('../registry/search.js');
            const searchArgs = {
              query: argv.query,
              status: argv.status,
              type: argv.type,
              transport: argv.transport,
              limit: argv.limit,
              cursor: argv.cursor,
              format: argv.format,
              _: argv._ || [],
              $0: argv.$0 || '1mcp',
              config: argv.config,
              'config-dir': argv['config-dir'],
              url: argv['url'],
              timeout: argv['timeout'],
              'cache-ttl': argv['cache-ttl'],
              'cache-max-size': argv['cache-max-size'],
              'cache-cleanup-interval': argv['cache-cleanup-interval'],
              proxy: argv['proxy'],
              'proxy-auth': argv['proxy-auth'],
            } as Parameters<typeof searchCommand>[0];
            await searchCommand(searchArgs);
          },
        })
        .demandCommand(1, 'You must specify a subcommand')
        .help().epilogue(`
MCP Command Group - Local MCP Server Configuration Management

The mcp command group helps you manage local MCP server configurations in your 1mcp instance.

This allows you to:
• Install MCP servers from the registry
• Add new MCP servers with various transport types (stdio, HTTP, SSE)
• Remove or uninstall servers you no longer need
• Update server configurations including environment variables and tags
• Enable/disable servers without removing them
• List and filter servers by tags or status
• Check the status and details of configured servers
• Estimate token usage for server capabilities and tools

For registry operations (search, discovery), use the 'registry' command group.
For more information about each command, use: $0 mcp <command> --help
        `);
    },
    () => {
      // This handler runs when 'mcp' is called without a subcommand
      console.log('Please specify a subcommand. Use --help for available commands.');
      process.exit(1);
    },
  );
}
