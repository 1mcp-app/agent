import { EventEmitter } from 'events';

import { McpLoadingEvent, McpLoadingManager } from '@src/core/loading/mcpLoadingManager.js';
import { NotificationManager } from '@src/core/notifications/notificationManager.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { InboundConnection, OutboundConnections } from '@src/core/types/index.js';
import { writeLocalDiagnostic } from '@src/logger/localDiagnostics.js';
import logger, { debugIf } from '@src/logger/logger.js';

import { AsyncLoadingOrchestratorEvent } from './asyncLoadingOrchestratorEvent.js';
import { CapabilityAggregator, CapabilityChanges } from './capabilityAggregator.js';
import type { CapabilityRefreshResult } from './capabilityCatalog.js';
import { InternalCapabilitiesProvider } from './internalCapabilitiesProvider.js';

/**
 * Orchestrates the async loading system by coordinating CapabilityAggregator,
 * NotificationManager, and LoadingStateTracker events.
 *
 * This class handles the complete flow:
 * 1. Every MCP server reaches a terminal loading state
 * 2. Capability aggregation publishes one completed snapshot
 * 3. Notifications are sent to clients about the completed snapshot
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
export type BackendStartupPolicy = 'configured' | 'cooperative-activation';

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
  public async initialize(startupPolicy: BackendStartupPolicy = 'configured'): Promise<void> {
    if (this.isInitialized) {
      logger.warn('asyncLoadingOrchestrator.asyncloadingorchestrator.already.initialized.8b366424');
      return;
    }

    if (!this.agentConfig.get('asyncLoading').enabled && startupPolicy === 'configured') {
      logger.info(
        'asyncLoadingOrchestrator.async.loading.disabled.asyncloadingorchestrator.skipping.initialization.e7bfe337',
      );
      return;
    }

    logger.info('asyncLoadingOrchestrator.initializing.asyncloadingorchestrator.c18c24fd');

    // Initialize 1mcp capabilities provider
    const internalProvider = InternalCapabilitiesProvider.getInstance();
    await internalProvider.initialize();
    logger.info('asyncLoadingOrchestrator.1mcp.capabilities.provider.initialized.76a4df74');

    // Wire up the event chain: LoadingManager -> CapabilityAggregator
    this.setupEventChain();

    this.isInitialized = true;
    logger.info('asyncLoadingOrchestrator.asyncloadingorchestrator.initialized.successfully.f6981563');
    this.emit(AsyncLoadingOrchestratorEvent.OrchestratorReady);
  }

  /**
   * Initialize notification manager when inbound connection is available
   */
  public initializeNotifications(inboundConnection: InboundConnection): void {
    if (this.notificationManager) {
      logger.warn('asyncLoadingOrchestrator.notificationmanager.already.initialized.9b4a7b4f');
      return;
    }

    if (!this.agentConfig.get('asyncLoading').enabled) {
      return;
    }

    // Create notification manager with config from agent settings
    const notificationConfig = {
      batchNotifications: this.agentConfig.get('asyncLoading').batchNotifications,
      batchDelayMs: this.agentConfig.get('asyncLoading').batchDelayMs,
      notifyOnServerReady: this.agentConfig.get('asyncLoading').notifyOnServerReady,
    };
    this.notificationManager = new NotificationManager(inboundConnection, notificationConfig);

    // Wire up notification events
    this.setupNotificationEvents();

    logger.info('asyncLoadingOrchestrator.asyncloadingorchestrator.notification.manager.initialized.132f1042');
  }

  /**
   * Set up the event handling chain for capability tracking
   */
  private setupEventChain(): void {
    // 1. Listen for server readiness from LoadingManager
    this.loadingManager.on(McpLoadingEvent.ServerLoaded, (serverName: string) => {
      if (this.isShuttingDown) return;

      this.serverManager.recordMcpServerReady(serverName);
      debugIf(() => ({
        message: 'asyncLoadingOrchestrator.server.became.ready.waiting.for.loading.cycle.completion.153e87d5',
        meta: { serverName: serverName },
      }));
    });

    this.loadingManager.on(McpLoadingEvent.LoadingComplete, () => {
      if (this.isShuttingDown) return;

      debugIf('asyncLoadingOrchestrator.loading.cycle.completed.publishing.capability.snapshot.dc43dc0b');
      void this.handleLoadingComplete();
    });

    // 2. Listen for capability changes from CapabilityAggregator
    this.capabilityAggregator.on('capabilities-changed', (changes: CapabilityChanges) => {
      if (this.isShuttingDown) return;

      debugIf('asyncLoadingOrchestrator.capabilities.changed.processing.notifications.b9b52ad8');
      this.handleCapabilityChanges(changes);
    });

    debugIf('asyncLoadingOrchestrator.event.chain.setup.completed.5d5b6001');
  }

  /**
   * Set up notification event handlers
   */
  private setupNotificationEvents(): void {
    if (!this.notificationManager) {
      return;
    }

    // 3. Listen for notification events from NotificationManager
    this.notificationManager.on('batch-sent', (notifications: string[], _clientCount: number) => {
      if (this.isShuttingDown) return;

      logger.info('asyncLoadingOrchestrator.sent.listchanged.notifications.to.clients.5d7a03f6');
      this.emit(AsyncLoadingOrchestratorEvent.NotificationsSent, notifications);
    });

    this.notificationManager.on('notification-failed', (_type: string, _error: Error) => {
      logger.error('asyncLoadingOrchestrator.failed.to.send.listchanged.notification.3ae391c3');
      writeLocalDiagnostic('warn', 'capability.notification.failed', { type: _type, error: _error });
    });

    debugIf('asyncLoadingOrchestrator.notification.event.handlers.setup.completed.13932b2d');
  }

  /**
   * Publish capabilities after every server reaches a terminal loading state.
   */
  private async handleLoadingComplete(): Promise<void> {
    const startedAt = Date.now();
    try {
      // Update capability aggregation
      const changes = await this.capabilityAggregator.updateCapabilities();
      writeLocalDiagnostic('info', 'capability.snapshot.completed', () => ({
        hasChanges: changes.hasChanges,
        readyServers: changes.current.readyServers,
        tools: changes.current.tools.length,
        resources: changes.current.resources.length,
        resourceTemplates: changes.current.resourceTemplates.length,
        prompts: changes.current.prompts.length,
        durationMs: Date.now() - startedAt,
      }));

      if (changes.hasChanges) {
        logger.info('asyncLoadingOrchestrator.loading.cycle.complete.tools.resources.prompts.now.available.e121d7b3');
        this.emit(AsyncLoadingOrchestratorEvent.CapabilitySnapshotPublished, changes);
      } else {
        debugIf('asyncLoadingOrchestrator.loading.cycle.completed.with.no.capability.changes.8c5f89f2');
      }
    } catch (_error) {
      writeLocalDiagnostic('error', 'capability.snapshot.failed', {
        stage: 'aggregate',
        durationMs: Date.now() - startedAt,
        error: _error,
      });
      logger.error('asyncLoadingOrchestrator.failed.to.publish.capabilities.after.loading.completed.6544b04e', {
        error: _error,
      });
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
      debugIf(
        'asyncLoadingOrchestrator.capability.changes.detected.but.no.notification.manager.available.yet.ee3e218b',
      );
    }

    // Log the changes for visibility

    logger.info('asyncLoadingOrchestrator.capability.update.complete.1b45dc6f');
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
  public async refreshCapabilities(): Promise<CapabilityRefreshResult> {
    if (!this.isInitialized || this.isShuttingDown) {
      logger.warn('asyncLoadingOrchestrator.cannot.refresh.capabilities.orchestrator.not.ready.d8def3cc');
      return { changed: false, shouldNotifyListChanged: false };
    }

    try {
      logger.info('asyncLoadingOrchestrator.manually.refreshing.capabilities.f27cec15');
      const changes = await this.capabilityAggregator.updateCapabilities();

      if (changes.hasChanges) {
        this.handleCapabilityChanges(changes);
        logger.info('asyncLoadingOrchestrator.manual.capability.refresh.completed.with.changes.ed9d1da6');
      } else {
        logger.info('asyncLoadingOrchestrator.manual.capability.refresh.completed.no.changes.detected.291b35c5');
      }
      return { changed: changes.hasChanges, shouldNotifyListChanged: changes.toolsChanged };
    } catch (_error) {
      logger.error('asyncLoadingOrchestrator.failed.to.refresh.capabilities.9ab02978', { error: _error });
      return { changed: false, shouldNotifyListChanged: false };
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
        batchNotifications: this.agentConfig.get('asyncLoading').batchNotifications,
        batchDelayMs: this.agentConfig.get('asyncLoading').batchDelayMs,
        notifyOnServerReady: this.agentConfig.get('asyncLoading').notifyOnServerReady,
      };

      this.notificationManager.updateConfig(notificationConfig);
      debugIf('asyncLoadingOrchestrator.asyncloadingorchestrator.configuration.updated.9dcb695c');
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
    logger.info('asyncLoadingOrchestrator.shutting.down.asyncloadingorchestrator.0f1e2941');

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

      logger.info('asyncLoadingOrchestrator.asyncloadingorchestrator.shutdown.complete.82ee1abf');
    } catch (_error) {
      logger.error('asyncLoadingOrchestrator.error.during.asyncloadingorchestrator.shutdown.95ead01e', {
        error: _error,
      });
    }
  }
}
