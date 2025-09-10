#!/usr/bin/env node

import 'source-map-support/register.js';

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { setupServer } from './server.js';
import logger, { configureLogger } from './logger/logger.js';
import configReloadService from './services/configReloadService.js';
import { ServerManager } from './core/server/serverManager.js';
import { McpConfigManager } from './config/mcpConfigManager.js';
import { ExpressServer } from './transport/http/server.js';
import { AgentConfigManager } from './core/server/agentConfig.js';
import { PORT, HOST } from './constants.js';
import { displayLogo } from './utils/logo.js';
import { setupAppCommands } from './commands/app/index.js';
import { setupMcpCommands } from './commands/mcp/index.js';
import { setupPresetCommands } from './commands/preset/index.js';
import { McpLoadingManager } from './core/loading/mcpLoadingManager.js';
import { TagQueryParser, TagExpression } from './utils/tagQueryParser.js';
import { globalOptions } from './globalOptions.js';

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
};

// Parse command line arguments and set up commands
let yargsInstance = yargs(hideBin(process.argv));

// Set up base yargs with global options
yargsInstance = yargsInstance
  .usage('Usage: $0 [command] [options]')
  .options(globalOptions)
  .command('$0', 'Start the 1mcp server (default)', serverOptions, () => {
    // Default command handler - will be processed by main()
  })
  .command('serve', 'Start the 1mcp server', serverOptions, () => {
    // Serve command handler - will be processed by main()
  })
  .env('ONE_MCP') // Enable environment variable parsing with ONE_MCP prefix
  .help()
  .alias('help', 'h');

// Register command groups with global options
yargsInstance = setupAppCommands(yargsInstance);
yargsInstance = setupMcpCommands(yargsInstance);
yargsInstance = setupPresetCommands(yargsInstance);

/**
 * Set up graceful shutdown handling
 */
