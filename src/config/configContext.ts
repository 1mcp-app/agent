/**
 * Configuration context for managing config directory and file paths
 * This provides a centralized way to handle config directory resolution
 * without passing parameters through every function call
 */

import { getConfigPath, getGlobalConfigPath } from '../constants.js';

class ConfigContext {
  private static instance: ConfigContext;
  private configDir?: string;
  private configPath?: string;

  private constructor() {}

  public static getInstance(): ConfigContext {
    if (!ConfigContext.instance) {
      ConfigContext.instance = new ConfigContext();
    }
    return ConfigContext.instance;
  }

  /**
   * Set the config directory for this context
   */
  public setConfigDir(configDir?: string): void {
    this.configDir = configDir;
    this.configPath = undefined; // Reset config path when dir changes
  }

  /**
   * Set the config file path directly (takes precedence over configDir)
   */
  public setConfigPath(configPath?: string): void {
    this.configPath = configPath;
  }

  /**
   * Get the resolved config file path based on current context
   */
  public getResolvedConfigPath(): string {
    if (this.configPath) {
      return this.configPath;
    }

    if (this.configDir) {
      return getConfigPath(this.configDir);
    }

    return getGlobalConfigPath();
  }

  /**
   * Reset the context to default state
   */
  public reset(): void {
    this.configDir = undefined;
    this.configPath = undefined;
  }
}

export default ConfigContext;
