import { CONFIG_EVENTS, ConfigChange, ConfigChangeType, ConfigManager } from '@src/config/configManager.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { MCPServerParams } from '@src/core/types/transport.js';
import logger, { debugIf } from '@src/logger/logger.js';

/**
 * ConfigChangeHandler implements business logic for configuration changes
 * It listens to ConfigManager events and decides what actions to take
 */
export class ConfigChangeHandler {
  private static instance: ConfigChangeHandler;
  private configManager: ConfigManager;

  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor(configManager?: ConfigManager) {
    this.configManager = configManager || ConfigManager.getInstance();

    // Listen to config changes
    this.configManager.on(CONFIG_EVENTS.CONFIG_CHANGED, this.handleConfigChanges.bind(this));
  }

  /**
   * Get the ServerManager instance lazily
   */
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

    logger.info('ConfigChangeHandler initialized');
  }

  /**
   * Handle configuration changes with business logic
   */
  private async handleConfigChanges(changes: ConfigChange[]): Promise<void> {
    if (changes.length === 0) {
      return;
    }

    logger.info(`Processing ${changes.length} configuration changes`);

    // Get the latest configuration for all operations
    const newConfig = this.configManager.getTransportConfig();

    for (const change of changes) {
      try {
        await this.processChange(change, newConfig);
      } catch (error) {
        logger.error(`Failed to process change for server ${change.serverName}: ${error}`);
      }
    }

    // Notify clients if capabilities changed
    await this.notifyClientsIfNeeded(changes, newConfig);
  }

  /**
   * Process a single configuration change
   */
  private async processChange(change: ConfigChange, newConfig: Record<string, MCPServerParams>): Promise<void> {
    debugIf(() => ({
      message: `Processing ${change.type} change for server ${change.serverName}`,
      meta: { change, fieldsChanged: change.fieldsChanged },
    }));

    switch (change.type) {
      case ConfigChangeType.ADDED:
        await this.handleServerAdded(change.serverName, newConfig[change.serverName]);
        break;

      case ConfigChangeType.REMOVED:
        await this.handleServerRemoved(change.serverName);
        break;

      case ConfigChangeType.MODIFIED:
        await this.handleServerModified(change.serverName, newConfig[change.serverName], change.fieldsChanged);
        break;

      default:
        logger.warn(`Unknown change type: ${String(change.type)}`);
    }
  }

  /**
   * Handle server addition
   */
  private async handleServerAdded(serverName: string, config: MCPServerParams): Promise<void> {
    logger.info(`Starting new server: ${serverName}`);
    await this.getServerManager().startServer(serverName, config);
  }

  /**
   * Handle server removal
   */
  private async handleServerRemoved(serverName: string): Promise<void> {
    logger.info(`Stopping server: ${serverName}`);
    await this.getServerManager().stopServer(serverName);
  }

  /**
   * Handle server modification
   */
  private async handleServerModified(
    serverName: string,
    config: MCPServerParams,
    fieldsChanged?: string[],
  ): Promise<void> {
    // Check if disabled field changed
    const disabledChanged = fieldsChanged?.includes('disabled');

    if (config.disabled) {
      // Server was disabled
      logger.info(`Stopping server (disabled): ${serverName}`);
      await this.getServerManager().stopServer(serverName);
      return;
    }

    if (disabledChanged && !config.disabled) {
      // Server was re-enabled
      logger.info(`Starting server (re-enabled): ${serverName}`, {
        config: {
          command: config.command,
          url: config.url,
          type: config.type,
          args: config.args,
          disabled: config.disabled,
        },
      });
      await this.getServerManager().startServer(serverName, config);
      return;
    }

    // Business logic: determine if this requires server restart
    if (this.requiresServerRestart(fieldsChanged)) {
      logger.info(`Restarting server (functional changes): ${serverName}`);
      await this.getServerManager().restartServer(serverName, config);
    } else {
      // Only tags changed - update metadata without restart
      logger.info(`Updating server metadata only (no restart needed): ${serverName}`);
      await this.updateServerMetadata(serverName, config);
      await this.notifyClientsOfMetadataChange(serverName);
    }
  }

  /**
   * Determine if a server restart is required based on changed fields
   */
  private requiresServerRestart(fieldsChanged?: string[]): boolean {
    if (!fieldsChanged || fieldsChanged.length === 0) {
      return true; // Conservative approach - restart if we don't know what changed
    }

    // Only restart if non-tag fields changed
    const nonTagFields = fieldsChanged.filter((field) => field !== 'tags');
    return nonTagFields.length > 0;
  }

  /**
   * Update server metadata without restarting
   */
  private async updateServerMetadata(serverName: string, config: MCPServerParams): Promise<void> {
    try {
      debugIf(() => ({
        message: `Updating metadata for server ${serverName}`,
        meta: { newTags: config.tags },
      }));

      // Update server metadata in ServerManager if server is running
      if (this.getServerManager().isMcpServerRunning(serverName)) {
        await this.updateServerMetadataInServerManager(serverName, config);
      }

      // Update any outbound connections if they exist
      this.updateOutboundConnectionMetadata(serverName, config);

      // Emit event for other components that might need to update their state
      this.configManager.emit(CONFIG_EVENTS.METADATA_UPDATED, { serverName, config });

      debugIf(() => ({
        message: `Successfully updated metadata for server ${serverName}`,
        meta: { newTags: config.tags },
      }));
    } catch (error) {
      logger.error(`Failed to update metadata for server ${serverName}:`, error);
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
        message: `Successfully updated metadata in ServerManager for server ${serverName}`,
        meta: { newConfig: config },
      }));
    } catch (error) {
      logger.warn(`Failed to update server metadata in ServerManager for ${serverName}:`, error);
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
        // Update transport metadata if supported
        if (connection.transport && 'tags' in connection.transport) {
          // Update tags on transport if it supports it
          connection.transport.tags = config.tags;
        }

        debugIf(() => ({
          message: `Updated outbound connection metadata for server ${serverName}`,
          meta: { connectionName: connection.name, newTags: config.tags },
        }));
      }
    } catch (error) {
      logger.warn(`Failed to update outbound connection metadata for ${serverName}:`, error);
      // Don't throw here, metadata updates should be non-critical
    }
  }

  /**
   * Notify clients about metadata changes (e.g., tag changes)
   */
  private async notifyClientsOfMetadataChange(serverName: string): Promise<void> {
    try {
      // Send listChanged notifications since capabilities might have changed due to tag modifications
      await this.sendListChangedNotifications();
    } catch (error) {
      logger.error(`Failed to notify clients of metadata change for ${serverName}: ${error}`);
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

      if (change.type === ConfigChangeType.MODIFIED && this.requiresServerRestart(change.fieldsChanged)) {
        return true;
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

      const agentConfig = AgentConfigManager.getInstance();
      if (!agentConfig.get('features').clientNotifications) {
        debugIf('Client notifications disabled, skipping listChanged notifications');
        return;
      }

      const inboundConnections = this.getServerManager().getInboundConnections();
      const outboundConnections = this.getServerManager().getClients();

      // Calculate new capabilities
      const capabilityAggregator = new CapabilityAggregator(outboundConnections);
      const changes = await capabilityAggregator.updateCapabilities();

      if (changes.hasChanges) {
        debugIf(() => ({
          message: 'Sending listChanged notifications to clients',
          meta: {
            toolsChanged: changes.current.tools.length > 0,
            resourcesChanged: changes.current.resources.length > 0,
            promptsChanged: changes.current.prompts.length > 0,
          },
        }));

        // Send notifications to all inbound connections
        for (const [sessionId, inboundConnection] of inboundConnections) {
          try {
            const notificationManager = new NotificationManager(inboundConnection);
            notificationManager.handleCapabilityChanges({
              toolsChanged: changes.current.tools.length > 0,
              resourcesChanged: changes.current.resources.length > 0,
              promptsChanged: changes.current.prompts.length > 0,
              hasChanges: true,
              addedServers: changes.addedServers,
              removedServers: changes.removedServers,
              current: changes.current,
              previous: changes.previous,
            });
          } catch (error) {
            logger.error(`Failed to send listChanged notification for session ${sessionId}: ${error}`);
          }
        }
      }
    } catch (error) {
      logger.error(`Failed to send listChanged notifications: ${error}`);
    }
  }

  /**
   * Stop the handler and clean up resources
   */
  public async stop(): Promise<void> {
    // Remove event listeners
    this.configManager.removeAllListeners(CONFIG_EVENTS.CONFIG_CHANGED);
    logger.info('ConfigChangeHandler stopped');
  }
}
