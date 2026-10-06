import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

import ConfigContext from '@src/config/configContext.js';
import { ConfigLoader } from '@src/config/configLoader.js';
import { mergeGlobalAndServerConfig } from '@src/config/mcpConfigMerge.js';
import { deferUntilRuntimeActivation, getFrozenRuntimeBootstrap } from '@src/config/runtimeBootstrap.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { runtimeAdmission, RuntimeDrainingError } from '@src/core/server/runtimeDrain.js';
import {
  ApplicationConfig,
  GlobalTransportConfig,
  mcpServerConfigSchema,
  MCPServerParams,
} from '@src/core/types/index.js';
import logger, { debugIf } from '@src/logger/logger.js';
import { resolveWatchPath } from '@src/utils/watchPath.js';

/**
 * Configuration change event types
 */
export enum ConfigChangeEvent {
  TRANSPORT_CONFIG_CHANGED = 'transportConfigChanged',
}

/**
 * MCP configuration manager that handles loading, watching, and reloading MCP server configurations
 */
export class McpConfigManager extends EventEmitter {
  private static instance: McpConfigManager;
  private configWatcher: fs.FSWatcher | null = null;
  private transportConfig: Record<string, MCPServerParams> = {};
  private templateConfig: Record<string, MCPServerParams> = {};
  private globalConfig: GlobalTransportConfig = {};
  private appConfig: ApplicationConfig = {};
  private configFilePath: string;
  private loader: ConfigLoader;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastModified: number = 0;
  private cancelDeferredReload?: () => void;
  private reloadGeneration = 0;

  private static resolveConfigFilePath(configFilePath?: string): string {
    if (configFilePath) {
      return configFilePath;
    }

    return ConfigContext.getInstance().getResolvedConfigPath();
  }

  /**
   * Private constructor to enforce singleton pattern
   * @param configFilePath - Optional path to the config file. If not provided, uses global config path
   */
  private constructor(configFilePath?: string) {
    super();
    this.configFilePath = McpConfigManager.resolveConfigFilePath(configFilePath);
    this.loader = new ConfigLoader(this.configFilePath);
    this.loadConfig();
  }

  /**
   * Get the singleton instance of McpConfigManager
   * @param configFilePath - Optional path to the config file
   */
  public static getInstance(configFilePath?: string): McpConfigManager {
    const resolvedConfigFilePath = McpConfigManager.resolveConfigFilePath(configFilePath);

    if (!McpConfigManager.instance) {
      McpConfigManager.instance = new McpConfigManager(resolvedConfigFilePath);
      return McpConfigManager.instance;
    }

    if (McpConfigManager.instance.configFilePath !== resolvedConfigFilePath) {
      McpConfigManager.instance.stopWatching();
      McpConfigManager.instance = new McpConfigManager(resolvedConfigFilePath);
    }

    return McpConfigManager.instance;
  }

