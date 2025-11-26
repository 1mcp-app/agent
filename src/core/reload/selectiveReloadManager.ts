import { EventEmitter } from 'events';

import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { ClientManager } from '@src/core/client/clientManager.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { MCPServerParams } from '@src/core/types/transport.js';
import logger, { debugIf } from '@src/logger/logger.js';
import { createTransports } from '@src/transport/transportFactory.js';

import { ChangeAnalyzer, ReloadImpactAnalysis, ServerChange } from './changeAnalyzer.js';

/**
 * Reload operation status
 */
export enum ReloadStatus {
  PENDING = 'pending',
  ANALYZING = 'analyzing',
  PREPARING = 'preparing',
  RELOADING = 'reloading',
  MIGRATING = 'migrating',
  COMPLETED = 'completed',
  FAILED = 'failed',
  ROLLED_BACK = 'rolled_back',
}

/**
 * Reload operation context
 */
export interface ReloadOperation {
  id: string;
  status: ReloadStatus;
  startTime: Date;
  endTime?: Date;
  impact: ReloadImpactAnalysis;
  currentStep?: string;
  progress: number; // 0-100
  error?: string;
  affectedServers: string[];
  completedServers: string[];
}

/**
 * Connection migration strategy
 */
export interface MigrationStrategy {
  strategy: 'graceful-handoff' | 'reconnect' | 'none';
  timeoutMs: number;
  retryAttempts: number;
  preserveSessions: boolean;
}

/**
 * SelectiveReloadManager handles intelligent partial reloads and connection migration
 */
export class SelectiveReloadManager extends EventEmitter {
  private static instance: SelectiveReloadManager;
  private changeAnalyzer: ChangeAnalyzer;
  private activeOperations: Map<string, ReloadOperation> = new Map();

  private constructor() {
    super();
    this.changeAnalyzer = new ChangeAnalyzer();
  }

  public static getInstance(): SelectiveReloadManager {
    if (!SelectiveReloadManager.instance) {
      SelectiveReloadManager.instance = new SelectiveReloadManager();
    }
    return SelectiveReloadManager.instance;
  }

  /**
   * Execute selective reload based on configuration changes
   */
  public async executeReload(
    oldConfig: Record<string, MCPServerParams>,
    newConfig: Record<string, MCPServerParams>,
    options: {
      strategy?: MigrationStrategy;
      forceFullReload?: boolean;
      dryRun?: boolean;
    } = {},
  ): Promise<ReloadOperation> {
    const operationId = this.generateOperationId();

    const operation: ReloadOperation = {
      id: operationId,
      status: ReloadStatus.ANALYZING,
      startTime: new Date(),
      impact: this.changeAnalyzer.analyzeChanges(oldConfig, newConfig),
      progress: 0,
      affectedServers: [],
      completedServers: [],
    };

    this.activeOperations.set(operationId, operation);
    this.emit('reloadStarted', operation);

    try {
      debugIf(() => ({
        message: `Starting selective reload operation ${operationId}`,
        meta: {
          strategy: options.strategy?.strategy || 'graceful-handoff',
          forceFullReload: options.forceFullReload,
          dryRun: options.dryRun,
        },
      }));

      // Step 1: Analysis
      await this.performAnalysis(operation);

      // Step 2: Determine reload strategy
      const reloadStrategy = this.determineReloadStrategy(operation, options);
      operation.currentStep = `Strategy: ${reloadStrategy}`;

      // Step 3: Dry run if requested
      if (options.dryRun) {
        operation.status = ReloadStatus.COMPLETED;
        operation.endTime = new Date();
        operation.progress = 100;
        operation.currentStep = 'Dry run completed';
        this.emit('reloadCompleted', operation);
        return operation;
      }

      // Step 4: Execute reload based on strategy
      if (reloadStrategy === 'full' || options.forceFullReload) {
        await this.executeFullReload(operation, oldConfig, newConfig);
      } else {
        await this.executePartialReload(operation, oldConfig, newConfig, options.strategy);
      }

      // Step 5: Complete operation
      operation.status = ReloadStatus.COMPLETED;
      operation.endTime = new Date();
      operation.progress = 100;
      operation.currentStep = 'Reload completed successfully';

      this.emit('reloadCompleted', operation);
    } catch (error) {
      operation.status = ReloadStatus.FAILED;
      operation.error = error instanceof Error ? error.message : String(error);
      operation.endTime = new Date();
      operation.currentStep = 'Reload failed';

      this.emit('reloadFailed', operation);

      // Attempt rollback if possible
      await this.attemptRollback(operation, oldConfig);
    }

    return operation;
  }

