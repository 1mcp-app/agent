import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import logger, { debugIf } from '@src/logger/logger.js';
import { resolveWatchPath } from '@src/utils/watchPath.js';

interface ConfigLoader {
  getConfigFilePath: () => string;
  checkFileModified: () => boolean;
  isReloadEnabled: () => boolean;
  getRuntimeEnvFilePath: () => string;
  checkRuntimeEnvModified: () => boolean;
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
      logger.info('configWatcher.configuration.hot.reload.is.disabled.skipping.file.watcher.setup.03b1b0a9');
      return;
    }

    if (this.configWatcher) {
      logger.warn('configWatcher.file.watcher.already.started.ignoring.duplicate.call.ad93bddf');
      return;
    }

    try {
      const configDir = path.dirname(this.configFilePath);
      const configFileName = path.basename(this.configFilePath);
      const runtimeEnvFileName = path.basename(this.loader.getRuntimeEnvFilePath());

      // Verify directory exists before watching
      if (!fs.existsSync(configDir)) {
        throw new Error(`Configuration directory does not exist: ${configDir}`);
      }

      const watchedDir = resolveWatchPath(configDir);
      this.configWatcher = fs.watch(watchedDir, (eventType: fs.WatchEventType, filename: string | null) => {
        this.handleWatchEvent(eventType, filename, configDir, configFileName, runtimeEnvFileName);
      });
      this.configWatcher.on('error', (error) => {
        logger.warn('configWatcher.configuration.file.watcher.failed.falling.back.to.polling.c2323c67', {
          error: error,
        });
        this.startPolling({ closeWatcher: true });
      });
      this.startPolling();
      logger.info('configWatcher.started.watching.configuration.directory.for.file.dfe83f83', {
        configFile: this.configFilePath,
      });
    } catch (_error) {
      logger.error('configWatcher.startwatching.diagnostic.55a6d834', { error: _error });
      this.startPolling({ closeWatcher: true });
    }
  }

  public stopWatching(): void {
    this.configWatcher?.close();
    this.configWatcher = null;
    logger.info('configWatcher.stopped.watching.configuration.file.bf006a6f');

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
    runtimeEnvFileName: string,
  ): void {
    debugIf(() => ({ message: 'configWatcher.directory.change.detected.f4b0d074' }));

    const isConfigFileEvent = filename === configFileName;
    const isRuntimeEnvEvent = filename === runtimeEnvFileName && this.loader.checkRuntimeEnvModified();

    if (
      isConfigFileEvent ||
      isRuntimeEnvEvent ||
      this.loader.checkFileModified() ||
      this.loader.checkRuntimeEnvModified()
    ) {
      debugIf(() => ({ message: 'configWatcher.configuration.file.change.detected.debouncing.reload.80faa869' }));
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
      if (this.loader.checkFileModified() || this.loader.checkRuntimeEnvModified()) {
        debugIf('configWatcher.configuration.file.modification.detected.by.polling.debouncing.reload.994934b4');
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
      logger.info('configWatcher.debounce.period.completed.reloading.configuration.94659153');
      this.emit('reload');
      this.debounceTimer = null;
    }, debounceDelayMs);
  }
}
