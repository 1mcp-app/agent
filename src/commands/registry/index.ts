import type { Argv } from 'yargs';
import { searchCommand, buildSearchCommand } from './search.js';
import { registryStatusCommand, buildStatusCommand } from './status.js';
import { showCommand, buildShowCommand } from './show.js';
import { versionsCommand, buildVersionsCommand } from './versions.js';
import { globalOptions } from '../../globalOptions.js';
import { registryOptions } from './options.js';

/**
 * Set up registry commands with their specific options
 */
export function setupRegistryCommands(yargs: Argv): Argv {
  return yargs.command(
    'registry',
    'Manage MCP registry operations',
    (registryYargs) => {
      return registryYargs
        .command(
          'search [query]',
          'Search for MCP servers in the official registry',
          (searchYargs) => {
            return buildSearchCommand(
              searchYargs.options({
                ...globalOptions,
                ...registryOptions,
              }),
            );
          },
          searchCommand,
        )
        .command(
          'status',
          'Show registry availability status and optional statistics',
          (statusYargs) => {
            return buildStatusCommand(
              statusYargs.options({
                ...globalOptions,
                ...registryOptions,
              }),
            );
          },
          registryStatusCommand,
        )
        .command({
          command: 'show <server-id>',
          describe: 'Show detailed information about a specific MCP server',
          builder: buildShowCommand,
          handler: async (argv) => {
            await showCommand(argv as any);
          },
        })
        .command({
          command: 'versions <server-id>',
          describe: 'List all available versions for a specific MCP server',
          builder: buildVersionsCommand,
          handler: async (argv) => {
            await versionsCommand(argv as any);
          },
        })
        .demandCommand(1, 'You must specify a registry command')
        .help();
    },
    () => {
      // Default handler - show help
      console.log('Use --help to see available registry commands');
    },
  );
}
