import { CONFIG_EVENTS, ConfigChange, ConfigChangeType, ConfigManager } from '@src/config/configManager.js';
import type { RuntimeEnvironmentChange } from '@src/config/types.js';
import {
  clearCompleteConfiguredToolTargetSnapshot,
  clearLastConfiguredToolSnapshot,
} from '@src/core/capabilities/configuredToolSnapshot.js';
import { runtimeAdmission } from '@src/core/server/runtimeDrain.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { MCPServerParams } from '@src/core/types/index.js';
import logger, { debugIf } from '@src/logger/logger.js';

/**
 * ConfigChangeHandler implements business logic for configuration changes
 * It listens to ConfigManager events and decides what actions to take
 */
export class ConfigChangeHandler {
  private static instance: ConfigChangeHandler;
  private configManager: ConfigManager;
  private readonly configChangesListener: (changes: ConfigChange[]) => Promise<void>;
  private readonly runtimeEnvironmentListener: (change: RuntimeEnvironmentChange) => Promise<void>;

  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor(configManager?: ConfigManager) {
    this.configManager = configManager || ConfigManager.getInstance();
    this.configChangesListener = (changes) =>
      runtimeAdmission
        .run(() => this.handleConfigChanges(changes))
        .catch((error: unknown) => {
          logger.error('configChangeHandler.failed.to.apply.configuration.changes.c04a8608', { error: error });
        });
    this.runtimeEnvironmentListener = (change) =>
      runtimeAdmission
        .run(() => this.handleRuntimeEnvironmentChange(change))
        .catch((error: unknown) => {
          logger.error('configChangeHandler.failed.to.apply.runtime.scope.environment.changes.81abbdd0', {
            error: error,
          });
        });

    // Listen to config changes
    this.configManager.on(CONFIG_EVENTS.CONFIG_CHANGED, this.configChangesListener);
    this.configManager.on(CONFIG_EVENTS.RUNTIME_ENVIRONMENT_CHANGED, this.runtimeEnvironmentListener);
  }

  /**
   * Get the ServerManager instance lazily
   */
  private tryGetServerManager(): ServerManager | undefined {
    try {
      return ServerManager.current;
    } catch {
      return undefined;
    }
  }

  private getServerManager(): ServerManager {
    return ServerManager.current;
  }

  /**
   * Get the singleton instance of ConfigChangeHandler
   */
  public static getInstance(configManager?: ConfigManager): ConfigChangeHandler {
    if (!ConfigChangeHandler.instance) {
      ConfigChangeHandler.instance = new ConfigChangeHandler(configManager);
    }
    return ConfigChangeHandler.instance;
  }

  /**
   * Initialize the handler
   */
  public async initialize(): Promise<void> {
    // Ensure ConfigManager is initialized
    if (!this.configManager) {
      this.configManager = ConfigManager.getInstance();
    }

    logger.info('configChangeHandler.configchangehandler.initialized.f312d3c9');
  }

  /**
   * Handle configuration changes with business logic
   */
  private async handleConfigChanges(changes: ConfigChange[]): Promise<void> {
    const templateToolMetadataChanged = this.reconcileDeclaredTemplates();
    this.refreshRuntimeInstructionConfiguration();
    if (changes.length === 0) {
      if (templateToolMetadataChanged) {
        await this.sendListChangedNotifications();
      }
      return;
    }

    logger.info('configChangeHandler.processing.configuration.changes.76003a4f');

    // Get the latest configuration for all operations
    const newConfig = this.configManager.getTransportConfig();

    const appliedChanges: ConfigChange[] = [];
    for (const change of changes) {
      try {
        if (await this.processChange(change, newConfig)) {
          appliedChanges.push(change);
        }
      } catch (_error) {
        logger.error('configChangeHandler.failed.to.process.change.for.server.ba4a3660', { error: _error });
      }
    }

    // Notify clients if capabilities changed
    await this.notifyClientsIfNeeded(appliedChanges, newConfig);
    if (templateToolMetadataChanged && appliedChanges.length === 0) {
      await this.sendListChangedNotifications();
    }
  }