  /**
   * Load the configuration from the config file
   */
  private loadConfig(): boolean {
    try {
      const loadedConfig = this.loader.loadParsedConfigWithEnvSubstitution();

      this.lastModified = loadedConfig.lastModified;
      this.globalConfig = loadedConfig.globalConfig;
      this.appConfig = loadedConfig.appConfig;
      this.transportConfig = loadedConfig.validatedServers;
      const declaredConfig = mcpServerConfigSchema.safeParse(loadedConfig.processedConfig);
      this.templateConfig = declaredConfig.success
        ? Object.fromEntries(
            Object.entries(declaredConfig.data.mcpTemplates ?? {}).map(([name, config]) => [
              name,
              mergeGlobalAndServerConfig(this.globalConfig, config),
            ]),
          )
        : {};

      logger.info('mcpConfigManager.configuration.loaded.successfully.environment.variable.substitution.f9e03cc4', {
        serverCount: Object.keys(this.transportConfig).length,
        templateCount: Object.keys(this.templateConfig).length,
      });
      return true;
    } catch (_error) {
      logger.error('mcpConfigManager.failed.to.load.configuration.4035e97b', { error: _error });
      this.globalConfig = {};
      this.appConfig = {};
      this.transportConfig = {};
      this.templateConfig = {};
      return false;
    }
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
    } catch (_error) {
      logger.error('mcpConfigManager.failed.to.check.file.modification.time.09e698e9', { error: _error });
      return false;
    }
  }

  /**
   * Start watching the configuration file for changes
   */
  public startWatching(): void {
    const generation = this.reloadGeneration;
    if (
      deferUntilRuntimeActivation(() => {
        if (generation === this.reloadGeneration) this.startWatching();
      })
    )
      return;
    // Check if config reload is enabled
    const agentConfig = AgentConfigManager.getInstance();
    const features = agentConfig.get('features');
    if (!features.configReload) {
      logger.info('mcpConfigManager.configuration.hot.reload.is.disabled.skipping.file.watcher.setup.a71d49d7');
      return;
    }

    if (this.configWatcher) {
      return;
    }

    try {
      const configDir = path.dirname(this.configFilePath);
      const configFileName = path.basename(this.configFilePath);

      // Watch the directory instead of the file to handle atomic operations like vim's :x
      const watchedDir = resolveWatchPath(configDir);
      this.configWatcher = fs.watch(watchedDir, (eventType: fs.WatchEventType, filename: string | null) => {
        debugIf(() => ({ message: 'mcpConfigManager.directory.change.detected.4c6feb9e' }));

        // Check if the change is related to our config file
        // Handle both direct changes and atomic renames affecting our config file
        const isConfigFileEvent =
          filename === configFileName ||
          (filename && filename.startsWith(configFileName)) ||
          (eventType === 'rename' && filename && filename.includes(path.parse(configFileName).name));

        if (isConfigFileEvent) {
          debugIf(() => ({
            message: 'mcpConfigManager.configuration.file.change.detected.checking.modification.time.948657e8',
          }));

          // Double-check by comparing modification times to handle vim's atomic saves
          if (this.checkFileModified()) {
            debugIf('mcpConfigManager.file.modification.confirmed.debouncing.reload.0c3de65e');
            this.debouncedReloadConfig();
          } else {
            debugIf('mcpConfigManager.file.modification.time.unchanged.ignoring.event.dfe2f587');
          }
        } else {
          // For debugging: check if file was actually modified despite not matching our criteria
          if (this.checkFileModified()) {
            debugIf(() => ({
              message:
                'mcpConfigManager.file.was.modified.but.event.did.not.match.criteria.debouncing.reload.anyway.a0941437',
            }));
            this.debouncedReloadConfig();
          }
        }
      });
      this.configWatcher.on('error', (error) => {
        logger.warn('mcpConfigManager.configuration.file.watcher.failed.c4b39877', { error: error });
        this.stopWatching();
      });
      logger.info('mcpConfigManager.started.watching.configuration.directory.for.file.6cfd05eb');
    } catch (_error) {
      logger.error('mcpConfigManager.failed.to.start.watching.configuration.file.00929ce9', { error: _error });
    }
  }

  /**
   * Stop watching the configuration file
   */
  public stopWatching(): void {
    this.reloadGeneration++;
    this.cancelDeferredReload?.();
    this.cancelDeferredReload = undefined;
    if (this.configWatcher) {
      this.configWatcher.close();
      this.configWatcher = null;
      logger.info('mcpConfigManager.stopped.watching.configuration.file.d4dd37a7');
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
      logger.info('mcpConfigManager.debounce.period.completed.reloading.configuration.0f648a97');
      this.reloadConfig();
      this.debounceTimer = null;
    }, debounceDelayMs);
  }

  /**
   * Reload the configuration from the config file
   */
  public reloadConfig(): void {
    const generation = this.reloadGeneration;
    void runtimeAdmission
      .run(async () => this.applyReloadConfig())
      .catch((error: unknown) => {
        if (error instanceof RuntimeDrainingError) {
          if (generation === this.reloadGeneration) this.deferReloadUntilResume();
          return;
        }
        logger.error('mcpConfigManager.failed.to.apply.configuration.reload.8f06d810', { error: error });
      });
  }

  private deferReloadUntilResume(): void {
    if (this.cancelDeferredReload) return;
    const reload = () => {
      this.cancelDeferredReload?.();
      this.cancelDeferredReload = undefined;
      this.reloadConfig();
    };
    if (!runtimeAdmission.snapshot().closed) {
      reload();
      return;
    }
    this.cancelDeferredReload = runtimeAdmission.subscribe((snapshot) => {
      if (!snapshot.closed) reload();
    });
  }

  private applyReloadConfig(): void {
    if (getFrozenRuntimeBootstrap(this.configFilePath)) return;
    const oldConfig = { ...this.transportConfig };

    try {
      const loadedSuccessfully = this.loadConfig();

      // Emit event for transport configuration changes
      if (loadedSuccessfully && JSON.stringify(oldConfig) !== JSON.stringify(this.transportConfig)) {
        logger.info('mcpConfigManager.transport.configuration.changed.emitting.event.bf5828e5');
        this.emit(ConfigChangeEvent.TRANSPORT_CONFIG_CHANGED, this.transportConfig);
      }
    } catch (_error) {
      logger.error('mcpConfigManager.failed.to.reload.configuration.2a029532', { error: _error });
    }
  }

  /**
   * Get the current transport configuration
   * @returns The current transport configuration
   */
  public getTransportConfig(): Record<string, MCPServerParams> {
    return { ...this.transportConfig };
  }

  /** Static and declared template targets, with templates authoritative on name conflicts. */
  public getConfiguredServerTargets(): Record<string, MCPServerParams> {
    return { ...this.transportConfig, ...this.templateConfig };
  }

  /**
   * Get the current global MCP configuration.
   */
  public getGlobalConfig(): GlobalTransportConfig {
    return { ...this.globalConfig };
  }

  /**
   * Get the application-level configuration from config.toml.
   * CLI args always take precedence over these values.
   */
  public getAppConfig(): ApplicationConfig {
    return { ...this.appConfig };
  }

  /**
   * Get the effective merged configuration for a specific server.
   */
  public getEffectiveServerConfig(serverName: string): MCPServerParams | undefined {
    return this.transportConfig[serverName] ? { ...this.transportConfig[serverName] } : undefined;
  }

  /**
   * Get all available tags from the configured servers
   * @returns Array of unique tags from all servers
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

export default McpConfigManager;
