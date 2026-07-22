import { EventEmitter } from 'node:events';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { MCP_SERVER_NAME } from '@src/constants.js';
import { DEFAULT_MAX_CONCURRENT_LOADS } from '@src/constants/mcp.js';
import { InstructionAggregator } from '@src/core/instructions/instructionAggregator.js';
import { ParallelExecutor } from '@src/core/loading/parallelExecutor.js';
import { BackendStdioSupervisor, type BackendSupervisionSnapshot } from '@src/core/server/backendStdioSupervisor.js';
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
import { getConnectionTimeout } from '@src/utils/core/timeoutUtils.js';

import { ClientFactory } from './clientFactory.js';
import type { ConnectedClient } from './connectedClient.js';
import { ConnectionHandler } from './connectionHandler.js';
import { OAuthFlowHandler } from './oauthFlowHandler.js';
import { TransportRecreator } from './transportRecreator.js';
import { OAuthRequiredError } from './types.js';

export { OAuthRequiredError };

export const enum ClientManagerEvent {
  BackendSupervisionStateChanged = 'backend-supervision-state-changed',
}

type StdioSupervisionMetadata = NonNullable<AuthProviderTransport['stdioSupervision']>;

export class ClientManager extends EventEmitter {
  private static instance: ClientManager;
  private outboundConns: OutboundConnections = new Map();
  private transports: Record<string, AuthProviderTransport> = {};
  private connectionSemaphore: Map<string, Promise<void>> = new Map();
  private bulkConnectionOperations = new Set<Promise<unknown>>();
  private instructionAggregator?: InstructionAggregator;
  private clientFactory: ClientFactory;
  private connectionHandler: ConnectionHandler;
  private oauthFlowHandler: OAuthFlowHandler;
  private transportRecreator: TransportRecreator;
  private backendSupervisors = new Map<string, BackendStdioSupervisor>();
  private backendAvailabilityHandler?: (name: string, snapshot: BackendSupervisionSnapshot) => void | Promise<void>;
  private isShuttingDown = false;
  private shutdownPromise?: Promise<void>;

