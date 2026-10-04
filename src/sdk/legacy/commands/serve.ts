import fs from 'fs';
import path from 'path';

import { activateUpstreamOAuthStore } from '@src/auth/storage/upstreamOAuthStorage.js';
import { resolveUpstreamOAuthStorageBaseDir } from '@src/auth/storage/upstreamOAuthStoragePath.js';
import { resolveAsyncLoadingOptions } from '@src/commands/serve/asyncLoadingOptions.js';
import { resolveServeConfigPaths } from '@src/commands/serve/runtimeScope.js';
import { describeServeLifecycleFailure } from '@src/commands/serve/serveLifecycleError.js';
import {
  parseCommaSeparatedList,
  parseInternalToolsList,
  resolveStdioFilterConfig,
} from '@src/commands/serve/serveOptions.js';
import { resolveTemplateContextTrust } from '@src/commands/serve/templateContextTrust.js';
import { ConfigManager } from '@src/config/configManager.js';
import { getDefaultInstructionsTemplatePath, HOST, PORT } from '@src/constants.js';
import { ClientManager } from '@src/core/client/clientManager.js';
import {
  TemplateContextCapabilityError,
  TemplateContextCapabilityStore,
  type TemplateContextTrustMode,
} from '@src/core/context/templateContextTrust.js';
import { InstructionAggregator } from '@src/core/instructions/instructionAggregator.js';
import { validateTemplateContent } from '@src/core/instructions/templateValidator.js';
import { LoadingSummary } from '@src/core/loading/loadingStateTracker.js';
import { McpLoadingManager } from '@src/core/loading/mcpLoadingManager.js';
import { RuntimeIdentityService } from '@src/core/runtime/runtimeIdentityService.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { getBackgroundLaunchConfigPath, readBackgroundLaunchConfig } from '@src/core/server/backgroundLaunchConfig.js';
import { cleanupPidFileOnExit, registerPidFileCleanup, writePidFile } from '@src/core/server/pidFileManager.js';
import type { RuntimeLaunchBootstrap } from '@src/core/server/runtimeLaunchIpc.js';
import {
  claimRuntimeScope,
  type RuntimeScopeOwnership,
  verifyRuntimeScopeOwnership,
} from '@src/core/server/runtimeScopeOwnership.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { resetBackendLogBroker } from '@src/domains/backend-logs/backendLogRuntime.js';
import { GlobalOptions } from '@src/globalOptions.js';
import { configureGlobalLogger } from '@src/logger/configureGlobalLogger.js';
import logger, { debugIf } from '@src/logger/logger.js';
import { resolveLoggingConfig } from '@src/logger/loggingConfig.js';
import { StdioServerTransport } from '@src/sdk/legacy/server/stdio.js';
import { setupServer } from '@src/server.js';
import { ExpressServer } from '@src/transport/http/server.js';
import { InsecureFilePermissionsError } from '@src/utils/filePermissions.js';
import { displayLogo } from '@src/utils/ui/logo.js';

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
  'drain-timeout'?: number;
  'on-drain-timeout'?: 'restart' | 'abort';
  'cooperative-bootstrap'?: 'supervisor' | 'worker';
  /** Internal guard set on the detached child to prevent recursive spawning. */
  'background-bootstrap'?: boolean;
  /** Internal authorization proving that a supervised worker belongs to the scoped supervisor. */
  'runtime-owner-claim-id'?: string;
  /** Internal validated app-config snapshot used by supervised workers. */
  'background-launch-config'?: string;
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
  'credential-store'?: 'file' | 'native';
  'rate-limit-window'?: number;
  'rate-limit-max'?: number;
  'trust-proxy'?: string;
  'template-context-trust'?: TemplateContextTrustMode;
  'confirm-untrusted-template-context'?: boolean;
  'health-info-level': string;
  'enable-async-loading'?: boolean;
  'async-min-servers'?: number;
  'async-timeout'?: number;
  'async-batch-notifications'?: boolean;
  'async-batch-delay'?: number;
  'async-notify-on-snapshot'?: boolean;
  'async-notify-on-ready'?: boolean;
  'async-max-concurrent-loads'?: number;
  'async-max-retries'?: number;
  'async-retry-delay'?: number;
  'async-background-retry'?: boolean;
  'async-background-retry-interval'?: number;
  'async-background-retry-max-servers'?: number;
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
        logger.error('serve.invalid.instructions.template.811a8b70');

        // For explicit template paths, this is a hard error
        if (templatePath) {
          logger.error('serve.template.validation.failed.server.will.use.built.in.template.7078ba5c');
        }

        return undefined;
      }

      logger.info('serve.loaded.and.validated.custom.instructions.template.from.3751f580');
      debugIf(() => ({ message: 'serve.template.length.details.9ac93eda' }));
      return templateContent;
    } else {
      if (templatePath) {
        // If user explicitly provided a template path, warn about missing file
        logger.warn('serve.custom.instructions.template.file.not.found.659ae3c3');
        logger.info('serve.template.file.resolution.606e9dfc');
        logger.info('serve.check.that.the.file.path.is.correct.cc805876');
        logger.info('serve.ensure.the.file.has.read.permissions.d3e15e7b');
        logger.info('serve.use.absolute.paths.or.paths.relative.to.current.directory.6a968d90');
        logger.info('serve.server.will.use.built.in.template.as.fallback.5dd65ea9');
      } else {
        // If using default path, just log debug (it's optional)
        debugIf(() => ({
          message: 'serve.default.instructions.template.file.not.found.using.built.in.template.3fd48023',
        }));
      }
      return undefined;
    }
  } catch (_error) {
    logger.error('serve.failed.to.load.instructions.template.from.cf604d83', { error: _error });

    // Provide helpful troubleshooting guidance
    logger.info('serve.template.loading.failed.troubleshooting.steps.d7a3ed11');
    logger.info('serve.verify.file.exists.and.has.read.permissions.04b2cb6d');
    logger.info('serve.check.file.encoding.should.be.utf.8.347ababb');
    logger.info('serve.ensure.no.other.process.is.locking.the.file.e98e6671');
    logger.info('serve.try.using.an.absolute.file.path.7145b186');
    logger.info('serve.server.will.use.built.in.template.as.fallback.5dd65ea9');

    return undefined;
  }
}

