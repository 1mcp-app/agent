import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { DEFAULT_MAX_CONCURRENT_LOADS } from '@src/constants/mcp.js';
import { InstructionAggregator } from '@src/core/instructions/instructionAggregator.js';
import { ParallelExecutor } from '@src/core/loading/parallelExecutor.js';
import {
  AuthProviderTransport,
  ClientStatus,
  OperationOptions,
  OutboundConnection,
  OutboundConnections,
  ServerCapability,
} from '@src/core/types/index.js';
import logger, { debugIf } from '@src/logger/logger.js';
import { CapabilityError, ClientConnectionError, ClientNotFoundError } from '@src/utils/core/errorTypes.js';
import { executeOperation } from '@src/utils/core/operationExecution.js';

import { ClientFactory } from './clientFactory.js';
import { ConnectionHandler } from './connectionHandler.js';
import { OAuthFlowHandler } from './oauthFlowHandler.js';
import { TransportRecreator } from './transportRecreator.js';
import { OAuthRequiredError } from './types.js';

export { OAuthRequiredError };

export class ClientManager {
  private static instance: ClientManager;
  private outboundConns: OutboundConnections = new Map();
  private transports: Record<string, AuthProviderTransport> = {};
  private connectionSemaphore: Map<string, Promise<void>> = new Map();
  private instructionAggregator?: InstructionAggregator;
  private clientFactory: ClientFactory;
  private connectionHandler: ConnectionHandler;
  private oauthFlowHandler: OAuthFlowHandler;
  private transportRecreator: TransportRecreator;

  private constructor() {
    this.clientFactory = new ClientFactory();
    this.connectionHandler = new ConnectionHandler();
    this.oauthFlowHandler = new OAuthFlowHandler();
    this.transportRecreator = new TransportRecreator();
  }

  public static getOrCreateInstance(): ClientManager {
    if (!ClientManager.instance) {
      ClientManager.instance = new ClientManager();
    }
    return ClientManager.instance;
  }

  public static get current(): ClientManager {
    return ClientManager.instance;
  }

  public static resetInstance(): void {
    ClientManager.instance = undefined as unknown as ClientManager;
  }

  public setInstructionAggregator(aggregator: InstructionAggregator): void {
    this.instructionAggregator = aggregator;
  }

  private extractAndCacheInstructions(name: string, client: Client): void {
    try {
      const instructions = client.getInstructions();
      const connectionInfo = this.outboundConns.get(name);
      if (connectionInfo) {
        connectionInfo.instructions = instructions;
      }

      if (this.instructionAggregator) {
        this.instructionAggregator.setInstructions(name, instructions);
      }

      if (instructions?.trim()) {
        debugIf(() => ({
          message: `Cached instructions for ${name}: ${instructions.length} characters`,
          meta: { name, instructionLength: instructions.length },
        }));
      } else {
        debugIf(() => ({ message: `No instructions available for ${name}`, meta: { name } }));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`Failed to extract instructions from ${name}: ${errorMessage}`, {
        error: errorMessage,
        clientName: name,
        transportType: this.outboundConns.get(name)?.transport?.constructor.name,
        connectionStatus: this.outboundConns.get(name)?.status,
      });
    }
  }

  private setupConnectionHandlers(name: string, client: Client): void {
    client.onclose = () => {
      const clientInfo = this.outboundConns.get(name);
      if (clientInfo) {
        clientInfo.status = ClientStatus.Disconnected;
      }
      this.instructionAggregator?.removeServer(name);
      logger.info(`Client ${name} disconnected`);
    };

    client.onerror = (error) => {
      logger.error(`Client ${name} error: ${error}`);
    };
  }

