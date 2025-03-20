import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import logger from './logger/logger.js';
import configReloadService from './services/configReloadService.js';
import { setupCapabilities } from './capabilities/capabilityManager.js';
import { enhanceServerWithLogging } from './middleware/loggingMiddleware.js';
import { Clients, ServerInfo, ClientTransports } from './types.js';

export class ServerManager {
  private static instance: ServerManager;
  private servers: Map<string, ServerInfo> = new Map();
  private serverConfig: { name: string; version: string };
  private serverCapabilities: { capabilities: Record<string, unknown> };

  private clients: Clients = {};
  private clientTransports: ClientTransports = {};

  private constructor(
    config: { name: string; version: string },
    capabilities: { capabilities: Record<string, unknown> },
    clients: Clients,
    clientTransports: ClientTransports,
  ) {
    this.serverConfig = config;
    this.serverCapabilities = capabilities;
    this.clients = clients;
    this.clientTransports = clientTransports;
  }

  public static getInstance(
    config: { name: string; version: string },
    capabilities: { capabilities: Record<string, unknown> },
    clients: Clients,
    clientTransports: ClientTransports,
  ): ServerManager {
    if (!ServerManager.instance) {
      ServerManager.instance = new ServerManager(config, capabilities, clients, clientTransports);
    }
    return ServerManager.instance;
  }

  public async connectTransport(transport: Transport, sessionId: string, tags?: string[]): Promise<void> {
    try {
      // Create a new server instance for this transport
      const server = new Server(this.serverConfig, this.serverCapabilities);

      // Enhance server with logging middleware
      enhanceServerWithLogging(server);

      const serverInfo: ServerInfo = {
        server,
        tags,
      };

      // Set up capabilities for this server instance
      await setupCapabilities(this.clients, serverInfo);

      // Initialize the configuration reload service
      configReloadService.initialize(serverInfo, this.clientTransports);

      // Store the server instance
      this.servers.set(sessionId, serverInfo);

      // Connect the transport to the new server instance
      await server.connect(transport);

      logger.info(`Connected transport for session ${sessionId}`);
    } catch (error) {
      logger.error(`Failed to connect transport for session ${sessionId}:`, error);
      throw error;
    }
  }

  public disconnectTransport(sessionId: string): void {
    const server = this.servers.get(sessionId);
    if (server) {
      this.servers.delete(sessionId);
      logger.info(`Disconnected transport for session ${sessionId}`);
    }
  }

  public getTransport(sessionId: string): Transport | undefined {
    return this.servers.get(sessionId)?.server.transport;
  }

  public getTransports(): Map<string, Transport> {
    const transports = new Map<string, Transport>();
    for (const [id, server] of this.servers.entries()) {
      if (server.server.transport) {
        transports.set(id, server.server.transport);
      }
    }
    return transports;
  }

  public getClientTransports(): ClientTransports {
    return this.clientTransports;
  }

  public getActiveTransportsCount(): number {
    return this.servers.size;
  }

  public getServer(sessionId: string): ServerInfo | undefined {
    return this.servers.get(sessionId);
  }
}
