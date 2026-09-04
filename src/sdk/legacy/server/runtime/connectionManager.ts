import { setupCapabilities } from '@src/core/capabilities/capabilityManager.js';
import { unregisterCapabilityPaginationForwarder } from '@src/core/capabilities/capabilityPagination.js';
import { LazyLoadingOrchestrator } from '@src/core/capabilities/lazyLoadingOrchestrator.js';
import type { OutboundConnections } from '@src/core/types/client.js';
import { InboundConnection, InboundConnectionConfig, OperationOptions, ServerStatus } from '@src/core/types/index.js';
import {
  type ClientConnection,
  PresetNotificationService,
} from '@src/domains/preset/services/presetNotificationService.js';
import logger, { debugIf } from '@src/logger/logger.js';
import { enhanceServerWithLogging } from '@src/logger/mcpLoggingEnhancer.js';
import { toJsonValue } from '@src/sdk/contracts/jsonValue.js';
import type { LegacyConnectionId } from '@src/sdk/contracts/legacySdkAdapter.js';
import { Server } from '@src/sdk/legacy/server/index.js';
import { Transport } from '@src/sdk/legacy/shared/transport.js';
import type { ContextData } from '@src/types/context.js';
import { executeOperation } from '@src/utils/core/operationExecution.js';

import {
  type LegacyInboundConnection,
  requireLegacyInboundConnection,
  toInboundConnectionError,
} from './legacyInboundConnection.js';
import {
  getLegacyServerTransportHandle,
  isLegacyServerConnected,
  LegacySdkServerAdapter,
} from './legacySdkServerAdapter.js';

function snapshotInboundConfig(
  opts: InboundConnectionConfig,
  context: NonNullable<InboundConnectionConfig['context']>,
): InboundConnectionConfig {
  return toJsonValue({
    ...(opts.tags !== undefined ? { tags: opts.tags } : {}),
    ...(opts.tagExpression !== undefined ? { tagExpression: opts.tagExpression } : {}),
    ...(opts.tagQuery !== undefined ? { tagQuery: opts.tagQuery } : {}),
    ...(opts.tagFilterMode !== undefined ? { tagFilterMode: opts.tagFilterMode } : {}),
    ...(opts.enablePagination !== undefined ? { enablePagination: opts.enablePagination } : {}),
    ...(opts.presetName !== undefined ? { presetName: opts.presetName } : {}),
    ...(opts.contextProof !== undefined ? { contextProof: opts.contextProof } : {}),
    ...(opts.customTemplate !== undefined ? { customTemplate: opts.customTemplate } : {}),
    ...(opts.title !== undefined ? { title: opts.title } : {}),
    ...(opts.toolPattern !== undefined ? { toolPattern: opts.toolPattern } : {}),
    ...(opts.examples !== undefined ? { examples: opts.examples } : {}),
    ...(opts.templateSizeLimit !== undefined ? { templateSizeLimit: opts.templateSizeLimit } : {}),
    context,
  }) as unknown as InboundConnectionConfig;
}

/**
 * Manages transport connection lifecycle and inbound connections
 */
export class ConnectionManager {
  private inboundConns: Map<string, LegacyInboundConnection> = new Map();
  private connectionSemaphore: Map<string, Promise<void>> = new Map();
  private disconnectingIds: Set<string> = new Set();
  private lazyLoadingOrchestrator?: LazyLoadingOrchestrator;

  constructor(
    private serverConfig: { name: string; version: string },
    private serverCapabilities: { capabilities: Record<string, unknown> },
    private outboundConns: OutboundConnections,
    lazyLoadingOrchestrator?: LazyLoadingOrchestrator,
  ) {
    this.lazyLoadingOrchestrator = lazyLoadingOrchestrator;
  }

  /**
   * Set the lazy loading orchestrator
   */
  public setLazyLoadingOrchestrator(orchestrator: LazyLoadingOrchestrator): void {
    this.lazyLoadingOrchestrator = orchestrator;
  }

  /**
   * Get the lazy loading orchestrator
   */
  public getLazyLoadingOrchestrator(): LazyLoadingOrchestrator | undefined {
    return this.lazyLoadingOrchestrator;
  }