  /**
   * Create multiple MCP clients in parallel with controlled concurrency
   *
   * @remarks Uses ParallelExecutor to create clients concurrently with a maximum
   * of DEFAULT_MAX_CONCURRENT_LOADS (5) simultaneous connections. Individual
   * client creation failures are captured in the OutboundConnections map with
   * appropriate error status, allowing other clients to continue loading.
   *
   * Error handling details:
   * - OAuthRequiredError: Client status set to AwaitingOAuth
   * - Other errors: Client status set to Error with lastError populated
   *
   * @param transports - Map of server names to their transport configurations
   * @returns Map of all attempted connections (successful, failed, and awaiting OAuth)
   */
  public async createClients(transports: Record<string, AuthProviderTransport>): Promise<OutboundConnections> {
    this.transports = transports;
    this.outboundConns.clear();

    const executor = new ParallelExecutor<[string, AuthProviderTransport], void>();
    const serverEntries = Object.entries(transports);
    const initialCount = serverEntries.length;

    await executor.execute(serverEntries, async ([name, transport]) => this.createClient(name, transport), {
      maxConcurrent: DEFAULT_MAX_CONCURRENT_LOADS,
    });

    // Check for failures and log summary
    let failedClientCount = 0;
    for (const conn of this.outboundConns.values()) {
      if (conn.status === ClientStatus.Error) {
        failedClientCount++;
      }
    }

    if (failedClientCount > 0) {
      logger.error(`Some clients failed to initialize: ${failedClientCount}/${initialCount}`);
    }

    let oauthClientCount = 0;
    for (const conn of this.outboundConns.values()) {
      if (conn.status === ClientStatus.AwaitingOAuth) {
        oauthClientCount++;
      }
    }

    if (oauthClientCount > 0) {
      logger.info(`Clients awaiting OAuth authorization: ${oauthClientCount}/${initialCount}`);
    }

    return this.outboundConns;
  }

  private async createClient(name: string, transport: AuthProviderTransport): Promise<void> {
    logger.info(`Creating client for ${name}`);
    try {
      const client = this.clientFactory.createClient();
      const connectedClient = await this.connectionHandler.connectWithRetry(client, transport, name, undefined, (t) =>
        this.transportRecreator.recreateHttpTransport(t),
      );

      this.outboundConns.set(name, {
        name,
        transport,
        client: connectedClient,
        status: ClientStatus.Connected,
        lastConnected: new Date(),
      });
      logger.info(`Client created for ${name}`);

      this.extractAndCacheInstructions(name, connectedClient);
      this.setupConnectionHandlers(name, connectedClient);
    } catch (error) {
      this.handleClientCreationError(name, transport, error);
    }
  }