function warnForLegacyLazyLoadingOptions(parsedArgv: ServeOptions): void {
  if (parsedArgv['lazy-mode'] !== undefined) {
    logger.warn('serve.deprecation.warning.lazy.mode.is.ignored.lazy.loading.is.controlled.only.by.9d79d3a4');
  }

  if (parsedArgv['lazy-direct-expose'] !== undefined) {
    logger.warn('serve.deprecation.warning.lazy.direct.expose.is.ignored.lazy.loading.exposes.only.bac35051');
  }
}

/**
 * Set up graceful shutdown handling
 */
export function setupGracefulShutdown(
  serverManager: ServerManager,
  loadingManager?: McpLoadingManager,
  expressServer?: ExpressServer,
  instructionAggregator?: InstructionAggregator,
  configDir?: string,
  runtimeOwnership?: RuntimeScopeOwnership,
): void {
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = async () => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      logger.info('serve.shutting.down.server.7bd0e75c');

      // Stop the configuration reload service
      // Config reload handled by ConfigManager singleton

      // Shutdown loading manager if it exists
      if (loadingManager && typeof loadingManager.shutdown === 'function') {
        try {
          loadingManager.shutdown();
          logger.info('serve.loading.manager.shutdown.complete.0bedfd3f');
        } catch (_error) {
          logger.error('serve.error.shutting.down.loading.manager.ecaf9547', { error: _error });
        }
      }

      try {
        await ClientManager.shutdownCurrent();
        logger.info('serve.clientmanager.shutdown.complete.6185d545');
      } catch (_error) {
        logger.error('serve.error.shutting.down.clientmanager.c3553270', { error: _error });
      }

      try {
        await serverManager.cleanup();
        logger.info('serve.servermanager.cleanup.complete.7aa4ec75');
      } catch (_error) {
        logger.error('serve.error.cleaning.up.servermanager.b2e3ed7d', { error: _error });
      }

      // Shutdown ExpressServer if it exists
      if (expressServer) {
        try {
          expressServer.shutdown();
          logger.info('serve.expressserver.shutdown.complete.83758030');
        } catch (_error) {
          logger.error('serve.error.shutting.down.expressserver.582eaa65', { error: _error });
        }
      }

      // Close all transports
      for (const [_sessionId, transport] of serverManager.getTransports().entries()) {
        try {
          transport?.close();
          logger.info('serve.closed.transport.0211d5c5');
        } catch (_error) {
          logger.error('serve.error.closing.transport.7d2d3d15', { error: _error });
        }
      }

      // Cleanup InstructionAggregator if it exists
      if (instructionAggregator && typeof instructionAggregator.cleanup === 'function') {
        try {
          instructionAggregator.cleanup();
          logger.info('serve.instructionaggregator.cleanup.complete.efba68f2');
        } catch (_error) {
          logger.error('serve.error.cleaning.up.instructionaggregator.46768b4e', { error: _error });
        }
      }

      // Cleanup PresetManager if it exists
      try {
        const PresetManager = (await import('@src/domains/preset/manager/presetManager.js')).PresetManager;
        const presetManager = PresetManager.getInstance();
        if (presetManager && typeof presetManager.cleanup === 'function') {
          await presetManager.cleanup();
          logger.info('serve.presetmanager.cleanup.complete.b9467741');
        }
      } catch (_error) {
        logger.error('serve.error.cleaning.up.presetmanager.55eb9b77', { error: _error });
      }

      // Cleanup PID file if configDir is available
      if (configDir) {
        try {
          cleanupPidFileOnExit(configDir);
          logger.info('serve.pid.file.cleanup.complete.85339e55');
        } catch (_error) {
          logger.error('serve.error.cleaning.up.pid.file.336e4ac3', { error: _error });
        }
      }

      runtimeOwnership?.release();

      logger.info('serve.server.shutdown.complete.fad6a0b9');
      process.exit(0);
    })();

    return shutdownPromise;
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
  let runtimeOwnership: RuntimeScopeOwnership | undefined;
  try {
    let cooperativeLaunch: RuntimeLaunchBootstrap | undefined;
    const cooperative = parsedArgv['cooperative-bootstrap']
      ? await import('@src/commands/serve/cooperativeRuntime.js')
      : undefined;
    if (parsedArgv['cooperative-bootstrap'] === 'supervisor') {
      await cooperative!.runCooperativeSupervisor();
      return;
    }
    if (parsedArgv['cooperative-bootstrap'] === 'worker') {
      cooperativeLaunch = await cooperative!.authorizeCooperativeWorker();
      parsedArgv = {
        ...parsedArgv,
        ...cooperativeLaunch.options,
        status: false,
        stop: false,
        restart: false,
        background: false,
        'background-bootstrap': false,
        'runtime-owner-claim-id': cooperativeLaunch.claimId,
      };
    }
    const { configFilePath, runtimeScope } = resolveServeConfigPaths(parsedArgv);

    // Lifecycle actions short-circuit before any server setup. They operate on
    // the Runtime Scope via the lifecycle module and then exit.
    if (parsedArgv.status) {
      const { runServeStatus } = await import('@src/commands/serve/serveStatus.js');
      await runServeStatus(runtimeScope);
      return;
    }

    if (parsedArgv.stop) {
      const { runServeStop } = await import('@src/commands/serve/serveStop.js');
      await runServeStop(runtimeScope);
      return;
    }

    // Restart: stop the scoped runtime (if any) then start a fresh detached
    // background runtime. The guard mirrors the background branch; the detached
    // child never carries --restart, but the check keeps the branch defensive.
    if (parsedArgv.restart && !parsedArgv['background-bootstrap']) {
      const { restartCooperativeRuntime } = await import('@src/commands/serve/cooperativeRuntime.js');
      await restartCooperativeRuntime(parsedArgv);
      return;
    }

    // Background parent: spawn a detached supervisor and wait for its worker's
    // readiness. The supervisor carries the guard flag so it cannot recurse.
    if (parsedArgv.background && !parsedArgv['background-bootstrap']) {
      const { launchCooperativeRuntime } = await import('@src/commands/serve/cooperativeRuntime.js');
      await launchCooperativeRuntime(parsedArgv);
      return;
    }

    const supervisorClaimId = parsedArgv['runtime-owner-claim-id'];
    const launchConfigFile = parsedArgv['background-launch-config'];
    if (launchConfigFile && !supervisorClaimId) {
      throw new Error('Background launch configuration is only valid for an authorized supervised worker');
    }
    if (parsedArgv['background-bootstrap'] && !supervisorClaimId) {
      const { runServeBackgroundSupervisor } = await import('@src/commands/serve/serveBackground.js');
      await runServeBackgroundSupervisor(parsedArgv);
      return;
    }
    if (supervisorClaimId && !cooperativeLaunch) {
      verifyRuntimeScopeOwnership(runtimeScope, supervisorClaimId, 'background-supervisor');
      const expectedLaunchConfigFile = getBackgroundLaunchConfigPath(runtimeScope);
      if (!launchConfigFile || path.resolve(launchConfigFile) !== path.resolve(expectedLaunchConfigFile)) {
        throw new Error('Authorized supervised workers must use the Runtime Scope background launch configuration');
      }
    } else if (!cooperativeLaunch) {
      runtimeOwnership = claimRuntimeScope(runtimeScope, {
        kind: parsedArgv.transport === 'stdio' ? 'foreground-stdio' : 'foreground-http',
      });
      process.once('exit', runtimeOwnership.release);
    }

    // Initialize MCP config manager using resolved config path
    const mcpConfigManager = ConfigManager.getInstance(configFilePath);

    // Load app-level config from config.toml (CLI args take precedence)
    const launchConfig = launchConfigFile ? readBackgroundLaunchConfig(launchConfigFile) : null;
    if (launchConfig && launchConfig.claimId !== supervisorClaimId) {
      throw new Error('Background launch configuration does not match the active supervisor claim');
    }
    const appConfig = launchConfig?.appConfig ?? mcpConfigManager.getAppConfig();

    // Get server count for logo display
    const transportConfig = mcpConfigManager.getTransportConfig();
    const serverCount = Object.keys(transportConfig).length;

    // Handle backward compatibility for auth flag
    const authEnabled = parsedArgv['enable-auth'] ?? parsedArgv['auth'] ?? appConfig.auth?.enabled ?? false;

    // Display logo with runtime information (skip for stdio or when logging to file)
    const effectiveTransport = parsedArgv.transport ?? appConfig.transport ?? 'http';
    const effectivePort = parsedArgv.port ?? appConfig.port ?? PORT;
    const effectiveHost = parsedArgv.host ?? appConfig.host ?? HOST;
    const templateContextTrust = resolveTemplateContextTrust({
      cliTrust: parsedArgv['template-context-trust'],
      configTrust: appConfig.templateContext?.trust,
      host: effectiveHost,
      confirmUntrusted: parsedArgv['confirm-untrusted-template-context'] ?? false,
      transport: effectiveTransport,
    });
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
      logger.warn('serve.deprecation.warning.config.keys.are.deprecated.use.the.structured.logging.b.600bd41d');
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
    const scopeValidationExplicit = parsedArgv['enable-scope-validation'] ?? appConfig.auth?.enableScopeValidation;
    const scopeValidationEnabled = scopeValidationExplicit ?? (authEnabled ? true : false);
    const enhancedSecurityEnabled =
      parsedArgv['enable-enhanced-security'] ?? appConfig.auth?.enableEnhancedSecurity ?? false;

    // Startup guard: detect contradictory security configuration that would silently
    // fail open (auth disabled but scope authorization enforced). Industry references:
    // Kubernetes apiserver rejects `--authorization-config` × `--authorization-mode`
    // conflicts at startup; Auth.js CVE-2026-73421 (CVSS 9.1) is a real-world
    // fail-open caused by config corruption. Policy: WARN and continue (fail-open
    // preserved for backward compatibility); users can silence by disabling
    // --enable-scope-validation when --enable-auth is off. CWE-862 / CWE-636.
    if (!authEnabled && scopeValidationExplicit === true) {
      logger.warn('serve.security.warning.authentication.is.disabled.but.scope.validation.is.enabled.cc1337b3');
    }

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
    warnForLegacyLazyLoadingOptions(parsedArgv);
    const directExpose = parseCommaSeparatedList(parsedArgv['lazy-direct-expose']);
    const preloadPatterns = parseCommaSeparatedList(parsedArgv['lazy-preload']);
    const preloadKeywords = parseCommaSeparatedList(parsedArgv['lazy-preload-keywords']);
    const sessionTtlMinutes = parsedArgv['session-ttl'] ?? appConfig.auth?.sessionTtl ?? 1440;
    const asyncLoading = resolveAsyncLoadingOptions(parsedArgv, appConfig.asyncLoading, (_warning) =>
      logger.warn('serve.asyncloading.diagnostic.912acccb'),
    );

    serverConfigManager.updateConfig({
      host: effectiveHost,
      port: effectivePort,
      externalUrl: parsedArgv['external-url'],
      runtimeScopeStoragePath: runtimeScope,
      trustProxy,
      admin: {
        enabled: appConfig.admin?.enabled ?? true,
        rateLimit: {
          login: {
            windowMs: (appConfig.admin?.rateLimit?.login?.windowSeconds ?? 900) * 1000,
            maxRequests: appConfig.admin?.rateLimit?.login?.maxRequests ?? 30,
            maxFailedAttempts: appConfig.admin?.rateLimit?.login?.maxFailedAttempts ?? 5,
          },
          status: {
            windowMs: (appConfig.admin?.rateLimit?.status?.windowSeconds ?? 60) * 1000,
            maxRequests: appConfig.admin?.rateLimit?.status?.maxRequests ?? 120,
          },
          sensitive: {
            windowMs: (appConfig.admin?.rateLimit?.sensitive?.windowSeconds ?? 900) * 1000,
            maxRequests: appConfig.admin?.rateLimit?.sensitive?.maxRequests ?? 10,
          },
        },
        audit: {
          retentionMs: (appConfig.admin?.audit?.retentionDays ?? 30) * 24 * 60 * 60 * 1000,
        },
      },
      templateContext: {
        trust: templateContextTrust,
      },
      templateInstancePool: {
        maxInstancesPerTemplate: appConfig.templateSettings?.pool?.maxInstancesPerTemplate ?? 50,
        maxTotalInstances: appConfig.templateSettings?.pool?.maxTotalInstances ?? 100,
        idleTimeoutMs: appConfig.templateSettings?.pool?.idleTimeout ?? 300000,
        cleanupIntervalMs: appConfig.templateSettings?.pool?.cleanupInterval ?? 30000,
      },
      auth: {
        credentialStore: parsedArgv['credential-store'] ?? appConfig.auth?.credentialStore ?? 'file',
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
        rateLimit: {
          windowMs: (appConfig.health?.rateLimit?.windowSeconds ?? 300) * 1000,
          maxRequests: appConfig.health?.rateLimit?.maxRequests ?? 200,
        },
      },
      asyncLoading,
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

    await activateUpstreamOAuthStore({
      baseDir: resolveUpstreamOAuthStorageBaseDir(sessionStoragePath),
      mode: parsedArgv['credential-store'] ?? appConfig.auth?.credentialStore ?? 'file',
      runtimeScope,
    });

    if (effectiveTransport !== 'stdio') {
      const runtimeScopeId = new RuntimeIdentityService({ storageDir: runtimeScope }).getRuntimeScopeId();
      try {
        new TemplateContextCapabilityStore({ storageDir: runtimeScope, runtimeScopeId }).getOrCreate();
      } catch (error) {
        if (error instanceof InsecureFilePermissionsError) {
          throw new TemplateContextCapabilityError(
            `Template context capability could not be secured: ${error.message}. ` +
              'Fix the storage directory/file permissions and restart the server.',
          );
        }
        throw error;
      }
      if (templateContextTrust === 'legacy') {
        logger.warn('serve.template.context.trust.is.legacy.unverified.clients.may.render.command.args.867a89a9');
      }
    }

    // Initialize PresetManager with config directory option before server setup
    // This ensures the singleton is created with the correct config directory
    const PresetManager = (await import('@src/domains/preset/manager/presetManager.js')).PresetManager;
    PresetManager.getInstance(runtimeScope);

    // Backend log history is scoped to this Aggregated Runtime invocation.
    resetBackendLogBroker();

    // Initialize server and get server manager with custom config path if provided
    const setup = cooperativeLaunch
      ? await setupServer(configFilePath, undefined, asyncLoading.loadingPolicy, 'cooperative-activation')
      : await setupServer(configFilePath, undefined, asyncLoading.loadingPolicy);
    const { serverManager, loadingManager, asyncOrchestrator, instructionAggregator } = setup;
    if (cooperativeLaunch) {
      void setup.loadingPromise.then(
        () => cooperative!.settleCooperativeInitialLoading(),
        () => cooperative!.settleCooperativeInitialLoading(),
      );
    }

    // Load custom instructions template if provided (applies to all transport types)
    const customTemplate = loadInstructionsTemplate(parsedArgv['instructions-template'], runtimeScope);

    let expressServer: ExpressServer | undefined;

    switch (effectiveTransport) {
      case 'stdio': {
        // DEPRECATION WARNING
        logger.warn('serve.deprecation.warning.serve.transport.stdio.is.deprecated.a3288aee');
        logger.warn('serve.please.use.1mcp.proxy.instead.for.better.compatibility.9caa3485');
        logger.warn('serve.this.mode.may.be.removed.in.a.future.major.version.9f1100ff');
        logger.warn('serve.diagnostic.c82ead89');
        logger.warn('serve.migration.guide.a032bb4f');
        logger.warn('serve.1.start.http.server.1mcp.serve.5c75ce98');
        logger.warn('serve.2.use.proxy.command.1mcp.proxy.75b19e38');
        logger.warn('serve.diagnostic.c82ead89');

        // Use stdio transport
        const transport = new StdioServerTransport();
        const filterConfig = await resolveStdioFilterConfig(parsedArgv);
        if (!filterConfig) {
          runtimeOwnership?.release();
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
            logger.info('serve.async.loading.notifications.initialized.for.stdio.transport.2f38a5e7');
          }
        }

        logger.info('serve.server.started.with.stdio.transport.ea94ea8d');
        break;
      }
      case 'sse': {
        logger.warn('serve.deprecated-sse');
      }
      // Reason: Intentional fallthrough from deprecated 'sse' to 'http' case for backward compatibility
      // eslint-disable-next-line no-fallthrough
      case 'http': {
        // Use HTTP/SSE transport
        expressServer = new ExpressServer(serverManager, loadingManager, asyncOrchestrator, customTemplate);
        expressServer.start(
          cooperativeLaunch ? () => cooperative!.acknowledgeCooperativeWorker(cooperativeLaunch!) : undefined,
        );

        // Write PID file for proxy auto-discovery
        const serverUrl = serverConfigManager.getUrl();
        writePidFile(runtimeScope, {
          pid: process.pid,
          ...(cooperativeLaunch ? { ownerClaimId: cooperativeLaunch.claimId } : {}),
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
        logger.error('serve.invalid.transport.1860e43c');
        process.exit(1);
    }

    // Set up graceful shutdown handling
    setupGracefulShutdown(
      serverManager,
      loadingManager,
      expressServer,
      instructionAggregator,
      runtimeScope,
      runtimeOwnership,
    );

    // Log MCP loading progress (non-blocking)
    loadingManager.on('loading-progress', (_summary: LoadingSummary) => {
      logger.info('serve.mcp.loading.progress.servers.ready.loading.failed.90307638');
    });

    loadingManager.on('loading-complete', (_summary: LoadingSummary) => {
      logger.info('serve.mcp.loading.complete.servers.ready.success.rate.0a0fdab1');
    });
  } catch (_error) {
    runtimeOwnership?.release();
    if (parsedArgv.background || parsedArgv.restart)
      process.stderr.write(`Error: ${describeServeLifecycleFailure(_error)}\n`);
    logger.error('serve.server.error.a68bf449', { error: _error });
    process.exit(1);
  }
}
