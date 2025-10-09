import type { Argv } from 'yargs';
import { globalOptions, GlobalOptions } from '@src/globalOptions.js';

/**
 * Proxy command - STDIO proxy to running 1MCP HTTP server.
 *
 * Provides a STDIO transport interface that proxies all requests to a running
 * 1MCP HTTP server instance. Auto-discovers the server using PID file or port scanning.
 */

export interface ProxyOptions extends GlobalOptions {
  url?: string;
  timeout?: number;
  filter?: string;
  preset?: string;
  tags?: string[];
}

/**
 * Register proxy command
 */
export function setupProxyCommand(yargs: Argv): Argv {
  return yargs.command(
    'proxy',
    'Start STDIO proxy to running 1MCP HTTP server',
    (yargs) => {
      return yargs
        .options(globalOptions || {})
        .option('url', {
          alias: 'u',
          describe: 'Override auto-detected 1MCP server URL',
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
        .example([
          ['$0 proxy', 'Auto-discover and connect to running 1MCP server'],
          ['$0 proxy --url http://localhost:3051/mcp', 'Connect to specific server URL'],
          ['$0 proxy --filter "web,api"', 'Connect with filter expression'],
          ['$0 proxy --preset my-preset', 'Connect using preset configuration'],
          ['$0 proxy --config-dir .tmp-test', 'Use custom config directory for discovery'],
        ]).epilogue(`
AUTO-DISCOVERY:
  The proxy automatically discovers running 1MCP servers using:
  1. PID file in config directory (~/.config/1mcp/server.pid)
  2. Port scanning on common ports (3050, 3051, 3052)
  3. Environment variables (ONE_MCP_HOST, ONE_MCP_PORT)

PROJECT CONFIGURATION (.1mcprc):
  Create a .1mcprc file in your project directory to set default connection settings:

  {
    "preset": "my-preset",    // Use preset configuration
    "filter": "web,api",      // Or use filter expression
    "tags": ["web", "api"]    // Or use simple tags
  }

  Priority: CLI options > .1mcprc > defaults
  Only one of preset/filter/tags will be used (preset > filter > tags)

USAGE:
  This command provides a STDIO interface for MCP clients that only support
  STDIO transport. It proxies all requests to a centralized 1MCP HTTP server.

  Before using the proxy, ensure a 1MCP server is running:
    1mcp serve

FILTERING OPTIONS (priority order):
  1. --preset <name>      Use preset configuration (highest priority)
  2. --filter <expr>      Filter expression for server selection
  3. --tags <tag1,tag2>   Simple comma-separated tags (lowest priority)

AUTHENTICATION:
  STDIO transport does not support OAuth authentication. Since the server
  has auth disabled by default, the proxy will work out of the box.

  If you enabled auth on the server (--enable-auth), STDIO clients cannot
  authenticate. You must either:
  • Use HTTP/SSE clients instead of STDIO
  • Run a separate server instance without auth for STDIO clients

For more information: https://docs.1mcp.app/guide/commands#proxy
        `);
    },
    async (argv) => {
      const { configureGlobalLogger } = await import('@src/utils/core/configureGlobalLogger.js');
      const { proxyCommand } = await import('./proxy.js');

      // Configure logger with global options
      configureGlobalLogger(argv, 'stdio');

      // Execute proxy command
      await proxyCommand(argv as ProxyOptions);
    },
  );
}
