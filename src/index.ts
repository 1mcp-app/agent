#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { setupServer } from './server.js';
import logger, { enableConsoleTransport } from './logger/logger.js';
import configReloadService from './services/configReloadService.js';
import { ServerManager } from './serverManager.js';
import { ConfigManager } from './config/configManager.js';
import { ExpressServer } from './server/expressServer.js';
import { PORT, HOST } from './constants.js';

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
  .usage('Usage: $0 [options]')
  .env('ONE_MCP') // Enable environment variable parsing with ONE_MCP prefix
  .options({
    transport: {
      alias: 't',
      describe: 'Transport type to use (stdio or http)',
      type: 'string',
      choices: ['stdio', 'http', 'sse'],
      default: 'http',
    },
    port: {
      alias: 'P',
      describe: 'HTTP port to listen on, applicable when transport is http',
      type: 'number',
      default: PORT,
    },
    host: {
      alias: 'H',
      describe: 'HTTP host to listen on, applicable when transport is http',
      type: 'string',
      default: HOST,
    },
    config: {
      alias: 'c',
      describe: 'Path to the config file',
      type: 'string',
      default: undefined,
    },
    tags: {
      alias: 'g',
      describe: 'Tags to filter clients (comma-separated)',
      type: 'string',
      default: undefined,
    },
  })
  .help()
  .alias('help', 'h')
  .parseSync();

/**
 * Set up graceful shutdown handling
 */
function setupGracefulShutdown(serverManager: ServerManager): void {
  const shutdown = async () => {
    logger.info('Shutting down server...');

    // Stop the configuration reload service
    configReloadService.stop();

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
 * Start the server using the specified transport.
 */
async function main() {
  try {
    if (argv.transport !== 'stdio') {
      enableConsoleTransport();
    }

    ConfigManager.getInstance(argv.config);

    // Initialize server and get server manager with custom config path if provided
    const serverManager = await setupServer();

    // Set up graceful shutdown handling
    setupGracefulShutdown(serverManager);

    switch (argv.transport) {
      case 'stdio': {
        // Use stdio transport
        const transport = new StdioServerTransport();
        // Parse and validate tags from CLI if provided
        let tags: string[] | undefined;
        if (argv.tags) {
          tags = argv.tags.split(',').filter((tag) => tag.trim().length > 0);
          if (tags.length === 0) {
            logger.warn('No valid tags provided, ignoring tags parameter');
            tags = undefined;
          }
        }
        await serverManager.connectTransport(transport, 'stdio', tags);
        logger.info('Server started with stdio transport');
        break;
      }
      case 'sse': {
        logger.warning('sse option is deprecated, use http instead');
      }
      // eslint-disable-next-line no-fallthrough
      case 'http': {
        // Use HTTP/SSE transport
        const expressServer = new ExpressServer(serverManager);
        expressServer.start(argv.port, argv.host);
        break;
      }
      default:
        logger.error(`Invalid transport: ${argv.transport}`);
        process.exit(1);
    }
  } catch (error) {
    logger.error('Server error:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error('Server error:', error);
  process.exit(1);
});
