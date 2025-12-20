import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { setupCapabilities } from '@src/core/capabilities/capabilityManager.js';
import type { OutboundConnections } from '@src/core/types/client.js';
import { InboundConnection, InboundConnectionConfig, OperationOptions, ServerStatus } from '@src/core/types/index.js';
import {
  type ClientConnection,
  PresetNotificationService,
} from '@src/domains/preset/services/presetNotificationService.js';
import logger, { debugIf } from '@src/logger/logger.js';
import { enhanceServerWithLogging } from '@src/logger/mcpLoggingEnhancer.js';
import type { ContextData } from '@src/types/context.js';
import { executeOperation } from '@src/utils/core/operationExecution.js';

/**
 * Manages transport connection lifecycle and inbound connections
 */
export class ConnectionManager {
  private inboundConns: Map<string, InboundConnection> = new Map();
  private connectionSemaphore: Map<string, Promise<void>> = new Map();
  private disconnectingIds: Set<string> = new Set();

  constructor(
    private serverConfig: { name: string; version: string },
    private serverCapabilities: { capabilities: Record<string, unknown> },
    private outboundConns: OutboundConnections,
  ) {}

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

    const server = this.inboundConns.get(sessionId);
    if (server) {
      this.disconnectingIds.add(sessionId);

      try {
        // Update status to Disconnected
        server.status = ServerStatus.Disconnected;

        // Only close the transport if explicitly requested
        if (forceClose && server.server.transport) {
          try {
            server.server.transport.close();
          } catch (error) {
            logger.error(`Error closing transport for session ${sessionId}:`, error);
          }
        }

        // Untrack client from preset notification service
        const notificationService = PresetNotificationService.getInstance();
        notificationService.untrackClient(sessionId);
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
    return this.inboundConns.get(sessionId)?.server.transport;
  }

  /**
   * Get all active transports
   */
  public getTransports(): Map<string, Transport> {
    const transports = new Map<string, Transport>();
    for (const [id, server] of this.inboundConns.entries()) {
      if (server.server.transport) {
        transports.set(id, server.server.transport);
      }
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
    return this.inboundConns;
  }

  /**
   * Get count of active transports
   */
  public getActiveTransportsCount(): number {
    return this.inboundConns.size;
  }

  /**
   * Execute a server operation with error handling
   */
  public async executeServerOperation<T>(
    inboundConn: InboundConnection,
    operation: (inboundConn: InboundConnection) => Promise<T>,
    options: OperationOptions = {},
  ): Promise<T> {
    // Check connection status before executing operation
    if (inboundConn.status !== ServerStatus.Connected || !inboundConn.server.transport) {
      throw new Error(`Cannot execute operation: server status is ${inboundConn.status}`);
    }

    return executeOperation(() => operation(inboundConn), 'server', options);
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
        connection.lastError = error instanceof Error ? error : new Error(String(error));
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

    // Create server info object first
    const serverInfo: InboundConnection = {
      server,
      status: ServerStatus.Connecting,
      connectedAt: new Date(),
      ...opts,
    };

    // Enhance server with logging middleware
    enhanceServerWithLogging(server);

    // Set up capabilities for this server instance
    await setupCapabilities(this.outboundConns, serverInfo);

    // Store the server instance
    this.inboundConns.set(sessionId, serverInfo);

    // Connect the transport to the new server instance
    await server.connect(transport);

    // Update status to Connected after successful connection
    serverInfo.status = ServerStatus.Connected;
    serverInfo.lastConnected = new Date();

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
    serverInfo: InboundConnection,
  ): Promise<void> {
    const notificationService = PresetNotificationService.getInstance();
    const clientConnection: ClientConnection = {
      id: sessionId,
      presetName,
      sendNotification: async (method: string, params?: Record<string, unknown>) => {
        try {
          if (serverInfo.status === ServerStatus.Connected && serverInfo.server.transport) {
            await serverInfo.server.notification({ method, params: params || {} });
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
      isConnected: () => serverInfo.status === ServerStatus.Connected && !!serverInfo.server.transport,
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
