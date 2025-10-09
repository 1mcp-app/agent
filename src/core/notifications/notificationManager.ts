import { EventEmitter } from 'events';

import {
  PromptListChangedNotification,
  ResourceListChangedNotification,
  ToolListChangedNotification,
} from '@modelcontextprotocol/sdk/types.js';

import { CapabilityChanges } from '@src/core/capabilities/capabilityAggregator.js';
import { InboundConnection, ServerStatus } from '@src/core/types/index.js';
import logger, { debugIf } from '@src/logger/logger.js';

/**
 * Configuration for notification batching and behavior
 */
export interface NotificationConfig {
  /** Whether to enable notification batching */
  readonly batchNotifications: boolean;
  /** Delay in milliseconds before sending batched notifications */
  readonly batchDelayMs: number;
  /** Whether to notify on server readiness changes */
  readonly notifyOnServerReady: boolean;
}

/**
 * Default notification configuration
 */
export const DEFAULT_NOTIFICATION_CONFIG: NotificationConfig = {
  batchNotifications: true,
  batchDelayMs: 1000, // 1 second
  notifyOnServerReady: true,
};

/**
 * Tracks pending notifications to be sent
 */
interface PendingNotifications {
  toolsChanged: boolean;
  resourcesChanged: boolean;
  promptsChanged: boolean;
  timestamp: Date;
}

/**
 * Events emitted by NotificationManager
 */
export interface NotificationManagerEvents {
  'notification-sent': (type: 'tools' | 'resources' | 'prompts', clientCount: number) => void;
  'notification-failed': (type: 'tools' | 'resources' | 'prompts', error: Error) => void;
  'batch-sent': (notifications: string[], clientCount: number) => void;
}

/**
 * Manages sending listChanged notifications to connected clients when MCP server
 * capabilities change during async loading.
 *
 * Features:
 * - Batches multiple notification types together to reduce client spam
 * - Handles client connection failures gracefully
 * - Provides configurable batching delays and behavior
 * - Tracks notification success/failure metrics
 *
 * @example
 * ```typescript
 * const manager = new NotificationManager(inboundConnection, config);
 * manager.handleCapabilityChanges(changes);
 * ```
 */
export class NotificationManager extends EventEmitter {
  private inboundConn: InboundConnection;
  private config: NotificationConfig;
  private pendingNotifications: PendingNotifications | null = null;
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private isShuttingDown: boolean = false;

  constructor(inboundConnection: InboundConnection, config: Partial<NotificationConfig> = {}) {
    super();
    this.inboundConn = inboundConnection;
    this.config = { ...DEFAULT_NOTIFICATION_CONFIG, ...config };
    this.setMaxListeners(20);
  }

  /**
   * Handle capability changes and send appropriate notifications
   */
  public handleCapabilityChanges(changes: CapabilityChanges): void {
    if (!this.config.notifyOnServerReady || this.isShuttingDown) {
      return;
    }

    if (!changes.hasChanges) {
      debugIf('No capability changes detected, skipping notifications');
      return;
    }

    logger.info(
      `Handling capability changes: tools=${changes.toolsChanged}, resources=${changes.resourcesChanged}, prompts=${changes.promptsChanged}`,
    );

    if (this.config.batchNotifications) {
      this.scheduleBatchedNotification(changes);
    } else {
      this.sendImmediateNotifications(changes);
    }
  }

  /**
   * Schedule notifications to be sent in a batch after a delay
   */
  private scheduleBatchedNotification(changes: CapabilityChanges): void {
    // Update pending notifications
    if (!this.pendingNotifications) {
      this.pendingNotifications = {
        toolsChanged: false,
        resourcesChanged: false,
        promptsChanged: false,
        timestamp: new Date(),
      };
    }

    this.pendingNotifications.toolsChanged = this.pendingNotifications.toolsChanged || changes.toolsChanged;
    this.pendingNotifications.resourcesChanged = this.pendingNotifications.resourcesChanged || changes.resourcesChanged;
    this.pendingNotifications.promptsChanged = this.pendingNotifications.promptsChanged || changes.promptsChanged;

    // Reset timer if one is already running
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    // Schedule batch send
    this.batchTimer = setTimeout(() => {
      this.sendBatchedNotifications();
    }, this.config.batchDelayMs);

    debugIf(() => ({
      message: `Scheduled batched notifications to be sent in ${this.config.batchDelayMs}ms`,
      meta: { delayMs: this.config.batchDelayMs },
    }));
  }

