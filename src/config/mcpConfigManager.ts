import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

import ConfigContext from '@src/config/configContext.js';
import { ConfigLoader } from '@src/config/configLoader.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { ApplicationConfig, GlobalTransportConfig, MCPServerParams } from '@src/core/types/index.js';
import logger, { debugIf } from '@src/logger/logger.js';

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
  private globalConfig: GlobalTransportConfig = {};
  private appConfig: ApplicationConfig = {};
  private configFilePath: string;
  private loader: ConfigLoader;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastModified: number = 0;

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
      const features = AgentConfigManager.getInstance().get('features');

      this.lastModified = loadedConfig.lastModified;
      this.globalConfig = loadedConfig.globalConfig;
      this.appConfig = loadedConfig.appConfig;
      this.transportConfig = loadedConfig.validatedServers;
      const substitutionStatus = features.envSubstitution ? 'with' : 'without';
      logger.info(`Configuration loaded successfully ${substitutionStatus} environment variable substitution`);
      return true;
    } catch (error) {
      logger.error(`Failed to load configuration: ${error instanceof Error ? error.message : String(error)}`);
      this.globalConfig = {};
      this.appConfig = {};
      this.transportConfig = {};
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
    const agentConfig = AgentConfigManager.getInstance();
    const features = agentConfig.get('features');
    if (!features.configReload) {
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
        // Handle both direct changes and atomic renames affecting our config file
        const isConfigFileEvent =
          filename === configFileName ||
          (filename && filename.startsWith(configFileName)) ||
          (eventType === 'rename' && filename && filename.includes(path.parse(configFileName).name));

        if (isConfigFileEvent) {
          debugIf(() => ({
            message: 'Configuration file change detected, checking modification time',
            meta: { eventType, filename, isConfigFileEvent },
          }));

          // Double-check by comparing modification times to handle vim's atomic saves
          if (this.checkFileModified()) {
            debugIf('File modification confirmed, debouncing reload');
            this.debouncedReloadConfig();
          } else {
            debugIf('File modification time unchanged, ignoring event');
          }
        } else {
          // For debugging: check if file was actually modified despite not matching our criteria
          if (this.checkFileModified()) {
            debugIf(() => ({
              message: 'File was modified but event did not match criteria, debouncing reload anyway',
              meta: { eventType, filename, configFileName },
            }));
            this.debouncedReloadConfig();
          }
        }
      });
      this.configWatcher.on('error', (error) => {
        logger.warn('Configuration file watcher failed', { error });
        this.stopWatching();
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
      this.reloadConfig();
      this.debounceTimer = null;
    }, debounceDelayMs);
  }

  /**
   * Reload the configuration from the config file
   */
  public reloadConfig(): void {
    const oldConfig = { ...this.transportConfig };

    try {
      const loadedSuccessfully = this.loadConfig();

      // Emit event for transport configuration changes
      if (loadedSuccessfully && JSON.stringify(oldConfig) !== JSON.stringify(this.transportConfig)) {
        logger.info('Transport configuration changed, emitting event');
        this.emit(ConfigChangeEvent.TRANSPORT_CONFIG_CHANGED, this.transportConfig);
      }
    } catch (error) {
      logger.error(`Failed to reload configuration: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get the current transport configuration
   * @returns The current transport configuration
   */
  public getTransportConfig(): Record<string, MCPServerParams> {
    return { ...this.transportConfig };
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