function setupGracefulShutdown(
  serverManager: ServerManager,
  loadingManager?: McpLoadingManager,
  expressServer?: ExpressServer,
): void {
  const shutdown = async () => {
    logger.info('Shutting down server...');

    // Stop the configuration reload service
    configReloadService.stop();

    // Shutdown loading manager if it exists
    if (loadingManager && typeof loadingManager.shutdown === 'function') {
      try {
        loadingManager.shutdown();
        logger.info('Loading manager shutdown complete');
      } catch (error) {
        logger.error(`Error shutting down loading manager: ${error}`);
      }
    }

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
  return argv.length >= 3 && (argv[2] === 'app' || argv[2] === 'mcp' || argv[2] === 'preset');
}

/**
 * Check for conflicting global options (options specified both before and after the command)
 */
function checkGlobalOptionConflicts(argv: string[]): void {
  const globalOptionNames = Object.keys(globalOptions).map((key) => (key.startsWith('--') ? key.slice(2) : key));
  const globalOptionAliases = Object.values(globalOptions)
    .map((opt) => ('alias' in opt ? opt.alias : null))
    .filter(Boolean);
  const allGlobalOptions = [...globalOptionNames, ...globalOptionAliases];

  const commandIndex = argv.findIndex((arg) => arg === 'app' || arg === 'mcp' || arg === 'preset' || arg === 'serve');

  if (commandIndex === -1) return;

  const beforeCommandArgs = argv.slice(0, commandIndex);
  const afterCommandArgs = argv.slice(commandIndex + 1);

  const beforeGlobalOptions = new Set<string>();
  const afterGlobalOptions = new Set<string>();

  // Parse global options before command
  for (let i = 0; i < beforeCommandArgs.length; i++) {
    const arg = beforeCommandArgs[i];
    const optionName = arg.replace(/^--?/, '');

    if (allGlobalOptions.includes(optionName)) {
      beforeGlobalOptions.add(optionName);
    }
  }

  // Parse global options after command
  for (let i = 0; i < afterCommandArgs.length; i++) {
    const arg = afterCommandArgs[i];
    const optionName = arg.replace(/^--?/, '');

    if (allGlobalOptions.includes(optionName)) {
      afterGlobalOptions.add(optionName);
    }
  }

  // Check for conflicts
  const conflicts = Array.from(beforeGlobalOptions).filter((opt) => afterGlobalOptions.has(opt));

  if (conflicts.length > 0) {
    console.error(
      `❌ Error: Cannot specify the following global options both before and after the command: ${conflicts.map((opt) => `--${opt}`).join(', ')}`,
    );
    console.error('   Please specify global options either before OR after the command, not both.');
    console.error('   Example: 1mcp --config test.json mcp list');
    console.error('   OR:      1mcp mcp list --config test.json');
    process.exit(1);
  }
}

/**
 * Check if the command is the serve command (or should default to serve)
 */
function isServeCommand(argv: string[]): boolean {
  // If no command specified (length < 3) or first arg is not a known command, default to serve
  if (argv.length < 3) return true;

  // If explicitly called serve
  if (argv[2] === 'serve') return true;

  // If the third argument starts with '-', it's likely a flag, so default to serve
  if (argv[2].startsWith('-')) return true;

  // Otherwise it's some other command
  return false;
}

/**
 * Start the server using the specified transport.
 */
async function main() {
  // Check for global option conflicts before parsing
  checkGlobalOptionConflicts(process.argv);

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
    // Configure logger with CLI options and transport awareness
    configureLogger({
      logLevel: parsedArgv['log-level'],
      logFile: parsedArgv['log-file'],
      transport: parsedArgv.transport,
    });

    if (parsedArgv.transport !== 'stdio' && !parsedArgv['log-file']) {
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
      ...(parsedArgv['enable-async-loading'] && {
        asyncLoading: {
          enabled: true,
        },
      }),
    });

    // Initialize PresetManager with config directory option before server setup
    // This ensures the singleton is created with the correct config directory
    const PresetManager = (await import('./utils/presetManager.js')).PresetManager;
    PresetManager.getInstance(parsedArgv['config-dir']);

    // Initialize server and get server manager with custom config path if provided
    const { serverManager, loadingManager, asyncOrchestrator } = await setupServer();

    let expressServer: ExpressServer | undefined;

    switch (parsedArgv.transport) {
      case 'stdio': {
        // Use stdio transport
        const transport = new StdioServerTransport();
        // Parse and validate filter from CLI if provided
        let tags: string[] | undefined;
        let tagExpression: TagExpression | undefined;
        let tagFilterMode: 'simple-or' | 'advanced' | 'none' = 'none';

        if (parsedArgv.filter) {
          try {
            // First try to parse as advanced expression
            tagExpression = TagQueryParser.parseAdvanced(parsedArgv.filter);
            tagFilterMode = 'advanced';
            // Provide simple tags for backward compat where possible
            if (tagExpression.type === 'tag') {
              tags = [tagExpression.value!];
            }
          } catch (_advancedError) {
            // Fall back to simple parsing for comma-separated tags
            try {
              tags = TagQueryParser.parseSimple(parsedArgv.filter);
              tagFilterMode = 'simple-or';
              if (!tags || tags.length === 0) {
                logger.warn('No valid tags provided, ignoring filter parameter');
                tags = undefined;
                tagFilterMode = 'none';
              }
            } catch (simpleError) {
              logger.error(
                `Invalid filter expression: ${simpleError instanceof Error ? simpleError.message : 'Unknown error'}`,
              );
              logger.error('Examples:');
              logger.error('  --filter "web,api,database"           # OR logic (comma-separated)');
              logger.error('  --filter "web AND database"           # AND logic');
              logger.error('  --filter "(web OR api) AND database"  # Complex expressions');
              process.exit(1);
            }
          }
        }

        await serverManager.connectTransport(transport, 'stdio', {
          tags,
          tagExpression,
          tagFilterMode,
          enablePagination: parsedArgv.pagination,
        });

        // Initialize notifications for async loading if enabled
        if (asyncOrchestrator) {
          const inboundConnection = serverManager.getServer('stdio');
          if (inboundConnection) {
            asyncOrchestrator.initializeNotifications(inboundConnection);
            logger.info('Async loading notifications initialized for stdio transport');
          }
        }

        logger.info('Server started with stdio transport');
        break;
      }
      case 'sse': {
        logger.warning('sse option is deprecated, use http instead');
      }
      // eslint-disable-next-line no-fallthrough
      case 'http': {
        // Use HTTP/SSE transport
        expressServer = new ExpressServer(serverManager, loadingManager, asyncOrchestrator);
        expressServer.start();
        break;
      }
      default:
        logger.error(`Invalid transport: ${parsedArgv.transport}`);
        process.exit(1);
    }

    // Set up graceful shutdown handling
    setupGracefulShutdown(serverManager, loadingManager, expressServer);

    // Log MCP loading progress (non-blocking)
    loadingManager.on('loading-progress', (summary) => {
      logger.info(
        `MCP loading progress: ${summary.ready}/${summary.totalServers} servers ready (${summary.loading} loading, ${summary.failed} failed)`,
      );
    });

    loadingManager.on('loading-complete', (summary) => {
      logger.info(
        `MCP loading complete: ${summary.ready}/${summary.totalServers} servers ready (${summary.successRate.toFixed(1)}% success rate)`,
      );
    });
  } catch (error) {
    logger.error('Server error:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error('Server error:', error);
  process.exit(1);
});
