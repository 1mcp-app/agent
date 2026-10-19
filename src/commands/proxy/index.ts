import { GlobalOptions, withGlobalOptions } from '@src/globalOptions.js';

import type { Argv } from 'yargs';

/**
 * Proxy command - STDIO proxy to running 1MCP HTTP server.
 *
 * Provides a STDIO transport interface that proxies all requests to a running
 * 1MCP HTTP server instance. Auto-discovers the server using PID file or port scanning.
 */

export interface ProxyOptions extends GlobalOptions {
  url?: string;
  context?: string;
  timeout?: number;
  filter?: string;
  preset?: string;
  tags?: string[];
}

/**
 * Register proxy command
 */
export function setupProxyCommand(yargs: Argv): Argv {
  return withGlobalOptions(yargs).command(
    'proxy',
    'Connect STDIO clients to an HTTP server',
    (yargs) => {
      return yargs
        .option('url', {
          alias: 'u',
          describe: 'Override auto-detected 1MCP server URL',
          type: 'string',
        })
        .option('context', {
          describe: 'Use a named Runtime Target Context',
          type: 'string',
        })
        .option('timeout', {
          alias: 't',
          describe: 'Connection timeout in milliseconds',
          type: 'number',
          default: 10000,
        })
        .option('filter', {
          alias: 'f',
          describe:
            'Filter expression for server selection (supports simple comma-separated or advanced boolean logic)',
          type: 'string',
        })
        .option('preset', {
          alias: 'P',
          describe: 'Load preset configuration (URL, filters, etc.)',
          type: 'string',
        })
        .option('tags', {
          describe: 'Simple comma-separated tags for server selection',
          type: 'array',
          string: true,
        })
        .example([
          ['$0 proxy', 'Auto-discover and connect to running 1MCP server'],
          ['$0 proxy --url http://localhost:3051/mcp', 'Connect to specific server URL'],
          ['$0 proxy --filter "web,api"', 'Connect with filter expression'],
          ['$0 proxy --preset my-preset', 'Connect using preset configuration'],
          ['$0 proxy --config-dir .tmp-test', 'Use custom config directory for discovery'],
        ])
        .epilogue(
          'Requires a running 1mcp serve instance. Connection settings can be saved in .1mcprc; CLI options take precedence.\nFilter priority: --preset, then --filter, then --tags.\nSTDIO clients cannot authenticate to an auth-enabled server. Use an HTTP client or a separate server without authentication.\nMore: https://docs.1mcp.app/guide/commands#proxy',
        );
    },
    async (argv) => {
      const { configureGlobalLogger } = await import('@src/logger/configureGlobalLogger.js');
      const { proxyCommand } = await import('./proxy.js');

      // Configure logger with global options
      configureGlobalLogger(argv, 'stdio');

      // Execute proxy command
      await proxyCommand(argv as ProxyOptions);
    },
  );
}
