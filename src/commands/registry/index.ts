import type { Argv } from 'yargs';
import { searchCommand, buildSearchCommand } from './search.js';
import { registryStatusCommand, buildStatusCommand } from './status.js';
import { showCommand, buildShowCommand } from './show.js';
import { versionsCommand, buildVersionsCommand } from './versions.js';
import { globalOptions } from '../../globalOptions.js';

// Registry-specific options
const registryOptions = {
  url: {
    describe: 'MCP registry base URL (env: ONE_MCP_REGISTRY_URL)',
    type: 'string' as const,
    default: undefined,
  },
  timeout: {
    describe: 'Registry request timeout in milliseconds (env: ONE_MCP_REGISTRY_TIMEOUT)',
    type: 'number' as const,
    default: undefined,
  },
  'cache-ttl': {
    describe: 'Registry cache TTL in seconds (env: ONE_MCP_REGISTRY_CACHE_TTL)',
    type: 'number' as const,
    default: undefined,
  },
  'cache-max-size': {
    describe: 'Registry cache maximum size (env: ONE_MCP_REGISTRY_CACHE_MAX_SIZE)',
    type: 'number' as const,
    default: undefined,
  },
  'cache-cleanup-interval': {
    describe: 'Registry cache cleanup interval in milliseconds (env: ONE_MCP_REGISTRY_CACHE_CLEANUP_INTERVAL)',
    type: 'number' as const,
    default: undefined,
  },
  proxy: {
    describe: 'Registry HTTP proxy URL (env: ONE_MCP_REGISTRY_PROXY)',
    type: 'string' as const,
    default: undefined,
  },
  'proxy-auth': {
    describe: 'Registry proxy authentication (username:password) (env: ONE_MCP_REGISTRY_PROXY_AUTH)',
    type: 'string' as const,
    default: undefined,
  },
} as const;

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
