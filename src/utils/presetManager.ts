import { promises as fs } from 'fs';
import { join } from 'path';
import { watch, FSWatcher } from 'fs';
import { getConfigDir } from '../constants.js';
import { TagQueryParser } from './tagQueryParser.js';
import { TagQueryEvaluator } from './tagQueryEvaluator.js';
import { McpConfigManager } from '../config/mcpConfigManager.js';
import { PresetConfig, PresetStorage, PresetValidationResult, PresetListItem } from './presetTypes.js';
import logger from '../logger/logger.js';

/**
 * PresetManager handles dynamic preset storage, validation, and hot-reloading.
 * Integrates with client notification system for real-time updates.
 */
export class PresetManager {
  private static instance: PresetManager | null = null;
  private presets: Map<string, PresetConfig> = new Map();
  private configPath: string;
  private watcher: FSWatcher | null = null;
  private notificationCallbacks: Set<(presetName: string) => Promise<void>> = new Set();
  private configDirOption?: string;

  private constructor(configDirOption?: string) {
    // Store presets in config directory based on CLI option, environment, or default
    this.configDirOption = configDirOption;
    const configDir = getConfigDir(configDirOption);
    this.configPath = join(configDir, 'presets.json');
  }

  public static getInstance(configDirOption?: string): PresetManager {
    if (!PresetManager.instance) {
      PresetManager.instance = new PresetManager(configDirOption);
    }
    return PresetManager.instance;
  }

  /**
   * Reset the singleton instance. Primarily for testing.
   */
  public static resetInstance(): void {
    if (PresetManager.instance) {
      PresetManager.instance.cleanup().catch((error) => {
        console.warn('Failed to cleanup PresetManager during reset:', error);
      });
      PresetManager.instance = null;
    }
  }

  /**
   * Initialize preset manager and start file watching
   */
  public async initialize(): Promise<void> {
    try {
      await this.loadPresets();
      await this.startWatching();
      logger.info('PresetManager initialized successfully', {
        presetsLoaded: this.presets.size,
        configPath: this.configPath,
      });
    } catch (error) {
      logger.error('Failed to initialize PresetManager', { error });
      throw error;
    }
  }

  /**
   * Register callback for preset change notifications
   */
  public onPresetChange(callback: (presetName: string) => Promise<void>): void {
    this.notificationCallbacks.add(callback);
  }

  /**
   * Remove notification callback
   */
  public offPresetChange(callback: (presetName: string) => Promise<void>): void {
    this.notificationCallbacks.delete(callback);
  }

