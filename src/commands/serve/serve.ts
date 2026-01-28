import fs from 'fs';
import path from 'path';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import ConfigContext from '@src/config/configContext.js';
import { ConfigManager } from '@src/config/configManager.js';
import { getDefaultInstructionsTemplatePath } from '@src/constants.js';
import { getConfigDir } from '@src/constants.js';
import { FlagManager } from '@src/core/flags/flagManager.js';
import { InstructionAggregator } from '@src/core/instructions/instructionAggregator.js';
import { formatValidationError, validateTemplateContent } from '@src/core/instructions/templateValidator.js';
import { LoadingSummary } from '@src/core/loading/loadingStateTracker.js';
import { McpLoadingManager } from '@src/core/loading/mcpLoadingManager.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { cleanupPidFileOnExit, registerPidFileCleanup, writePidFile } from '@src/core/server/pidFileManager.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { TagExpression, TagQueryParser } from '@src/domains/preset/parsers/tagQueryParser.js';
import type { TagQuery } from '@src/domains/preset/types/presetTypes.js';
import logger, { debugIf } from '@src/logger/logger.js';
import { setupServer } from '@src/server.js';
import { ExpressServer } from '@src/transport/http/server.js';
import { displayLogo } from '@src/utils/ui/logo.js';

export interface ServeOptions {
  config?: string;
  'config-dir'?: string;
  'log-level'?: string;
  'log-file'?: string;
  transport: string;
  port: number;
  host: string;
  'external-url'?: string;
  filter?: string;
  pagination: boolean;
  auth: boolean;
  'enable-auth': boolean;
  'enable-scope-validation': boolean;
  'enable-enhanced-security': boolean;
  'session-ttl': number;
  'session-storage-path'?: string;
  'rate-limit-window': number;
  'rate-limit-max': number;
  'trust-proxy': string;
  'health-info-level': string;
  'enable-async-loading': boolean;
  'async-min-servers': number;
  'async-timeout': number;
  'async-batch-notifications': boolean;
  'async-batch-delay': number;
  'async-notify-on-ready': boolean;
  'enable-lazy-loading': boolean;
  'lazy-mode': string;
  'lazy-inline-catalog': boolean;
  'lazy-catalog-format': string;
  'lazy-direct-expose'?: string;
  'lazy-cache-max-entries': number;
  'lazy-cache-ttl'?: number;
  'lazy-preload'?: string;
  'lazy-preload-keywords'?: string;
  'lazy-fallback-on-error'?: string;
  'lazy-fallback-timeout'?: number;
  'enable-config-reload': boolean;
  'config-reload-debounce': number;
  'enable-env-substitution': boolean;
  'enable-session-persistence': boolean;
  'session-persist-requests': number;
  'session-persist-interval': number;
  'session-background-flush': number;
  'enable-client-notifications': boolean;
  'enable-jsonrpc-error-logging': boolean;
  // Internal tool control
  'enable-internal-tools': boolean;
  'internal-tools'?: string;
  'instructions-template'?: string;
}

/**
 * Load custom instructions template from file with validation
 * @param templatePath Path to template file (CLI option or default)
 * @param configDir Config directory for default template location
 * @returns Template content or undefined if not found/error
 */