  /**
   * Get active reload operations
   */
  public getActiveOperations(): ReloadOperation[] {
    return Array.from(this.activeOperations.values());
  }

  /**
   * Get operation by ID
   */
  public getOperation(id: string): ReloadOperation | undefined {
    return this.activeOperations.get(id);
  }

  /**
   * Cancel an active operation
   */
  public async cancelOperation(id: string): Promise<boolean> {
    const operation = this.activeOperations.get(id);
    if (!operation || operation.status === ReloadStatus.COMPLETED) {
      return false;
    }

    operation.status = ReloadStatus.FAILED;
    operation.error = 'Operation cancelled by user';
    operation.endTime = new Date();

    this.emit('reloadCancelled', operation);
    return true;
  }

  /**
   * Perform analysis step
   */
  private async performAnalysis(operation: ReloadOperation): Promise<void> {
    operation.currentStep = 'Analyzing configuration changes';
    operation.progress = 10;

    debugIf(() => ({
      message: `Analyzing ${operation.impact.changes.length} configuration changes`,
      meta: {
        requiresFullRestart: operation.impact.summary.requiresFullRestart,
        canPartialReload: operation.impact.summary.canPartialReload,
      },
    }));

    // Extract affected servers
    operation.affectedServers = operation.impact.changes.map((c) => c.serverId);
    operation.progress = 20;
  }

  /**
   * Determine optimal reload strategy
   */
  private determineReloadStrategy(
    operation: ReloadOperation,
    options: {
      strategy?: MigrationStrategy;
      forceFullReload?: boolean;
    },
  ): 'full' | 'partial' | 'deferred' {
    if (options.forceFullReload) {
      return 'full';
    }

    const primaryRecommendation = operation.impact.recommendations[0];
    return primaryRecommendation.reloadStrategy as 'full' | 'partial' | 'deferred';
  }

  /**
   * Execute full reload
   */
  private async executeFullReload(
    operation: ReloadOperation,
    oldConfig: Record<string, MCPServerParams>,
    newConfig: Record<string, MCPServerParams>,
  ): Promise<void> {
    operation.currentStep = 'Executing full reload';
    operation.status = ReloadStatus.RELOADING;
    operation.progress = 30;

    debugIf(() => ({
      message: 'Executing full server reload',
      meta: { oldCount: Object.keys(oldConfig).length, newCount: Object.keys(newConfig).length },
    }));

    // Notify clients about upcoming restart
    this.emit('reloadProgress', {
      operationId: operation.id,
      step: 'full_reload_start',
      message: 'Starting full server reload',
      progress: 30,
    });

    try {
      const clientManager = ClientManager.current;
      const serverManager = ServerManager.current;

      // 1. Create new transports from new config
      const transports = createTransports(newConfig);

      // 2. Disconnect existing clients and create new ones
      // Note: createClients clears existing connections first
      await clientManager.createClients(transports);

      // 3. Update ServerManager
      this.updateServerManager(clientManager, serverManager);

      operation.completedServers = operation.affectedServers;
      operation.progress = 90;

      this.emit('reloadProgress', {
        operationId: operation.id,
        step: 'full_reload_complete',
        message: 'Full reload completed',
        progress: 90,
      });
    } catch (error) {
      logger.error(`Full reload failed: ${error}`);
      throw error;
    }
  }

  /**
   * Execute partial reload
   */
  private async executePartialReload(
    operation: ReloadOperation,
    oldConfig: Record<string, MCPServerParams>,
    newConfig: Record<string, MCPServerParams>,
    migrationStrategy?: MigrationStrategy,
  ): Promise<void> {
    operation.currentStep = 'Executing partial reload';
    operation.status = ReloadStatus.RELOADING;
    operation.progress = 30;

    const strategy = migrationStrategy || this.getDefaultMigrationStrategy();

    debugIf(() => ({
      message: 'Executing partial reload with connection migration',
      meta: {
        strategy: strategy.strategy,
        affectedServers: operation.affectedServers.length,
      },
    }));

    this.emit('reloadProgress', {
      operationId: operation.id,
      step: 'partial_reload_start',
      message: 'Starting partial reload',
      progress: 30,
    });

    // Process each change
    for (let i = 0; i < operation.impact.changes.length; i++) {
      const change = operation.impact.changes[i];
      const progressBase = 30;
      const progressStep = 60 / operation.impact.changes.length;
      operation.progress = progressBase + progressStep * i;

      operation.currentStep = `Processing ${change.changeType} for ${change.serverId}`;

      await this.processServerChange(change, oldConfig, newConfig, strategy);
      operation.completedServers.push(change.serverId);

      this.emit('reloadProgress', {
        operationId: operation.id,
        step: 'server_change_processed',
        message: `Processed ${change.changeType} for ${change.serverId}`,
        progress: operation.progress,
        serverId: change.serverId,
        changeType: change.changeType,
      });
    }

    operation.progress = 90;
  }

