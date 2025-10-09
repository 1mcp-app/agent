import { EventEmitter } from 'events';

import { McpLoadingManager } from '@src/core/loading/mcpLoadingManager.js';
import { NotificationManager } from '@src/core/notifications/notificationManager.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { InboundConnection, OutboundConnections } from '@src/core/types/index.js';
import logger, { debugIf } from '@src/logger/logger.js';

import { CapabilityAggregator, CapabilityChanges } from './capabilityAggregator.js';

/**
 * Events emitted by AsyncLoadingOrchestrator
 */
export interface AsyncLoadingOrchestratorEvents {
  'orchestrator-ready': () => void;
  'server-capabilities-updated': (serverName: string, changes: CapabilityChanges) => void;
  'notifications-sent': (types: string[]) => void;
}

/**
 * Orchestrates the async loading system by coordinating CapabilityAggregator,
 * NotificationManager, and LoadingStateTracker events.
 *
 * This class handles the complete flow:
 * 1. MCP server becomes ready
 * 2. Capability aggregation detects changes
 * 3. Notifications are sent to clients about new capabilities
 *
 * @example
 * ```typescript
 * const orchestrator = new AsyncLoadingOrchestrator(
 *   outboundConnections,
 *   inboundConnection,
 *   loadingManager
 * );
 * orchestrator.initialize();
 * ```
 */
export class AsyncLoadingOrchestrator extends EventEmitter {
  private capabilityAggregator: CapabilityAggregator;
  private notificationManager: NotificationManager | null = null;
  private loadingManager: McpLoadingManager;
  private serverManager: ServerManager;
  private agentConfig: AgentConfigManager;
  private isInitialized: boolean = false;
  private isShuttingDown: boolean = false;

  constructor(
    outboundConnections: OutboundConnections,
    serverManager: ServerManager,
    loadingManager: McpLoadingManager,
  ) {
    super();
    this.loadingManager = loadingManager;
    this.serverManager = serverManager;
    this.agentConfig = AgentConfigManager.getInstance();

    // Create capability aggregator
    this.capabilityAggregator = new CapabilityAggregator(outboundConnections);

    this.setMaxListeners(20);
  }

  /**
   * Initialize the orchestrator and wire up event handlers
   */
  public initialize(): void {
    if (this.isInitialized) {
      logger.warn('AsyncLoadingOrchestrator already initialized');
      return;
    }

    if (!this.agentConfig.isAsyncLoadingEnabled()) {
      logger.info('Async loading disabled - AsyncLoadingOrchestrator skipping initialization');
      return;
    }

    logger.info('Initializing AsyncLoadingOrchestrator...');

    // Wire up the event chain: LoadingManager -> CapabilityAggregator
    this.setupEventChain();

    this.isInitialized = true;
    logger.info('AsyncLoadingOrchestrator initialized successfully');
    this.emit('orchestrator-ready');
  }

  /**
   * Initialize notification manager when inbound connection is available
   */
  public initializeNotifications(inboundConnection: InboundConnection): void {
    if (this.notificationManager) {
      logger.warn('NotificationManager already initialized');
      return;
    }

    if (!this.agentConfig.isAsyncLoadingEnabled()) {
      return;
    }

    // Create notification manager with config from agent settings
    const notificationConfig = {
      batchNotifications: this.agentConfig.isBatchNotificationsEnabled(),
      batchDelayMs: this.agentConfig.getBatchDelayMs(),
      notifyOnServerReady: this.agentConfig.isNotifyOnServerReadyEnabled(),
    };
    this.notificationManager = new NotificationManager(inboundConnection, notificationConfig);

    // Wire up notification events
    this.setupNotificationEvents();

    logger.info('AsyncLoadingOrchestrator notification manager initialized');
  }

  /**
   * Set up the event handling chain for capability tracking
   */
  private setupEventChain(): void {
    // 1. Listen for server readiness from LoadingManager
    this.loadingManager.on('server-loaded', (serverName, _result) => {
      if (this.isShuttingDown) return;

      debugIf(() => ({ message: `Server ${serverName} became ready, updating capabilities`, meta: { serverName } }));
      this.handleServerReady(serverName);
    });

    // 2. Listen for capability changes from CapabilityAggregator
    this.capabilityAggregator.on('capabilities-changed', (changes) => {
      if (this.isShuttingDown) return;

      debugIf('Capabilities changed, processing notifications');
      this.handleCapabilityChanges(changes);
    });

    debugIf('Event chain setup completed');
  }

