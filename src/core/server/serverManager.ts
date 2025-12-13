import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { processEnvironment } from '@src/config/envProcessor.js';
import { setupCapabilities } from '@src/core/capabilities/capabilityManager.js';
import { ClientManager } from '@src/core/client/clientManager.js';
import { InstructionAggregator } from '@src/core/instructions/instructionAggregator.js';
import type { OutboundConnection } from '@src/core/types/client.js';
import {
  AuthProviderTransport,
  InboundConnection,
  InboundConnectionConfig,
  MCPServerParams,
  OperationOptions,
  OutboundConnections,
  ServerStatus,
} from '@src/core/types/index.js';
import {
  type ClientConnection,
  PresetNotificationService,
} from '@src/domains/preset/services/presetNotificationService.js';
import logger, { debugIf } from '@src/logger/logger.js';
import { enhanceServerWithLogging } from '@src/logger/mcpLoggingEnhancer.js';
import { createTransports, inferTransportType } from '@src/transport/transportFactory.js';
import { executeOperation } from '@src/utils/core/operationExecution.js';

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
  private clientManager?: ClientManager;
  private mcpServers: Map<string, { transport: AuthProviderTransport; config: MCPServerParams }> = new Map();

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
    this.clientManager = ClientManager.getOrCreateInstance();
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
    // Config reload service removed - handled by ConfigChangeHandler

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
        // Config reload service removed - handled by ConfigChangeHandler
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

  /**
   * Start a new MCP server instance
   */
  public async startServer(serverName: string, config: MCPServerParams): Promise<void> {
    try {
      logger.info(`Starting MCP server: ${serverName}`);

      // Check if server is already running
      if (this.mcpServers.has(serverName)) {
        logger.warn(`Server ${serverName} is already running`);
        return;
      }

      // Skip disabled servers
      if (config.disabled) {
        logger.info(`Server ${serverName} is disabled, skipping start`);
        return;
      }

      // Process environment variables in config
      const processedConfig = this.processServerConfig(config);

      // Infer transport type if not specified
      const configWithType = inferTransportType(processedConfig, serverName);

      // Create transport for the server
      const transport = await this.createServerTransport(serverName, configWithType);

      // Store server info
      this.mcpServers.set(serverName, {
        transport,
        config: configWithType,
      });

      // Create client connection to the server using ClientManager
      await this.connectToServer(serverName, transport, configWithType);

      logger.info(`Successfully started MCP server: ${serverName}`);
    } catch (error) {
      logger.error(`Failed to start MCP server ${serverName}:`, error);
      throw error;
    }
  }

  /**
   * Stop a server instance
   */
  public async stopServer(serverName: string): Promise<void> {
    try {
      logger.info(`Stopping MCP server: ${serverName}`);

      // Check if server is running
      const serverInfo = this.mcpServers.get(serverName);
      if (!serverInfo) {
        logger.warn(`Server ${serverName} is not running`);
        return;
      }

      // Disconnect client from the server using ClientManager
      await this.disconnectFromServer(serverName);

      // Clean up transport
      const { transport } = serverInfo;
      try {
        if (transport.close) {
          await transport.close();
        }
      } catch (error) {
        logger.warn(`Error closing transport for server ${serverName}:`, error);
      }

      // Remove from tracking
      this.mcpServers.delete(serverName);

      logger.info(`Successfully stopped MCP server: ${serverName}`);
    } catch (error) {
      logger.error(`Failed to stop MCP server ${serverName}:`, error);
      throw error;
    }
  }

  /**
   * Restart a server instance
   */
  public async restartServer(serverName: string, config: MCPServerParams): Promise<void> {
    try {
      logger.info(`Restarting MCP server: ${serverName}`);

      // Check if server is currently running and stop it
      const isCurrentlyRunning = this.mcpServers.has(serverName);
      if (isCurrentlyRunning) {
        logger.info(`Stopping existing server ${serverName} before restart`);
        await this.stopServer(serverName);
      }

      // Start the server with new configuration
      await this.startServer(serverName, config);

      logger.info(`Successfully restarted MCP server: ${serverName}`);
    } catch (error) {
      logger.error(`Failed to restart MCP server ${serverName}:`, error);
      throw error;
    }
  }

  /**
   * Process server configuration to handle environment variables
   */
  private processServerConfig(config: MCPServerParams): MCPServerParams {
    try {
      // Create a mutable copy for processing
      const processedConfig = { ...config };

      // Process environment variables if enabled - only pass env-related fields
      const envConfig = {
        inheritParentEnv: config.inheritParentEnv,
        envFilter: config.envFilter,
        env: config.env,
      };

      const processedEnv = processEnvironment(envConfig);

      // Replace environment variables in the config while preserving all other fields
      if (processedEnv.processedEnv && Object.keys(processedEnv.processedEnv).length > 0) {
        processedConfig.env = processedEnv.processedEnv;
      }

      return processedConfig;
    } catch (error) {
      logger.warn(`Failed to process environment variables for server config:`, error);
      return config;
    }
  }

  /**
   * Create a transport for the given server configuration
   */
  private async createServerTransport(serverName: string, config: MCPServerParams): Promise<AuthProviderTransport> {
    try {
      debugIf(() => ({
        message: `Creating transport for server ${serverName}`,
        meta: { serverName, type: config.type, command: config.command, url: config.url },
      }));

      // Create transport using the factory pattern
      const transports = createTransports({ [serverName]: config });
      const transport = transports[serverName];

      if (!transport) {
        throw new Error(`Failed to create transport for server ${serverName}`);
      }

      debugIf(() => ({
        message: `Successfully created transport for server ${serverName}`,
        meta: { serverName, transportType: config.type },
      }));

      return transport;
    } catch (error) {
      logger.error(`Failed to create transport for server ${serverName}:`, error);
      throw error;
    }
  }

  /**
   * Connect to a server using ClientManager
   */
  private async connectToServer(
    serverName: string,
    transport: AuthProviderTransport,
    _config: MCPServerParams,
  ): Promise<void> {
    try {
      if (!this.clientManager) {
        throw new Error('ClientManager not initialized');
      }

      // Create client connection using the existing ClientManager infrastructure
      const clients = await this.clientManager.createClients({ [serverName]: transport });

      // Update our local outbound connections
      const newClient = clients.get(serverName);
      if (newClient) {
        this.outboundConns.set(serverName, newClient);
        this.transports[serverName] = transport;
      }

      debugIf(() => ({
        message: `Successfully connected to server ${serverName}`,
        meta: { serverName, status: newClient?.status },
      }));
    } catch (error) {
      logger.error(`Failed to connect to server ${serverName}:`, error);
      throw error;
    }
  }

  /**
   * Disconnect from a server using ClientManager
   */
  private async disconnectFromServer(serverName: string): Promise<void> {
    try {
      if (!this.clientManager) {
        throw new Error('ClientManager not initialized');
      }

      // Remove from outbound connections
      this.outboundConns.delete(serverName);
      delete this.transports[serverName];

      // ClientManager doesn't have explicit disconnect method, so we clean up our references
      // The actual transport cleanup happens in stopServer

      debugIf(() => ({
        message: `Successfully disconnected from server ${serverName}`,
        meta: { serverName },
      }));
    } catch (error) {
      logger.error(`Failed to disconnect from server ${serverName}:`, error);
      throw error;
    }
  }

  /**
   * Get the status of all managed MCP servers
   */
  public getMcpServerStatus(): Map<string, { running: boolean; config: MCPServerParams }> {
    const status = new Map<string, { running: boolean; config: MCPServerParams }>();

    for (const [serverName, serverInfo] of this.mcpServers.entries()) {
      status.set(serverName, {
        running: true,
        config: serverInfo.config,
      });
    }

    return status;
  }

  /**
   * Check if a specific MCP server is running
   */
  public isMcpServerRunning(serverName: string): boolean {
    return this.mcpServers.has(serverName);
  }

  /**
   * Update metadata for a running server without restarting it
   */
  public async updateServerMetadata(serverName: string, newConfig: MCPServerParams): Promise<void> {
    try {
      const serverInfo = this.mcpServers.get(serverName);
      if (!serverInfo) {
        logger.warn(`Cannot update metadata for ${serverName}: server not running`);
        return;
      }

      debugIf(() => ({
        message: `Updating metadata for server ${serverName}`,
        meta: {
          oldConfig: serverInfo.config,
          newConfig,
        },
      }));

      // Update the stored configuration with new metadata
      serverInfo.config = { ...serverInfo.config, ...newConfig };

      // Update transport metadata if supported
      const { transport } = serverInfo;
      if (transport && 'tags' in transport) {
        // Update tags and other metadata on transport
        if (newConfig.tags) {
          transport.tags = newConfig.tags;
        }
      }

      // Update outbound connections metadata
      const outboundConn = this.outboundConns.get(serverName);
      if (outboundConn && outboundConn.transport && 'tags' in outboundConn.transport) {
        // Update tags in the outbound connection
        outboundConn.transport.tags = newConfig.tags;
      }

      debugIf(() => ({
        message: `Successfully updated metadata for server ${serverName}`,
        meta: { newTags: newConfig.tags },
      }));
    } catch (error) {
      logger.error(`Failed to update metadata for server ${serverName}:`, error);
      throw error;
    }
  }
}
