import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

import { substituteEnvVarsInConfig } from '@src/config/envProcessor.js';
import { DEFAULT_CONFIG, getGlobalConfigDir, getGlobalConfigPath } from '@src/constants.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import {
  mcpServerConfigSchema,
  MCPServerConfiguration,
  MCPServerParams,
  TemplateSettings,
  transportConfigSchema,
} from '@src/core/types/transport.js';
import logger, { debugIf } from '@src/logger/logger.js';
import { TemplateProcessor } from '@src/template/templateProcessor.js';
import { TemplateValidator } from '@src/template/templateValidator.js';
import type { ContextData } from '@src/types/context.js';

import { ZodError } from 'zod';

/**
 * Configuration change types
 */
export enum ConfigChangeType {
  ADDED = 'added',
  REMOVED = 'removed',
  MODIFIED = 'modified',
}

/**
 * Event constants for better maintainability
 */
export const CONFIG_EVENTS = {
  CONFIG_CHANGED: 'configChanged',
  SERVER_ADDED: 'serverAdded',
  SERVER_REMOVED: 'serverRemoved',
  METADATA_UPDATED: 'metadataUpdated',
  VALIDATION_ERROR: 'validationError',
} as const;

/**
 * Configuration change information
 */
export interface ConfigChange {
  serverName: string;
  type: ConfigChangeType;
  fieldsChanged?: string[]; // For detailed tracking if needed
}

/**
 * Unified configuration manager that handles loading, watching, and detecting changes
 * Replaces McpConfigManager, ConfigReloadService, SelectiveReloadManager, and ChangeAnalyzer
 */
export class ConfigManager extends EventEmitter {
  private static instance: ConfigManager;
  private configWatcher: fs.FSWatcher | null = null;
  private transportConfig: Record<string, MCPServerParams> = {};
  private configFilePath: string;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastModified: number = 0;

  // Template processing related properties
  private templateProcessingErrors: string[] = [];
  private processedTemplates: Record<string, MCPServerParams> = {};
  private lastContextHash?: string;
  private templateProcessor?: TemplateProcessor;

  /**
   * Private constructor to enforce singleton pattern
   * @param configFilePath - Optional path to the config file. If not provided, uses global config path
   */
  private constructor(configFilePath?: string) {
    super();
    this.configFilePath = configFilePath || getGlobalConfigPath();
    this.ensureConfigExists();
    this.loadConfig();
  }

