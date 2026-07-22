import { promises as fs, FSWatcher, watch } from 'fs';
import { join } from 'path';

import { getAllServerTargets } from '@src/commands/shared/baseConfigUtils.js';
import { getConfigDir } from '@src/constants.js';
import { TagQueryEvaluator } from '@src/domains/preset/parsers/tagQueryEvaluator.js';
import { PresetErrorHandler } from '@src/domains/preset/services/presetErrorHandler.js';
import { PresetServerChangeDetector } from '@src/domains/preset/services/presetServerChangeDetector.js';
import {
  PresetConfig,
  PresetListItem,
  PresetStorage,
  PresetValidationResult,
} from '@src/domains/preset/types/presetTypes.js';
import logger from '@src/logger/logger.js';

import { cleanupPresetManagerState } from './presetManagerCleanup.js';
import { ensurePresetConfigDirectory, writePresetStorage } from './presetStorage.js';
import { testPresetAgainstServers } from './presetTesting.js';
import { validatePresetConfig } from './presetValidation.js';

/**
 * PresetManager handles dynamic preset storage, validation, and hot-reloading.
 * Integrates with client notification system for real-time updates.
 */
export class PresetManager {
  private static instance: PresetManager | null = null;
  private presets: Map<string, PresetConfig> = new Map();
  private configPath: string;
  private watcher: FSWatcher | null = null;
  private reloadTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly DEBOUNCE_DELAY = 500; // 500ms debounce delay
  private notificationCallbacks: Set<(presetName: string) => Promise<void>> = new Set();
  private configDirOption?: string;
  private changeDetector: PresetServerChangeDetector = new PresetServerChangeDetector();

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
        logger.warn('Failed to cleanup PresetManager during reset:', error);
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
   * Load presets from storage without starting file watcher
   * This is useful for quick loading when file watching is not needed (e.g., STDIO transport)
   */
  public async loadPresetsWithoutWatcher(): Promise<void> {
    await this.loadPresets(true);
  }

  public async reloadFromStorage(): Promise<void> {
    await this.loadPresets(true);
  }

