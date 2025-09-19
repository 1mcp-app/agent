import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import logger, { debugIf } from '../../logger/logger.js';
import configReloadService from '../../services/configReloadService.js';
import { setupCapabilities } from '../capabilities/capabilityManager.js';
import { enhanceServerWithLogging } from '../../logger/mcpLoggingEnhancer.js';
import { PresetNotificationService, type ClientConnection } from '../../utils/presetNotificationService.js';
import {
  OutboundConnections,
  InboundConnection,
  InboundConnectionConfig,
  OperationOptions,
  ServerStatus,
} from '../types/index.js';
import type { OutboundConnection } from '../types/client.js';
import { executeOperation } from '../../utils/operationExecution.js';
import { InstructionAggregator } from '../instructions/instructionAggregator.js';

export class ServerManager {
  private static instance: ServerManager | undefined;
  private inboundConns: Map<string, InboundConnection> = new Map();
  private serverConfig: { name: string; version: string };
  private serverCapabilities: { capabilities: Record<string, unknown> };

  private outboundConns: OutboundConnections = new Map<string, OutboundConnection>();
  private transports: Record<string, Transport> = {};
  private connectionSemaphore: Map<string, Promise<void>> = new Map();
  private disconnectingIds: Set<string> = new Set();
  private instructionAggregator?: InstructionAggregator;

  private constructor(
    config: { name: string; version: string },
    capabilities: { capabilities: Record<string, unknown> },
    outboundConns: OutboundConnections,
    transports: Record<string, Transport>,
  ) {
    this.serverConfig = config;
    this.serverCapabilities = capabilities;
    this.outboundConns = outboundConns;
    this.transports = transports;
  }

  public static getOrCreateInstance(
    config: { name: string; version: string },
    capabilities: { capabilities: Record<string, unknown> },
    outboundConns: OutboundConnections,
    transports: Record<string, Transport>,
  ): ServerManager {
    if (!ServerManager.instance) {
      ServerManager.instance = new ServerManager(config, capabilities, outboundConns, transports);
    }
    return ServerManager.instance;
  }

  public static get current(): ServerManager {
    if (!ServerManager.instance) {
      throw new Error('ServerManager not initialized');
    }
    return ServerManager.instance;
  }

  // Test utility method to reset singleton state
  public static resetInstance(): void {
    if (ServerManager.instance) {
      // Clean up existing connections with forced close
      for (const [sessionId] of ServerManager.instance.inboundConns) {
        ServerManager.instance.disconnectTransport(sessionId, true);
      }
      ServerManager.instance.inboundConns.clear();
      ServerManager.instance.connectionSemaphore.clear();
      ServerManager.instance.disconnectingIds.clear();
    }
    ServerManager.instance = undefined;
  }

  /**
   * Set the instruction aggregator instance
   * @param aggregator The instruction aggregator to use
   */
  public setInstructionAggregator(aggregator: InstructionAggregator): void {
    this.instructionAggregator = aggregator;

    // Listen for instruction changes and update existing server instances
    aggregator.on('instructions-changed', () => {
      this.updateServerInstructions();
    });

    debugIf('Instruction aggregator set for ServerManager');
  }

  /**
   * Update all server instances with new aggregated instructions
   */
  private updateServerInstructions(): void {
    logger.info(`Server instructions have changed. Active sessions: ${this.inboundConns.size}`);

    for (const [sessionId, _inboundConn] of this.inboundConns) {
      try {
        // Note: The MCP SDK doesn't provide a direct way to update instructions
        // on an existing server instance. Instructions are set during server construction.
        // For now, we'll log this for future server instances.
        debugIf(() => ({ message: `Instructions changed notification for session ${sessionId}`, meta: { sessionId } }));
      } catch (error) {
        logger.warn(`Failed to process instruction change for session ${sessionId}: ${error}`);
      }
    }
  }

