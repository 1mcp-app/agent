import { sanitizeRuntimeScopeError } from '@src/config/runtimeScopeEnv.js';
import { ClientManager } from '@src/core/client/clientManager.js';
import { getGlobalContextManager } from '@src/core/context/globalContextManager.js';
import type { OutboundConnections } from '@src/core/types/client.js';
import { MCPServerParams } from '@src/core/types/index.js';
import logger, { debugIf } from '@src/logger/logger.js';
import { getLegacyTransport } from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import type { AuthProviderTransport } from '@src/sdk/legacy/client/runtime/legacyTransport.js';
import { Transport } from '@src/sdk/legacy/shared/transport.js';
import { createTransports, createTransportsWithContext, inferTransportType } from '@src/transport/transportFactory.js';

/**
 * Manages the lifecycle of MCP server instances (start, stop, restart)
 */
export class MCPServerLifecycleManager {
  private mcpServers: Map<string, { transport: AuthProviderTransport; config: MCPServerParams }> = new Map();
  private clientManager?: ClientManager;

  constructor() {
    this.clientManager = ClientManager.getOrCreateInstance();
  }

  /**
   * Start a new MCP server instance
   */
  public async startServer(
    serverName: string,
    config: MCPServerParams,
    outboundConns: OutboundConnections,
    transports: Record<string, Transport>,
  ): Promise<void> {
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

      // Infer transport type if not specified
      const configWithType = inferTransportType(config, serverName);

      // Create transport for the server
      const transport = await this.createServerTransport(serverName, configWithType);

      // Store server info
      this.mcpServers.set(serverName, {
        transport,
        config: configWithType,
      });

      // Create client connection to the server using ClientManager
      await this.connectToServer(serverName, transport, configWithType, outboundConns, transports);

      logger.info(`Successfully started MCP server: ${serverName}`);
    } catch (error) {
      const safeError = sanitizeRuntimeScopeError(error);
      logger.error(`Failed to start MCP server ${serverName}:`, safeError);
      throw safeError;
    }
  }

  /**
   * Stop a server instance
   */
  public async stopServer(
    serverName: string,
    outboundConns: OutboundConnections,
    transports: Record<string, Transport>,
  ): Promise<void> {
    try {
      logger.info(`Stopping MCP server: ${serverName}`);

      // Check if server is running
      const serverInfo = this.mcpServers.get(serverName);
      if (!serverInfo) {
        logger.warn(`Server ${serverName} is not running`);
        return;
      }

      // Disconnect client from the server using ClientManager
      await this.disconnectFromServer(serverName, outboundConns, transports);

      // Clean up transport
      const { transport } = serverInfo;
      try {
        if (transport.close) {
          await transport.close();
        }
      } catch (error) {
        logger.warn(`Error closing transport for server ${serverName}:`, sanitizeRuntimeScopeError(error));
      }

      // Remove from tracking
      this.mcpServers.delete(serverName);

      logger.info(`Successfully stopped MCP server: ${serverName}`);
    } catch (error) {
      const safeError = sanitizeRuntimeScopeError(error);
      logger.error(`Failed to stop MCP server ${serverName}:`, safeError);
      throw safeError;
    }
  }

  /**
   * Restart a server instance
   */
  public async restartServer(
    serverName: string,
    config: MCPServerParams,
    outboundConns: OutboundConnections,
    transports: Record<string, Transport>,
  ): Promise<void> {
    try {
      logger.info(`Restarting MCP server: ${serverName}`);

      // Check if server is currently running and stop it
      const isCurrentlyRunning = this.mcpServers.has(serverName);
      if (isCurrentlyRunning) {
        logger.info(`Stopping existing server ${serverName} before restart`);
        await this.stopServer(serverName, outboundConns, transports);
      }

      // Start the server with new configuration
      await this.startServer(serverName, config, outboundConns, transports);

      logger.info(`Successfully restarted MCP server: ${serverName}`);
    } catch (error) {
      const safeError = sanitizeRuntimeScopeError(error);
      logger.error(`Failed to restart MCP server ${serverName}:`, safeError);
      throw safeError;
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
   * Track a server whose connection is managed by another startup path.
   */
  public trackServer(serverName: string, config: MCPServerParams, transport: AuthProviderTransport): void {
    if (config.disabled) {
      this.mcpServers.delete(serverName);
      return;
    }

    this.mcpServers.set(serverName, { transport, config });
    debugIf(() => ({
      message: `Tracked MCP server lifecycle state: ${serverName}`,
      meta: { serverName, tags: config.tags },
    }));
  }

  /**
   * Remove lifecycle tracking without touching the already-cleaned-up transport.
   */
  public untrackServer(serverName: string): void {
    if (this.mcpServers.delete(serverName)) {
      debugIf(() => ({ message: `Untracked MCP server lifecycle state: ${serverName}` }));
    }
  }

  /**
   * Update metadata for a running server without restarting it
   */
  public async updateServerMetadata(
    serverName: string,
    newConfig: MCPServerParams,
    outboundConns: OutboundConnections,
  ): Promise<void> {
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
      const outboundConn = outboundConns.get(serverName);
      if (outboundConn) {
        // Update tags in the outbound connection
        getLegacyTransport(outboundConn).tags = newConfig.tags;
        outboundConn.tags = [...(newConfig.tags ?? [])];
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
      const transport = transports[serverName] as AuthProviderTransport | undefined;

      if (!transport) {
        throw new Error(`Failed to create transport for server ${serverName}`);
      }

      debugIf(() => ({
        message: `Successfully created transport for server ${serverName}`,
        meta: { serverName, transportType: config.type },
      }));

      return transport as AuthProviderTransport;
    } catch (error) {
      const safeError = sanitizeRuntimeScopeError(error);
      logger.error(`Failed to create transport for server ${serverName}:`, safeError);
      throw safeError;
    }
  }

  /**
   * Connect to a server using ClientManager
   */
  private async connectToServer(
    serverName: string,
    transport: AuthProviderTransport,
    _config: MCPServerParams,
    outboundConns: OutboundConnections,
    transports: Record<string, Transport>,
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
        outboundConns.set(serverName, newClient);
        transports[serverName] = transport;
      }

      debugIf(() => ({
        message: `Successfully connected to server ${serverName}`,
        meta: { serverName, status: newClient?.status },
      }));
    } catch (error) {
      const safeError = sanitizeRuntimeScopeError(error);
      logger.error(`Failed to connect to server ${serverName}:`, safeError);
      throw safeError;
    }
  }

  /**
   * Disconnect from a server using ClientManager
   */
  private async disconnectFromServer(
    serverName: string,
    outboundConns: OutboundConnections,
    transports: Record<string, Transport>,
  ): Promise<void> {
    try {
      if (!this.clientManager) {
        throw new Error('ClientManager not initialized');
      }

      // Remove from outbound connections
      outboundConns.delete(serverName);
      delete transports[serverName];

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
}
