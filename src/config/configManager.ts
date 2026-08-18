import { EventEmitter } from 'events';

import { McpConfigManager } from '@src/config/mcpConfigManager.js';
import { mergeGlobalAndServerConfig } from '@src/config/mcpConfigMerge.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import {
  ApplicationConfig,
  mcpServerConfigSchema,
  MCPServerConfiguration,
  MCPServerParams,
  TemplateSettings,
  transportConfigSchema,
} from '@src/core/types/transport.js';
import logger, { debugIf } from '@src/logger/logger.js';
import { HandlebarsTemplateRenderer } from '@src/template/handlebarsTemplateRenderer.js';
import type { ContextData } from '@src/types/context.js';
import { createContextHash } from '@src/utils/context/contextHash.js';

import { z } from 'zod';

import { ConfigChangeDetector } from './configChangeDetector.js';
import { ConfigLoader } from './configLoader.js';
import { ConfigWatcher } from './configWatcher.js';
import { activateRuntimeScopeEnvironment, loadRuntimeScopeEnvironment } from './runtimeScopeEnv.js';
import { createRuntimeTargetFingerprint } from './runtimeTargetFingerprint.js';
import { TemplateProcessor } from './templateProcessor.js';
import { CONFIG_EVENTS, ConfigChange, ConfigChangeType, RuntimeEnvironmentChange } from './types.js';

export class ConfigManager extends EventEmitter {
  private static instance: ConfigManager;
  private transportConfig: Record<string, MCPServerParams> = {};
  private loader: ConfigLoader;
  private templateProcessor: TemplateProcessor;
  private watcher: ConfigWatcher;
  private changeDetector: ConfigChangeDetector;

  // Template processing related properties
  private templateProcessingErrors: string[] = [];
  private processedTemplates: Record<string, MCPServerParams> = {};
  private lastContextHash?: string;
  private templateRenderer?: HandlebarsTemplateRenderer;
  private lastValidDeclaredServerConfigs: {
    staticServers: Record<string, MCPServerParams>;
    templateServers: Record<string, MCPServerParams>;
  } = { staticServers: {}, templateServers: {} };
  private runtimeEnvironment: Readonly<Record<string, string>> = {};
  private staticRuntimeFingerprints = new Map<string, string>();
  private templateRuntimeFingerprints = new Map<string, string>();

  /**
   * Private constructor to enforce singleton pattern
   * @param configFilePath - Optional path to the config file. If not provided, uses global config path
   */
  private constructor(configFilePath?: string) {
    super();
    this.loader = new ConfigLoader(configFilePath);
    this.templateProcessor = new TemplateProcessor();
    this.watcher = new ConfigWatcher(this.loader.getConfigFilePath(), this.loader);
    this.changeDetector = new ConfigChangeDetector();

    this.setupWatcherEvents();
  }

