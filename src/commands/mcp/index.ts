// Import builder functions from command implementations
import { withGlobalOptions } from '@src/globalOptions.js';
import { runProductCommand } from '@src/productTelemetry/commandScope.js';
import { normalizedArgv } from '@src/utils/cli/normalizedArgv.js';
import printer from '@src/utils/ui/printer.js';

import type { Argv } from 'yargs';

import { buildAddCommand } from './add.js';
import { buildDisableCommand, buildEnableCommand } from './enable.js';
import { buildInstallCommand } from './install.js';
import { buildListCommand } from './list.js';
import { buildRemoveCommand } from './remove.js';
import { buildRestartCommand } from './restart.js';
import { buildSetupCommand } from './setup.js';
import { buildStatusCommand } from './status.js';
import { buildTokensCommand } from './tokens.js';
import { setupMcpToolsCommands } from './tools.js';
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
  return withGlobalOptions(yargs).command(
    'mcp',
    'Manage MCP server configurations',
    (yargs) => {
      const commandGroup = setupMcpToolsCommands(yargs);

      return commandGroup
        .command({
          command: 'add <name>',
          describe: 'Add a new MCP server to the configuration',
          builder: buildAddCommand,
          handler: async (argv) => {
            return runProductCommand('mcp', async () => {
              const { addCommand } = await import('./add.js');
              const { parseDoubleHyphenArgs, hasDoubleHyphen, mergeDoubleHyphenArgs } =
                await import('./utils/doubleHyphenParser.js');

              // Check if " -- " pattern is used
              if (hasDoubleHyphen(normalizedArgv)) {
                const doubleHyphenResult = parseDoubleHyphenArgs(normalizedArgv);
                const mergedArgv = mergeDoubleHyphenArgs(argv, doubleHyphenResult);
                await addCommand(mergedArgv);
              } else {
                await addCommand(argv);
              }
            });
          },
        })
        .command({
          command: 'setup',
          describe: 'Configure an installed backend from a maintained example',
          builder: buildSetupCommand,
          handler: async (argv) => {
            return runProductCommand('mcp', async () => {
              const { setupCommand } = await import('./setup.js');
              await setupCommand(argv);
            });
          },
        })
        .command({
          command: 'install [serverName]',
          describe: 'Install an MCP server from the registry (interactive wizard if no serverName)',
          builder: buildInstallCommand,
          handler: async (argv) => {
            return runProductCommand('mcp', async () => {
              const { installCommand } = await import('./install.js');
              await installCommand(argv);
            });
          },
        })
        .command({
          command: 'remove <name>',
          describe: 'Remove an MCP server from the configuration',
          builder: buildRemoveCommand,
          handler: async (argv) => {
            return runProductCommand('mcp', async () => {
              const { removeCommand } = await import('./remove.js');
              await removeCommand(argv);
            });
          },
        })
        .command({
          command: 'uninstall <serverName>',
          describe: 'Uninstall an MCP server',
          builder: buildUninstallCommand,
          handler: async (argv) => {
            return runProductCommand('mcp', async () => {
              const { uninstallCommand } = await import('./uninstall.js');
              await uninstallCommand(argv);
            });
          },
        })
        .command({
          command: 'update <name>',
          describe: 'Update an existing MCP server configuration',
          builder: buildUpdateCommand,
          handler: async (argv) => {
            return runProductCommand('mcp', async () => {
              const { updateCommand } = await import('./update.js');
              const { parseDoubleHyphenArgs, hasDoubleHyphen, mergeDoubleHyphenArgs } =
                await import('./utils/doubleHyphenParser.js');

              // Check if " -- " pattern is used
              if (hasDoubleHyphen(normalizedArgv)) {
                const doubleHyphenResult = parseDoubleHyphenArgs(normalizedArgv);
                const mergedArgv = mergeDoubleHyphenArgs(argv, doubleHyphenResult);
                await updateCommand(mergedArgv);
              } else {
                await updateCommand(argv);
              }
            });
          },
        })
        .command({
          command: 'enable <name>',
          describe: 'Enable a disabled MCP server',
          builder: buildEnableCommand,
          handler: async (argv) => {
            return runProductCommand('mcp', async () => {
              const { enableCommand } = await import('./enable.js');
              await enableCommand(argv);
            });
          },
        })
        .command({
          command: 'disable <name>',
          describe: 'Disable an MCP server without removing it',
          builder: buildDisableCommand,
          handler: async (argv) => {
            return runProductCommand('mcp', async () => {
              const { disableCommand } = await import('./enable.js');
              await disableCommand(argv);
            });
          },
        })
        .command({
          command: 'restart <name>',
          describe: 'Restart a supervised stdio backend',
          builder: buildRestartCommand,
          handler: async (argv) => {
            return runProductCommand('mcp', async () => {
              const { restartCommand } = await import('./restart.js');
              await restartCommand(argv);
            });
          },
        })
        .command({
          command: 'list',
          describe: 'List all configured MCP servers',
          builder: buildListCommand,
          handler: async (argv) => {
            return runProductCommand('mcp', async () => {
              const { listCommand } = await import('./list.js');
              await listCommand(argv);
            });
          },
        })
        .command({
          command: 'status [name]',
          describe: 'Show status and details of MCP servers',
          builder: buildStatusCommand,
          handler: async (argv) => {
            return runProductCommand('mcp', async () => {
              const { statusCommand } = await import('./status.js');
              await statusCommand(argv);
            });
          },
        })
        .command({
          command: 'tokens',
          describe: 'Estimate MCP token usage for server capabilities',
          builder: buildTokensCommand,
          handler: async (argv) => {
            return runProductCommand('mcp', async () => {
              const { tokensCommand } = await import('./tokens.js');
              await tokensCommand(argv);
            });
          },
        })
        .command({
          command: 'search [query]',
          describe: 'Search registry for MCP servers (alias for registry search)',
          builder: (yargs) => {
            return yargs
              .positional('query', {
                describe: 'Search query',
                type: 'string',
              })
              .option('category', {
                describe: 'Filter by category',
                type: 'string',
              })
              .option('tag', {
                describe: 'Filter by tag',
                type: 'array',
                string: true,
              })
              .option('limit', {
                describe: 'Limit results',
                type: 'number',
                default: 20,
              })
              .example([
                ['$0 mcp search', 'Browse all servers'],
                ['$0 mcp search filesystem', 'Search for filesystem-related servers'],
              ]);
          },
          handler: async (argv) => {
            return runProductCommand('mcp', async () => {
              // Delegate to registry search command
              const { searchCommand } = await import('../registry/search.js');
              const searchArgs = {
                query: argv.query,
                limit: argv.limit,
                _: argv._ || [],
                $0: argv.$0 || '1mcp',
                config: argv.config,
                'config-dir': argv['config-dir'],
              };
              await searchCommand(searchArgs as Parameters<typeof searchCommand>[0]);
            });
          },
        })
        .demandCommand(1, 'You must specify a subcommand')
        .help()
        .alias('help', 'h')
        .epilogue("Use 'registry' to search and discover servers.\nRun 1mcp mcp <command> --help for command details.");
    },
    () => {
      return runProductCommand('mcp', async () => {
        // This handler runs when 'mcp' is called without a subcommand
        printer.info('Please specify a subcommand. Use --help for available commands.');
        process.exit(1);
      });
    },
  );
}
