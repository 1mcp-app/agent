import { EventEmitter } from 'events';

import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { MCPServerParams } from '@src/core/types/transport.js';
import logger from '@src/logger/logger.js';
import type { ContextData } from '@src/types/context.js';

import { ConfigChangeDetector } from './configChangeDetector.js';
import { ConfigLoader } from './configLoader.js';
import { ConfigWatcher } from './configWatcher.js';
import { TemplateProcessor } from './templateProcessor.js';
import { CONFIG_EVENTS, ConfigChange, ConfigChangeType, TemplateLoadResult } from './types.js';

export class ConfigManager extends EventEmitter {
  private static instance: ConfigManager;
  private transportConfig: Record<string, MCPServerParams> = {};
  private loader: ConfigLoader;
  private templateProcessor: TemplateProcessor;
  private watcher: ConfigWatcher;
  private changeDetector: ConfigChangeDetector;

  private constructor(configFilePath?: string) {
    super();
    this.loader = new ConfigLoader(configFilePath);
    this.templateProcessor = new TemplateProcessor();
    this.watcher = new ConfigWatcher(this.loader.getConfigFilePath(), this.loader);
    this.changeDetector = new ConfigChangeDetector();

    this.loadConfig();
    this.setupWatcherEvents();
  }

  public static getInstance(configFilePath?: string): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager(configFilePath);
    }
    return ConfigManager.instance;
  }

  private setupWatcherEvents(): void {
    this.watcher.on('reload', () => {
      this.handleConfigChange().catch((error) => {
        logger.error(`Error handling config change: ${error}`);
      });
    });
  }

  public async initialize(): Promise<void> {
    this.watcher.startWatching();
    logger.info('ConfigManager initialized');
  }

  public async stop(): Promise<void> {
    this.watcher.stopWatching();
    logger.info('ConfigManager stopped');
  }

  private loadConfig(): void {
    try {
      this.transportConfig = this.loader.loadConfigWithEnvSubstitution();

      const agentConfig = AgentConfigManager.getInstance();
      const features = agentConfig.get('features');
      const substitutionStatus = features.envSubstitution ? 'with' : 'without';
      logger.info(`Configuration loaded successfully ${substitutionStatus} environment variable substitution`);
    } catch (error) {
      logger.error(`Failed to load configuration: ${error instanceof Error ? error.message : String(error)}`);
      this.transportConfig = {};
    }
  }

  public async loadConfigWithTemplates(context?: ContextData): Promise<TemplateLoadResult> {
    try {
      const rawConfig = this.loader.loadRawConfig();
      return this.templateProcessor.loadConfigWithTemplates(rawConfig, context);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        staticServers: {},
        templateServers: {},
        errors: [`Configuration parsing failed: ${errorMessage}`],
      };
    }
  }

  public getTemplateProcessingErrors(): string[] {
    return this.templateProcessor.getTemplateProcessingErrors();
  }

  public hasTemplateProcessingErrors(): boolean {
    return this.templateProcessor.hasTemplateProcessingErrors();
  }

  public clearTemplateCache(): void {
    this.templateProcessor.clearTemplateCache();
  }

  public isReloadEnabled(): boolean {
    return this.loader.isReloadEnabled();
  }

  private async handleConfigChange(): Promise<void> {
    if (!this.isReloadEnabled()) {
      logger.info('Configuration hot-reload is disabled, ignoring file changes');
      return;
    }

    const oldConfig = { ...this.transportConfig };
    let newConfig: Record<string, MCPServerParams>;

    try {
      newConfig = this.loader.loadConfigWithEnvSubstitution();
    } catch (error) {
      logger.error(
        `Failed to load or validate configuration: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.emit(CONFIG_EVENTS.VALIDATION_ERROR, error);
      return;
    }

    const changes = this.changeDetector.detectChanges(oldConfig, newConfig);
    this.transportConfig = newConfig;

    logger.info(`Detected ${changes.length} configuration changes`);
    this.emit(CONFIG_EVENTS.CONFIG_CHANGED, changes);

    for (const change of changes) {
      switch (change.type) {
        case ConfigChangeType.ADDED:
          this.emit(CONFIG_EVENTS.SERVER_ADDED, change.serverName);
          break;
        case ConfigChangeType.REMOVED:
          this.emit(CONFIG_EVENTS.SERVER_REMOVED, change.serverName);
          break;
      }
    }
  }

  public async reloadConfig(): Promise<void> {
    await this.handleConfigChange();
  }

  public getTransportConfig(): Record<string, MCPServerParams> {
    return this.loader.getTransportConfig(this.transportConfig);
  }

  public getAvailableTags(): string[] {
    return this.loader.getAvailableTags(this.transportConfig);
  }
}

export type { ConfigChange };
export { ConfigChangeType, CONFIG_EVENTS };

export default ConfigManager;
