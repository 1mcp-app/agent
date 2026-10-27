import { GlobalOptions, withGlobalOptions } from '@src/globalOptions.js';
import { configureGlobalLogger } from '@src/logger/configureGlobalLogger.js';
import { runProductCommand } from '@src/productTelemetry/commandScope.js';
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
  return withGlobalOptions(yargs).command(
    'registry',
    'Search and browse the MCP registry',
    (registryYargs) => {
      return registryYargs
        .options(registryOptions)
        .env('ONE_MCP') // Parse all ONE_MCP env vars but filter out server options
        .strict(false) // Allow unknown options to prevent port error
        .check((argv) => {
          // This permissive command family must still reject unsupported project selectors.
          for (const selector of ['project', 'project-set']) {
            if (argv[selector] !== undefined) throw new Error(`Unknown argument: ${selector}`);
          }
          return true;
        })
        .command(
          'search [query]',
          'Search for MCP servers in the official registry',
          (searchYargs) => {
            return buildSearchCommand(searchYargs);
          },
          async (argv) => {
            return runProductCommand('mcp', async () => {
              configureGlobalLogger(argv as GlobalOptions);
              await searchCommand(argv as unknown as SearchCommandArgs);
            });
          },
        )
        .command(
          'status',
          'Show registry availability status and optional statistics',
          (statusYargs) => {
            return buildStatusCommand(statusYargs);
          },
          async (argv) => {
            return runProductCommand('mcp', async () => {
              configureGlobalLogger(argv as GlobalOptions);
              await registryStatusCommand(argv as unknown as RegistryStatusCommandArgs);
            });
          },
        )
        .command({
          command: 'show <server-id>',
          describe: 'Show detailed information about a specific MCP server',
          builder: (yargs) => buildShowCommand(yargs),
          handler: async (argv) => {
            return runProductCommand('mcp', async () => {
              configureGlobalLogger(argv as GlobalOptions);
              await showCommand(argv as unknown as ShowCommandCliArgs);
            });
          },
        })
        .command({
          command: 'versions <server-id>',
          describe: 'List all available versions for a specific MCP server',
          builder: (yargs) => buildVersionsCommand(yargs),
          handler: async (argv) => {
            return runProductCommand('mcp', async () => {
              configureGlobalLogger(argv as GlobalOptions);
              await versionsCommand(argv as unknown as VersionsCommandCliArgs);
            });
          },
        })
        .demandCommand(1, 'You must specify a registry command')
        .help()
        .alias('help', 'h');
    },
    () => {
      return runProductCommand('mcp', async () => {
        // Default handler - show help
        printer.info('Use --help to see available registry commands');
      });
    },
  );
}
