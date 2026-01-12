import { HOST, PORT } from '@src/constants.js';
import { globalOptions } from '@src/globalOptions.js';

import type { Argv } from 'yargs';

/**
 * Serve command group entry point.
 *
 * Starts the 1mcp server with various transport options and configurations.
 */

// Define server options that should be available for serve commands and default command
export const serverOptions = {
  transport: {
    alias: 't',
    describe: 'Transport type to use (stdio or http, sse is deprecated)',
    type: 'string' as const,
    choices: ['stdio', 'http', 'sse'] as const,
    default: 'http',
  },
  port: {
    alias: 'P',
    describe: 'HTTP port to listen on, applicable when transport is http',
    type: 'number' as const,
    default: PORT,
  },
  host: {
    alias: 'H',
    describe: 'HTTP host to listen on, applicable when transport is http',
    type: 'string' as const,
    default: HOST,
  },
  'external-url': {
    alias: 'u',
    describe: 'External URL for the server (used for OAuth callbacks and public URLs)',
    type: 'string' as const,
    default: undefined,
  },
  filter: {
    alias: 'f',
    describe: 'Filter expression for server selection (supports simple comma-separated or advanced boolean logic)',
    type: 'string' as const,
    default: undefined,
  },
  pagination: {
    alias: 'p',
    describe: 'Enable pagination',
    type: 'boolean' as const,
    default: false,
  },
  auth: {
    describe: 'Enable authentication (OAuth 2.1) - deprecated, use --enable-auth',
    type: 'boolean' as const,
    default: false,
  },
  'enable-auth': {
    describe: 'Enable authentication (OAuth 2.1)',
    type: 'boolean' as const,
    default: false,
  },
  'enable-scope-validation': {
    describe: 'Enable tag-based scope validation',
    type: 'boolean' as const,
    default: true,
  },
  'enable-enhanced-security': {
    describe: 'Enable enhanced security middleware',
    type: 'boolean' as const,
    default: false,
  },
  'session-ttl': {
    describe: 'Session expiry time in minutes',
    type: 'number' as const,
    default: 24 * 60, // 24 hours
  },
  'session-storage-path': {
    describe: 'Custom session storage directory path',
    type: 'string' as const,
    default: undefined,
  },
  'rate-limit-window': {
    describe: 'OAuth rate limit window in minutes',
    type: 'number' as const,
    default: 15,
  },
  'rate-limit-max': {
    describe: 'Maximum requests per OAuth rate limit window',
    type: 'number' as const,
    default: 100,
  },
  'trust-proxy': {
    describe:
      'Trust proxy configuration for Express.js (boolean, IP address, subnet, or preset: loopback, linklocal, uniquelocal)',
    type: 'string' as const,
    default: 'loopback',
  },
  'health-info-level': {
    describe: 'Health endpoint information detail level (full, basic, minimal)',
    type: 'string' as const,
    choices: ['full', 'basic', 'minimal'] as const,
    default: 'minimal',
  },
  'enable-async-loading': {
    describe: 'Enable asynchronous MCP server loading with listChanged notifications',
    type: 'boolean' as const,
    default: false,
  },
  'async-min-servers': {
    describe: 'Minimum number of servers to wait for before accepting requests (when async loading enabled)',
    type: 'number' as const,
    default: 1,
  },
  'async-timeout': {
    describe: 'Initial load timeout in milliseconds (when async loading enabled)',
    type: 'number' as const,
    default: 30000,
  },
  'async-batch-notifications': {
    describe: 'Batch capability change notifications (when async loading enabled)',
    type: 'boolean' as const,
    default: true,
  },
  'async-batch-delay': {
    describe: 'Batch delay in milliseconds for notifications (when async loading enabled)',
    type: 'number' as const,
    default: 100,
  },
  'async-notify-on-ready': {
    describe: 'Notify clients when servers become ready (when async loading enabled)',
    type: 'boolean' as const,
    default: true,
  },
  'enable-lazy-loading': {
    describe: 'Enable lazy loading for tools (tools loaded on-demand, reduces token usage by ~95%)',
    type: 'boolean' as const,
    default: false,
  },
  'lazy-mode': {
    describe: 'Lazy loading mode (metatool: 3 meta-tools only, hybrid: direct + meta-tools, full: disabled)',
    type: 'string' as const,
    choices: ['metatool', 'hybrid', 'full'] as const,
    default: 'full',
  },
  'lazy-cache-max-entries': {
    describe: 'Maximum number of tool schemas to cache in LRU cache (when lazy loading enabled)',
    type: 'number' as const,
    default: 1000,
  },
  'lazy-preload': {
    describe: 'Comma-separated list of tool patterns to preload at startup (when lazy loading enabled)',
    type: 'string' as const,
    default: undefined,
  },
  'lazy-preload-keywords': {
    describe: 'Comma-separated list of tool name keywords to preload at startup (when lazy loading enabled)',
    type: 'string' as const,
    default: undefined,
  },
  'lazy-inline-catalog': {
    describe: 'Include full tool catalog in initialize template (when lazy loading enabled)',
    type: 'boolean' as const,
    default: false,
  },
  'lazy-catalog-format': {
    describe: 'Format for inline tool catalog (flat, grouped, categorized)',
    type: 'string' as const,
    choices: ['flat', 'grouped', 'categorized'] as const,
    default: 'grouped',
  },
  'lazy-direct-expose': {
    describe: 'Comma-separated glob patterns for tools to expose directly in hybrid mode',
    type: 'string' as const,
    default: undefined,
  },
  'lazy-cache-ttl': {
    describe: 'Cache TTL in milliseconds for tool schemas (optional, default: no TTL)',
    type: 'number' as const,
    default: undefined,
  },
  'lazy-fallback-on-error': {
    describe: 'Behavior when on-demand loading fails (skip or full)',
    type: 'string' as const,
    choices: ['skip', 'full'] as const,
    default: 'skip',
  },
  'lazy-fallback-timeout': {
    describe: 'Timeout in milliseconds for on-demand schema loading',
    type: 'number' as const,
    default: 5000,
  },
  'enable-config-reload': {
    describe: 'Enable automatic configuration hot-reload on file changes',
    type: 'boolean' as const,
    default: true,
  },
  'config-reload-debounce': {
    describe: 'Debounce delay in milliseconds for config reload',
    type: 'number' as const,
    default: 500,
  },
  'enable-env-substitution': {
    describe: 'Enable environment variable substitution in config (${VAR_NAME} pattern)',
    type: 'boolean' as const,
    default: true,
  },
  'enable-session-persistence': {
    describe: 'Enable session persistence to disk',
    type: 'boolean' as const,
    default: true,
  },
  'session-persist-requests': {
    describe: 'Number of requests before persisting session to disk',
    type: 'number' as const,
    default: 100,
  },
  'session-persist-interval': {
    describe: 'Time interval in minutes before persisting session to disk',
    type: 'number' as const,
    default: 5,
  },
  'session-background-flush': {
    describe: 'Background flush interval in seconds for dirty sessions',
    type: 'number' as const,
    default: 60,
  },
  'enable-client-notifications': {
    describe: 'Enable listChanged notifications to clients on capability updates',
    type: 'boolean' as const,
    default: true,
  },
  // Internal tool control
  'enable-internal-tools': {
    describe: 'Enable internal MCP management tools (installation, configuration, etc.)',
    type: 'boolean' as const,
    default: false,
  },
  'internal-tools': {
    describe:
      'Enable specific internal MCP tools (comma-separated list: "search,list,status" or categories: "discovery,management,safe")',
    type: 'string' as const,
    default: undefined,
  },
  'instructions-template': {
    alias: 'T',
    describe:
      'Path to custom instructions template file (Handlebars format). Defaults to instructions-template.md in config directory',
    type: 'string' as const,
    default: undefined,
  },
};

