import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { getGlobalConfigPath, getGlobalConfigDir, DEFAULT_CONFIG } from '../constants.js';
import logger from '../logger/logger.js';
import { MCPServerParams } from '../core/types/index.js';

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
      logger.error(`Failed to ensure config exists: ${error}`);
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

      const configData = JSON.parse(fs.readFileSync(this.configFilePath, 'utf8'));
      this.transportConfig = configData.mcpServers || {};
      logger.info('Configuration loaded successfully');
    } catch (error) {
      logger.error(`Failed to load configuration: ${error}`);
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
      logger.error(`Failed to check file modification time: ${error}`);
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
        logger.debug(`Directory change detected: event=${eventType}, filename=${filename}`);

        // Check if the change is related to our config file
        // Handle both direct changes and atomic renames affecting our config file
        const isConfigFileEvent =
          filename === configFileName ||
          (filename && filename.startsWith(configFileName)) ||
          (eventType === 'rename' && filename && filename.includes(path.parse(configFileName).name));

        if (isConfigFileEvent) {
          logger.debug(
            `Configuration file change detected (event: ${eventType}, filename: ${filename}), checking modification time...`,
          );

          // Double-check by comparing modification times to handle vim's atomic saves
          if (this.checkFileModified()) {
            logger.debug(`File modification confirmed, debouncing reload...`);
            this.debouncedReloadConfig();
          } else {
            logger.debug(`File modification time unchanged, ignoring event`);
          }
        } else {
          // For debugging: check if file was actually modified despite not matching our criteria
          if (this.checkFileModified()) {
            logger.debug(
              `File was modified but event didn't match criteria. Event: ${eventType}, filename: ${filename}. Debouncing reload anyway...`,
            );
            this.debouncedReloadConfig();
          }
        }
      });
      logger.info(`Started watching configuration directory: ${configDir} for file: ${configFileName}`);
    } catch (error) {
      logger.error(`Failed to start watching configuration file: ${error}`);
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
      logger.error(`Failed to reload configuration: ${error}`);
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
