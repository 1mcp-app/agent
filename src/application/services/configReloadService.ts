import { ConfigChangeEvent, McpConfigManager } from '@src/config/mcpConfigManager.js';
import { SelectiveReloadManager } from '@src/core/reload/selectiveReloadManager.js';
import { InboundConnection, MCPServerParams } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';

/**
 * Service to handle dynamic configuration reloading
 */
export class ConfigReloadService {
  private static instance: ConfigReloadService;
  private serverInstances: Map<string, InboundConnection> = new Map();
  private currentConfig: Record<string, MCPServerParams> = {};
  private isReloading = false;

  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor() {}

  /**
   * Get the singleton instance of the ConfigReloadService
   * @returns The ConfigReloadService instance
   */
  public static getInstance(): ConfigReloadService {
    if (!ConfigReloadService.instance) {
      ConfigReloadService.instance = new ConfigReloadService();
    }
    return ConfigReloadService.instance;
  }

  /**
   * Initialize the service with initial transports
   * @param initialTransports The initial transports
   */
  public initialize(): void {
    // We need to get the initial config that corresponds to these transports
    const configManager = McpConfigManager.getInstance();
    this.currentConfig = configManager.getTransportConfig();

    // Remove any existing listeners to prevent duplicates
    configManager.removeAllListeners(ConfigChangeEvent.TRANSPORT_CONFIG_CHANGED);

    // Increase max listeners limit to prevent warnings
    configManager.setMaxListeners(20);

    // Set up configuration change listener
    configManager.on(ConfigChangeEvent.TRANSPORT_CONFIG_CHANGED, this.handleConfigChange.bind(this));

    // Start watching for configuration changes
    configManager.startWatching();

    logger.info('Config reload service initialized');
  }

  /**
   * Handle configuration changes
   * @param newConfig The new transport configuration
   */
  private async handleConfigChange(newConfig: Record<string, MCPServerParams>): Promise<void> {
    if (this.isReloading) {
      return;
    }

    this.isReloading = true;
    logger.info('Handling configuration change...');

    try {
      const reloadManager = SelectiveReloadManager.getInstance();

      // Execute reload using SelectiveReloadManager
      const operation = await reloadManager.executeReload(this.currentConfig, newConfig);

      if (operation.status === 'completed') {
        this.currentConfig = newConfig;
        logger.info('Configuration reload completed successfully');

        // Trigger listChanged notifications
        await this.sendListChangedNotifications();
      } else {
        logger.error(`Configuration reload failed: ${operation.error}`);
      }
    } catch (error) {
      logger.error(`Failed to reload configuration: ${error}`);
    } finally {
      this.isReloading = false;
    }
  }

  /**
   * Update the server info when a client connects
   * @param sessionId The session ID for this server instance
   * @param serverInfo The MCP server instance
   */
  public updateServerInfo(sessionId: string, serverInfo: InboundConnection): void {
    this.serverInstances.set(sessionId, serverInfo);
    logger.debug(`Updated server info for session ${sessionId} in config reload service`);
  }

  /**
   * Remove server info when a client disconnects
   * @param sessionId The session ID to remove
   */
  public removeServerInfo(sessionId: string): void {
    this.serverInstances.delete(sessionId);
    logger.debug(`Removed server info for session ${sessionId} from config reload service`);
  }

  /**
   * Send listChanged notifications to clients after config reload
   */
  private async sendListChangedNotifications(): Promise<void> {
    try {
      const { ServerManager } = await import('@src/core/server/serverManager.js');
      const { AgentConfigManager } = await import('@src/core/server/agentConfig.js');

      const agentConfig = AgentConfigManager.getInstance();
      if (!agentConfig.get('features').clientNotifications) {
        return;
      }

      const serverManager = ServerManager.current;
      const inboundConnections = serverManager.getInboundConnections();

      for (const [sessionId, inboundConnection] of inboundConnections) {
        try {
          await this.triggerCapabilityNotifications(inboundConnection);
        } catch (error) {
          logger.error(`Failed to send listChanged notification for session ${sessionId}: ${error}`);
        }
      }
    } catch (error) {
      logger.error(`Failed to send listChanged notifications: ${error}`);
    }
  }

  /**
   * Trigger capability notifications for a specific inbound connection
   */
  private async triggerCapabilityNotifications(inboundConnection: InboundConnection): Promise<void> {
    try {
      const { ServerManager } = await import('@src/core/server/serverManager.js');
      const serverManager = ServerManager.current;
      const outboundConnections = serverManager.getClients();

      const { CapabilityAggregator } = await import('@src/core/capabilities/capabilityAggregator.js');
      const capabilityAggregator = new CapabilityAggregator(outboundConnections);

      const changes = await capabilityAggregator.updateCapabilities();

      if (changes.hasChanges) {
        const { NotificationManager } = await import('@src/core/notifications/notificationManager.js');
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
      }
    } catch (error) {
      logger.error(`Error triggering capability notifications: ${error}`);
    }
  }

  /**
   * Stop the service and clean up resources
   */
  public stop(): void {
    const configManager = McpConfigManager.getInstance();
    configManager.stopWatching();
    configManager.removeAllListeners(ConfigChangeEvent.TRANSPORT_CONFIG_CHANGED);
    logger.info('Config reload service stopped');
  }
}

export default ConfigReloadService.getInstance();
