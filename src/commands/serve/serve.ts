import fs from 'fs';
import path from 'path';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { ConfigManager } from '@src/config/configManager.js';
import { getDefaultInstructionsTemplatePath, HOST, PORT } from '@src/constants.js';
import { InstructionAggregator } from '@src/core/instructions/instructionAggregator.js';
import { formatValidationError, validateTemplateContent } from '@src/core/instructions/templateValidator.js';
import { LoadingSummary } from '@src/core/loading/loadingStateTracker.js';
import { McpLoadingManager } from '@src/core/loading/mcpLoadingManager.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { cleanupPidFileOnExit, registerPidFileCleanup, writePidFile } from '@src/core/server/pidFileManager.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { GlobalOptions } from '@src/globalOptions.js';
import { configureGlobalLogger } from '@src/logger/configureGlobalLogger.js';
import logger, { debugIf } from '@src/logger/logger.js';
import { resolveLoggingConfig } from '@src/logger/loggingConfig.js';
import { setupServer } from '@src/server.js';
import { ExpressServer } from '@src/transport/http/server.js';
import { displayLogo } from '@src/utils/ui/logo.js';

import { resolveServeConfigPaths } from './runtimeScope.js';
import { parseCommaSeparatedList, parseInternalToolsList, resolveStdioFilterConfig } from './serveOptions.js';

export interface ServeOptions {
  config?: string;
  'config-dir'?: string;
  /** Lifecycle action: report the scoped runtime's state and exit. */
  status?: boolean;
  /** Lifecycle action: start the runtime as a detached background process. */
  background?: boolean;
  /** Lifecycle action: stop the runtime in the selected Runtime Scope. */
  stop?: boolean;
  /** Lifecycle action: stop (if running) then start a fresh background runtime. */
  restart?: boolean;
  /** Internal guard set on the detached child to prevent recursive spawning. */
  'background-bootstrap'?: boolean;
  'log-level'?: 'debug' | 'info' | 'warn' | 'error';
  'log-file'?: string;
  transport?: string;
  port?: number;
  host?: string;
  'external-url'?: string;
  preset?: string;
  filter?: string;
  pagination: boolean;
  auth?: boolean;
  'enable-auth'?: boolean;
  'enable-scope-validation'?: boolean;
  'enable-enhanced-security'?: boolean;
  'session-ttl'?: number;
  'session-storage-path'?: string;
  'rate-limit-window'?: number;
  'rate-limit-max'?: number;
  'trust-proxy'?: string;
  'health-info-level': string;
  'enable-async-loading'?: boolean;
  'async-min-servers'?: number;
  'async-timeout'?: number;
  'async-batch-notifications'?: boolean;
  'async-batch-delay'?: number;
  'async-notify-on-ready': boolean;
  'enable-lazy-loading'?: boolean;
  'lazy-mode'?: string;
  'lazy-inline-catalog'?: boolean;
  'lazy-catalog-format': string;
  'lazy-direct-expose'?: string;
  'lazy-cache-max-entries'?: number;
  'lazy-cache-ttl'?: number;
  'lazy-preload'?: string;
  'lazy-preload-keywords'?: string;
  'lazy-fallback-on-error'?: string;
  'lazy-fallback-timeout'?: number;
  'enable-config-reload'?: boolean;
  'config-reload-debounce'?: number;
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
    const { configFilePath, runtimeScope } = resolveServeConfigPaths(parsedArgv);

    // Lifecycle actions short-circuit before any server setup. They operate on
    // the Runtime Scope via the lifecycle module and then exit.
    if (parsedArgv.status) {
      const { runServeStatus } = await import('./serveStatus.js');
      await runServeStatus(runtimeScope);
      return;
    }

    if (parsedArgv.stop) {
      const { runServeStop } = await import('./serveStop.js');
      await runServeStop(runtimeScope);
      return;
    }

    // Restart: stop the scoped runtime (if any) then start a fresh detached
    // background runtime. The guard mirrors the background branch; the detached
    // child never carries --restart, but the check keeps the branch defensive.
    if (parsedArgv.restart && !parsedArgv['background-bootstrap']) {
      const { runServeRestart } = await import('./serveRestart.js');
      await runServeRestart(parsedArgv);
      return;
    }

    // Background parent: spawn a detached child and wait for readiness. The
    // detached child carries the guard flag, so it falls through to the normal
    // serve path below instead of recursively spawning another background.
    if (parsedArgv.background && !parsedArgv['background-bootstrap']) {
      const { runServeBackground } = await import('./serveBackground.js');
      await runServeBackground(parsedArgv);
      return;
    }

    // Initialize MCP config manager using resolved config path
    const mcpConfigManager = ConfigManager.getInstance(configFilePath);

