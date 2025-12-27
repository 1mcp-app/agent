import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { InstructionAggregator } from '@src/core/instructions/instructionAggregator.js';
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
      logger.warn(`Failed to extract instructions from ${name}: ${error}`);
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

  public async createClients(transports: Record<string, AuthProviderTransport>): Promise<OutboundConnections> {
    this.transports = transports;
    this.outboundConns.clear();

    for (const [name, transport] of Object.entries(transports)) {
      await this.createClient(name, transport);
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
      logger.info(`OAuth authorization required for ${name}`);
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
      logger.error(`Failed to create client for ${name}: ${error}`);
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
      logger.info(`OAuth authorization required for ${name}`);
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
      logger.error(`Failed to create client for ${name}: ${error}`);
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
          logger.warn(`Error closing transport for ${name}: ${error}`);
        }
      }

      this.outboundConns.delete(name);
      delete this.transports[name];
      this.instructionAggregator?.removeServer(name);

      logger.info(`Client ${name} removed successfully`);
    } catch (error) {
      logger.error(`Error removing client ${name}: ${error}`);
      throw error;
    }
  }
}

export default ClientManager;
