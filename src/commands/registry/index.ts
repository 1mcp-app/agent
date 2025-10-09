import { globalOptions } from '@src/globalOptions.js';

import type { Argv } from 'yargs';

import { registryOptions } from './options.js';
import { buildSearchCommand, searchCommand } from './search.js';
import { buildShowCommand, showCommand } from './show.js';
import { buildStatusCommand, registryStatusCommand } from './status.js';
import { buildVersionsCommand, versionsCommand } from './versions.js';

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