/**
 * Register serve command
 */
export function setupServeCommand(yargs: Argv): Argv {
  return yargs.command(
    'serve',
    'Start the 1mcp server',
    (yargs) => {
      return yargs
        .options(globalOptions || {})
        .options(serverOptions)
        .example([
          ['$0 serve', 'Start server with HTTP transport (default)'],
          ['$0 serve --transport=stdio', 'Start server with stdio transport'],
          ['$0 serve --port=3000', 'Start HTTP server on port 3000'],
          ['$0 serve --filter="web,api"', 'Start server with filtered MCP servers'],
          ['$0 serve --enable-auth', 'Start server with OAuth authentication enabled'],
          ['$0 serve --enable-internal-tools', 'Enable all internal MCP management tools'],
          ['$0 serve --internal-tools="search,list,status"', 'Enable specific internal tools'],
          ['$0 serve --internal-tools="discovery,management"', 'Enable tools by category'],
          ['$0 serve --instructions-template=./custom-template.md', 'Use custom instructions template'],
        ]).epilogue(`
TRANSPORT OPTIONS:
  stdio: Use stdin/stdout for communication (for programmatic use)
  http:  Use HTTP server with SSE for web-based clients (default)

FILTERING:
  Use --filter to limit which MCP servers are exposed:
  • Simple: "web,api,database" (OR logic)
  • Advanced: "web AND database" or "(web OR api) AND database"

AUTHENTICATION:
  Use --enable-auth to enable OAuth 2.1 authentication with scope validation.
  Configure OAuth providers in your MCP configuration file.

CUSTOM TEMPLATES:
  Use --instructions-template to customize the instructions template sent to clients.
  Template files use Handlebars syntax with variables like {{serverCount}}, {{serverList}}, etc.
  Defaults to instructions-template.md in your config directory.

INTERNAL TOOLS:
  Use --enable-internal-tools to enable ALL internal MCP management tools.
  Use --internal-tools with comma-separated list for selective control:
  • Individual tools: "search,list,status,registry"
  • Categories: "discovery,management,installation,safe"
  • Examples: "safe" (read-only), "discovery,management" (no installation)

LAZY LOADING:
  Use --enable-lazy-loading to enable lazy tool loading for token optimization.
  Lazy loading reduces initial token usage by ~95% by loading tools on-demand.
  Modes:
  • metatool: Expose only 3 meta-tools (list/describe/call) - maximum savings
  • hybrid: Common tools direct + meta-tools for rest - balanced approach
  • full: Disabled, load all tools normally (default, backward compatible)
  Examples:
  • --enable-lazy-loading --lazy-mode=metatool
  • --enable-lazy-loading --lazy-mode=hybrid --lazy-preload=filesystem,search
  • --enable-lazy-loading --lazy-cache-max-entries=2000

For more information: https://github.com/1mcp-app/agent
        `);
    },
    async (argv) => {
      const { configureGlobalLogger } = await import('@src/logger/configureGlobalLogger.js');
      const { serveCommand } = await import('./serve.js');

      // Configure logger with global options and transport awareness
      const globalOptions = {
        config: argv.config,
        'config-dir': argv['config-dir'],
        'log-level': argv['log-level'],
        'log-file': argv['log-file'],
      };
      configureGlobalLogger(globalOptions, argv.transport);

      // Execute serve command
      await serveCommand(argv);
    },
  );
}
