import { ConfigChangeEvent, McpConfigManager } from '@src/config/mcpConfigManager.js';
import { setupCapabilities } from '@src/core/capabilities/capabilityManager.js';
import { ClientManager } from '@src/core/client/clientManager.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { EnhancedTransport, InboundConnection, MCPServerParams } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';
import { createTransports } from '@src/transport/transportFactory.js';

/**
 * Service to handle dynamic configuration reloading
 */
export class ConfigReloadService {
  private static instance: ConfigReloadService;
  private serverInstances: Map<string, InboundConnection> = new Map();
  private currentTransports: Record<string, EnhancedTransport> = {};
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
  public initialize(initialTransports: Record<string, EnhancedTransport>): void {
    this.currentTransports = initialTransports;

    const configManager = McpConfigManager.getInstance();

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

    // Store current transports for reconnection
    const currentTransportEntries = Object.entries(this.currentTransports);

    try {
      // Close all current transports
      for (const [key, transport] of currentTransportEntries) {
        try {
          await transport.close();
          logger.info(`Closed transport: ${key}`);
        } catch (error) {
          logger.error(`Error closing transport ${key}: ${error}`);
        }
      }

      // Create new transports from updated configuration
      const newTransports = createTransports(newConfig);

      // Create clients for the new transports
      const clientManager = ClientManager.getOrCreateInstance();
      const newClients = await clientManager.createClients(newTransports);

      // Update ServerManager with new clients and transports
      const serverManager = ServerManager.current;
      serverManager.updateClientsAndTransports(newClients, newTransports);

      // Register new capabilities with the server if serverInfo is available
      for (const serverInfo of this.serverInstances.values()) {
        await setupCapabilities(newClients, serverInfo);
      }

      // Update current transports
      this.currentTransports = newTransports;

      // Trigger listChanged notifications after successful config reload
      await this.sendListChangedNotifications();

      logger.info('Configuration reload completed successfully');
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
    // Check if client notifications are enabled
    const agentConfig = AgentConfigManager.getInstance();
    if (!agentConfig.get('features').clientNotifications) {
      logger.info('Client notifications are disabled, skipping listChanged notifications after config reload');
      return;
    }

    try {
      const serverManager = ServerManager.current;
      const inboundConnections = serverManager.getInboundConnections();

      // For each connected client, get their AsyncLoadingOrchestrator and refresh capabilities
      for (const [sessionId, inboundConnection] of inboundConnections) {
        try {
          // Try to get the AsyncLoadingOrchestrator from the server context
          // Note: This requires the orchestrator to be accessible
          // We'll use a more direct approach to trigger listChanged notifications
          await this.triggerCapabilityNotifications(inboundConnection);
        } catch (error) {
          logger.error(`Failed to send listChanged notification for session ${sessionId}: ${error}`);
        }
      }

      logger.info(`Sent listChanged notifications to ${inboundConnections.size} connected clients after config reload`);
    } catch (error) {
      logger.error(`Failed to send listChanged notifications: ${error}`);
    }
  }

  /**
   * Trigger capability notifications for a specific inbound connection
   */
  private async triggerCapabilityNotifications(inboundConnection: InboundConnection): Promise<void> {
    try {
      // Get the current outbound connections (MCP servers)
      const serverManager = ServerManager.current;
      const outboundConnections = serverManager.getClients();

      // Create a temporary capability aggregator to detect changes
      const { CapabilityAggregator } = await import('@src/core/capabilities/capabilityAggregator.js');
      const capabilityAggregator = new CapabilityAggregator(outboundConnections);

      // Get the current capabilities
      const changes = await capabilityAggregator.updateCapabilities();

      // If there are capabilities to notify about, create notification manager and send
      if (
        changes.hasChanges ||
        changes.current.tools.length > 0 ||
        changes.current.resources.length > 0 ||
        changes.current.prompts.length > 0
      ) {
        const { NotificationManager } = await import('@src/core/notifications/notificationManager.js');
        const notificationManager = new NotificationManager(inboundConnection);

        // Force send notifications for all capability types that exist
        const forcedChanges = {
          toolsChanged: changes.current.tools.length > 0,
          resourcesChanged: changes.current.resources.length > 0,
          promptsChanged: changes.current.prompts.length > 0,
          hasChanges:
            changes.current.tools.length > 0 ||
            changes.current.resources.length > 0 ||
            changes.current.prompts.length > 0,
          addedServers: changes.addedServers,
          removedServers: changes.removedServers,
          current: changes.current,
          previous: changes.previous,
        };

        notificationManager.handleCapabilityChanges(forcedChanges);
        logger.debug(
          `Triggered listChanged notifications for capabilities: tools=${forcedChanges.toolsChanged}, resources=${forcedChanges.resourcesChanged}, prompts=${forcedChanges.promptsChanged}`,
        );
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