  /**
   * Get the singleton instance of ConfigManager
   * @param configFilePath - Optional path to the config file
   */
  public static getInstance(configFilePath?: string): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager(configFilePath);
    }
    return ConfigManager.instance;
  }

  /**
   * Initialize the config manager (start watching if enabled)
   */
  public async initialize(): Promise<void> {
    this.startWatching();
    logger.info('ConfigManager initialized');
  }

  /**
   * Stop the config manager and clean up resources
   */
  public async stop(): Promise<void> {
    this.stopWatching();
    logger.info('ConfigManager stopped');
  }

  /**
   * Ensure the config directory and file exist
   */
  private ensureConfigExists(): void {
    try {
      const configDir = getGlobalConfigDir();
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
        logger.info(`Created config directory: ${configDir}`);
      }

      if (!fs.existsSync(this.configFilePath)) {
        fs.writeFileSync(this.configFilePath, JSON.stringify(DEFAULT_CONFIG, null, 2));
        logger.info(`Created default config file: ${this.configFilePath}`);
      }
    } catch (error) {
      logger.error(`Failed to ensure config exists: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Load the raw configuration from the config file
   */
  private loadRawConfig(): unknown {
    try {
      const stats = fs.statSync(this.configFilePath);
      this.lastModified = stats.mtime.getTime();

      const rawConfigData = fs.readFileSync(this.configFilePath, 'utf8');
      return JSON.parse(rawConfigData);
    } catch (error) {
      logger.error(`Failed to load configuration: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Load configuration with environment variable substitution
   */
  private validateServerConfig(serverName: string, config: unknown): MCPServerParams {
    try {
      return transportConfigSchema.parse(config);
    } catch (error) {
      if (error instanceof ZodError) {
        const fieldErrors = error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        throw new Error(`Invalid configuration for server '${serverName}': ${fieldErrors}`);
      }
      throw new Error(
        `Invalid configuration for server '${serverName}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private loadConfigWithEnvSubstitution(): Record<string, MCPServerParams> {
    const rawConfig = this.loadRawConfig();

    // Apply environment variable substitution if enabled
    const agentConfig = AgentConfigManager.getInstance();
    const features = agentConfig.get('features');

    const processedConfig = features.envSubstitution ? substituteEnvVarsInConfig(rawConfig) : rawConfig;

    // Type guard to ensure processedConfig has proper structure
    if (!processedConfig || typeof processedConfig !== 'object') {
      logger.error('Invalid configuration format');
      return {};
    }

    const configObj = processedConfig as Record<string, unknown>;
    const mcpServersConfig = (configObj.mcpServers as Record<string, unknown>) || {};

    // Validate each server configuration
    const validatedConfig: Record<string, MCPServerParams> = {};
    for (const [serverName, serverConfig] of Object.entries(mcpServersConfig)) {
      try {
        validatedConfig[serverName] = this.validateServerConfig(serverName, serverConfig);
        debugIf(() => ({
          message: `Validated configuration for server: ${serverName}`,
          meta: { serverName },
        }));
      } catch (error) {
        logger.error(`Configuration validation failed: ${error instanceof Error ? error.message : String(error)}`);
        // Skip invalid server configurations
        continue;
      }
    }

    return validatedConfig;
  }

  /**
   * Load the configuration from the config file
   */
  private loadConfig(): void {
    try {
      this.transportConfig = this.loadConfigWithEnvSubstitution();

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
        // No context - return raw templates for filtering purposes
        templateServers = config.mcpTemplates;
      }
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

    // Validate templates before processing
    if (settings?.validateOnReload !== false) {
      const validationErrors = await this.validateTemplates(templates);
      if (validationErrors.length > 0 && settings?.failureMode === 'strict') {
        throw new Error(`Template validation failed: ${validationErrors.join(', ')}`);
      }
      errors.push(...validationErrors);
    }

    // Initialize template processor
    this.templateProcessor = new TemplateProcessor({
      strictMode: false,
      allowUndefined: true,
      validateTemplates: settings?.validateOnReload !== false,
      cacheResults: true,
    });

    const results = await this.templateProcessor.processMultipleServerConfigs(templates, context);
    const processedServers: Record<string, MCPServerParams> = {};

    for (const [serverName, result] of Object.entries(results)) {
      if (result.success) {
        processedServers[serverName] = result.processedConfig;
      } else {
        const errorMsg = `Template processing failed for ${serverName}: ${result.errors.join(', ')}`;
        errors.push(errorMsg);

        // According to user requirement: Fail fast, log errors, return to client
        logger.error(errorMsg);

        // For graceful mode, include raw config for debugging
        if (settings?.failureMode === 'graceful') {
          processedServers[serverName] = result.processedConfig;
        }
      }
    }

    return { servers: processedServers, errors };
  }

  /**
   * Validate template configurations for syntax and security issues
   * @param templates - Template configurations to validate
   * @returns Array of validation error messages
   */
  private async validateTemplates(templates: Record<string, MCPServerParams>): Promise<string[]> {
    const errors: string[] = [];
    const templateValidator = new TemplateValidator();

    for (const [serverName, config] of Object.entries(templates)) {
      try {
        // Validate template syntax in all string fields
        const fieldErrors = this.validateConfigFields(config, templateValidator);

        if (fieldErrors.length > 0) {
          errors.push(`${serverName}: ${fieldErrors.join(', ')}`);
        }
      } catch (error) {
        errors.push(`${serverName}: Validation error - ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return errors;
  }

  /**
   * Validate all fields in a configuration for template syntax
   * @param config - Configuration to validate
   * @param validator - Template validator instance
   * @returns Array of validation error messages
   */
  private validateConfigFields(config: MCPServerParams, validator: TemplateValidator): string[] {
    const errors: string[] = [];

    // Validate command field
    if (config.command) {
      const result = validator.validate(config.command);
      if (!result.valid) {
        errors.push(...result.errors);
      }
    }

    // Validate args array
    if (config.args) {
      config.args.forEach((arg, index) => {
        if (typeof arg === 'string') {
          const result = validator.validate(arg);
          if (!result.valid) {
            errors.push(`args[${index}]: ${result.errors.join(', ')}`);
          }
        }
      });
    }

    // Validate cwd field
    if (config.cwd) {
      const result = validator.validate(config.cwd);
      if (!result.valid) {
        errors.push(`cwd: ${result.errors.join(', ')}`);
      }
    }

    // Validate env object
    if (config.env) {
      for (const [key, value] of Object.entries(config.env)) {
        if (typeof value === 'string') {
          const result = validator.validate(value);
          if (!result.valid) {
            errors.push(`env.${key}: ${result.errors.join(', ')}`);
          }
        }
      }
    }

    return errors;
  }

  /**
   * Create a hash of context data for caching purposes
   * @param context - Context data to hash
   * @returns MD5 hash string
   */
  private hashContext(context: ContextData): string {
    return createHash('md5').update(JSON.stringify(context)).digest('hex');
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
   * Check if reload is enabled via feature flag
   */
  public isReloadEnabled(): boolean {
    const agentConfig = AgentConfigManager.getInstance();
    return agentConfig.get('features').configReload;
  }

  /**
   * Check if the configuration file has been modified
   */
  private checkFileModified(): boolean {
    try {
      const stats = fs.statSync(this.configFilePath);
      const currentModified = stats.mtime.getTime();

      if (currentModified !== this.lastModified) {
        this.lastModified = currentModified;
        return true;
      }

      return false;
    } catch (error) {
      logger.error(`Failed to check file modification time: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Start watching the configuration file for changes
   */
  public startWatching(): void {
    // Check if config reload is enabled
    if (!this.isReloadEnabled()) {
      logger.info('Configuration hot-reload is disabled, skipping file watcher setup');
      return;
    }

    if (this.configWatcher) {
      return;
    }

    try {
      const configDir = path.dirname(this.configFilePath);
      const configFileName = path.basename(this.configFilePath);

      // Watch the directory instead of the file to handle atomic operations like vim's :x
      this.configWatcher = fs.watch(configDir, (eventType: fs.WatchEventType, filename: string | null) => {
        debugIf(() => ({
          message: 'Directory change detected',
          meta: { eventType, filename, configDir, configFileName },
        }));

        // Check if the change is related to our config file
        const isConfigFileEvent =
          filename === configFileName ||
          (filename && filename.startsWith(configFileName)) ||
          (eventType === 'rename' && filename && filename.includes(path.parse(configFileName).name));

        if (isConfigFileEvent) {
          debugIf(() => ({
            message: 'Configuration file change detected, checking modification time',
            meta: { eventType, filename, isConfigFileEvent },
          }));

          if (this.checkFileModified()) {
            debugIf('File modification confirmed, debouncing reload');
            this.debouncedReloadConfig();
          }
        } else {
          if (this.checkFileModified()) {
            debugIf(() => ({
              message: 'File was modified but event did not match criteria, debouncing reload anyway',
              meta: { eventType, filename, configFileName },
            }));
            this.debouncedReloadConfig();
          }
        }
      });
      logger.info(`Started watching configuration directory: ${configDir} for file: ${configFileName}`);
    } catch (error) {
      logger.error(
        `Failed to start watching configuration file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Stop watching the configuration file
   */
  public stopWatching(): void {
    if (this.configWatcher) {
      this.configWatcher.close();
      this.configWatcher = null;
      logger.info('Stopped watching configuration file');
    }

    // Clear any pending debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * Debounced configuration reload to prevent excessive reloading
   */
  private debouncedReloadConfig(): void {
    // Clear existing timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // Get debounce delay from config
    const agentConfig = AgentConfigManager.getInstance();
    const configReload = agentConfig.get('configReload');
    const debounceDelayMs = configReload.debounceMs;

    // Set new timer
    this.debounceTimer = setTimeout(() => {
      logger.info('Debounce period completed, reloading configuration...');
      this.handleConfigChange();
      this.debounceTimer = null;
    }, debounceDelayMs);
  }

  /**
   * Simple deep equality check for objects
   */
  private deepEqual(obj1: unknown, obj2: unknown): boolean {
    if (obj1 === obj2) return true;
    if (obj1 == null || obj2 == null) return false;
    return JSON.stringify(obj1) === JSON.stringify(obj2);
  }

  /**
   * Get the fields that changed between two configurations
   */
  private getChangedFields(oldConfig: MCPServerParams, newConfig: MCPServerParams): string[] {
    const changed: string[] = [];

    for (const key of Object.keys(newConfig) as (keyof MCPServerParams)[]) {
      if (!(key in oldConfig) || !this.deepEqual(oldConfig[key], newConfig[key])) {
        changed.push(key);
      }
    }

    return changed;
  }

  /**
   * Detect changes between old and new configurations
   */
  private detectChanges(
    oldConfig: Record<string, MCPServerParams>,
    newConfig: Record<string, MCPServerParams>,
  ): ConfigChange[] {
    const changes: ConfigChange[] = [];
    const oldKeys = new Set(Object.keys(oldConfig));
    const newKeys = new Set(Object.keys(newConfig));

    // Added servers
    for (const name of newKeys) {
      if (!oldKeys.has(name)) {
        changes.push({ serverName: name, type: ConfigChangeType.ADDED });
      }
    }

    // Removed servers
    for (const name of oldKeys) {
      if (!newKeys.has(name)) {
        changes.push({ serverName: name, type: ConfigChangeType.REMOVED });
      }
    }

    // Modified servers
    for (const name of newKeys) {
      if (oldKeys.has(name)) {
        const oldServer = oldConfig[name];
        const newServer = newConfig[name];

        if (!this.deepEqual(oldServer, newServer)) {
          const fieldsChanged = this.getChangedFields(oldServer, newServer);
          changes.push({
            serverName: name,
            type: ConfigChangeType.MODIFIED,
            fieldsChanged,
          });
        }
      }
    }

    return changes;
  }

  /**
   * Handle configuration changes
   */
  private async handleConfigChange(): Promise<void> {
    // Check if reload is enabled via feature flag
    if (!this.isReloadEnabled()) {
      logger.info('Configuration hot-reload is disabled, ignoring file changes');
      return;
    }

    const oldConfig = { ...this.transportConfig };
    let newConfig: Record<string, MCPServerParams>;

    try {
      newConfig = this.loadConfigWithEnvSubstitution();
    } catch (error) {
      logger.error(
        `Failed to load or validate configuration: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Emit validation error event for possible UI handling
      this.emit(CONFIG_EVENTS.VALIDATION_ERROR, error);
      return;
    }

    const changes = this.detectChanges(oldConfig, newConfig);

    // Update the transport config BEFORE emitting events so handlers get the latest config
    this.transportConfig = newConfig;

    // Let business logic determine what to do with the changes
    // ConfigManager only detects changes and reports them
    logger.info(`Detected ${changes.length} configuration changes`);
    this.emit(CONFIG_EVENTS.CONFIG_CHANGED, changes);

    // Also emit specific events for easier handling
    for (const change of changes) {
      switch (change.type) {
        case ConfigChangeType.ADDED:
          this.emit(CONFIG_EVENTS.SERVER_ADDED, change.serverName);
          break;
        case ConfigChangeType.REMOVED:
          this.emit(CONFIG_EVENTS.SERVER_REMOVED, change.serverName);
          break;
        case ConfigChangeType.MODIFIED:
          // Business logic will determine if this requires restart or just metadata update
          break;
      }
    }
  }

  /**
   * Reload the configuration from the config file
   */
  public async reloadConfig(): Promise<void> {
    await this.handleConfigChange();
  }

  /**
   * Get the current transport configuration
   */
  public getTransportConfig(): Record<string, MCPServerParams> {
    return { ...this.transportConfig };
  }

  /**
   * Get all available tags from the configured servers
   */
  public getAvailableTags(): string[] {
    const tags = new Set<string>();

    for (const [_serverName, serverParams] of Object.entries(this.transportConfig)) {
      // Skip disabled servers
      if (serverParams.disabled) {
        continue;
      }

      // Add tags from server configuration
      if (serverParams.tags && Array.isArray(serverParams.tags)) {
        serverParams.tags.forEach((tag) => tags.add(tag));
      }
    }

    return Array.from(tags).sort();
  }
}

export default ConfigManager;