  /**
   * Load presets from storage file
   */
  private async loadPresets(skipChangeDetectorInit: boolean = false): Promise<void> {
    try {
      await ensurePresetConfigDirectory(this.configDirOption);

      try {
        const data = await fs.readFile(this.configPath, 'utf-8');
        const storage = JSON.parse(data) as PresetStorage;

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

        // Initialize change detector with current server lists
        if (!skipChangeDetectorInit) {
          await this.initializeChangeDetector();
        }
      } catch (error: unknown) {
        if (error instanceof Error && 'code' in error) {
          const errorCode = (error as Error & { code?: string }).code;
          if (errorCode === 'ENOENT') {
            // File doesn't exist, start with empty presets
            logger.info('No preset file found, starting with empty presets');
            await this.savePresets();
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }
    } catch (error) {
      logger.error('Failed to load presets', { error });
      PresetErrorHandler.throwError(
        `Failed to load presets: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { context: 'preset loading', exitCode: 2 },
      );
    }
  }

  /**
   * Reload presets and notify clients of any server list changes
   */
  private async reloadAndNotifyChanges(): Promise<void> {
    // Store current server lists before reloading
    const previousServerLists = new Map<string, string[]>();
    for (const presetName of this.presets.keys()) {
      try {
        const testResult = await this.testPreset(presetName);
        previousServerLists.set(presetName, testResult.servers);
      } catch (error) {
        logger.warn('Failed to get server list before reload', { presetName, error });
        previousServerLists.set(presetName, []);
      }
    }

    // Reload presets from file (skip change detector initialization)
    await this.loadPresets(true);

    // Check for changes and notify affected presets
    const changedPresets: string[] = [];

    for (const presetName of this.presets.keys()) {
      try {
        const newTestResult = await this.testPreset(presetName);
        const previousServers = previousServerLists.get(presetName) || [];

        // Manually check for changes by comparing server lists
        const previousSet = new Set(previousServers);
        const currentSet = new Set(newTestResult.servers);

        const hasChanged =
          previousServers.length !== newTestResult.servers.length ||
          !newTestResult.servers.every((server) => previousSet.has(server));

        if (hasChanged) {
          const added = newTestResult.servers.filter((s) => !previousSet.has(s));
          const removed = previousServers.filter((s) => !currentSet.has(s));

          logger.info('Detected server list changes for preset', {
            presetName,
            added,
            removed,
            previousCount: previousServers.length,
            currentCount: newTestResult.servers.length,
          });

          changedPresets.push(presetName);
        }

        // Update the detector with the new server list
        try {
          this.changeDetector.updateServerList(presetName, newTestResult.servers);
        } catch (error) {
          logger.error('Failed to update change detector for preset', {
            presetName,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      } catch (error) {
        logger.error('Failed to check for preset changes', {
          presetName,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Handle deleted presets
    const currentPresetNames = new Set(this.presets.keys());
    const trackedPresetNames = this.changeDetector.getTrackedPresets();

    for (const trackedPresetName of trackedPresetNames) {
      if (!currentPresetNames.has(trackedPresetName)) {
        logger.info('Preset was deleted, cleaning up tracking', { presetName: trackedPresetName });
        this.changeDetector.removePreset(trackedPresetName);
        // Note: We don't need to notify for deleted presets as clients will get errors
        // when trying to use them and will handle gracefully
      }
    }

    // Notify clients for presets with server list changes
    if (changedPresets.length > 0) {
      logger.info('Notifying clients of preset changes', {
        changedPresets,
        totalChangedPresets: changedPresets.length,
      });

      for (const presetName of changedPresets) {
        await this.notifyPresetChange(presetName);
      }
    } else {
      logger.debug('No preset server list changes detected, skipping notifications');
    }
  }

  /**
   * Initialize change detector with current preset server lists
   */
  private async initializeChangeDetector(): Promise<void> {
    for (const presetName of this.presets.keys()) {
      try {
        const testResult = await this.testPreset(presetName);
        this.changeDetector.updateServerList(presetName, testResult.servers);
        logger.debug('Initialized change detector for preset', {
          presetName,
          serverCount: testResult.servers.length,
        });
      } catch (error) {
        logger.warn('Failed to initialize change detector for preset', {
          presetName,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        this.changeDetector.updateServerList(presetName, []);
      }
    }
  }

  /**
   * Save presets to storage file
   */
  private async savePresets(): Promise<void> {
    try {
      await writePresetStorage(this.configPath, this.presets, this.configDirOption);
      logger.debug('Presets saved to file', {
        presetCount: this.presets.size,
        configPath: this.configPath,
      });
    } catch (error) {
      logger.error('Failed to save presets', { error });
      PresetErrorHandler.throwError(
        `Failed to save presets: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { context: 'preset saving', exitCode: 3 },
      );
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
          logger.debug('Preset file changed, scheduling reload...');

          // Clear any existing debounce timeout
          if (this.reloadTimeout) {
            clearTimeout(this.reloadTimeout);
          }

          // Schedule debounced reload
          this.reloadTimeout = setTimeout(async () => {
            try {
              await this.reloadAndNotifyChanges();
              logger.info('Presets reloaded successfully');
            } catch (error) {
              logger.error('Failed to reload presets', { error });
            } finally {
              this.reloadTimeout = null;
            }
          }, this.DEBOUNCE_DELAY);
        }
      });

      logger.debug('Started watching preset file', { path: this.configPath, debounceDelay: this.DEBOUNCE_DELAY });
    } catch (error) {
      logger.warn('Failed to start preset file watching', { error });
    }
  }

  /**
   * Stop watching preset file
   */
  public async cleanup(): Promise<void> {
    const state = await cleanupPresetManagerState({
      reloadTimeout: this.reloadTimeout,
      watcher: this.watcher,
      notificationCallbacks: this.notificationCallbacks,
      changeDetector: this.changeDetector,
      presets: this.presets,
    });
    this.reloadTimeout = state.reloadTimeout;
    this.watcher = state.watcher;
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
   * Validate a preset configuration
   */
  public async validatePreset(
    name: string,
    config: Omit<PresetConfig, 'name' | 'created' | 'lastModified'>,
  ): Promise<PresetValidationResult> {
    return validatePresetConfig(name, config);
  }

  /**
   * Resolve preset to tag expression for filtering
   */
  public resolvePresetToExpression(name: string): string | null {
    const preset = this.presets.get(name);
    if (!preset) {
      logger.warn('Attempted to resolve non-existent preset', { name });
      return null;
    }

    try {
      // Convert JSON query to string representation for backward compatibility
      const expression = TagQueryEvaluator.queryToString(preset.tagQuery);

      if (!expression || expression.trim() === '') {
        logger.warn('Preset resolved to empty expression', { name, tagQuery: preset.tagQuery });
        return null;
      }

      return expression;
    } catch (error) {
      logger.error('Failed to resolve preset to expression', {
        name,
        error: error instanceof Error ? error.message : 'Unknown error',
        tagQuery: preset.tagQuery,
      });
      return null;
    }
  }

  /**
   * Test a preset against current server configuration
   */
  public async testPreset(name: string): Promise<{ servers: string[]; tags: string[] }> {
    const preset = this.presets.get(name);
    if (!preset) {
      throw new Error(`Preset '${name}' not found`);
    }

    return testPresetAgainstServers(name, preset, getAllServerTargets());
  }

  /**
   * Notify clients of preset changes
   */
  private async notifyPresetChange(presetName: string): Promise<void> {
    const promises = Array.from(this.notificationCallbacks).map((callback) =>
      callback(presetName).catch((error: unknown) => {
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

  /**
   * Get the configuration path
   */
  public getConfigPath(): string {
    return this.configPath;
  }
}
