#!/usr/bin/env node

import 'source-map-support/register.js';

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { setupServer } from './server.js';
import logger, { enableConsoleTransport } from './logger/logger.js';
import configReloadService from './services/configReloadService.js';
import { ServerManager } from './core/server/serverManager.js';
import { McpConfigManager } from './config/mcpConfigManager.js';
import { ExpressServer } from './transport/http/server.js';
import { AgentConfigManager } from './core/server/agentConfig.js';
import { PORT, HOST } from './constants.js';
import { displayLogo } from './utils/logo.js';
import { setupAppCommands } from './commands/app/index.js';
import { setupMcpCommands } from './commands/mcp/index.js';

// Define server options that should only be available for serve commands
const serverOptions = {
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
  config: {
    alias: 'c',
    describe: 'Path to the config file',
    type: 'string' as const,
    default: undefined,
  },
  tags: {
    alias: 'g',
    describe: 'Tags to filter clients (comma-separated)',
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
};

// Parse command line arguments and set up commands
let yargsInstance = yargs(hideBin(process.argv));

// Set up base yargs with serve commands having server options
yargsInstance = yargsInstance
  .usage('Usage: $0 [command] [options]')
  .command('$0', 'Start the 1mcp server (default)', serverOptions, () => {
    // Default command handler - will be processed by main()
  })
  .command('serve', 'Start the 1mcp server', serverOptions, () => {
    // Serve command handler - will be processed by main()
  })
  .env('ONE_MCP') // Enable environment variable parsing with ONE_MCP prefix
  .help()
  .alias('help', 'h');

// Register command groups (these will have clean option lists without server options)
yargsInstance = setupAppCommands(yargsInstance);
yargsInstance = setupMcpCommands(yargsInstance);

/**
 * Set up graceful shutdown handling
 */
function setupGracefulShutdown(serverManager: ServerManager, expressServer?: ExpressServer): void {
  const shutdown = async () => {
    logger.info('Shutting down server...');

    // Stop the configuration reload service
    configReloadService.stop();

    // Shutdown ExpressServer if it exists
    if (expressServer) {
      try {
        expressServer.shutdown();
        logger.info('ExpressServer shutdown complete');
      } catch (error) {
        logger.error(`Error shutting down ExpressServer: ${error}`);
      }
    }

    // Close all transports
    for (const [sessionId, transport] of serverManager.getTransports().entries()) {
      try {
        transport?.close();
        logger.info(`Closed transport: ${sessionId}`);
      } catch (error) {
        logger.error(`Error closing transport ${sessionId}: ${error}`);
      }
    }

    logger.info('Server shutdown complete');
    process.exit(0);
  };

  // Handle various signals for graceful shutdown
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);
}

/**
 * Check if the command is a CLI command that should not start the server
 */
function isCliCommand(argv: string[]): boolean {
  return argv.length >= 3 && (argv[2] === 'app' || argv[2] === 'mcp');
}

/**
 * Check if the command is the serve command (or should default to serve)
 */
function isServeCommand(argv: string[]): boolean {
  // If no command specified, default to serve
  if (argv.length < 3) return true;
  // If explicitly called serve
  return argv[2] === 'serve';
}

/**
 * Start the server using the specified transport.
 */
async function main() {
  // Check if this is a CLI command - if so, let yargs handle it and exit
  if (isCliCommand(process.argv)) {
    await yargsInstance.parse();
    return;
  }

  // Check if this is a serve command or should default to serve
  if (!isServeCommand(process.argv)) {
    // Let yargs handle other commands
    await yargsInstance.parse();
    return;
  }

  // Parse arguments asynchronously first
  const parsedArgv = (await yargsInstance.parse()) as any;

  try {
    if (parsedArgv.transport !== 'stdio') {
      enableConsoleTransport();
      displayLogo();
    }

    McpConfigManager.getInstance(parsedArgv.config);

    // Configure server settings from CLI arguments
    const serverConfigManager = AgentConfigManager.getInstance();

    // Handle backward compatibility for auth flag
    const authEnabled = parsedArgv['enable-auth'] ?? parsedArgv['auth'] ?? false;
    const scopeValidationEnabled = parsedArgv['enable-scope-validation'] ?? authEnabled;
    const enhancedSecurityEnabled = parsedArgv['enable-enhanced-security'] ?? false;

    // Handle trust proxy configuration (convert 'true'/'false' strings to boolean)
    const trustProxyValue = parsedArgv['trust-proxy'];
    const trustProxy = trustProxyValue === 'true' ? true : trustProxyValue === 'false' ? false : trustProxyValue;

    serverConfigManager.updateConfig({
      host: parsedArgv.host,
      port: parsedArgv.port,
      externalUrl: parsedArgv['external-url'],
      trustProxy,
      auth: {
        enabled: authEnabled,
        sessionTtlMinutes: parsedArgv['session-ttl'],
        sessionStoragePath: parsedArgv['session-storage-path'],
        oauthCodeTtlMs: 60 * 1000, // 1 minute
        oauthTokenTtlMs: parsedArgv['session-ttl'] * 60 * 1000, // Convert minutes to milliseconds
      },
      rateLimit: {
        windowMs: parsedArgv['rate-limit-window'] * 60 * 1000, // Convert minutes to milliseconds
        max: parsedArgv['rate-limit-max'],
      },
      features: {
        auth: authEnabled,
        scopeValidation: scopeValidationEnabled,
        enhancedSecurity: enhancedSecurityEnabled,
      },
      health: {
        detailLevel: parsedArgv['health-info-level'] as 'full' | 'basic' | 'minimal',
      },
    });

    // Initialize server and get server manager with custom config path if provided
    const serverManager = await setupServer();

    let expressServer: ExpressServer | undefined;

    switch (parsedArgv.transport) {
      case 'stdio': {
        // Use stdio transport
        const transport = new StdioServerTransport();
        // Parse and validate tags from CLI if provided
        let tags: string[] | undefined;
        if (parsedArgv.tags) {
          tags = parsedArgv.tags.split(',').filter((tag: string) => tag.trim().length > 0);
          if (tags && tags.length === 0) {
            logger.warn('No valid tags provided, ignoring tags parameter');
            tags = undefined;
          }
        }
        await serverManager.connectTransport(transport, 'stdio', { tags, enablePagination: parsedArgv.pagination });
        logger.info('Server started with stdio transport');
        break;
      }
      case 'sse': {
        logger.warning('sse option is deprecated, use http instead');
      }
      // eslint-disable-next-line no-fallthrough
      case 'http': {
        // Use HTTP/SSE transport
        expressServer = new ExpressServer(serverManager);
        expressServer.start();
        break;
      }
      default:
        logger.error(`Invalid transport: ${parsedArgv.transport}`);
        process.exit(1);
    }

    // Set up graceful shutdown handling
    setupGracefulShutdown(serverManager, expressServer);
  } catch (error) {
    logger.error('Server error:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error('Server error:', error);
  process.exit(1);
});
