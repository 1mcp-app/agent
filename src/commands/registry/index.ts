import type { Argv } from 'yargs';
import { searchCommand } from './search.js';
import { registryStatusCommand } from './status.js';
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
            return searchYargs
              .positional('query', {
                describe: 'Search query to match against server names and descriptions',
                type: 'string',
              })
              .options({
                ...globalOptions,
                ...registryOptions,
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
                  choices: ['stdio', 'sse', 'webhook'] as const,
                },
                limit: {
                  describe: 'Maximum number of results to return',
                  type: 'number' as const,
                  default: 20,
                },
                offset: {
                  describe: 'Number of results to skip for pagination',
                  type: 'number' as const,
                  default: 0,
                },
                json: {
                  describe: 'Output results in JSON format',
                  type: 'boolean' as const,
                  default: false,
                },
              })
              .example('$0 registry search', 'List all active MCP servers')
              .example('$0 registry search "file system"', 'Search for file system related servers')
              .example('$0 registry search --type=npm --transport=stdio', 'Find npm packages with stdio transport')
              .example(
                '$0 registry search database --limit=5 --json',
                'Search for database servers, limit to 5, output JSON',
              );
          },
          searchCommand,
        )
        .command(
          'status',
          'Show registry availability status and optional statistics',
          (statusYargs) => {
            return statusYargs
              .options({
                ...globalOptions,
                ...registryOptions,
                stats: {
                  describe: 'Include detailed server count statistics',
                  type: 'boolean' as const,
                  default: false,
                },
                json: {
                  describe: 'Output results in JSON format',
                  type: 'boolean' as const,
                  default: false,
                },
              })
              .example('$0 registry status', 'Check registry availability')
              .example('$0 registry status --stats', 'Show registry status with statistics')
              .example('$0 registry status --stats --json', 'Output detailed status in JSON format');
          },
          registryStatusCommand,
        )
        .demandCommand(1, 'You must specify a registry command')
        .help();
    },
    () => {
      // Default handler - show help
      console.log('Use --help to see available registry commands');
    },
  );
}