  public static getInstance(configFilePath?: string): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager(configFilePath);
    }
    return ConfigManager.instance;
  }

  private setupWatcherEvents(): void {
    this.watcher.on('reload', () => {
      this.handleConfigChange().catch((error) => {
        logger.error(`Error handling config change: ${error}`);
      });
    });
  }

  public async initialize(): Promise<void> {
    try {
      this.loadConfig();
      this.watcher.startWatching();
      logger.info('ConfigManager initialized');
    } catch (error) {
      const errorMsg = `Failed to initialize ConfigManager: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
  }

  public async stop(): Promise<void> {
    this.watcher.stopWatching();
    logger.info('ConfigManager stopped');
  }
  private loadConfig(): void {
    try {
      const runtimeEnvironment = loadRuntimeScopeEnvironment(this.loader.getConfigFilePath());
      this.transportConfig = this.loader.loadConfigWithEnvSubstitution();
      const declared = this.loadDeclaredServerConfigs();
      this.runtimeEnvironment = runtimeEnvironment;
      activateRuntimeScopeEnvironment(runtimeEnvironment);
      this.staticRuntimeFingerprints = this.createRuntimeFingerprints(this.transportConfig, runtimeEnvironment);
      this.templateRuntimeFingerprints = this.createRuntimeFingerprints(declared.templateServers, runtimeEnvironment);
      this.loader.markRuntimeEnvObserved();

      const agentConfig = AgentConfigManager.getInstance();
      const features = agentConfig.get('features');
      const substitutionStatus = features.envSubstitution ? 'with' : 'without';
      logger.info(`Configuration loaded successfully ${substitutionStatus} environment variable substitution`);
    } catch (error) {
      const errorMsg = `Failed to load configuration: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
  }

  /**
   * Load configuration with template processing support
   * @param context - Optional context data for template processing
   * @returns Object with static servers, processed template servers, and any errors
   */
  public async loadConfigWithTemplates(context?: ContextData): Promise<{
    staticServers: Record<string, MCPServerParams>;
    templateServers: Record<string, MCPServerParams>;
    errors: string[];
  }> {
    let rawConfig: unknown;
    let config: MCPServerConfiguration;

    try {
      rawConfig = this.loadRawConfig();
      // Parse the configuration using the extended schema
      config = mcpServerConfigSchema.parse(rawConfig);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to parse configuration: ${errorMessage}`);
      // Return empty config on schema validation errors
      return {
        staticServers: {},
        templateServers: {},
        errors: [`Configuration parsing failed: ${errorMessage}`],
      };
    }

    // Process static servers
    const staticServers: Record<string, MCPServerParams> = {};
    const serverDefaults = config.serverDefaults;
    for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
      try {
        const mergedConfig = mergeGlobalAndServerConfig(serverDefaults, serverConfig);
        staticServers[serverName] = this.validateServerConfig(serverName, mergedConfig);
      } catch (error) {
        logger.error(
          `Static server validation failed for ${serverName}: ${error instanceof Error ? error.message : String(error)}`,
        );
        // Skip invalid static server configurations
      }
    }

    // Process templates if context available, otherwise return raw templates
    let templateServers: Record<string, MCPServerParams> = {};
    let errors: string[] = [];

    if (config.mcpTemplates) {
      if (context) {
        // Context available - process templates
        const contextHash = this.hashContext(context);

        // Use cached templates if context hasn't changed and caching is enabled
        if (
          config.templateSettings?.cacheContext &&
          this.lastContextHash === contextHash &&
          Object.keys(this.processedTemplates).length > 0
        ) {
          templateServers = this.processedTemplates;
          errors = this.templateProcessingErrors;
        } else {
          // Process templates with validation
          const result = await this.processTemplates(config.mcpTemplates, context, config.templateSettings);
          templateServers = {};
          errors = [...result.errors];
          for (const [serverName, templateConfig] of Object.entries(result.servers)) {
            try {
              templateServers[serverName] = this.validateServerConfig(
                serverName,
                mergeGlobalAndServerConfig(serverDefaults, templateConfig),
              );
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              logger.error(`Template server validation failed for ${serverName}: ${message}`);
              errors.push(`${serverName}: ${message}`);
            }
          }

          // Cache results if caching is enabled
          if (config.templateSettings?.cacheContext) {
            this.processedTemplates = templateServers;
            this.templateProcessingErrors = errors;
            this.lastContextHash = contextHash;
          }
        }
      } else {
        // No context - return empty templateServers object
        // Templates require context to be processed
        templateServers = {};
      }
    }

    // Filter out static servers that conflict with template servers
    // Template servers take precedence
    const conflictingServers: string[] = [];
    for (const staticServerName of Object.keys(staticServers)) {
      if (staticServerName in templateServers) {
        conflictingServers.push(staticServerName);
        delete staticServers[staticServerName];
      }
    }

    if (conflictingServers.length > 0) {
      logger.warn(
        `Ignoring ${conflictingServers.length} static server(s) that conflict with template servers: ${conflictingServers.join(', ')}`,
      );
    }

    return { staticServers, templateServers, errors };
  }

  /**
   * Load declared server definitions without rendering templates.
   * This is useful for metadata/discovery flows that need configured server names
   * even when no session context exists yet.
   */
  public loadDeclaredServerConfigs(): {
    staticServers: Record<string, MCPServerParams>;
    templateServers: Record<string, MCPServerParams>;
    errors: string[];
  } {
    let rawConfig: unknown;
    let config: MCPServerConfiguration;

    try {
      rawConfig = this.loadRawConfig();
      config = mcpServerConfigSchema.parse(rawConfig);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to parse configuration: ${errorMessage}`);
      return {
        ...this.copyLastValidDeclaredServerConfigs(),
        errors: [`Configuration parsing failed: ${errorMessage}`],
      };
    }

    const staticServers: Record<string, MCPServerParams> = {};
    const errors: string[] = [];
    for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
      try {
        staticServers[serverName] = this.validateServerConfig(serverName, serverConfig);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Static server validation failed for ${serverName}: ${message}`);
        errors.push(`${serverName}: ${message}`);
      }
    }

    const templateServers: Record<string, MCPServerParams> = {};
    if (config.mcpTemplates) {
      for (const [serverName, serverConfig] of Object.entries(config.mcpTemplates)) {
        try {
          templateServers[serverName] = this.validateServerConfig(
            serverName,
            mergeGlobalAndServerConfig(config.serverDefaults, serverConfig),
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error(`Template server validation failed for ${serverName}: ${message}`);
          errors.push(`${serverName}: ${message}`);
        }
      }
    }

    for (const staticServerName of Object.keys(staticServers)) {
      if (staticServerName in templateServers) {
        delete staticServers[staticServerName];
      }
    }

    if (errors.length > 0) {
      return { ...this.copyLastValidDeclaredServerConfigs(), errors };
    }

    this.lastValidDeclaredServerConfigs = { staticServers, templateServers };
    return { ...this.copyLastValidDeclaredServerConfigs(), errors: [] };
  }

  private copyLastValidDeclaredServerConfigs(): {
    staticServers: Record<string, MCPServerParams>;
    templateServers: Record<string, MCPServerParams>;
  } {
    return {
      staticServers: { ...this.lastValidDeclaredServerConfigs.staticServers },
      templateServers: { ...this.lastValidDeclaredServerConfigs.templateServers },
    };
  }

  /**
   * Process template configurations with context data
   * @param templates - Template configurations to process
   * @param context - Context data for template substitution
   * @param settings - Template processing settings
   * @returns Object with processed servers and any errors
   */
  private async processTemplates(
    templates: Record<string, MCPServerParams>,
    context: ContextData,
    settings?: TemplateSettings,
  ): Promise<{ servers: Record<string, MCPServerParams>; errors: string[] }> {
    const errors: string[] = [];

    // Initialize template renderer
    this.templateRenderer = new HandlebarsTemplateRenderer();

    const processedServers: Record<string, MCPServerParams> = {};

    for (const [serverName, templateConfig] of Object.entries(templates)) {
      try {
        const processedConfig = this.templateRenderer.renderTemplate(templateConfig, context);
        processedServers[serverName] = processedConfig;

        debugIf(() => ({
          message: 'Template processed successfully',
          meta: { serverName },
        }));
      } catch (error) {
        const errorMsg = `Template processing failed for ${serverName}: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(errorMsg);

        // According to user requirement: Fail fast, log errors, return to client
        logger.error(errorMsg);

        // For graceful mode, include raw config for debugging
        if (settings?.failureMode === 'graceful') {
          processedServers[serverName] = templateConfig;
        }
      }
    }

    return { servers: processedServers, errors };
  }

  /**
   * Create a hash of context data for caching purposes
   * @param context - Context data to hash
   * @returns SHA-256 hash string
   */
  private hashContext(context: ContextData): string {
    return createContextHash(context);
  }

  /**
   * Get template processing errors from the last processing run
   * @returns Array of template processing error messages
   */
  public getTemplateProcessingErrors(): string[] {
    return [...this.templateProcessingErrors];
  }

  /** Return the unrendered instruction configuration used by both runtime surfaces. */
  public getRuntimeInstructionConfiguration(): {
    instructionTemplates?: MCPServerConfiguration['instructionTemplates'];
    publishedInstructionTemplates?: MCPServerConfiguration['publishedInstructionTemplates'];
    activeInstructionTemplate?: string;
    configuredTargets: {
      mcpServers: MCPServerConfiguration['mcpServers'];
      mcpTemplates: NonNullable<MCPServerConfiguration['mcpTemplates']>;
    };
  } {
    const config = mcpServerConfigSchema.parse(this.loadRawConfig());
    return {
      instructionTemplates: config.instructionTemplates,
      publishedInstructionTemplates: config.publishedInstructionTemplates,
      activeInstructionTemplate: config.activeInstructionTemplate,
      configuredTargets: {
        mcpServers: config.mcpServers,
        mcpTemplates: config.mcpTemplates ?? {},
      },
    };
  }

  /**
   * Check if there are any template processing errors
   * @returns True if there are template processing errors
   */
  public hasTemplateProcessingErrors(): boolean {
    return this.templateProcessingErrors.length > 0;
  }

  /**
   * Clear template cache and force reprocessing on next load
   */
  public clearTemplateCache(): void {
    this.processedTemplates = {};
    this.lastContextHash = undefined;
    this.templateProcessingErrors = [];
  }

  /**
   * Validate server configuration
   * @param serverName - Name of the server
   * @param config - Server configuration to validate
   * @returns Validated server configuration
   */
  private validateServerConfig(serverName: string, config: unknown): MCPServerParams {
    try {
      return transportConfigSchema.parse(config);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors = error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        throw new Error(`Invalid configuration for server '${serverName}': ${fieldErrors}`);
      }
      throw new Error(
        `Invalid configuration for server '${serverName}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Load raw configuration from file
   * @returns Parsed raw configuration
   */
  private loadRawConfig(): unknown {
    const rawConfig = this.loader.loadRawConfig();
    return rawConfig;
  }

  /**
   * Check if reload is enabled via feature flag
   */
  public isReloadEnabled(): boolean {
    return this.loader.isReloadEnabled();
  }

  private async handleConfigChange(): Promise<void> {
    if (!this.isReloadEnabled()) {
      logger.info('Configuration hot-reload is disabled, ignoring file changes');
      return;
    }

    const oldConfig = { ...this.transportConfig };
    let newConfig: Record<string, MCPServerParams>;
    let runtimeEnvironment: Readonly<Record<string, string>>;
    let declaredTemplates: Record<string, MCPServerParams>;

    try {
      runtimeEnvironment = loadRuntimeScopeEnvironment(this.loader.getConfigFilePath());
      newConfig = this.loader.loadConfigWithEnvSubstitution();
      const declared = this.loadDeclaredServerConfigs();
      declaredTemplates = declared.templateServers;
    } catch (error) {
      if (this.loader.checkRuntimeEnvModified()) {
        this.loader.markRuntimeEnvAttempted();
      }
      logger.error(
        `Failed to load or validate configuration: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.emit(CONFIG_EVENTS.VALIDATION_ERROR, error);
      return;
    }

    const changes = this.changeDetector.detectChanges(oldConfig, newConfig);
    const nextStaticFingerprints = this.createRuntimeFingerprints(newConfig, runtimeEnvironment);
    const nextTemplateFingerprints = this.createRuntimeFingerprints(declaredTemplates, runtimeEnvironment);
    const runtimeEnvironmentChanged = !environmentsEqual(this.runtimeEnvironment, runtimeEnvironment);
    const environmentChange = !runtimeEnvironmentChanged
      ? { staticServerNames: [], templateServerNames: [] }
      : this.detectRuntimeEnvironmentChanges(nextStaticFingerprints, nextTemplateFingerprints);
    const alreadyChanged = new Set(changes.map((change) => change.serverName));
    for (const serverName of environmentChange.staticServerNames) {
      if (!alreadyChanged.has(serverName) && newConfig[serverName]) {
        changes.push({ serverName, type: ConfigChangeType.MODIFIED, fieldsChanged: ['runtimeEnvironment'] });
      }
    }

    this.runtimeEnvironment = runtimeEnvironment;
    activateRuntimeScopeEnvironment(runtimeEnvironment);
    this.transportConfig = newConfig;
    this.staticRuntimeFingerprints = nextStaticFingerprints;
    this.templateRuntimeFingerprints = nextTemplateFingerprints;
    McpConfigManager.getInstance(this.loader.getConfigFilePath()).reloadConfig();
    this.loader.markRuntimeEnvObserved();

    logger.info(`Detected ${changes.length} configuration changes`);
    this.emit(CONFIG_EVENTS.CONFIG_CHANGED, changes);
    if (runtimeEnvironmentChanged) {
      this.emit(CONFIG_EVENTS.RUNTIME_ENVIRONMENT_CHANGED, environmentChange);
    }

    for (const change of changes) {
      switch (change.type) {
        case ConfigChangeType.ADDED:
          this.emit(CONFIG_EVENTS.SERVER_ADDED, change.serverName);
          break;
        case ConfigChangeType.REMOVED:
          this.emit(CONFIG_EVENTS.SERVER_REMOVED, change.serverName);
          break;
      }
    }
  }

  private createRuntimeFingerprints(
    configs: Record<string, MCPServerParams>,
    runtimeEnvironment: Readonly<Record<string, string>>,
  ): Map<string, string> {
    const substituteEnv = AgentConfigManager.getInstance().get('features').envSubstitution;
    return new Map(
      Object.entries(configs).map(([name, config]) => [
        name,
        createRuntimeTargetFingerprint(config, runtimeEnvironment, substituteEnv),
      ]),
    );
  }

  private detectRuntimeEnvironmentChanges(
    nextStatic: ReadonlyMap<string, string>,
    nextTemplates: ReadonlyMap<string, string>,
  ): RuntimeEnvironmentChange {
    return {
      staticServerNames: changedFingerprintNames(this.staticRuntimeFingerprints, nextStatic),
      templateServerNames: changedFingerprintNames(this.templateRuntimeFingerprints, nextTemplates),
    };
  }

  public async reloadConfig(): Promise<void> {
    await this.handleConfigChange();
  }

  public getTransportConfig(): Record<string, MCPServerParams> {
    return this.loader.getTransportConfig(this.transportConfig);
  }

  public getAvailableTags(): string[] {
    return this.loader.getAvailableTags(this.transportConfig);
  }

  public getAppConfig(): ApplicationConfig {
    return this.loader.loadAppConfig();
  }
}

export type { ConfigChange };
export { ConfigChangeType, CONFIG_EVENTS };

export default ConfigManager;

function changedFingerprintNames(previous: ReadonlyMap<string, string>, next: ReadonlyMap<string, string>): string[] {
  return Array.from(next)
    .filter(([name, fingerprint]) => previous.has(name) && previous.get(name) !== fingerprint)
    .map(([name]) => name);
}

function environmentsEqual(
  previous: Readonly<Record<string, string>>,
  next: Readonly<Record<string, string>>,
): boolean {
  const previousKeys = Object.keys(previous).sort();
  const nextKeys = Object.keys(next).sort();
  return (
    previousKeys.length === nextKeys.length &&
    previousKeys.every((key, index) => key === nextKeys[index] && previous[key] === next[key])
  );
}
