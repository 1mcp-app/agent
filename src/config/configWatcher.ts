import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import logger, { debugIf } from '@src/logger/logger.js';

interface ConfigLoader {
  getConfigFilePath: () => string;
  checkFileModified: () => boolean;
  isReloadEnabled: () => boolean;
}

export class ConfigWatcher extends EventEmitter {
  private configWatcher: fs.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private configFilePath: string;
  private loader: ConfigLoader;

  constructor(configFilePath: string, loader: ConfigLoader) {
    super();
    this.configFilePath = configFilePath;
    this.loader = loader;
  }

  public startWatching(): void {
    if (!this.loader.isReloadEnabled()) {
      logger.info('Configuration hot-reload is disabled, skipping file watcher setup');
      return;
    }

    if (this.configWatcher) {
      return;
    }

    try {
      const configDir = path.dirname(this.configFilePath);
      const configFileName = path.basename(this.configFilePath);

      this.configWatcher = fs.watch(configDir, (eventType: fs.WatchEventType, filename: string | null) => {
        debugIf(() => ({
          message: 'Directory change detected',
          meta: { eventType, filename, configDir, configFileName },
        }));

        const isConfigFileEvent =
          filename === configFileName ||
          (filename && filename.startsWith(configFileName)) ||
          (eventType === 'rename' && filename && filename.includes(path.parse(configFileName).name));

        if (isConfigFileEvent || this.loader.checkFileModified()) {
          debugIf(() => ({
            message: 'Configuration file change detected, debouncing reload',
            meta: { eventType, filename },
          }));
          this.debouncedReloadConfig();
        }
      });
      logger.info(`Started watching configuration directory: ${configDir} for file: ${configFileName}`);
    } catch (error) {
      logger.error(
        `Failed to start watching configuration file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  public stopWatching(): void {
    this.configWatcher?.close();
    this.configWatcher = null;
    logger.info('Stopped watching configuration file');

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private debouncedReloadConfig(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    const agentConfig = AgentConfigManager.getInstance();
    const debounceDelayMs = agentConfig.get('configReload').debounceMs;

    this.debounceTimer = setTimeout(() => {
      logger.info('Debounce period completed, reloading configuration...');
      this.emit('reload');
      this.debounceTimer = null;
    }, debounceDelayMs);
  }
}
