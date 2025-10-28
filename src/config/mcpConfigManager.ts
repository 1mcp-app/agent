import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

import { substituteEnvVarsInConfig } from '@src/config/envProcessor.js';
import { DEFAULT_CONFIG, getGlobalConfigDir, getGlobalConfigPath } from '@src/constants.js';
import { MCPServerParams } from '@src/core/types/index.js';
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
  private configFilePath: string;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceDelayMs: number = 500; // 500ms debounce delay
  private lastModified: number = 0;

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
   * Get the singleton instance of McpConfigManager
   * @param configFilePath - Optional path to the config file
   */
  public static getInstance(configFilePath?: string): McpConfigManager {
    if (!McpConfigManager.instance) {
      McpConfigManager.instance = new McpConfigManager(configFilePath);
    }
    return McpConfigManager.instance;
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
   * Load the configuration from the config file
   */
  private loadConfig(): void {
    try {
      const stats = fs.statSync(this.configFilePath);
      this.lastModified = stats.mtime.getTime();

      const rawConfigData = fs.readFileSync(this.configFilePath, 'utf8');

      // Parse JSON and apply environment variable substitution
      const configData = JSON.parse(rawConfigData) as unknown;
      const processedConfig = substituteEnvVarsInConfig(configData) as { mcpServers?: Record<string, MCPServerParams> };

      // Type guard to ensure processedConfig has proper structure
      if (!processedConfig || typeof processedConfig !== 'object') {
        logger.error('Invalid configuration format');
        this.transportConfig = {};
        return;
      }

      const configObj = processedConfig as Record<string, unknown>;
      this.transportConfig = (configObj.mcpServers as Record<string, MCPServerParams>) || {};
      logger.info('Configuration loaded successfully with environment variable substitution');
    } catch (error) {
      logger.error(`Failed to load configuration: ${error instanceof Error ? error.message : String(error)}`);
      this.transportConfig = {};
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

    // Set new timer
    this.debounceTimer = setTimeout(() => {
      logger.info('Debounce period completed, reloading configuration...');
      this.reloadConfig();
      this.debounceTimer = null;
    }, this.debounceDelayMs);
  }

  /**
   * Reload the configuration from the config file
   */
  public reloadConfig(): void {
    const oldConfig = { ...this.transportConfig };

    try {
      this.loadConfig();

      // Emit event for transport configuration changes
      if (JSON.stringify(oldConfig) !== JSON.stringify(this.transportConfig)) {
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