  private handleClientCreationError(name: string, transport: AuthProviderTransport, error: unknown): void {
    if (error instanceof OAuthRequiredError) {
      logger.info(`OAuth authorization required for ${name}`, {
        reason: error.message,
        hasAuthorizationUrl: !!this.oauthFlowHandler.extractAuthorizationUrl(transport),
        clientName: name,
        transportType: transport.constructor.name,
      });
      const authorizationUrl = this.oauthFlowHandler.extractAuthorizationUrl(transport);
      this.outboundConns.set(name, {
        name,
        transport,
        client: error.client,
        status: ClientStatus.AwaitingOAuth,
        authorizationUrl,
        oauthStartTime: new Date(),
      });
    } else {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to create client for ${name}: ${errorMessage}`, {
        error: errorMessage,
        clientName: name,
        transportType: transport.constructor.name,
        connectionStatus: this.outboundConns.get(name)?.status,
        stack: error instanceof Error ? error.stack : undefined,
      });
      this.outboundConns.set(name, {
        name,
        transport,
        client: this.clientFactory.createClient(),
        status: ClientStatus.Error,
        lastError: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  public getClient(clientName: string): OutboundConnection {
    const client = this.outboundConns.get(clientName);
    if (!client) {
      throw new ClientNotFoundError(clientName);
    }
    return client;
  }

  public getClients(): OutboundConnections {
    return this.outboundConns;
  }

  public async createSingleClient(
    name: string,
    transport: AuthProviderTransport,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    const existingPromise = this.connectionSemaphore.get(name);
    if (existingPromise) {
      await existingPromise;
      return;
    }

    if (abortSignal?.aborted) {
      throw new Error(`Operation aborted: ${abortSignal.reason || 'Request cancelled'}`);
    }

    const connectionPromise = this.createSingleClientInternal(name, transport, abortSignal);
    this.connectionSemaphore.set(name, connectionPromise);

    try {
      await connectionPromise;
    } finally {
      this.connectionSemaphore.delete(name);
    }
  }

  private async createSingleClientInternal(
    name: string,
    transport: AuthProviderTransport,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    logger.info(`Creating client for ${name}`);
    this.transports[name] = transport;

    try {
      if (abortSignal?.aborted) {
        throw new Error(`Operation aborted: ${abortSignal.reason || 'Request cancelled'}`);
      }

      const client = this.clientFactory.createClient();
      const connectedClient = await this.connectionHandler.connectWithRetry(client, transport, name, abortSignal, (t) =>
        this.transportRecreator.recreateHttpTransport(t),
      );

      this.outboundConns.set(name, {
        name,
        transport,
        client: connectedClient,
        status: ClientStatus.Connected,
        lastConnected: new Date(),
      });
      logger.info(`Client created for ${name}`);

      this.extractAndCacheInstructions(name, connectedClient);
      this.setupConnectionHandlers(name, connectedClient);
    } catch (error) {
      this.handleSingleClientError(name, transport, error);
      throw error;
    }
  }

  private handleSingleClientError(name: string, transport: AuthProviderTransport, error: unknown): void {
    if (error instanceof OAuthRequiredError) {
      logger.info(`OAuth authorization required for ${name}`, {
        reason: error.message,
        hasAuthorizationUrl: !!this.oauthFlowHandler.extractAuthorizationUrl(transport),
        clientName: name,
        transportType: transport.constructor.name,
      });
      const authorizationUrl = this.oauthFlowHandler.extractAuthorizationUrl(transport);
      this.outboundConns.set(name, {
        name,
        transport,
        client: error.client,
        status: ClientStatus.AwaitingOAuth,
        authorizationUrl,
        oauthStartTime: new Date(),
      });
    } else {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to create client for ${name}: ${errorMessage}`, {
        error: errorMessage,
        clientName: name,
        transportType: transport.constructor.name,
        connectionStatus: this.outboundConns.get(name)?.status,
        stack: error instanceof Error ? error.stack : undefined,
      });
      this.outboundConns.set(name, {
        name,
        transport,
        client: this.clientFactory.createClient(),
        status: ClientStatus.Error,
        lastError: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  public initializeClientsAsync(transports: Record<string, AuthProviderTransport>): OutboundConnections {
    this.transports = transports;
    this.outboundConns.clear();
    logger.info(`Initialized client storage for ${Object.keys(transports).length} transports`);
    return this.outboundConns;
  }

  public getTransport(name: string): AuthProviderTransport | undefined {
    return this.transports[name];
  }

  public getTransportNames(): string[] {
    return Object.keys(this.transports);
  }

  public async completeOAuthAndReconnect(serverName: string, authorizationCode: string): Promise<void> {
    const clientInfo = this.outboundConns.get(serverName);
    if (!clientInfo) {
      throw new ClientNotFoundError(serverName);
    }

    const oldTransport = clientInfo.transport;
    const newTransport = this.transportRecreator.recreateHttpTransport(oldTransport, serverName);

    const updatedInfo = await this.oauthFlowHandler.completeOAuthAndReconnect(
      serverName,
      oldTransport,
      newTransport,
      authorizationCode,
      clientInfo,
    );

    this.outboundConns.set(serverName, updatedInfo);
    this.transports[serverName] = newTransport;

    this.extractAndCacheInstructions(serverName, updatedInfo.client);
    this.setupConnectionHandlers(serverName, updatedInfo.client);
  }

  public async executeClientOperation<T>(
    clientName: string,
    operation: (clientInfo: OutboundConnection) => Promise<T>,
    options: OperationOptions = {},
    requiredCapability?: ServerCapability,
  ): Promise<T> {
    const outboundConn = this.getClient(clientName);

    if (outboundConn.status !== ClientStatus.Connected || !outboundConn.client.transport) {
      throw new ClientConnectionError(clientName, new Error('Client not connected'));
    }

    if (requiredCapability && !outboundConn.capabilities?.[requiredCapability]) {
      throw new CapabilityError(clientName, String(requiredCapability));
    }

    return executeOperation(() => operation(outboundConn), `client ${clientName}`, options);
  }

  public createClientInstance(): Client {
    return this.clientFactory.createClientInstance();
  }

  public createPooledClientInstance(): Client {
    return this.clientFactory.createPooledClientInstance();
  }

  public async removeClient(name: string): Promise<void> {
    const clientInfo = this.outboundConns.get(name);
    if (!clientInfo) {
      return;
    }

    logger.info(`Removing client ${name}...`);

    try {
      if (clientInfo.transport) {
        try {
          await clientInfo.transport.close();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.warn(`Error closing transport for ${name}: ${errorMessage}`, {
            error: errorMessage,
            clientName: name,
            transportType: clientInfo.transport?.constructor.name,
          });
        }
      }

      this.outboundConns.delete(name);
      delete this.transports[name];
      this.instructionAggregator?.removeServer(name);

      logger.info(`Client ${name} removed successfully`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error removing client ${name}: ${errorMessage}`, {
        error: errorMessage,
        clientName: name,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }
}

export default ClientManager;
