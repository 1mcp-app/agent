import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { ConfigManager } from '@src/config/configManager.js';
import { processEnvironment } from '@src/config/envProcessor.js';
import { setupCapabilities } from '@src/core/capabilities/capabilityManager.js';
import { ClientManager } from '@src/core/client/clientManager.js';
import { getGlobalContextManager } from '@src/core/context/globalContextManager.js';
import {
  ClientTemplateTracker,
  FilterCache,
  getFilterCache,
  TemplateFilteringService,
  TemplateIndex,
} from '@src/core/filtering/index.js';
import { InstructionAggregator } from '@src/core/instructions/instructionAggregator.js';
import { ClientInstancePool, type PooledClientInstance } from '@src/core/server/clientInstancePool.js';
import type { OutboundConnection } from '@src/core/types/client.js';
import { ClientStatus } from '@src/core/types/client.js';
import {
  AuthProviderTransport,
  InboundConnection,
  InboundConnectionConfig,
  MCPServerParams,
  OperationOptions,
  OutboundConnections,
  ServerStatus,
} from '@src/core/types/index.js';
import type { MCPServerConfiguration } from '@src/core/types/transport.js';
import {
  type ClientConnection,
  PresetNotificationService,
} from '@src/domains/preset/services/presetNotificationService.js';
import logger, { debugIf } from '@src/logger/logger.js';
import { enhanceServerWithLogging } from '@src/logger/mcpLoggingEnhancer.js';
import { createTransports, createTransportsWithContext, inferTransportType } from '@src/transport/transportFactory.js';
import type { ContextData } from '@src/types/context.js';
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
  private clientInstancePool?: ClientInstancePool;
  private serverConfigData: MCPServerConfiguration | null = null; // Cache the config data
  private templateSessionMap?: Map<string, string>; // Maps template name to session ID for tracking
  private cleanupTimer?: ReturnType<typeof setInterval>; // Timer for idle instance cleanup

  // Enhanced filtering components
  private clientTemplateTracker = new ClientTemplateTracker();
  private templateIndex = new TemplateIndex();
  private filterCache = getFilterCache();

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

    // Initialize the client instance pool
    this.clientInstancePool = new ClientInstancePool({
      maxInstances: 50, // Configurable limit
      idleTimeout: 5 * 60 * 1000, // 5 minutes - faster cleanup for development
      cleanupInterval: 30 * 1000, // 30 seconds - more frequent cleanup checks
    });

    // Start cleanup timer for idle template instances
    this.startCleanupTimer();
  }

  /**
   * Starts the periodic cleanup timer for idle template instances
   */
  private startCleanupTimer(): void {
    const cleanupInterval = 30 * 1000; // 30 seconds - match pool's cleanup interval
    this.cleanupTimer = setInterval(async () => {
      try {
        await this.cleanupIdleInstances();
      } catch (error) {
        logger.error('Error during idle instance cleanup:', error);
      }
    }, cleanupInterval);

    // Ensure the timer doesn't prevent process exit
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }

    debugIf(() => ({
      message: 'ServerManager cleanup timer started',
      meta: { interval: cleanupInterval },
    }));
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
  public static async resetInstance(): Promise<void> {
    if (ServerManager.instance) {
      // Clean up cleanup timer
      if (ServerManager.instance.cleanupTimer) {
        clearInterval(ServerManager.instance.cleanupTimer);
        ServerManager.instance.cleanupTimer = undefined;
      }

      // Clean up existing connections with forced close
      for (const [sessionId] of ServerManager.instance.inboundConns) {
        await ServerManager.instance.disconnectTransport(sessionId, true);
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

    // Set up context change listener for template processing
    this.setupContextChangeListener();

    debugIf('Instruction aggregator set for ServerManager');
  }

  /**
   * Set up context change listener for dynamic template processing
   */
  private setupContextChangeListener(): void {
    const globalContextManager = getGlobalContextManager();

    globalContextManager.on('context-changed', async (data: { newContext: ContextData; sessionIdChanged: boolean }) => {
      logger.info('Context changed, reprocessing templates', {
        sessionId: data.newContext?.sessionId,
        sessionChanged: data.sessionIdChanged,
      });

      try {
        await this.reprocessTemplatesWithNewContext(data.newContext);
      } catch (error) {
        logger.error('Failed to reprocess templates after context change:', error);
      }
    });

    debugIf('Context change listener set up for ServerManager');
  }

  // Circuit breaker state
  private templateProcessingErrors = 0;
  private readonly maxTemplateProcessingErrors = 3;
  private templateProcessingDisabled = false;
  private templateProcessingResetTimeout?: ReturnType<typeof setTimeout>;

  /**
   * Reprocess templates when context changes with circuit breaker pattern
   */
  private async reprocessTemplatesWithNewContext(context: ContextData | undefined): Promise<void> {
    // Check if template processing is disabled due to repeated failures
    if (this.templateProcessingDisabled) {
      logger.warn('Template processing temporarily disabled due to repeated failures');
      return;
    }

    try {
      const configManager = ConfigManager.getInstance();
      const { staticServers, templateServers, errors } = await configManager.loadConfigWithTemplates(context);

      // Merge static and template servers
      const newConfig = { ...staticServers, ...templateServers };

      // Compare with current servers and restart only those that changed
      // Handle partial failures gracefully
      try {
        await this.updateServersWithNewConfig(newConfig);
      } catch (updateError) {
        // Log the error but don't fail completely - try to update servers individually
        logger.error('Failed to update all servers with new config, attempting individual updates:', updateError);
        await this.updateServersIndividually(newConfig);
      }

      if (errors.length > 0) {
        logger.warn(`Template reprocessing completed with ${errors.length} errors:`, { errors });
      }

      const templateCount = Object.keys(templateServers).length;
      if (templateCount > 0) {
        logger.info(`Reprocessed ${templateCount} template servers with new context`);
      }

      // Reset error count on success
      this.templateProcessingErrors = 0;
      if (this.templateProcessingResetTimeout) {
        clearTimeout(this.templateProcessingResetTimeout);
        this.templateProcessingResetTimeout = undefined;
      }
    } catch (error) {
      this.templateProcessingErrors++;
      logger.error(
        `Failed to reprocess templates with new context (${this.templateProcessingErrors}/${this.maxTemplateProcessingErrors}):`,
        {
          error: error instanceof Error ? error.message : String(error),
          context: context?.sessionId ? `session ${context.sessionId}` : 'unknown',
        },
      );

      // Implement circuit breaker pattern
      if (this.templateProcessingErrors >= this.maxTemplateProcessingErrors) {
        this.templateProcessingDisabled = true;
        logger.error(`Template processing disabled due to ${this.templateProcessingErrors} consecutive failures`);

        // Reset after 5 minutes
        this.templateProcessingResetTimeout = setTimeout(
          () => {
            this.templateProcessingDisabled = false;
            this.templateProcessingErrors = 0;
            logger.info('Template processing re-enabled after timeout');
          },
          5 * 60 * 1000,
        );
      }
    }
  }

  /**
   * Update servers individually to handle partial failures
   */
  private async updateServersIndividually(newConfig: Record<string, MCPServerParams>): Promise<void> {
    const promises = Object.entries(newConfig).map(async ([serverName, config]) => {
      try {
        await this.updateServerMetadata(serverName, config);
        logger.debug(`Successfully updated server: ${serverName}`);
      } catch (serverError) {
        logger.error(`Failed to update server ${serverName}:`, serverError);
        // Continue with other servers even if one fails
      }
    });

    await Promise.allSettled(promises);
  }

  /**
   * Update servers with new configuration
   */
  private async updateServersWithNewConfig(newConfig: Record<string, MCPServerParams>): Promise<void> {
    const currentServerNames = new Set(this.mcpServers.keys());
    const newServerNames = new Set(Object.keys(newConfig));

    // Stop servers that are no longer in the configuration
    for (const serverName of currentServerNames) {
      if (!newServerNames.has(serverName)) {
        logger.info(`Stopping server no longer in configuration: ${serverName}`);
        await this.stopServer(serverName);
      }
    }

    // Start or restart servers with new configurations
    for (const [serverName, config] of Object.entries(newConfig)) {
      const existingServerInfo = this.mcpServers.get(serverName);

      if (existingServerInfo) {
        // Check if configuration changed
        if (this.configChanged(existingServerInfo.config, config)) {
          logger.info(`Restarting server with updated configuration: ${serverName}`);
          await this.restartServer(serverName, config);
        }
      } else {
        // New server, start it
        logger.info(`Starting new server: ${serverName}`);
        await this.startServer(serverName, config);
      }
    }
  }

  /**
   * Check if server configuration has changed
   */
  private configChanged(oldConfig: MCPServerParams, newConfig: MCPServerParams): boolean {
    return JSON.stringify(oldConfig) !== JSON.stringify(newConfig);
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

  public async connectTransport(
    transport: Transport,
    sessionId: string,
    opts: InboundConnectionConfig,
    context?: ContextData,
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
    const connectionPromise = this.performConnection(transport, sessionId, opts, context);
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
    context?: ContextData,
  ): Promise<void> {
    // Set connection timeout
    const connectionTimeoutMs = 30000; // 30 seconds

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Connection timeout for session ${sessionId}`)), connectionTimeoutMs);
    });

    try {
      await Promise.race([this.doConnect(transport, sessionId, opts, context), timeoutPromise]);
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

  private async doConnect(
    transport: Transport,
    sessionId: string,
    opts: InboundConnectionConfig,
    context?: ContextData,
  ): Promise<void> {
    // Get filtered instructions based on client's filter criteria using InstructionAggregator
    const filteredInstructions = this.instructionAggregator?.getFilteredInstructions(opts, this.outboundConns) || '';

    // Create server capabilities with filtered instructions
    const serverOptionsWithInstructions = {
      ...this.serverCapabilities,
      instructions: filteredInstructions || undefined,
    };

    // Initialize outbound connections
    // Load configuration data if not already loaded
    if (!this.serverConfigData) {
      const configManager = ConfigManager.getInstance();
      const { staticServers, templateServers } = await configManager.loadConfigWithTemplates(context);
      this.serverConfigData = {
        mcpServers: staticServers,
        mcpTemplates: templateServers,
      };
    }

    // If we have context, create template-based servers
    if (context && this.clientInstancePool && this.serverConfigData.mcpTemplates) {
      await this.createTemplateBasedServers(sessionId, context, opts);
    }

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

  /**
   * Create template-based servers for a client connection
   */
  private async createTemplateBasedServers(
    sessionId: string,
    context: ContextData,
    opts: InboundConnectionConfig,
  ): Promise<void> {
    if (!this.clientInstancePool || !this.serverConfigData?.mcpTemplates) {
      return;
    }

    // Get template servers that match the client's tags/preset
    const templateConfigs = this.getMatchingTemplateConfigs(opts);

    logger.info(`Creating ${templateConfigs.length} template-based servers for session ${sessionId}`, {
      templates: templateConfigs.map(([name]) => name),
    });

    // Create client instances from templates
    for (const [templateName, templateConfig] of templateConfigs) {
      try {
        // Get or create client instance from template
        const instance = await this.clientInstancePool.getOrCreateClientInstance(
          templateName,
          templateConfig,
          context,
          sessionId,
          templateConfig.template,
        );

        // CRITICAL: Register the template server in outbound connections for capability aggregation
        // This ensures the template server's tools are included in the capabilities
        this.outboundConns.set(templateName, {
          name: templateName, // Use template name for clean tool namespacing (serena_1mcp_*)
          transport: instance.transport,
          client: instance.client,
          status: ClientStatus.Connected, // Template servers should be connected
          capabilities: undefined, // Will be populated by setupCapabilities
        });

        // Store session ID mapping separately for cleanup tracking
        if (!this.templateSessionMap) {
          this.templateSessionMap = new Map<string, string>();
        }
        this.templateSessionMap.set(templateName, sessionId);

        // Add to transports map as well using instance ID
        this.transports[instance.id] = instance.transport;

        // Enhanced client-template tracking
        this.clientTemplateTracker.addClientTemplate(sessionId, templateName, instance.id, {
          shareable: templateConfig.template?.shareable,
          perClient: templateConfig.template?.perClient,
        });

        debugIf(() => ({
          message: `ServerManager.createTemplateBasedServers: Tracked client-template relationship`,
          meta: {
            sessionId,
            templateName,
            instanceId: instance.id,
            referenceCount: instance.referenceCount,
            shareable: templateConfig.template?.shareable,
            perClient: templateConfig.template?.perClient,
            registeredInOutbound: true,
          },
        }));

        logger.info(`Connected to template client instance: ${templateName} (${instance.id})`, {
          sessionId,
          clientCount: instance.referenceCount,
          registeredInCapabilities: true,
        });
      } catch (error) {
        logger.error(`Failed to create client instance from template ${templateName}:`, error);
      }
    }
  }

  /**
   * Get template configurations that match the client's filter criteria
   */
  private getMatchingTemplateConfigs(opts: InboundConnectionConfig): Array<[string, MCPServerParams]> {
    if (!this.serverConfigData?.mcpTemplates) {
      return [];
    }

    // Validate template entries to ensure type safety
    const templateEntries = Object.entries(this.serverConfigData.mcpTemplates);
    const templates: Array<[string, MCPServerParams]> = templateEntries.filter(([_name, config]) => {
      // Basic validation of MCPServerParams structure
      return config && typeof config === 'object' && 'command' in config;
    }) as Array<[string, MCPServerParams]>;

    logger.info('ServerManager.getMatchingTemplateConfigs: Using enhanced filtering', {
      totalTemplates: templates.length,
      filterMode: opts.tagFilterMode,
      tags: opts.tags,
      presetName: opts.presetName,
      templateNames: templates.map(([name]) => name),
    });

    return TemplateFilteringService.getMatchingTemplates(templates, opts);
  }

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

        // Only close the transport if explicitly requested (e.g., during shutdown)
        // Don't close if this is called from an onclose handler to avoid recursion
        if (forceClose && server.server.transport) {
          try {
            server.server.transport.close();
          } catch (error) {
            logger.error(`Error closing transport for session ${sessionId}:`, error);
          }
        }

        // Clean up template-based servers for this client
        await this.cleanupTemplateServers(sessionId);

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

  /**
   * Clean up template-based servers when a client disconnects
   */
  private async cleanupTemplateServers(sessionId: string): Promise<void> {
    // Enhanced cleanup using client template tracker
    const instancesToCleanup = this.clientTemplateTracker.removeClient(sessionId);
    logger.info(`Removing client from ${instancesToCleanup.length} template instances`, {
      sessionId,
      instancesToCleanup,
    });

    // Remove client from client instance pool
    for (const instanceKey of instancesToCleanup) {
      const [templateName, ...instanceParts] = instanceKey.split(':');
      const instanceId = instanceParts.join(':');

      try {
        if (this.clientInstancePool) {
          // Remove the client from the instance
          this.clientInstancePool.removeClientFromInstance(instanceKey, sessionId);

          debugIf(() => ({
            message: `ServerManager.cleanupTemplateServers: Successfully removed client from client instance`,
            meta: {
              sessionId,
              templateName,
              instanceId,
              instanceKey,
            },
          }));
        }

        // Check if this instance has no more clients
        const remainingClients = this.clientTemplateTracker.getClientCount(templateName, instanceId);

        if (remainingClients === 0) {
          // No more clients, instance becomes idle
          // The client instance will be closed after idle timeout by the cleanup timer
          const templateConfig = this.serverConfigData?.mcpTemplates?.[templateName];
          const idleTimeout = templateConfig?.template?.idleTimeout || 5 * 60 * 1000; // 5 minutes default

          debugIf(() => ({
            message: `Client instance ${instanceId} has no more clients, marking as idle for cleanup after timeout`,
            meta: {
              templateName,
              instanceId,
              idleTimeout,
            },
          }));
        } else {
          debugIf(() => ({
            message: `Client instance ${instanceId} still has ${remainingClients} clients, keeping connection open`,
            meta: { instanceId, remainingClients },
          }));
        }
      } catch (error) {
        logger.warn(`Failed to cleanup client instance ${instanceKey}:`, {
          error: error instanceof Error ? error.message : 'Unknown error',
          sessionId,
          templateName,
          instanceId,
        });
      }
    }

    logger.info(`Cleaned up template client instances for session ${sessionId}`, {
      instancesCleaned: instancesToCleanup.length,
    });
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

      // Create transport using the factory pattern with context awareness
      const globalContextManager = getGlobalContextManager();
      const currentContext = globalContextManager.getContext();

      const transports = currentContext
        ? await createTransportsWithContext({ [serverName]: config }, currentContext)
        : createTransports({ [serverName]: config });
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

  /**
   * Get enhanced filtering statistics and information
   */
  public getFilteringStats(): {
    tracker: ReturnType<ClientTemplateTracker['getStats']> | null;
    cache: ReturnType<FilterCache['getStats']> | null;
    index: ReturnType<TemplateIndex['getStats']> | null;
    enabled: boolean;
  } {
    const tracker = this.clientTemplateTracker.getStats();
    const cache = this.filterCache.getStats();
    const index = this.templateIndex.getStats();

    return {
      tracker,
      cache,
      index,
      enabled: true,
    };
  }

  /**
   * Get detailed client template tracking information
   */
  public getClientTemplateInfo(): ReturnType<ClientTemplateTracker['getDetailedInfo']> {
    return this.clientTemplateTracker.getDetailedInfo();
  }

  /**
   * Rebuild the template index
   */
  public rebuildTemplateIndex(): void {
    if (this.serverConfigData?.mcpTemplates) {
      this.templateIndex.buildIndex(this.serverConfigData.mcpTemplates);
      logger.info('Template index rebuilt');
    }
  }

  /**
   * Clear filter cache
   */
  public clearFilterCache(): void {
    this.filterCache.clear();
    logger.info('Filter cache cleared');
  }

  /**
   * Get idle template instances for cleanup
   */
  public getIdleTemplateInstances(idleTimeoutMs: number = 10 * 60 * 1000): Array<{
    templateName: string;
    instanceId: string;
    idleTime: number;
  }> {
    return this.clientTemplateTracker.getIdleInstances(idleTimeoutMs);
  }

  /**
   * Force cleanup of idle template instances
   */
  public async cleanupIdleInstances(): Promise<number> {
    if (!this.clientInstancePool) {
      return 0;
    }

    // Get all instances from the pool
    const allInstances = this.clientInstancePool.getAllInstances();
    const instancesToCleanup: Array<{ templateName: string; instanceId: string; instance: PooledClientInstance }> = [];

    for (const instance of allInstances) {
      if (instance.status === 'idle') {
        instancesToCleanup.push({
          templateName: instance.templateName,
          instanceId: instance.id,
          instance,
        });
      }
    }

    let cleanedUp = 0;

    for (const { templateName, instanceId, instance } of instancesToCleanup) {
      try {
        // Remove the instance from the pool
        await this.clientInstancePool.removeInstance(`${templateName}:${instance.variableHash}`);

        // Clean up transport references
        delete this.transports[instanceId];
        this.outboundConns.delete(templateName);

        // Clean up tracking
        this.clientTemplateTracker.cleanupInstance(templateName, instanceId);

        cleanedUp++;
        logger.info(`Cleaned up idle client instance: ${templateName}:${instanceId}`);
      } catch (error) {
        logger.warn(`Failed to cleanup idle client instance ${templateName}:${instanceId}:`, error);
      }
    }

    if (cleanedUp > 0) {
      logger.info(`Cleaned up ${cleanedUp} idle client instances`);
    }

    return cleanedUp;
  }
}