  /**
   * Process individual server change
   */
  private async processServerChange(
    change: ServerChange,
    _oldConfig: Record<string, MCPServerParams>,
    _newConfig: Record<string, MCPServerParams>,
    _strategy: MigrationStrategy,
  ): Promise<void> {
    const clientManager = ClientManager.current;
    const serverManager = ServerManager.current;
    const serverName = change.serverId;

    logger.info(`Processing server change: ${change.changeType} for ${serverName}`);

    try {
      switch (change.changeType) {
        case 'add_server': {
          if (!change.newConfig) throw new Error('New config missing for add_server');

          // Create transport map for single item to reuse factory logic
          const transportMap = createTransports({ [serverName]: change.newConfig });
          const transport = transportMap[serverName];

          if (!transport) throw new Error(`Failed to create transport for ${serverName}`);

          await clientManager.createSingleClient(serverName, transport);
          this.updateServerManager(clientManager, serverManager);
          break;
        }

        case 'remove_server': {
          await clientManager.removeClient(serverName);
          this.updateServerManager(clientManager, serverManager);
          break;
        }

        case 'modify_server':
        case 'transport_change': {
          if (!change.newConfig) throw new Error('New config missing for modify_server');

          // Remove existing
          await clientManager.removeClient(serverName);

          // Create new
          const transportMap = createTransports({ [serverName]: change.newConfig });
          const transport = transportMap[serverName];

          if (!transport) throw new Error(`Failed to create transport for ${serverName}`);

          await clientManager.createSingleClient(serverName, transport);
          this.updateServerManager(clientManager, serverManager);
          break;
        }

        default:
          debugIf(() => ({
            message: `Skipping unhandled change type: ${change.changeType}`,
            meta: { serverId: serverName },
          }));
      }
    } catch (error) {
      logger.error(`Failed to process change for ${serverName}: ${error}`);
      throw error;
    }
  }

  /**
   * Helper to update ServerManager with current clients and transports
   */
  private updateServerManager(clientManager: ClientManager, serverManager: ServerManager): void {
    const transports: Record<string, Transport> = {};
    for (const name of clientManager.getTransportNames()) {
      const t = clientManager.getTransport(name);
      if (t) transports[name] = t;
    }
    serverManager.updateClientsAndTransports(clientManager.getClients(), transports);
  }

  /**
   * Gracefully shutdown server with connection migration
   */
  private async gracefulServerShutdown(serverId: string, strategy: MigrationStrategy): Promise<void> {
    if (strategy.strategy === 'graceful-handoff') {
      // Notify clients about server shutdown
      this.emit('serverShutdown', { serverId, strategy: strategy.strategy });

      // Wait for connections to drain or timeout
      await this.waitForConnectionDrain(serverId, strategy.timeoutMs);
    }

    logger.info(`Would gracefully shutdown server: ${serverId}`);
  }

  /**
   * Wait for connections to drain
   */
  private async waitForConnectionDrain(serverId: string, timeoutMs: number): Promise<void> {
    // Implementation would track active connections and wait for them to complete
    // For now, just wait a short time
    await new Promise((resolve) => setTimeout(resolve, Math.min(timeoutMs, 1000)));
  }

  /**
   * Attempt rollback on failure
   */
  private async attemptRollback(
    operation: ReloadOperation,
    _oldConfig: Record<string, MCPServerParams>,
  ): Promise<void> {
    operation.currentStep = 'Attempting rollback';
    operation.status = ReloadStatus.ROLLED_BACK;

    try {
      // Integration with ServerManager will be implemented in future iteration
      logger.info('Would restore original configuration during rollback');

      this.emit('rollbackCompleted', operation);
    } catch (rollbackError) {
      operation.error += ` | Rollback failed: ${rollbackError}`;
      this.emit('rollbackFailed', operation);
    }
  }

  /**
   * Get default migration strategy
   */
  private getDefaultMigrationStrategy(): MigrationStrategy {
    return {
      strategy: 'graceful-handoff',
      timeoutMs: 5000,
      retryAttempts: 3,
      preserveSessions: true,
    };
  }

  /**
   * Generate unique operation ID
   */
  private generateOperationId(): string {
    return `reload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