function loadInstructionsTemplate(templatePath?: string, configDir?: string): string | undefined {
  let templateFilePath: string;

  if (templatePath) {
    // Use provided template path (resolve relative paths)
    templateFilePath = path.isAbsolute(templatePath) ? templatePath : path.resolve(process.cwd(), templatePath);
  } else {
    // Use default template file in config directory
    templateFilePath = getDefaultInstructionsTemplatePath(configDir);
  }

  try {
    if (fs.existsSync(templateFilePath)) {
      const templateContent = fs.readFileSync(templateFilePath, 'utf-8');

      // Validate template content and syntax
      const validation = validateTemplateContent(templateContent, templateFilePath);

      if (!validation.valid) {
        const errorMessage = formatValidationError(validation);
        logger.error(`Invalid instructions template: ${errorMessage}`);

        // For explicit template paths, this is a hard error
        if (templatePath) {
          logger.error('Template validation failed. Server will use built-in template.');
        }

        return undefined;
      }

      logger.info(`Loaded and validated custom instructions template from: ${templateFilePath}`);
      debugIf(() => ({
        message: 'Template length details',
        meta: { templateLength: templateContent.length, templateFilePath },
      }));
      return templateContent;
    } else {
      if (templatePath) {
        // If user explicitly provided a template path, warn about missing file
        logger.warn(`Custom instructions template file not found: ${templateFilePath}`);
        logger.info('Template file resolution:');
        logger.info(`  • Check that the file path is correct`);
        logger.info(`  • Ensure the file has read permissions`);
        logger.info(`  • Use absolute paths or paths relative to current directory`);
        logger.info(`  • Server will use built-in template as fallback`);
      } else {
        // If using default path, just log debug (it's optional)
        debugIf(() => ({
          message: 'Default instructions template file not found, using built-in template',
          meta: { templateFilePath, usingBuiltIn: true },
        }));
      }
      return undefined;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to load instructions template from ${templateFilePath}: ${errorMessage}`);

    // Provide helpful troubleshooting guidance
    logger.info('Template loading failed. Troubleshooting steps:');
    logger.info(`  • Verify file exists and has read permissions`);
    logger.info(`  • Check file encoding (should be UTF-8)`);
    logger.info(`  • Ensure no other process is locking the file`);
    logger.info(`  • Try using an absolute file path`);
    logger.info(`  • Server will use built-in template as fallback`);

    return undefined;
  }
}

/**
 * Set up graceful shutdown handling
 */
function setupGracefulShutdown(
  serverManager: ServerManager,
  loadingManager?: McpLoadingManager,
  expressServer?: ExpressServer,
  instructionAggregator?: InstructionAggregator,
  configDir?: string,
): void {
  const shutdown = async () => {
    logger.info('Shutting down server...');

    // Stop the configuration reload service
    // Config reload handled by ConfigManager singleton

    // Shutdown loading manager if it exists
    if (loadingManager && typeof loadingManager.shutdown === 'function') {
      try {
        loadingManager.shutdown();
        logger.info('Loading manager shutdown complete');
      } catch (error) {
        logger.error(`Error shutting down loading manager: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Shutdown ExpressServer if it exists
    if (expressServer) {
      try {
        expressServer.shutdown();
        logger.info('ExpressServer shutdown complete');
      } catch (error) {
        logger.error(`Error shutting down ExpressServer: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Close all transports
    for (const [sessionId, transport] of serverManager.getTransports().entries()) {
      try {
        transport?.close();
        logger.info(`Closed transport: ${sessionId}`);
      } catch (error) {
        logger.error(`Error closing transport ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Cleanup InstructionAggregator if it exists
    if (instructionAggregator && typeof instructionAggregator.cleanup === 'function') {
      try {
        instructionAggregator.cleanup();
        logger.info('InstructionAggregator cleanup complete');
      } catch (error) {
        logger.error(
          `Error cleaning up InstructionAggregator: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Cleanup PresetManager if it exists
    try {
      const PresetManager = (await import('@src/domains/preset/manager/presetManager.js')).PresetManager;
      const presetManager = PresetManager.getInstance();
      if (presetManager && typeof presetManager.cleanup === 'function') {
        await presetManager.cleanup();
        logger.info('PresetManager cleanup complete');
      }
    } catch (error) {
      logger.error(`Error cleaning up PresetManager: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Cleanup PID file if configDir is available
    if (configDir) {
      try {
        cleanupPidFileOnExit(configDir);
        logger.info('PID file cleanup complete');
      } catch (error) {
        logger.error(`Error cleaning up PID file: ${error instanceof Error ? error.message : String(error)}`);
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
export async function serveCommand(parsedArgv: ServeOptions): Promise<void> {
  try {
    // Initialize ConfigContext with CLI options
    const configContext = ConfigContext.getInstance();
    if (parsedArgv.config) {
      configContext.setConfigPath(parsedArgv.config);
    } else if (parsedArgv['config-dir']) {
      configContext.setConfigDir(parsedArgv['config-dir']);
    } else {
      configContext.reset();
    }

    // Initialize MCP config manager using resolved config path
    const configFilePath = configContext.getResolvedConfigPath();
    const mcpConfigManager = ConfigManager.getInstance(configFilePath);

    // Get server count for logo display
    const transportConfig = mcpConfigManager.getTransportConfig();
    const serverCount = Object.keys(transportConfig).length;

    // Handle backward compatibility for auth flag
    const authEnabled = parsedArgv['enable-auth'] ?? parsedArgv['auth'] ?? false;

    // Display logo with runtime information (skip for stdio or when logging to file)
    if (parsedArgv.transport !== 'stdio' && !parsedArgv['log-file']) {
      displayLogo({
        transport: parsedArgv.transport,
        port: parsedArgv.port,
        host: parsedArgv.host,
        serverCount,
        authEnabled,
        logLevel: parsedArgv['log-level'],
        configDir: getConfigDir(parsedArgv['config-dir']),
      });
    }

    // Configure server settings from CLI arguments
    const serverConfigManager = AgentConfigManager.getInstance();
    const scopeValidationEnabled = parsedArgv['enable-scope-validation'] ?? authEnabled;
    const enhancedSecurityEnabled = parsedArgv['enable-enhanced-security'] ?? false;

    // Handle trust proxy configuration (convert 'true'/'false' strings to boolean)
    const trustProxyValue = parsedArgv['trust-proxy'];
    const trustProxy = trustProxyValue === 'true' ? true : trustProxyValue === 'false' ? false : trustProxyValue;

    // Derive session storage path: explicit option > config-dir/sessions > global default
    let sessionStoragePath = parsedArgv['session-storage-path'];
    if (!sessionStoragePath && parsedArgv['config-dir']) {
      // When config-dir is specified but session-storage-path is not,
      // store sessions within the config directory to maintain isolation
      sessionStoragePath = path.join(parsedArgv['config-dir'], 'sessions');
    }

    serverConfigManager.updateConfig({
      host: parsedArgv.host,
      port: parsedArgv.port,
      externalUrl: parsedArgv['external-url'],
      trustProxy,
      auth: {
        enabled: authEnabled,
        sessionTtlMinutes: parsedArgv['session-ttl'],
        sessionStoragePath,
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
        configReload: parsedArgv['enable-config-reload'],
        envSubstitution: parsedArgv['enable-env-substitution'],
        sessionPersistence: parsedArgv['enable-session-persistence'],
        clientNotifications: parsedArgv['enable-client-notifications'],
        jsonRpcErrorLogging: parsedArgv['enable-jsonrpc-error-logging'],
        // Internal tool configuration from CLI flags
        internalTools: parsedArgv['enable-internal-tools'],
        internalToolsList: parsedArgv['internal-tools']
          ? (() => {
              try {
                const flagManager = FlagManager.getInstance();
                return flagManager.parseToolsList(parsedArgv['internal-tools']);
              } catch (error) {
                logger.error(
                  `Failed to parse internal-tools list: ${error instanceof Error ? error.message : String(error)}`,
                );
                process.exit(1);
              }
            })()
          : [],
      },
      health: {
        detailLevel: parsedArgv['health-info-level'] as 'full' | 'basic' | 'minimal',
      },
      asyncLoading: {
        enabled: parsedArgv['enable-async-loading'],
        notifyOnServerReady: parsedArgv['async-notify-on-ready'],
        waitForMinimumServers: parsedArgv['async-min-servers'],
        initialLoadTimeoutMs: parsedArgv['async-timeout'],
        batchNotifications: parsedArgv['async-batch-notifications'],
        batchDelayMs: parsedArgv['async-batch-delay'],
      },
      lazyLoading: {
        enabled: parsedArgv['enable-lazy-loading'],
        inlineCatalog: parsedArgv['lazy-inline-catalog'],
        catalogFormat: (parsedArgv['lazy-catalog-format'] || 'grouped') as 'flat' | 'grouped' | 'categorized',
        directExpose: parsedArgv['lazy-direct-expose']
          ? parsedArgv['lazy-direct-expose'].split(',').map((s) => s.trim())
          : [],
        cache: {
          maxEntries: parsedArgv['lazy-cache-max-entries'],
          strategy: 'lru' as const,
          ttlMs: parsedArgv['lazy-cache-ttl'],
        },
        preload: {
          patterns: parsedArgv['lazy-preload'] ? parsedArgv['lazy-preload'].split(',').map((s) => s.trim()) : [],
          keywords: parsedArgv['lazy-preload-keywords']
            ? parsedArgv['lazy-preload-keywords'].split(',').map((s) => s.trim())
            : [],
        },
        fallback: {
          onError: (parsedArgv['lazy-fallback-on-error'] || 'skip') as 'skip' | 'full',
          timeoutMs: parsedArgv['lazy-fallback-timeout'] ?? 30000,
        },
      },
      configReload: {
        debounceMs: parsedArgv['config-reload-debounce'],
      },
      sessionPersistence: {
        persistRequests: parsedArgv['session-persist-requests'],
        persistIntervalMinutes: parsedArgv['session-persist-interval'],
        backgroundFlushSeconds: parsedArgv['session-background-flush'],
      },
    });

    // Initialize PresetManager with config directory option before server setup
    // This ensures the singleton is created with the correct config directory
    const PresetManager = (await import('@src/domains/preset/manager/presetManager.js')).PresetManager;
    PresetManager.getInstance(parsedArgv['config-dir']);

    // Initialize server and get server manager with custom config path if provided
    const { serverManager, loadingManager, asyncOrchestrator, instructionAggregator } =
      await setupServer(configFilePath);

    // Load custom instructions template if provided (applies to all transport types)
    const customTemplate = loadInstructionsTemplate(parsedArgv['instructions-template'], parsedArgv['config-dir']);

    let expressServer: ExpressServer | undefined;

    switch (parsedArgv.transport) {
      case 'stdio': {
        // DEPRECATION WARNING
        logger.warn('⚠️  DEPRECATION WARNING: `serve --transport stdio` is deprecated');
        logger.warn('⚠️  Please use `1mcp proxy` instead for better compatibility');
        logger.warn('⚠️  This mode may be removed in a future major version');
        logger.warn('');
        logger.warn('Migration guide:');
        logger.warn('  1. Start HTTP server: 1mcp serve');
        logger.warn('  2. Use proxy command: 1mcp proxy');
        logger.warn('');

        // Use stdio transport
        const transport = new StdioServerTransport();
        // Parse and validate filter from CLI if provided
        let tags: string[] | undefined;
        let tagExpression: TagExpression | undefined;
        let tagQuery: TagQuery | undefined;
        let tagFilterMode: 'simple-or' | 'advanced' | 'preset' | 'none' = 'none';
        let presetName: string | undefined;

        // Check for preset environment variable (for STDIO transport)
        const presetEnv = process.env.ONE_MCP_PRESET;
        if (presetEnv) {
          const PresetManager = (await import('@src/domains/preset/manager/presetManager.js')).PresetManager;
          const presetManager = PresetManager.getInstance(parsedArgv['config-dir']);

          // Load presets synchronously for STDIO transport (skip file watching to avoid blocking)
          try {
            await presetManager.loadPresetsWithoutWatcher();
          } catch (error) {
            logger.warn(`Failed to load presets: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }

          // Load presets if not already loaded
          if (presetManager.hasPreset(presetEnv)) {
            const preset = presetManager.getPreset(presetEnv);
            if (preset) {
              presetName = presetEnv;
              tagQuery = preset.tagQuery;
              tagFilterMode = 'preset';

              // Convert tagQuery to tagExpression for compatibility
              try {
                // Convert JSON query to expression string first
                const queryStr = presetManager.resolvePresetToExpression(presetEnv);
                if (queryStr) {
                  tagExpression = TagQueryParser.parseAdvanced(queryStr);
                  // Provide simple tags for backward compat where possible
                  if (tagExpression?.type === 'tag') {
                    tags = [tagExpression.value!];
                  }
                }
                logger.info(`Loaded preset '${presetEnv}' for STDIO transport`, {
                  strategy: preset.strategy,
                  tagQuery,
                });
              } catch (error) {
                logger.warn(
                  `Failed to parse preset tag query as expression: ${error instanceof Error ? error.message : 'Unknown error'}`,
                );
              }
            }
          } else {
            logger.warn(`Preset '${presetEnv}' not found, ignoring preset environment variable`);
          }
        }

        // Fall back to CLI filter if no preset was loaded
        if (!presetName && parsedArgv.filter) {
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
          tagQuery,
          tagFilterMode,
          presetName,
          enablePagination: parsedArgv.pagination,
          customTemplate,
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
      // Reason: Intentional fallthrough from deprecated 'sse' to 'http' case for backward compatibility
      // eslint-disable-next-line no-fallthrough
      case 'http': {
        // Use HTTP/SSE transport
        expressServer = new ExpressServer(serverManager, loadingManager, asyncOrchestrator, customTemplate);
        expressServer.start();

        // Write PID file for proxy auto-discovery
        const configDir = getConfigDir(parsedArgv['config-dir']);
        const serverUrl = serverConfigManager.getUrl();
        writePidFile(configDir, {
          pid: process.pid,
          url: `${serverUrl}/mcp`,
          port: parsedArgv.port,
          host: parsedArgv.host,
          transport: 'http',
          startedAt: new Date().toISOString(),
          configDir,
        });

        // Register cleanup handlers
        registerPidFileCleanup(configDir);

        break;
      }
      default:
        logger.error(`Invalid transport: ${parsedArgv.transport}`);
        process.exit(1);
    }

    // Set up graceful shutdown handling
    const configDir = getConfigDir(parsedArgv['config-dir']);
    setupGracefulShutdown(serverManager, loadingManager, expressServer, instructionAggregator, configDir);

    // Log MCP loading progress (non-blocking)
    loadingManager.on('loading-progress', (summary: LoadingSummary) => {
      logger.info(
        `MCP loading progress: ${summary.ready}/${summary.totalServers} servers ready (${summary.loading} loading, ${summary.failed} failed)`,
      );
    });

    loadingManager.on('loading-complete', (summary: LoadingSummary) => {
      logger.info(
        `MCP loading complete: ${summary.ready}/${summary.totalServers} servers ready (${Number(summary.successRate).toFixed(1)}% success rate)`,
      );
    });
  } catch (error) {
    logger.error(`Server error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