  /**
   * Send all pending notifications as a batch
   */
  private sendBatchedNotifications(): void {
    if (!this.pendingNotifications || this.isShuttingDown) {
      return;
    }

    const pending = this.pendingNotifications;
    this.pendingNotifications = null;
    this.batchTimer = null;

    const notifications: string[] = [];

    if (pending.toolsChanged) {
      notifications.push('tools');
      this.sendToolListChangedNotification();
    }

    if (pending.resourcesChanged) {
      notifications.push('resources');
      this.sendResourceListChangedNotification();
    }

    if (pending.promptsChanged) {
      notifications.push('prompts');
      this.sendPromptListChangedNotification();
    }

    if (notifications.length > 0) {
      logger.info(`Sent batched listChanged notifications: [${notifications.join(', ')}]`);
      this.emit('batch-sent', notifications, this.getClientCount());
    }
  }

  /**
   * Send notifications immediately without batching
   */
  private sendImmediateNotifications(changes: CapabilityChanges): void {
    if (changes.toolsChanged) {
      this.sendToolListChangedNotification();
    }

    if (changes.resourcesChanged) {
      this.sendResourceListChangedNotification();
    }

    if (changes.promptsChanged) {
      this.sendPromptListChangedNotification();
    }
  }

  /**
   * Send ToolListChangedNotification to client
   */
  private sendToolListChangedNotification(): void {
    this.sendNotification('tools', {
      method: 'notifications/tools/list_changed',
      params: {},
    });
  }

  /**
   * Send ResourceListChangedNotification to client
   */
  private sendResourceListChangedNotification(): void {
    this.sendNotification('resources', {
      method: 'notifications/resources/list_changed',
      params: {},
    });
  }

  /**
   * Send PromptListChangedNotification to client
   */
  private sendPromptListChangedNotification(): void {
    this.sendNotification('prompts', {
      method: 'notifications/prompts/list_changed',
      params: {},
    });
  }

  /**
   * Send a notification to the connected client
   */
  private sendNotification(
    type: 'tools' | 'resources' | 'prompts',
    notification: ToolListChangedNotification | ResourceListChangedNotification | PromptListChangedNotification,
  ): void {
    try {
      // Check if server is connected
      if (this.inboundConn.status !== ServerStatus.Connected || !this.inboundConn.server.transport) {
        logger.warn(`Cannot send ${type} listChanged notification - server not connected`);
        return;
      }

      // Send notification
      this.inboundConn.server.notification(notification);

      debugIf(() => ({ message: `Sent ${type} listChanged notification to client`, meta: { type } }));
      this.emit('notification-sent', type, this.getClientCount());
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`Failed to send ${type} listChanged notification: ${err.message}`);
      this.emit('notification-failed', type, err);

      // If connection is broken, log a warning
      if (err.message.includes('Not connected')) {
        logger.warn('Client connection lost during notification sending');
      }
    }
  }

  /**
   * Get count of connected clients (always 1 for this proxy architecture)
   */
  private getClientCount(): number {
    return this.inboundConn.status === ServerStatus.Connected ? 1 : 0;
  }

  /**
   * Force send any pending notifications immediately
   */
  public flushPendingNotifications(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.sendBatchedNotifications();
    }
  }

  /**
   * Update configuration at runtime
   */
  public updateConfig(newConfig: Partial<NotificationConfig>): void {
    this.config = { ...this.config, ...newConfig };
    debugIf('NotificationManager configuration updated');
  }

  /**
   * Get current configuration
   */
  public getConfig(): NotificationConfig {
    return { ...this.config };
  }

  /**
   * Check if notifications are enabled
   */
  public isEnabled(): boolean {
    return this.config.notifyOnServerReady;
  }

  /**
   * Get summary of notification manager state
   */
  public getStatusSummary(): string {
    const status = this.isEnabled() ? 'enabled' : 'disabled';
    const batching = this.config.batchNotifications ? `batched(${this.config.batchDelayMs}ms)` : 'immediate';
    const pending = this.pendingNotifications ? 'has-pending' : 'no-pending';
    return `${status}, ${batching}, ${pending}`;
  }

  /**
   * Shutdown the notification manager
   */
  public shutdown(): void {
    this.isShuttingDown = true;

    // Send any pending notifications before shutdown
    this.flushPendingNotifications();

    debugIf('NotificationManager shutdown complete');
  }
}