    // Load app-level config from config.toml (CLI args take precedence)
    const appConfig = mcpConfigManager.getAppConfig();

    // Get server count for logo display
    const transportConfig = mcpConfigManager.getTransportConfig();
    const serverCount = Object.keys(transportConfig).length;

    // Handle backward compatibility for auth flag
    const authEnabled = parsedArgv['enable-auth'] ?? parsedArgv['auth'] ?? appConfig.auth?.enabled ?? false;

    // Display logo with runtime information (skip for stdio or when logging to file)
    const effectiveTransport = parsedArgv.transport ?? appConfig.transport ?? 'http';
    const effectivePort = parsedArgv.port ?? appConfig.port ?? PORT;
    const effectiveHost = parsedArgv.host ?? appConfig.host ?? HOST;
    // Resolve logging from normalized CLI/config sources. ONE_MCP_* env vars
    // are already merged into parsedArgv by yargs; legacy LOG_LEVEL handling is
    // centralized in logger.configureLogger when no explicit level is supplied.
    const { resolved: resolvedLogging, deprecatedKeys: deprecatedLoggingKeys } = resolveLoggingConfig({
      cli: { level: parsedArgv['log-level'], file: parsedArgv['log-file'] },
      structured: appConfig.logging,
      flat: { level: appConfig.logLevel, file: appConfig.logFile },
    });
    const configuredLogLevel = parsedArgv['log-level'] ?? appConfig.logging?.level ?? appConfig.logLevel;
    configureGlobalLogger(
      {
        ...parsedArgv,
        'log-level': configuredLogLevel as GlobalOptions['log-level'],
        'log-file': resolvedLogging.file,
        maxSize: resolvedLogging.maxSize,
        maxFiles: resolvedLogging.maxFiles,
      },
      effectiveTransport,
    );
    if (deprecatedLoggingKeys.length > 0) {
      logger.warn(
        `⚠️  DEPRECATION WARNING: config keys ${deprecatedLoggingKeys
          .map((key) => `\`${key}\``)
          .join(' and ')} are deprecated. Use the structured \`logging\` block ` +
          '(logging.level / logging.file) instead. The flat keys still work but will be removed in a future release.',
      );
    }
    const effectiveLogFile = resolvedLogging.file;
    if (effectiveTransport !== 'stdio' && !effectiveLogFile) {
      displayLogo({
        transport: effectiveTransport,
        port: effectivePort,
        host: effectiveHost,
        serverCount,
        authEnabled,
        logLevel: resolvedLogging.level,
        configDir: runtimeScope,
      });
    }

    // Configure server settings from CLI arguments (CLI args take precedence over appConfig)
    const serverConfigManager = AgentConfigManager.getInstance();
    const scopeValidationEnabled =
      parsedArgv['enable-scope-validation'] ?? appConfig.auth?.enableScopeValidation ?? true;
    const enhancedSecurityEnabled =
      parsedArgv['enable-enhanced-security'] ?? appConfig.auth?.enableEnhancedSecurity ?? false;

    // Handle trust proxy configuration (convert 'true'/'false' strings to boolean)
    const trustProxyValue = parsedArgv['trust-proxy'] ?? appConfig.auth?.trustProxy ?? 'loopback';
    const trustProxy = trustProxyValue === 'true' ? true : trustProxyValue === 'false' ? false : trustProxyValue;

    // Derive session storage path: explicit option > config-dir/sessions > global default
    let sessionStoragePath = parsedArgv['session-storage-path'];
    if (!sessionStoragePath && (parsedArgv['config-dir'] || parsedArgv.config)) {
      // Store sessions within the selected Runtime Scope to maintain isolation.
      sessionStoragePath = path.join(runtimeScope, 'sessions');
    }

    const internalToolsList = parseInternalToolsList(parsedArgv['internal-tools']);
    const directExpose = parseCommaSeparatedList(parsedArgv['lazy-direct-expose']);
    const preloadPatterns = parseCommaSeparatedList(parsedArgv['lazy-preload']);
    const preloadKeywords = parseCommaSeparatedList(parsedArgv['lazy-preload-keywords']);
    const sessionTtlMinutes = parsedArgv['session-ttl'] ?? appConfig.auth?.sessionTtl ?? 1440;

    serverConfigManager.updateConfig({
      host: effectiveHost,
      port: effectivePort,
      externalUrl: parsedArgv['external-url'],
      trustProxy,
      auth: {
        enabled: authEnabled,
        sessionTtlMinutes,
        sessionStoragePath,
        oauthCodeTtlMs: 60 * 1000, // 1 minute
        oauthTokenTtlMs: sessionTtlMinutes * 60 * 1000,
      },
      rateLimit: {
        windowMs: (parsedArgv['rate-limit-window'] ?? appConfig.auth?.rateLimitWindow ?? 15) * 60 * 1000,
        max: parsedArgv['rate-limit-max'] ?? appConfig.auth?.rateLimitMax ?? 100,
      },
      features: {
        auth: authEnabled,
        scopeValidation: scopeValidationEnabled,
        enhancedSecurity: enhancedSecurityEnabled,
        configReload: parsedArgv['enable-config-reload'] ?? appConfig.configReload?.enabled ?? true,
        envSubstitution: parsedArgv['enable-env-substitution'],
        sessionPersistence: parsedArgv['enable-session-persistence'],
        clientNotifications: parsedArgv['enable-client-notifications'],
        jsonRpcErrorLogging: parsedArgv['enable-jsonrpc-error-logging'],
        // Internal tool configuration from CLI flags
        internalTools: parsedArgv['enable-internal-tools'],
        internalToolsList,
      },
      health: {
        detailLevel: parsedArgv['health-info-level'] as 'full' | 'basic' | 'minimal',
      },
      asyncLoading: {
        enabled: parsedArgv['enable-async-loading'] ?? appConfig.asyncLoading?.enabled ?? false,
        notifyOnServerReady: parsedArgv['async-notify-on-ready'],
        waitForMinimumServers: parsedArgv['async-min-servers'] ?? appConfig.asyncLoading?.minServers ?? 1,
        initialLoadTimeoutMs: parsedArgv['async-timeout'] ?? appConfig.asyncLoading?.timeout ?? 30000,
        batchNotifications:
          parsedArgv['async-batch-notifications'] ?? appConfig.asyncLoading?.batchNotifications ?? true,
        batchDelayMs: parsedArgv['async-batch-delay'] ?? appConfig.asyncLoading?.batchDelay ?? 100,
      },
      lazyLoading: {
        enabled: parsedArgv['enable-lazy-loading'] ?? appConfig.lazyLoading?.enabled ?? false,
        inlineCatalog: parsedArgv['lazy-inline-catalog'] ?? appConfig.lazyLoading?.inlineCatalog ?? false,
        catalogFormat: (parsedArgv['lazy-catalog-format'] || 'grouped') as 'flat' | 'grouped' | 'categorized',
        directExpose,
        cache: {
          maxEntries: parsedArgv['lazy-cache-max-entries'] ?? appConfig.lazyLoading?.cacheMaxEntries ?? 1000,
          strategy: 'lru' as const,
          ttlMs: parsedArgv['lazy-cache-ttl'],
        },
        preload: {
          patterns: preloadPatterns,
          keywords: preloadKeywords,
        },
        fallback: {
          onError: (parsedArgv['lazy-fallback-on-error'] || 'skip') as 'skip' | 'full',
          timeoutMs: parsedArgv['lazy-fallback-timeout'] ?? 30000,
        },
      },
      configReload: {
        debounceMs: parsedArgv['config-reload-debounce'] ?? appConfig.configReload?.debounce ?? 500,
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
    PresetManager.getInstance(runtimeScope);

    // Initialize server and get server manager with custom config path if provided
    const { serverManager, loadingManager, asyncOrchestrator, instructionAggregator } =
      await setupServer(configFilePath);

    // Load custom instructions template if provided (applies to all transport types)
    const customTemplate = loadInstructionsTemplate(parsedArgv['instructions-template'], runtimeScope);

    let expressServer: ExpressServer | undefined;

    switch (effectiveTransport) {
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
        const filterConfig = await resolveStdioFilterConfig(parsedArgv);
        if (!filterConfig) {
          return;
        }

        await serverManager.connectTransport(transport, 'stdio', {
          ...filterConfig,
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
        const serverUrl = serverConfigManager.getUrl();
        writePidFile(runtimeScope, {
          pid: process.pid,
          url: `${serverUrl}/mcp`,
          port: effectivePort,
          host: effectiveHost,
          transport: 'http',
          startedAt: new Date().toISOString(),
          configDir: runtimeScope,
          // Record the effective log file so `serve --status` reports the real
          // path rather than recomputing a default that would be wrong under an
          // explicit `--log-file`. Undefined when no log file is configured.
          logFile: effectiveLogFile,
        });

        // Register cleanup handlers
        registerPidFileCleanup(runtimeScope);

        break;
      }
      default:
        logger.error(`Invalid transport: ${effectiveTransport}`);
        process.exit(1);
    }

    // Set up graceful shutdown handling
    setupGracefulShutdown(serverManager, loadingManager, expressServer, instructionAggregator, runtimeScope);

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