  /**
   * Connect a transport with the given session ID and configuration
   */
  public async connectTransport(
    transport: Transport,
    sessionId: string,
    opts: InboundConnectionConfig,
    context?: ContextData,
    filteredInstructions?: string,
  ): Promise<void> {
    // Check if a connection is already in progress for this session
    const existingConnection = this.connectionSemaphore.get(sessionId);
    if (existingConnection) {
      logger.warn(`Connection already in progress for session ${sessionId}, waiting...`);
      await existingConnection;
      return;
    }

    // Check if transport is already connected
    if (this.inboundConns.has(sessionId)) {
      logger.warn(`Transport already connected for session ${sessionId}`);
      return;
    }

    // Create connection promise to prevent race conditions
    const connectionPromise = this.performConnection(transport, sessionId, opts, context, filteredInstructions);
    this.connectionSemaphore.set(sessionId, connectionPromise);

    try {
      await connectionPromise;
    } finally {
      // Clean up the semaphore entry
      this.connectionSemaphore.delete(sessionId);
    }
  }

  /**
   * Disconnect a transport by session ID
   */
  public async disconnectTransport(sessionId: string, forceClose: boolean = false): Promise<void> {
    // Prevent recursive disconnection calls
    if (this.disconnectingIds.has(sessionId)) {
      return;
    }

    const connection = this.inboundConns.get(sessionId);
    if (connection) {
      this.disconnectingIds.add(sessionId);

      try {
        // Update status to Disconnected
        connection.status = ServerStatus.Disconnected;

        // Only close the transport if explicitly requested
        if (forceClose) {
          try {
            await connection.adapter.close();
          } catch (error) {
            logger.error(`Error closing transport for session ${sessionId}:`, error);
          }
        }

        // Untrack client from preset notification service
        const notificationService = PresetNotificationService.getInstance();
        notificationService.untrackClient(sessionId);
        unregisterCapabilityPaginationForwarder(this.outboundConns, connection);
        debugIf(() => ({ message: 'Untracked client from preset notifications', meta: { sessionId } }));

        this.inboundConns.delete(sessionId);
        logger.info(`Disconnected transport for session ${sessionId}`);
      } finally {
        this.disconnectingIds.delete(sessionId);
      }
    }
  }

  /**
   * Get transport by session ID
   */
  public getTransport(sessionId: string): Transport | undefined {
    const connection = this.inboundConns.get(sessionId);
    return connection ? getLegacyServerTransportHandle(connection.adapter) : undefined;
  }

  /**
   * Get all active transports
   */
  public getTransports(): Map<string, Transport> {
    const transports = new Map<string, Transport>();
    for (const [id, connection] of this.inboundConns.entries()) {
      const transport = getLegacyServerTransportHandle(connection.adapter);
      if (transport) transports.set(id, transport);
    }
    return transports;
  }

  /**
   * Get server connection by session ID
   */
  public getServer(sessionId: string): InboundConnection | undefined {
    return this.inboundConns.get(sessionId);
  }

  /**
   * Get all inbound connections
   */
  public getInboundConnections(): Map<string, InboundConnection> {
    return new Map(this.inboundConns);
  }

  /**
   * Get count of active transports
   */
  public getActiveTransportsCount(): number {
    return this.inboundConns.size;
  }

  public recordConnectionError(sessionId: string, error: unknown): void {
    const connection = this.inboundConns.get(sessionId);
    if (!connection) return;
    connection.status = ServerStatus.Error;
    connection.lastError = toInboundConnectionError(error);
  }

  /**
   * Execute a server operation with error handling
   */
  public async executeServerOperation<T>(
    inboundConn: InboundConnection,
    operation: (inboundConn: LegacyInboundConnection) => Promise<T>,
    options: OperationOptions = {},
  ): Promise<T> {
    // Check connection status before executing operation
    const legacyConnection = requireLegacyInboundConnection(inboundConn);
    if (legacyConnection.status !== ServerStatus.Connected || !isLegacyServerConnected(legacyConnection.adapter)) {
      throw new Error(`Cannot execute operation: server status is ${inboundConn.status}`);
    }

    return executeOperation(() => operation(legacyConnection), 'server', options);
  }