  private async handleRuntimeEnvironmentChange(change: RuntimeEnvironmentChange): Promise<void> {
    const serverManager = this.tryGetServerManager();
    if (!serverManager) return;
    try {
      await serverManager.reloadTemplatesForRuntimeEnvironment(change.templateServerNames);
    } catch (error) {
      logger.error('configChangeHandler.failed.to.reload.templates.after.runtime.scope.environment.change.ac9ce5e9', {
        error: error,
      });
    }
  }

  private refreshRuntimeInstructionConfiguration(): void {
    if (typeof this.configManager.getRuntimeInstructionConfiguration !== 'function') return;
    const aggregator = this.tryGetServerManager()?.getInstructionAggregator();
    aggregator?.setRuntimeInstructionConfiguration(this.configManager.getRuntimeInstructionConfiguration());
  }

  private reconcileDeclaredTemplates(): boolean {
    if (typeof this.configManager.loadDeclaredServerConfigs !== 'function') return false;
    const serverManager = this.tryGetServerManager();
    if (typeof serverManager?.getTemplateServerManager !== 'function') return false;

    const { templateServers, errors } = this.configManager.loadDeclaredServerConfigs();
    if (errors.length > 0) {
      logger.warn(
        'configChangeHandler.skipping.template.reconciliation.because.the.declared.configuration.is.inva.f0aafc7d',
      );
      return false;
    }
    return (
      serverManager.getTemplateServerManager().rebuildTemplateIndex({ mcpTemplates: templateServers })
        ?.toolMetadataChanged ?? false
    );
  }

  /**
   * Process a single configuration change
   */
  private async processChange(change: ConfigChange, newConfig: Record<string, MCPServerParams>): Promise<boolean> {
    // Access fieldsChanged only for 'modified' type using type guard

    debugIf(() => ({ message: 'configChangeHandler.processing.change.for.server.ea2503b1' }));

    switch (change.type) {
      case ConfigChangeType.ADDED: {
        const config = newConfig[change.serverName];
        if (!config) {
          logger.warn(
            'configChangeHandler.skipping.added.server.server.configuration.is.missing.after.reload.76945545',
          );
          return false;
        }

        await this.handleServerAdded(change.serverName, config);
        return true;
      }

      case ConfigChangeType.REMOVED:
        try {
          await this.handleServerRemoved(change.serverName);
          return true;
        } finally {
          clearLastConfiguredToolSnapshot(change.serverName);
          clearCompleteConfiguredToolTargetSnapshot('mcpServers', change.serverName);
        }

      case ConfigChangeType.MODIFIED: {
        const config = newConfig[change.serverName];
        if (!config) {
          logger.warn(
            'configChangeHandler.skipping.modified.server.server.configuration.is.missing.after.reload.7b99998e',
          );
          return false;
        }

        await this.handleServerModified(change.serverName, config, change.fieldsChanged);
        return true;
      }

      default: {
        const _exhaustive: never = change;
        logger.warn('configChangeHandler.unknown.change.type.c3ca2270');
        return false;
      }
    }
  }

  /**
   * Handle server addition.
   *
   * Routes through ServerManager's hot-reload facade so config changes have a
   * single lifecycle entry point. ServerManager owns the coordination between
   * the loading pipeline and lifecycle/status tracking.
   */
  private async handleServerAdded(serverName: string, config: MCPServerParams): Promise<void> {
    logger.info('configChangeHandler.starting.new.server.9b90716d');
    await this.getServerManager().loadMcpServer(serverName, config);
  }

  /**
   * Handle server removal — unload via the canonical pipeline so the tracker
   * entry is cleared (no ghost in /health/mcp).
   */
  private async handleServerRemoved(serverName: string): Promise<void> {
    logger.info('configChangeHandler.stopping.server.2e863e16');
    await this.getServerManager().unloadMcpServer(serverName);
  }