  /**
   * Load presets from storage file
   */
  private async loadPresets(): Promise<void> {
    try {
      await this.ensureConfigDirectory();

      try {
        const data = await fs.readFile(this.configPath, 'utf-8');
        const storage: PresetStorage = JSON.parse(data);

        // Clear existing presets
        this.presets.clear();

        // Load presets into memory
        for (const [name, config] of Object.entries(storage.presets || {})) {
          this.presets.set(name, config);
        }

        logger.debug('Presets loaded from file', {
          presetCount: this.presets.size,
          presetNames: Array.from(this.presets.keys()),
        });
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          // File doesn't exist, start with empty presets
          logger.info('No preset file found, starting with empty presets');
          await this.savePresets();
        } else {
          throw error;
        }
      }
    } catch (error) {
      logger.error('Failed to load presets', { error });
      throw new Error(`Failed to load presets: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Save presets to storage file
   */
  private async savePresets(): Promise<void> {
    try {
      await this.ensureConfigDirectory();

      const storage: PresetStorage = {
        version: '1.0.0',
        presets: Object.fromEntries(this.presets),
      };

      await fs.writeFile(this.configPath, JSON.stringify(storage, null, 2), 'utf-8');
      logger.debug('Presets saved to file', {
        presetCount: this.presets.size,
        configPath: this.configPath,
      });
    } catch (error) {
      logger.error('Failed to save presets', { error });
      throw new Error(`Failed to save presets: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Ensure config directory exists
   */
  private async ensureConfigDirectory(): Promise<void> {
    const configDir = getConfigDir(this.configDirOption);
    try {
      await fs.mkdir(configDir, { recursive: true });
    } catch (error: any) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  /**
   * Start watching preset file for changes
   */
  private async startWatching(): Promise<void> {
    if (this.watcher) {
      return;
    }

    try {
      this.watcher = watch(this.configPath, { persistent: false }, async (eventType) => {
        if (eventType === 'change') {
          logger.debug('Preset file changed, reloading...');
          try {
            await this.loadPresets();
            logger.info('Presets reloaded successfully');
          } catch (error) {
            logger.error('Failed to reload presets', { error });
          }
        }
      });

      logger.debug('Started watching preset file', { path: this.configPath });
    } catch (error) {
      logger.warn('Failed to start preset file watching', { error });
    }
  }

  /**
   * Stop watching preset file
   */
  public async cleanup(): Promise<void> {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      logger.debug('Stopped watching preset file');
    }
  }

  /**
   * Create or update a preset
   */
  public async savePreset(
    name: string,
    config: Omit<PresetConfig, 'name' | 'created' | 'lastModified'>,
  ): Promise<void> {
    const validation = await this.validatePreset(name, config);
    if (!validation.isValid) {
      throw new Error(`Invalid preset: ${validation.errors.join('; ')}`);
    }

    const now = new Date().toISOString();
    const existingPreset = this.presets.get(name);

    const presetConfig: PresetConfig = {
      ...config,
      name,
      created: existingPreset?.created || now,
      lastModified: now,
    };

    this.presets.set(name, presetConfig);
    await this.savePresets();

    // Notify clients of preset change
    await this.notifyPresetChange(name);

    logger.info('Preset saved successfully', {
      name,
      strategy: config.strategy,
      tagQuery: config.tagQuery,
    });
  }

  /**
   * Get a preset by name
   */
  public getPreset(name: string): PresetConfig | null {
    return this.presets.get(name) || null;
  }

  /**
   * Get all presets as list items
   */
  public getPresetList(): PresetListItem[] {
    return Array.from(this.presets.values()).map((preset) => ({
      name: preset.name,
      description: preset.description,
      strategy: preset.strategy,
      lastUsed: preset.lastUsed,
      tagQuery: preset.tagQuery,
    }));
  }

  /**
   * Delete a preset
   */
  public async deletePreset(name: string): Promise<boolean> {
    if (!this.presets.has(name)) {
      return false;
    }

    this.presets.delete(name);
    await this.savePresets();

    logger.info('Preset deleted successfully', { name });
    return true;
  }

  /**
   * Update preset usage timestamp
   */
  public async markPresetUsed(name: string): Promise<void> {
    const preset = this.presets.get(name);
    if (!preset) {
      return;
    }

    preset.lastUsed = new Date().toISOString();
    await this.savePresets();
  }

  /**
   * Validate a preset configuration
   */
  public async validatePreset(
    name: string,
    config: Omit<PresetConfig, 'name' | 'created' | 'lastModified'>,
  ): Promise<PresetValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate name
    if (!name || typeof name !== 'string') {
      errors.push('Preset name is required and must be a string');
    } else if (name.length > 50) {
      errors.push('Preset name must be 50 characters or less');
    } else if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      errors.push('Preset name can only contain letters, numbers, hyphens, and underscores');
    }

    // Validate strategy
    if (!config.strategy || !['or', 'and', 'advanced'].includes(config.strategy)) {
      errors.push('Strategy must be one of: or, and, advanced');
    }

    // Validate tag query
    if (!config.tagQuery || typeof config.tagQuery !== 'object') {
      errors.push('Tag query is required and must be an object');
    } else {
      try {
        // Validate JSON query structure
        const validation = TagQueryEvaluator.validateQuery(config.tagQuery);
        if (!validation.isValid) {
          errors.push(...validation.errors.map((err) => `Tag query: ${err}`));
        }

        // Check if query has any meaningful content
        const queryString = TagQueryEvaluator.queryToString(config.tagQuery);
        if (!queryString.trim()) {
          warnings.push('Tag query produces no meaningful filter');
        }
      } catch (error) {
        errors.push(`Invalid tag query: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Resolve preset to tag expression for filtering
   */
  public resolvePresetToExpression(name: string): string | null {
    const preset = this.presets.get(name);
    if (!preset) {
      return null;
    }

    // Mark preset as used
    this.markPresetUsed(name).catch((error) => {
      logger.warn('Failed to update preset usage', { name, error });
    });

    // Convert JSON query to string representation for backward compatibility
    return TagQueryEvaluator.queryToString(preset.tagQuery);
  }

  /**
   * Test a preset against current server configuration
   */
  public async testPreset(name: string): Promise<{ servers: string[]; tags: string[] }> {
    const preset = this.presets.get(name);
    if (!preset) {
      throw new Error(`Preset '${name}' not found`);
    }

    const mcpConfig = McpConfigManager.getInstance();
    const availableServers = mcpConfig.getTransportConfig();

    // Find matching servers based on tag expression
    const matchingServers: string[] = [];
    const allTags = new Set<string>();

    for (const [serverName, serverConfig] of Object.entries(availableServers)) {
      const serverTags = serverConfig.tags || [];

      // Add server tags to collection
      serverTags.forEach((tag: string) => allTags.add(tag));

      // Test if server matches preset expression
      let matches = false;

      try {
        if (preset.strategy === 'advanced' && preset.tagQuery.$advanced) {
          // Handle advanced expressions using the old parser for now
          const expression = TagQueryParser.parseAdvanced(preset.tagQuery.$advanced);
          matches = TagQueryParser.evaluate(expression, serverTags);
        } else {
          // Use JSON query evaluator
          matches = TagQueryEvaluator.evaluate(preset.tagQuery, serverTags);
        }
      } catch (error) {
        logger.warn('Failed to evaluate preset against server', {
          preset: name,
          server: serverName,
          error,
        });
      }

      if (matches) {
        matchingServers.push(serverName);
      }
    }

    return {
      servers: matchingServers,
      tags: Array.from(allTags).sort(),
    };
  }

  /**
   * Notify clients of preset changes
   */
  private async notifyPresetChange(presetName: string): Promise<void> {
    const promises = Array.from(this.notificationCallbacks).map((callback) =>
      callback(presetName).catch((error) => {
        logger.error('Preset change notification failed', { presetName, error });
      }),
    );

    await Promise.all(promises);
    logger.debug('Preset change notifications sent', {
      presetName,
      callbackCount: this.notificationCallbacks.size,
    });
  }

  /**
   * Check if a preset exists
   */
  public hasPreset(name: string): boolean {
    return this.presets.has(name);
  }

  /**
   * Get preset names
   */
  public getPresetNames(): string[] {
    return Array.from(this.presets.keys());
  }
}
