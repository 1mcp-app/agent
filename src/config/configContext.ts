import { getConfigPath } from '../constants.js';

/**
 * Singleton context for managing configuration file resolution
 * Centralizes the logic for resolving config paths from CLI options
 */
class ConfigContext {
  private static instance: ConfigContext | null = null;
  private configDir?: string;
  private configPath?: string;

  private constructor() {
    // Private constructor for singleton
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): ConfigContext {
    if (!ConfigContext.instance) {
      ConfigContext.instance = new ConfigContext();
    }
    return ConfigContext.instance;
  }

  /**
   * Set the config directory
   */
  setConfigDir(dir?: string): void {
    this.configDir = dir;
    this.configPath = undefined; // Clear config path when setting dir
  }

  /**
   * Set the config path directly
   */
  setConfigPath(path?: string): void {
    this.configPath = path;
    this.configDir = undefined; // Clear config dir when setting path
  }

  /**
   * Reset all configuration
   */
  reset(): void {
    this.configDir = undefined;
    this.configPath = undefined;
  }

  /**
   * Get the resolved config path based on priority:
   * 1. Explicit config path (highest priority)
   * 2. Config directory + mcp.json
   * 3. Default global config path
   */
  getResolvedConfigPath(): string {
    if (this.configPath) {
      return this.configPath;
    }

    if (this.configDir) {
      return getConfigPath(this.configDir);
    }

    return getConfigPath();
  }
}

export default ConfigContext;
