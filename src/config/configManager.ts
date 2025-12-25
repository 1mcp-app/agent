import { createHash } from 'crypto';
import { EventEmitter } from 'events';

import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import {
  mcpServerConfigSchema,
  MCPServerConfiguration,
  MCPServerParams,
  TemplateSettings,
  transportConfigSchema,
} from '@src/core/types/transport.js';
import logger, { debugIf } from '@src/logger/logger.js';
import { HandlebarsTemplateRenderer } from '@src/template/handlebarsTemplateRenderer.js';
import type { ContextData } from '@src/types/context.js';

import { z } from 'zod';

import { ConfigChangeDetector } from './configChangeDetector.js';
import { ConfigLoader } from './configLoader.js';
import { ConfigWatcher } from './configWatcher.js';
import { TemplateProcessor } from './templateProcessor.js';
import { CONFIG_EVENTS, ConfigChange, ConfigChangeType } from './types.js';

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

    this.loadConfig();
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
    this.watcher.startWatching();
    logger.info('ConfigManager initialized');
  }

  public async stop(): Promise<void> {
    this.watcher.stopWatching();
    logger.info('ConfigManager stopped');
  }
  private loadConfig(): void {
    try {
      this.transportConfig = this.loader.loadConfigWithEnvSubstitution();

      const agentConfig = AgentConfigManager.getInstance();
      const features = agentConfig.get('features');
      const substitutionStatus = features.envSubstitution ? 'with' : 'without';
      logger.info(`Configuration loaded successfully ${substitutionStatus} environment variable substitution`);
    } catch (error) {
      logger.error(`Failed to load configuration: ${error instanceof Error ? error.message : String(error)}`);
      this.transportConfig = {};
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

    // Process static servers (existing logic)
    const staticServers: Record<string, MCPServerParams> = {};
    for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
      try {
        staticServers[serverName] = this.validateServerConfig(serverName, serverConfig);
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
          templateServers = result.servers;
          errors = result.errors;

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
    return createHash('sha256').update(JSON.stringify(context)).digest('hex');
  }

  /**
   * Get template processing errors from the last processing run
   * @returns Array of template processing error messages
   */
  public getTemplateProcessingErrors(): string[] {
    return [...this.templateProcessingErrors];
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

    try {
      newConfig = this.loader.loadConfigWithEnvSubstitution();
    } catch (error) {
      logger.error(
        `Failed to load or validate configuration: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.emit(CONFIG_EVENTS.VALIDATION_ERROR, error);
      return;
    }

    const changes = this.changeDetector.detectChanges(oldConfig, newConfig);
    this.transportConfig = newConfig;

    logger.info(`Detected ${changes.length} configuration changes`);
    this.emit(CONFIG_EVENTS.CONFIG_CHANGED, changes);

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

  public async reloadConfig(): Promise<void> {
    await this.handleConfigChange();
  }

  public getTransportConfig(): Record<string, MCPServerParams> {
    return this.loader.getTransportConfig(this.transportConfig);
  }

  public getAvailableTags(): string[] {
    return this.loader.getAvailableTags(this.transportConfig);
  }
}

export type { ConfigChange };
export { ConfigChangeType, CONFIG_EVENTS };

export default ConfigManager;
