import { GlobalOptions, globalOptions } from '@src/globalOptions.js';
import { configureGlobalLogger } from '@src/logger/configureGlobalLogger.js';
import printer from '@src/utils/ui/printer.js';

import type { Argv } from 'yargs';

import { registryOptions } from './options.js';
import { buildSearchCommand, searchCommand, SearchCommandArgs } from './search.js';
import { buildShowCommand, showCommand, ShowCommandCliArgs } from './show.js';
import { buildStatusCommand, registryStatusCommand, RegistryStatusCommandArgs } from './status.js';
import { buildVersionsCommand, versionsCommand, VersionsCommandCliArgs } from './versions.js';

/**
 * Set up registry commands with their specific options
 */
export function setupRegistryCommands(yargs: Argv): Argv {
  return yargs.command(
    'registry',
    'Manage MCP registry operations',
    (registryYargs) => {
      return registryYargs
        .options(globalOptions)
        .options(registryOptions)
        .env('ONE_MCP') // Parse all ONE_MCP env vars but filter out server options
        .strict(false) // Allow unknown options to prevent port error
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
          async (argv) => {
            configureGlobalLogger(argv as GlobalOptions);
            await searchCommand(argv as unknown as SearchCommandArgs);
          },
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
          async (argv) => {
            configureGlobalLogger(argv as GlobalOptions);
            await registryStatusCommand(argv as unknown as RegistryStatusCommandArgs);
          },
        )
        .command({
          command: 'show <server-id>',
          describe: 'Show detailed information about a specific MCP server',
          builder: (yargs) =>
            buildShowCommand(
              yargs.options({
                ...globalOptions,
                ...registryOptions,
              }),
            ),
          handler: async (argv) => {
            configureGlobalLogger(argv as GlobalOptions);
            await showCommand(argv as unknown as ShowCommandCliArgs);
          },
        })
        .command({
          command: 'versions <server-id>',
          describe: 'List all available versions for a specific MCP server',
          builder: (yargs) =>
            buildVersionsCommand(
              yargs.options({
                ...globalOptions,
                ...registryOptions,
              }),
            ),
          handler: async (argv) => {
            configureGlobalLogger(argv as GlobalOptions);
            await versionsCommand(argv as unknown as VersionsCommandCliArgs);
          },
        })
        .demandCommand(1, 'You must specify a registry command')
        .help();
    },
    () => {
      // Default handler - show help
      printer.info('Use --help to see available registry commands');
    },
  );
}