  /**
   * Handle server modification
   */
  private async handleServerModified(
    serverName: string,
    config: MCPServerParams,
    fieldsChanged?: readonly string[],
  ): Promise<void> {
    // Check if disabled field changed
    const disabledChanged = fieldsChanged?.includes('disabled');

    if (config.disabled) {
      // Server was disabled
      logger.info('configChangeHandler.stopping.server.disabled.f7c2723e');
      await this.getServerManager().unloadMcpServer(serverName);
      return;
    }

    if (disabledChanged && !config.disabled) {
      // Server was re-enabled
      logger.info('configChangeHandler.starting.server.re.enabled.c42cea8d');
      await this.getServerManager().loadMcpServer(serverName, config);
      return;
    }

    // Business logic: determine if this requires server restart
    if (this.requiresServerRestart(fieldsChanged)) {
      logger.info('configChangeHandler.restarting.server.functional.changes.b0a6f31f');
      // loadMcpServer is idempotent: ServerManager coordinates unload/reload
      // through the canonical loading pipeline and lifecycle registry.
      await this.getServerManager().loadMcpServer(serverName, config);
    } else {
      // Only tags changed - update metadata without restart
      logger.info('configChangeHandler.updating.server.metadata.only.no.restart.needed.519c8615');
      await this.updateServerMetadata(serverName, config);
      await this.notifyClientsOfMetadataChange(serverName);
    }
  }

  /**
   * Determine if a server restart is required based on changed fields
   */
  private requiresServerRestart(fieldsChanged?: readonly string[]): boolean {
    if (!fieldsChanged || fieldsChanged.length === 0) {
      return true; // Conservative approach - restart if we don't know what changed
    }

    const metadataOnlyFields = new Set(['tags', 'instructionOverride', 'disabledTools', 'toolDescriptionOverrides']);
    return fieldsChanged.some((field) => !metadataOnlyFields.has(field));
  }

  /**
   * Update server metadata without restarting
   */
  private async updateServerMetadata(serverName: string, config: MCPServerParams): Promise<void> {
    try {
      debugIf(() => ({ message: 'configChangeHandler.updating.metadata.for.server.cb80b3e8' }));

      // Update server metadata in ServerManager if server is running
      if (this.getServerManager().isMcpServerRunning(serverName)) {
        await this.updateServerMetadataInServerManager(serverName, config);
      }

      // Update any outbound connections if they exist
      this.updateOutboundConnectionMetadata(serverName, config);

      // Emit event for other components that might need to update their state
      this.configManager.emit(CONFIG_EVENTS.METADATA_UPDATED, { serverName, config });

      debugIf(() => ({ message: 'configChangeHandler.successfully.updated.metadata.for.server.6116c209' }));
    } catch (error) {
      logger.error('configChangeHandler.failed.to.update.metadata.for.server.56841692', { error: error });
      throw error;
    }
  }

  /**
   * Update metadata in ServerManager for a running server
   */
  private async updateServerMetadataInServerManager(serverName: string, config: MCPServerParams): Promise<void> {
    try {
      // Use ServerManager's dedicated metadata update method
      await this.getServerManager().updateServerMetadata(serverName, config);

      debugIf(() => ({
        message: 'configChangeHandler.successfully.updated.metadata.in.servermanager.for.server.4a7bf709',
      }));
    } catch (error) {
      logger.warn('configChangeHandler.failed.to.update.server.metadata.in.servermanager.for.48d0cff4', {
        error: error,
      });
      // Don't throw here, metadata updates should be non-critical
    }
  }

  /**
   * Update metadata in outbound connections (tags, etc.)
   */
  private updateOutboundConnectionMetadata(serverName: string, config: MCPServerParams): void {
    try {
      // Update tags in existing outbound connections if they exist
      const outboundConns = this.getServerManager().getClients();
      const connection = outboundConns.get(serverName);

      if (connection) {
        connection.tags = [...(config.tags ?? [])];

        debugIf(() => ({ message: 'configChangeHandler.updated.outbound.connection.metadata.for.server.bb5d2dc5' }));
      }
    } catch (error) {
      logger.warn('configChangeHandler.failed.to.update.outbound.connection.metadata.for.a4a71b6b', { error: error });
      // Don't throw here, metadata updates should be non-critical
    }
  }

