import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import fs from 'fs';
import path from 'path';

import { setupServer } from '../../server.js';
import logger, { debugIf } from '../../logger/logger.js';
import configReloadService from '../../services/configReloadService.js';
import { ServerManager } from '../../core/server/serverManager.js';
import { McpConfigManager } from '../../config/mcpConfigManager.js';
import { ExpressServer } from '../../transport/http/server.js';
import { AgentConfigManager } from '../../core/server/agentConfig.js';
import { displayLogo } from '../../utils/logo.js';
import { McpLoadingManager } from '../../core/loading/mcpLoadingManager.js';
import { TagQueryParser, TagExpression } from '../../utils/tagQueryParser.js';
import ConfigContext from '../../config/configContext.js';
import { getDefaultInstructionsTemplatePath } from '../../constants.js';
import { validateTemplateContent, formatValidationError } from '../../core/instructions/templateValidator.js';
import { InstructionAggregator } from '../../core/instructions/instructionAggregator.js';

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

    // Cleanup InstructionAggregator if it exists
    if (instructionAggregator && typeof instructionAggregator.cleanup === 'function') {
      try {
        instructionAggregator.cleanup();
        logger.info('InstructionAggregator cleanup complete');
      } catch (error) {
        logger.error(`Error cleaning up InstructionAggregator: ${error}`);
      }
    }

    // Cleanup PresetManager if it exists
    try {
      const PresetManager = (await import('../../utils/presetManager.js')).PresetManager;
      const presetManager = PresetManager.getInstance();
      if (presetManager && typeof presetManager.cleanup === 'function') {
        await presetManager.cleanup();
        logger.info('PresetManager cleanup complete');
      }
    } catch (error) {
      logger.error(`Error cleaning up PresetManager: ${error}`);
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
    if (parsedArgv.transport !== 'stdio' && !parsedArgv['log-file']) {
      displayLogo();
    }

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
    McpConfigManager.getInstance(configFilePath);

    // Configure server settings from CLI arguments
    const serverConfigManager = AgentConfigManager.getInstance();

    // Handle backward compatibility for auth flag
    const authEnabled = parsedArgv['enable-auth'] ?? parsedArgv['auth'] ?? false;
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
      },
      health: {
        detailLevel: parsedArgv['health-info-level'] as 'full' | 'basic' | 'minimal',
      },
      ...(parsedArgv['enable-async-loading'] && {
        asyncLoading: {
          enabled: true,
          notifyOnServerReady: true,
          waitForMinimumServers: 1,
          initialLoadTimeoutMs: 30000,
          batchNotifications: true,
          batchDelayMs: 100,
        },
      }),
    });

    // Initialize PresetManager with config directory option before server setup
    // This ensures the singleton is created with the correct config directory
    const PresetManager = (await import('../../utils/presetManager.js')).PresetManager;
    PresetManager.getInstance(parsedArgv['config-dir']);

    // Initialize server and get server manager with custom config path if provided
    const { serverManager, loadingManager, asyncOrchestrator, instructionAggregator } = await setupServer();

    // Load custom instructions template if provided (applies to all transport types)
    const customTemplate = loadInstructionsTemplate(parsedArgv['instructions-template'], parsedArgv['config-dir']);

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
      // eslint-disable-next-line no-fallthrough
      case 'http': {
        // Use HTTP/SSE transport
        expressServer = new ExpressServer(serverManager, loadingManager, asyncOrchestrator, customTemplate);
        expressServer.start();
        break;
      }
      default:
        logger.error(`Invalid transport: ${parsedArgv.transport}`);
        process.exit(1);
    }

    // Set up graceful shutdown handling
    setupGracefulShutdown(serverManager, loadingManager, expressServer, instructionAggregator);

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