  /**
   * Set up notification event handlers
   */
  private setupNotificationEvents(): void {
    if (!this.notificationManager) {
      return;
    }

    // 3. Listen for notification events from NotificationManager
    this.notificationManager.on('batch-sent', (notifications, clientCount) => {
      if (this.isShuttingDown) return;

      logger.info(`Sent listChanged notifications to ${clientCount} clients: [${notifications.join(', ')}]`);
      this.emit('notifications-sent', notifications);
    });

    this.notificationManager.on('notification-failed', (type, error) => {
      logger.error(`Failed to send ${type} listChanged notification: ${error.message}`);
    });

    debugIf('Notification event handlers setup completed');
  }

  /**
   * Handle a server becoming ready by updating capabilities
   */
  private async handleServerReady(serverName: string): Promise<void> {
    try {
      // Update capability aggregation
      const changes = await this.capabilityAggregator.updateCapabilities();

      if (changes.hasChanges) {
        logger.info(
          `Server ${serverName} ready: ${changes.current.tools.length} tools, ${changes.current.resources.length} resources, ${changes.current.prompts.length} prompts now available`,
        );
        this.emit('server-capabilities-updated', serverName, changes);
      } else {
        debugIf(() => ({
          message: `Server ${serverName} ready but no capability changes detected`,
          meta: { serverName },
        }));
      }
    } catch (error) {
      logger.error(`Failed to update capabilities after ${serverName} became ready: ${error}`);
    }
  }

  /**
   * Handle capability changes by sending notifications
   */
  private handleCapabilityChanges(changes: CapabilityChanges): void {
    if (!changes.hasChanges) {
      return;
    }

    // Send notifications to clients if notification manager is available
    if (this.notificationManager) {
      this.notificationManager.handleCapabilityChanges(changes);
    } else {
      debugIf('Capability changes detected but no notification manager available yet');
    }

    // Log the changes for visibility
    const summary = this.capabilityAggregator.getCapabilitiesSummary();
    logger.info(`Capability update complete: ${summary}`);
  }

  /**
   * Get the capability aggregator instance
   */
  public getCapabilityAggregator(): CapabilityAggregator {
    return this.capabilityAggregator;
  }

  /**
   * Get the notification manager instance
   */
  public getNotificationManager(): NotificationManager | null {
    return this.notificationManager;
  }

  /**
   * Check if the orchestrator is initialized
   */
  public isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Force refresh capabilities and send notifications if needed
   */
  public async refreshCapabilities(): Promise<void> {
    if (!this.isInitialized || this.isShuttingDown) {
      logger.warn('Cannot refresh capabilities - orchestrator not ready');
      return;
    }

    try {
      logger.info('Manually refreshing capabilities...');
      const changes = await this.capabilityAggregator.updateCapabilities();

      if (changes.hasChanges) {
        this.handleCapabilityChanges(changes);
        logger.info('Manual capability refresh completed with changes');
      } else {
        logger.info('Manual capability refresh completed - no changes detected');
      }
    } catch (error) {
      logger.error(`Failed to refresh capabilities: ${error}`);
    }
  }

  /**
   * Update configuration at runtime
   */
  public updateConfig(): void {
    if (!this.isInitialized) {
      return;
    }

    if (this.notificationManager) {
      const notificationConfig = {
        batchNotifications: this.agentConfig.isBatchNotificationsEnabled(),
        batchDelayMs: this.agentConfig.getBatchDelayMs(),
        notifyOnServerReady: this.agentConfig.isNotifyOnServerReadyEnabled(),
      };

      this.notificationManager.updateConfig(notificationConfig);
      debugIf('AsyncLoadingOrchestrator configuration updated');
    }
  }

  /**
   * Get status summary for monitoring
   */
  public getStatusSummary(): string {
    if (!this.isInitialized) {
      return 'not-initialized';
    }

    const capabilities = this.capabilityAggregator.getCapabilitiesSummary();
    const notifications = this.notificationManager ? this.notificationManager.getStatusSummary() : 'not-initialized';

    return `capabilities: ${capabilities}, notifications: ${notifications}`;
  }

  /**
   * Shutdown the orchestrator
   */
  public shutdown(): void {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    logger.info('Shutting down AsyncLoadingOrchestrator...');

    try {
      // Flush any pending notifications
      if (this.notificationManager) {
        this.notificationManager.flushPendingNotifications();
        this.notificationManager.shutdown();
      }

      // Remove all listeners
      this.removeAllListeners();
      this.capabilityAggregator.removeAllListeners();
      if (this.notificationManager) {
        this.notificationManager.removeAllListeners();
      }

      logger.info('AsyncLoadingOrchestrator shutdown complete');
    } catch (error) {
      logger.error(`Error during AsyncLoadingOrchestrator shutdown: ${error}`);
    }
  }
}
