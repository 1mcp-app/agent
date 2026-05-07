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
  private pollTimer: ReturnType<typeof setInterval> | null = null;
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
      logger.warn('File watcher already started, ignoring duplicate call');
      return;
    }

    try {
      const configDir = path.dirname(this.configFilePath);
      const configFileName = path.basename(this.configFilePath);

      // Verify directory exists before watching
      if (!fs.existsSync(configDir)) {
        throw new Error(`Configuration directory does not exist: ${configDir}`);
      }

      this.configWatcher = fs.watch(configDir, (eventType: fs.WatchEventType, filename: string | null) => {
        this.handleWatchEvent(eventType, filename, configDir, configFileName);
      });
      this.configWatcher.on('error', (error) => {
        logger.warn('Configuration file watcher failed; falling back to polling', { error });
        this.startPolling({ closeWatcher: true });
      });
      this.startPolling();
      logger.info(`Started watching configuration directory: ${configDir} for file: ${configFileName}`);
    } catch (error) {
      const errorMsg = `Failed to start watching configuration file: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(errorMsg);
      this.startPolling({ closeWatcher: true });
    }
  }

  public stopWatching(): void {
    this.configWatcher?.close();
    this.configWatcher = null;
    logger.info('Stopped watching configuration file');

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private handleWatchEvent(
    eventType: fs.WatchEventType,
    filename: string | null,
    configDir: string,
    configFileName: string,
  ): void {
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
  }

  private startPolling(options: { closeWatcher?: boolean } = {}): void {
    if (this.pollTimer) {
      return;
    }

    if (options.closeWatcher) {
      this.configWatcher?.close();
      this.configWatcher = null;
    }

    this.pollTimer = setInterval(() => {
      if (this.loader.checkFileModified()) {
        debugIf('Configuration file modification detected by polling, debouncing reload');
        this.debouncedReloadConfig();
      }
    }, 1000);
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