  public async connectTransport(transport: Transport, sessionId: string, opts: InboundConnectionConfig): Promise<void> {
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
    const connectionPromise = this.performConnection(transport, sessionId, opts);
    this.connectionSemaphore.set(sessionId, connectionPromise);

    try {
      await connectionPromise;
    } finally {
      // Clean up the semaphore entry
      this.connectionSemaphore.delete(sessionId);
    }
  }

  private async performConnection(
    transport: Transport,
    sessionId: string,
    opts: InboundConnectionConfig,
  ): Promise<void> {
    // Set connection timeout
    const connectionTimeoutMs = 30000; // 30 seconds

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Connection timeout for session ${sessionId}`)), connectionTimeoutMs);
    });

    try {
      await Promise.race([this.doConnect(transport, sessionId, opts), timeoutPromise]);
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

  private async doConnect(transport: Transport, sessionId: string, opts: InboundConnectionConfig): Promise<void> {
    // Get filtered instructions based on client's filter criteria using InstructionAggregator
    const filteredInstructions = this.instructionAggregator?.getFilteredInstructions(opts, this.outboundConns) || '';

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

    // Update the configuration reload service with server info
    configReloadService.updateServerInfo(sessionId, serverInfo);

    // Store the server instance
    this.inboundConns.set(sessionId, serverInfo);

    // Connect the transport to the new server instance
    await server.connect(transport);

    // Update status to Connected after successful connection
    serverInfo.status = ServerStatus.Connected;
    serverInfo.lastConnected = new Date();

    // Register client with preset notification service if preset is used
    if (opts.presetName) {
      const notificationService = PresetNotificationService.getInstance();
      const clientConnection: ClientConnection = {
        id: sessionId,
        presetName: opts.presetName,
        sendNotification: async (method: string, params?: any) => {
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

      notificationService.trackClient(clientConnection, opts.presetName);
      logger.info('Registered client for preset notifications', {
        sessionId,
        presetName: opts.presetName,
      });
    }

    logger.info(`Connected transport for session ${sessionId}`);
  }

  public disconnectTransport(sessionId: string, forceClose: boolean = false): void {
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

        // Only close the transport if explicitly requested (e.g., during shutdown)
        // Don't close if this is called from an onclose handler to avoid recursion
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
        configReloadService.removeServerInfo(sessionId);
        logger.info(`Disconnected transport for session ${sessionId}`);
      } finally {
        this.disconnectingIds.delete(sessionId);
      }
    }
  }

  public getTransport(sessionId: string): Transport | undefined {
    return this.inboundConns.get(sessionId)?.server.transport;
  }

  public getTransports(): Map<string, Transport> {
    const transports = new Map<string, Transport>();
    for (const [id, server] of this.inboundConns.entries()) {
      if (server.server.transport) {
        transports.set(id, server.server.transport);
      }
    }
    return transports;
  }

  public getClientTransports(): Record<string, Transport> {
    return this.transports;
  }

  public getClients(): OutboundConnections {
    return this.outboundConns;
  }

  /**
   * Safely get a client by name. Returns undefined if not found or not an own property.
   * Encapsulates access to prevent prototype pollution and accidental key collisions.
   */
  public getClient(serverName: string): OutboundConnection | undefined {
    return this.outboundConns.get(serverName);
  }

  public getActiveTransportsCount(): number {
    return this.inboundConns.size;
  }

  public getServer(sessionId: string): InboundConnection | undefined {
    return this.inboundConns.get(sessionId);
  }

  public getInboundConnections(): Map<string, InboundConnection> {
    return this.inboundConns;
  }

  public updateClientsAndTransports(newClients: OutboundConnections, newTransports: Record<string, Transport>): void {
    this.outboundConns = newClients;
    this.transports = newTransports;
  }

  /**
   * Executes a server operation with error handling and retry logic
   * @param inboundConn The inbound connection to execute the operation on
   * @param operation The operation to execute
   * @param options Operation options including timeout and retry settings
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
}