  private constructor() {
    super();
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

  public static async shutdownCurrent(): Promise<void> {
    await ClientManager.instance?.shutdown();
  }

  public setInstructionAggregator(aggregator: InstructionAggregator): void {
    this.instructionAggregator = aggregator;
  }

  public setBackendAvailabilityHandler(
    handler: (name: string, snapshot: BackendSupervisionSnapshot) => void | Promise<void>,
  ): void {
    this.backendAvailabilityHandler = handler;
  }

  private extractAndCacheInstructions(name: string, client: Client): void {
    try {
      const instructions = client.getInstructions();
      const connectionInfo = this.outboundConns.get(name);
      if (connectionInfo) {
        connectionInfo.instructions = instructions;
      }

      // Use clean name from connection object for instruction aggregation
      // Template servers use hash-based keys (e.g., "serena:6fa053f1...") but we want
      // to display the clean name (e.g., "serena") in instructions
      const cleanName = connectionInfo?.name || name;

      if (this.instructionAggregator) {
        this.instructionAggregator.setInstructions(cleanName, instructions);
      }

      if (instructions?.trim()) {
        debugIf(() => ({
          message: `Cached instructions for ${cleanName}: ${instructions.length} characters`,
          meta: { name: cleanName, instructionLength: instructions.length },
        }));
      } else {
        debugIf(() => ({ message: `No instructions available for ${cleanName}`, meta: { name: cleanName } }));
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
      if (this.isShuttingDown) {
        return;
      }

      const clientInfo = this.outboundConns.get(name);
      if (!clientInfo || clientInfo.client !== client) {
        return;
      }

      const supervision = clientInfo.transport.stdioSupervision;
      if (supervision) {
        this.getOrCreateBackendSupervisor(name, supervision).handleUnexpectedExit(
          supervision.getLastExit() ?? {
            code: null,
            signal: null,
            pid: this.getTransportPid(clientInfo.transport),
            at: new Date(),
          },
        );
        return;
      }

      if (clientInfo) {
        clientInfo.status = ClientStatus.Disconnected;
      }
      // Use cleanName for removal to match the key used during caching
      const cleanName = clientInfo?.name || name;
      this.instructionAggregator?.removeServer(cleanName);
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
    this.assertActive();
    this.transports = transports;
    this.outboundConns.clear();

    const executor = new ParallelExecutor<[string, AuthProviderTransport], void>();
    const serverEntries = Object.entries(transports);
    const initialCount = serverEntries.length;

    const bulkOperation = executor.execute(
      serverEntries,
      async ([name, transport]) => this.createClient(name, transport),
      {
        maxConcurrent: DEFAULT_MAX_CONCURRENT_LOADS,
      },
    );
    this.bulkConnectionOperations.add(bulkOperation);
    try {
      await bulkOperation;
    } finally {
      this.bulkConnectionOperations.delete(bulkOperation);
    }

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
    if (this.isShuttingDown) {
      return;
    }
    try {
      const client = this.clientFactory.createClient();
      const connected = await this.connectionHandler.connectWithRetry(client, transport, name, undefined, (t) =>
        this.transportRecreator.recreateForRetry(t, name),
      );
      if (this.isShuttingDown) {
        await this.disposeConnectedClient(connected);
        return;
      }
      this.recordConnectedClient(name, connected);
    } catch (error) {
      if (this.isShuttingDown) {
        return;
      }
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
    this.assertActive();
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
    const attemptTransport = this.prepareTransportForAttempt(name, transport);
    this.transports[name] = attemptTransport;

    try {
      if (abortSignal?.aborted) {
        throw new Error(`Operation aborted: ${abortSignal.reason || 'Request cancelled'}`);
      }

      const client = this.clientFactory.createClient();
      const connected = await this.connectionHandler.connectWithRetry(
        client,
        attemptTransport,
        name,
        abortSignal,
        (t) => this.transportRecreator.recreateForRetry(t, name),
      );
      if (this.isShuttingDown) {
        await this.disposeConnectedClient(connected);
        throw new Error('ClientManager is shutting down');
      }
      this.recordConnectedClient(name, connected);
    } catch (error) {
      if (this.isShuttingDown) {
        throw error;
      }
      this.handleSingleClientError(name, attemptTransport, error);
      throw error;
    }
  }

  private prepareTransportForAttempt(name: string, requestedTransport: AuthProviderTransport): AuthProviderTransport {
    const previousConnection = this.outboundConns.get(name);
    if (previousConnection?.status !== ClientStatus.Error) {
      return requestedTransport;
    }

    return this.transportRecreator.recreateForRetry(requestedTransport, name);
  }

  private recordConnectedClient(name: string, connected: ConnectedClient): void {
    const supervision = this.backendSupervisors.get(name)?.snapshot();
    this.transports[name] = connected.transport;
    this.outboundConns.set(name, {
      name,
      transport: connected.transport,
      client: connected.client,
      status: ClientStatus.Connected,
      lastConnected: new Date(),
      capabilities: connected.client.getServerCapabilities?.(),
      supervision,
    });
    logger.info(`Client created for ${name}`);
    this.extractAndCacheInstructions(name, connected.client);
    this.setupConnectionHandlers(name, connected.client);

    const metadata = connected.transport.stdioSupervision;
    if (metadata) {
      const supervisor = this.getOrCreateBackendSupervisor(name, metadata);
      this.applyBackendSupervisionState(name, supervisor.snapshot());
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
    this.assertActive();
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
    this.assertActive();
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

    if (this.isShuttingDown) {
      updatedInfo.client.onclose = undefined;
      await updatedInfo.client.close().catch(() => updatedInfo.transport.close().catch(() => undefined));
      throw new Error('ClientManager is shutting down');
    }

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
      const supervisor = this.backendSupervisors.get(name);
      if (supervisor) {
        await supervisor.stop();
        this.backendSupervisors.delete(name);
      }
      clientInfo.client.onclose = undefined;
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

  public async restartBackend(name: string): Promise<BackendSupervisionSnapshot> {
    this.assertActive();
    const connection = this.getClient(name);
    const metadata = connection.transport.stdioSupervision;
    if (!metadata) {
      throw new ClientConnectionError(name, new Error('Backend stdio supervision is not enabled'));
    }

    const supervisor = this.getOrCreateBackendSupervisor(name, metadata);
    await supervisor.restartNow();
    return supervisor.snapshot();
  }

  public getBackendSupervision(name: string): BackendSupervisionSnapshot | undefined {
    return this.backendSupervisors.get(name)?.snapshot();
  }

  public publishBackendSupervisionState(name: string, snapshot: BackendSupervisionSnapshot): void {
    this.applyBackendSupervisionState(name, snapshot);
  }

  public async shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.isShuttingDown = true;
    this.shutdownPromise = this.performShutdown();
    return this.shutdownPromise;
  }

  private async performShutdown(): Promise<void> {
    const supervisors = Array.from(this.backendSupervisors.values());
    await Promise.allSettled(supervisors.map((supervisor) => supervisor.stop()));
    this.backendSupervisors.clear();

    // Initial connections are not supervisor-owned. Wait for both loading paths
    // to observe the shutdown gate and dispose their just-connected clients
    // before clearing the shared maps.
    await Promise.allSettled([
      ...Array.from(this.connectionSemaphore.values()),
      ...Array.from(this.bulkConnectionOperations),
    ]);

    const connections = Array.from(this.outboundConns.entries());
    for (const [, connection] of connections) {
      connection.client.onclose = undefined;
    }

    await Promise.allSettled(
      connections.map(async ([name, connection]) => {
        try {
          await connection.client.close();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.warn(`Error closing client during shutdown for ${name}: ${errorMessage}`);
          await connection.transport.close().catch(() => undefined);
        }
        this.instructionAggregator?.removeServer(connection.name);
      }),
    );

    this.outboundConns.clear();
    this.transports = {};
    this.connectionSemaphore.clear();
    this.bulkConnectionOperations.clear();
    this.backendAvailabilityHandler = undefined;
    logger.info('ClientManager shutdown complete');
  }

  private getOrCreateBackendSupervisor(name: string, metadata: StdioSupervisionMetadata): BackendStdioSupervisor {
    this.assertActive();
    const existing = this.backendSupervisors.get(name);
    if (existing) {
      return existing;
    }

    const supervisor = new BackendStdioSupervisor({
      backendId: `static:${name}`,
      policy: metadata.policy,
      initialPid: (this.outboundConns.get(name)?.transport as AuthProviderTransport & { pid?: number }).pid ?? null,
      recover: (signal) => this.recoverSupervisedBackend(name, metadata, signal),
      onStateChange: (snapshot) => this.applyBackendSupervisionState(name, snapshot),
    });
    this.backendSupervisors.set(name, supervisor);
    return supervisor;
  }

  private async recoverSupervisedBackend(
    name: string,
    metadata: StdioSupervisionMetadata,
    signal: AbortSignal,
  ): Promise<{ pid: number | null; activate: () => void; dispose: () => Promise<void> }> {
    const current = this.outboundConns.get(name);
    if (current) {
      current.client.onclose = undefined;
      try {
        await current.client.close();
      } catch (error) {
        debugIf(() => ({ message: `Could not close previous supervised client ${name}: ${error}` }));
      }
    }

    if (signal.aborted) {
      throw new Error(`Backend recovery cancelled for ${name}`);
    }

    const transport = metadata.recreate() as AuthProviderTransport;
    const client = this.clientFactory.createClient();
    const dispose = async (): Promise<void> => {
      client.onclose = undefined;
      try {
        await client.close();
      } catch {
        await transport.close().catch(() => undefined);
      }
    };

    try {
      const timeout = getConnectionTimeout(transport);
      await client.connect(transport, timeout ? { timeout } : undefined);
      const serverVersion = await client.getServerVersion();
      if (serverVersion?.name === MCP_SERVER_NAME) {
        throw new ClientConnectionError(name, new Error('Aborted to prevent circular dependency'));
      }
      if (signal.aborted) {
        throw new Error(`Backend recovery cancelled for ${name}`);
      }

      return {
        pid: this.getTransportPid(transport),
        activate: () => this.recordConnectedClient(name, { client, transport }),
        dispose,
      };
    } catch (error) {
      await dispose();
      throw error;
    }
  }

  private applyBackendSupervisionState(name: string, snapshot: BackendSupervisionSnapshot): void {
    const connection = this.outboundConns.get(name);
    if (connection) {
      connection.supervision = snapshot;
      logger.info(`Backend stdio supervision state changed for ${name}`, {
        backendId: snapshot.backendId,
        state: snapshot.state,
        attempt: snapshot.attempt,
        limit: snapshot.limit,
        nextRetryAt: snapshot.nextRetryAt,
        lastExit: snapshot.lastExit,
        currentPid: snapshot.currentPid,
        error: snapshot.lastError?.message,
      });
      if (snapshot.state === 'restarting') {
        connection.status = ClientStatus.Restarting;
        connection.capabilities = undefined;
        connection.instructions = undefined;
        if (snapshot.backendId.startsWith('static:')) {
          this.instructionAggregator?.removeServer(connection.name);
        }
      } else if (snapshot.state === 'crash-loop') {
        connection.status = ClientStatus.CrashLoop;
        connection.capabilities = undefined;
        connection.instructions = undefined;
        if (snapshot.backendId.startsWith('static:')) {
          this.instructionAggregator?.removeServer(connection.name);
        }
      } else if (snapshot.state === 'connected') {
        connection.status = ClientStatus.Connected;
      }
    }
    this.emit(ClientManagerEvent.BackendSupervisionStateChanged, name, snapshot);
    void this.backendAvailabilityHandler?.(name, snapshot);
  }

  private getTransportPid(transport: AuthProviderTransport): number | null {
    return (transport as AuthProviderTransport & { pid?: number | null }).pid ?? null;
  }

  private assertActive(): void {
    if (this.isShuttingDown) {
      throw new Error('ClientManager is shutting down');
    }
  }

  private async disposeConnectedClient(connected: ConnectedClient): Promise<void> {
    connected.client.onclose = undefined;
    try {
      await connected.client.close();
    } catch {
      await connected.transport.close().catch(() => undefined);
    }
  }
}

export default ClientManager;