  /**
   * Perform the actual connection
   */
  private async performConnection(
    transport: Transport,
    sessionId: string,
    opts: InboundConnectionConfig,
    context?: ContextData,
    filteredInstructions?: string,
  ): Promise<void> {
    // Set connection timeout
    const connectionTimeoutMs = 30000; // 30 seconds

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Connection timeout for session ${sessionId}`)), connectionTimeoutMs);
    });

    try {
      await Promise.race([this.doConnect(transport, sessionId, opts, context, filteredInstructions), timeoutPromise]);
    } catch (error) {
      // Update status to Error if connection exists
      const connection = this.inboundConns.get(sessionId);
      if (connection) {
        connection.status = ServerStatus.Error;
        connection.lastError = toInboundConnectionError(error);
      }

      logger.error(`Failed to connect transport for session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Do the actual connection work
   */
  private async doConnect(
    transport: Transport,
    sessionId: string,
    opts: InboundConnectionConfig,
    context?: ContextData,
    filteredInstructions?: string,
  ): Promise<void> {
    // Create server capabilities with filtered instructions
    const serverOptionsWithInstructions = {
      ...this.serverCapabilities,
      instructions: filteredInstructions || undefined,
    };

    // Create a new server instance for this transport
    const server = new Server(this.serverConfig, serverOptionsWithInstructions);

    // Create server info object, merging context if provided
    // CRITICAL: Ensure sessionId is always set in context for session-scoped filtering
    // This is needed for lazy loading to store and retrieve session filters correctly
    // Priority: opts.context.sessionId > context.sessionId > transport sessionId (fallback)
    const mergedContext = {
      ...(context || {}),
      ...(opts.context || {}),
      // Use opts.context.sessionId if provided, otherwise fall back to transport sessionId
      sessionId: opts.context?.sessionId || context?.sessionId || sessionId,
    };

    const connectionId = sessionId as LegacyConnectionId;
    const adapter = new LegacySdkServerAdapter(connectionId, server, transport);
    const configSnapshot = snapshotInboundConfig(opts, mergedContext);
    const serverInfo: LegacyInboundConnection = {
      connectionId,
      adapter,
      status: ServerStatus.Connecting,
      connectedAt: new Date().toISOString(),
      ...configSnapshot,
    };

    // Enhance server with logging middleware
    enhanceServerWithLogging(server);

    // Set up capabilities for this server instance
    await setupCapabilities(this.outboundConns, serverInfo, this.lazyLoadingOrchestrator);

    // Store the server instance
    this.inboundConns.set(sessionId, serverInfo);

    // Connect the transport to the new server instance
    await adapter.start();

    // Update status to Connected after successful connection
    serverInfo.status = ServerStatus.Connected;
    serverInfo.lastConnected = new Date().toISOString();

    // Register client with preset notification service if preset is used
    if (opts.presetName) {
      await this.registerClientForPresets(sessionId, opts.presetName, serverInfo);
    }

    logger.info(`Connected transport for session ${sessionId}`);
  }

  /**
   * Register client with preset notification service
   */
  private async registerClientForPresets(
    sessionId: string,
    presetName: string,
    serverInfo: LegacyInboundConnection,
  ): Promise<void> {
    const notificationService = PresetNotificationService.getInstance();
    const clientConnection: ClientConnection = {
      id: sessionId,
      presetName,
      sendNotification: async (method: string, params?: Record<string, unknown>) => {
        try {
          if (serverInfo.status === ServerStatus.Connected && isLegacyServerConnected(serverInfo.adapter)) {
            await serverInfo.adapter.notify({ method, params: toJsonValue(params || {}) });
            debugIf(() => ({ message: 'Sent notification to client', meta: { sessionId, method } }));
          } else {
            logger.warn('Cannot send notification to disconnected client', { sessionId, method });
          }
        } catch (error) {
          logger.error('Failed to send notification to client', {
            sessionId,
            method,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          throw error;
        }
      },
      isConnected: () => serverInfo.status === ServerStatus.Connected && isLegacyServerConnected(serverInfo.adapter),
    };

    notificationService.trackClient(clientConnection, presetName);
    logger.info('Registered client for preset notifications', {
      sessionId,
      presetName,
    });
  }

  /**
   * Clean up all connections (for shutdown)
   */
  public async cleanup(): Promise<void> {
    // Clean up existing connections with forced close
    for (const [sessionId] of this.inboundConns) {
      await this.disconnectTransport(sessionId, true);
    }
    this.inboundConns.clear();
    this.connectionSemaphore.clear();
    this.disconnectingIds.clear();
  }
}
