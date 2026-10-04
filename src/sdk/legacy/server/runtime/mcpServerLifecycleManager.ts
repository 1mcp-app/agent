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
      logger.info('mcpServerLifecycleManager.starting.mcp.server.c60fd61a');

      // Check if server is already running
      if (this.mcpServers.has(serverName)) {
        logger.warn('mcpServerLifecycleManager.server.is.already.running.67a5851c');
        return;
      }

      // Skip disabled servers
      if (config.disabled) {
        logger.info('mcpServerLifecycleManager.server.is.disabled.skipping.start.ba9a2684');
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

      logger.info('mcpServerLifecycleManager.successfully.started.mcp.server.3355cad1');
    } catch (error) {
      const safeError = sanitizeRuntimeScopeError(error);
      logger.error('mcpServerLifecycleManager.failed.to.start.mcp.server.3fd8e8c1', { error: error });
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
      logger.info('mcpServerLifecycleManager.stopping.mcp.server.f57921e8');

      // Check if server is running
      const serverInfo = this.mcpServers.get(serverName);
      if (!serverInfo) {
        logger.warn('mcpServerLifecycleManager.server.is.not.running.8e5bdcc3');
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
      } catch (_error) {
        logger.warn('mcpServerLifecycleManager.error.closing.transport.for.server.4689317f', { error: _error });
      }

      // Remove from tracking
      this.mcpServers.delete(serverName);

      logger.info('mcpServerLifecycleManager.successfully.stopped.mcp.server.f5e283e8');
    } catch (error) {
      const safeError = sanitizeRuntimeScopeError(error);
      logger.error('mcpServerLifecycleManager.failed.to.stop.mcp.server.b33787bf', { error: error });
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
      logger.info('mcpServerLifecycleManager.restarting.mcp.server.dd07115c');

      // Check if server is currently running and stop it
      const isCurrentlyRunning = this.mcpServers.has(serverName);
      if (isCurrentlyRunning) {
        logger.info('mcpServerLifecycleManager.stopping.existing.server.before.restart.f0a20e9f');
        await this.stopServer(serverName, outboundConns, transports);
      }

      // Start the server with new configuration
      await this.startServer(serverName, config, outboundConns, transports);

      logger.info('mcpServerLifecycleManager.successfully.restarted.mcp.server.c9b33cb7');
    } catch (error) {
      const safeError = sanitizeRuntimeScopeError(error);
      logger.error('mcpServerLifecycleManager.failed.to.restart.mcp.server.8b93a852', { error: error });
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
      message: 'mcpServerLifecycleManager.tracked.mcp.server.lifecycle.state.9f4bff42',
      meta: { serverName: serverName },
    }));
  }

  /**
   * Remove lifecycle tracking without touching the already-cleaned-up transport.
   */
  public untrackServer(serverName: string): void {
    if (this.mcpServers.delete(serverName)) {
      debugIf(() => ({ message: 'mcpServerLifecycleManager.untracked.mcp.server.lifecycle.state.5d6dfa5a' }));
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
        logger.warn('mcpServerLifecycleManager.cannot.update.metadata.for.server.not.running.f11c2348');
        return;
      }

      debugIf(() => ({ message: 'mcpServerLifecycleManager.updating.metadata.for.server.e21816d0' }));

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

      debugIf(() => ({ message: 'mcpServerLifecycleManager.successfully.updated.metadata.for.server.03355998' }));
    } catch (error) {
      logger.error('mcpServerLifecycleManager.failed.to.update.metadata.for.server.5f509b50', { error: error });
      throw error;
    }
  }

  /**
   * Create a transport for the given server configuration
   */
  private async createServerTransport(serverName: string, config: MCPServerParams): Promise<AuthProviderTransport> {
    try {
      debugIf(() => ({
        message: 'mcpServerLifecycleManager.creating.transport.for.server.b7871772',
        meta: { serverName: serverName },
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
        message: 'mcpServerLifecycleManager.successfully.created.transport.for.server.8226be48',
        meta: { serverName: serverName },
      }));

      return transport as AuthProviderTransport;
    } catch (error) {
      const safeError = sanitizeRuntimeScopeError(error);
      logger.error('mcpServerLifecycleManager.failed.to.create.transport.for.server.98caaa0f', { error: error });
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
        message: 'mcpServerLifecycleManager.successfully.connected.to.server.80d84788',
        meta: { serverName: serverName, status: newClient?.status },
      }));
    } catch (error) {
      const safeError = sanitizeRuntimeScopeError(error);
      logger.error('mcpServerLifecycleManager.failed.to.connect.to.server.143a5977', { error: error });
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
        message: 'mcpServerLifecycleManager.successfully.disconnected.from.server.7a6f427d',
        meta: { serverName: serverName },
      }));
    } catch (error) {
      logger.error('mcpServerLifecycleManager.failed.to.disconnect.from.server.98663348', { error: error });
      throw error;
    }
  }
}