  /**
   * Notify clients about metadata changes (e.g., tag changes)
   */
  private async notifyClientsOfMetadataChange(_serverName: string): Promise<void> {
    try {
      // Send listChanged notifications since capabilities might have changed due to tag modifications
      await this.sendListChangedNotifications();
    } catch (_error) {
      logger.error('configChangeHandler.failed.to.notify.clients.of.metadata.change.for.73b5b124', { error: _error });
    }
  }

  /**
   * Notify clients of capability changes if needed
   */
  private async notifyClientsIfNeeded(
    changes: ConfigChange[],
    _newConfig: Record<string, MCPServerParams>,
  ): Promise<void> {
    // Check if any functional changes occurred (not just tag changes)
    const hasFunctionalChanges = changes.some((change) => {
      if (change.type === ConfigChangeType.ADDED || change.type === ConfigChangeType.REMOVED) {
        return true;
      }

      if (change.type === ConfigChangeType.MODIFIED) {
        const fieldsChanged = change.fieldsChanged;
        return this.requiresServerRestart(fieldsChanged);
      }

      return false;
    });

    if (hasFunctionalChanges) {
      await this.sendListChangedNotifications();
    }
  }

  /**
   * Send listChanged notifications to all connected clients
   */
  private async sendListChangedNotifications(): Promise<void> {
    try {
      const { AgentConfigManager } = await import('@src/core/server/agentConfig.js');
      const { NotificationManager } = await import('@src/core/notifications/notificationManager.js');
      const { CapabilityAggregator } = await import('@src/core/capabilities/capabilityAggregator.js');
      const { createCapabilityNotificationFacts } =
        await import('@src/core/capabilities/capabilityNotificationFacts.js');

      const agentConfig = AgentConfigManager.getInstance();
      if (!agentConfig.get('features').clientNotifications) {
        debugIf('configChangeHandler.client.notifications.disabled.skipping.listchanged.notifications.9b90cbc2');
        return;
      }

      const inboundConnections = this.getServerManager().getInboundConnections();
      const outboundConnections = this.getServerManager().getClients();

      // Calculate new capabilities
      const capabilityAggregator = new CapabilityAggregator(outboundConnections);
      const changes = await capabilityAggregator.updateCapabilities();
      const notificationFacts = createCapabilityNotificationFacts(changes);

      if (changes.hasChanges) {
        debugIf(() => ({ message: 'configChangeHandler.sending.listchanged.notifications.to.clients.a8865155' }));

        // Send notifications to all inbound connections
        for (const [_sessionId, inboundConnection] of inboundConnections) {
          try {
            const notificationManager = new NotificationManager(inboundConnection);
            notificationManager.handleCapabilityChanges({
              resourceTemplatesChanged: changes.resourceTemplatesChanged,
              toolsChanged: notificationFacts.refresh.shouldNotifyListChanged,
              resourcesChanged: notificationFacts.resourcesChanged,
              promptsChanged: notificationFacts.promptsChanged,
              hasChanges: true,
              addedServers: changes.addedServers,
              removedServers: changes.removedServers,
              current: changes.current,
              previous: changes.previous,
            });
          } catch (_error) {
            logger.error('configChangeHandler.failed.to.send.listchanged.notification.for.session.26cbafe5', {
              error: _error,
            });
          }
        }
      }
    } catch (_error) {
      logger.error('configChangeHandler.failed.to.send.listchanged.notifications.2b1028b3', { error: _error });
    }
  }

  /**
   * Stop the handler and clean up resources
   */
  public async stop(): Promise<void> {
    this.configManager.off(CONFIG_EVENTS.CONFIG_CHANGED, this.configChangesListener);
    this.configManager.off(CONFIG_EVENTS.RUNTIME_ENVIRONMENT_CHANGED, this.runtimeEnvironmentListener);
    logger.info('configChangeHandler.configchangehandler.stopped.6b441a59');
  }
}
