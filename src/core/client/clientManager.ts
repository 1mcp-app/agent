import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import logger from '../../logger/logger.js';
import { CONNECTION_RETRY, MCP_SERVER_NAME, MCP_SERVER_VERSION, MCP_CLIENT_CAPABILITIES } from '../../constants.js';
import { ClientConnectionError, ClientNotFoundError, CapabilityError } from '../../utils/errorTypes.js';
import {
  ClientStatus,
  OutboundConnection,
  OutboundConnections,
  OperationOptions,
  ServerCapability,
  AuthProviderTransport,
} from '../types/index.js';
import { AgentConfigManager } from '../server/agentConfig.js';
import { executeOperation } from '../../utils/operationExecution.js';
import { InstructionAggregator } from '../instructions/instructionAggregator.js';

export class ClientManager {
  private static instance: ClientManager;
  private outboundConns: OutboundConnections = new Map();
  private transports: Record<string, AuthProviderTransport> = {};
  private connectionSemaphore: Map<string, Promise<void>> = new Map();
  private instructionAggregator?: InstructionAggregator;

  private constructor() {}

  public static getOrCreateInstance(): ClientManager {
    if (!ClientManager.instance) {
      ClientManager.instance = new ClientManager();
    }
    return ClientManager.instance;
  }

  public static get current(): ClientManager {
    return ClientManager.instance;
  }

  // Test utility method to reset singleton state
  public static resetInstance(): void {
    ClientManager.instance = undefined as any;
  }

  /**
   * Set the instruction aggregator instance
   * @param aggregator The instruction aggregator to use
   */
  public setInstructionAggregator(aggregator: InstructionAggregator): void {
    this.instructionAggregator = aggregator;
  }

  /**
   * Extract and cache instructions from a connected client
   * @param name The client name
   * @param client The connected client instance
   */
  private extractAndCacheInstructions(name: string, client: Client): void {
    try {
      const instructions = client.getInstructions();

      // Update the connection info with instructions
      const connectionInfo = this.outboundConns.get(name);
      if (connectionInfo) {
        connectionInfo.instructions = instructions;
      }

      // Update the instruction aggregator if available
      if (this.instructionAggregator) {
        this.instructionAggregator.setInstructions(name, instructions);
      }

      if (instructions?.trim()) {
        logger.debug(`Cached instructions for ${name}: ${instructions.length} characters`);
      } else {
        logger.debug(`No instructions available for ${name}`);
      }
    } catch (error) {
      logger.warn(`Failed to extract instructions from ${name}: ${error}`);
    }
  }

  /**
   * Creates a new MCP client instance
   * @returns A new Client instance
   */
  private createClient(): Client {
    return new Client(
      {
        name: MCP_SERVER_NAME,
        version: MCP_SERVER_VERSION,
      },
      {
        capabilities: MCP_CLIENT_CAPABILITIES,
      },
    );
  }

  /**
   * Creates a new MCP client instance for external use (e.g., OAuth testing)
   * @returns A new Client instance
   */
  public createClientInstance(): Client {
    return this.createClient();
  }

  /**
   * Creates client instances for all transports with retry logic
   * @param transports Record of transport instances
   * @returns Record of client instances
   */
  public async createClients(transports: Record<string, AuthProviderTransport>): Promise<OutboundConnections> {
    this.transports = transports;
    this.outboundConns.clear();

    for (const [name, transport] of Object.entries(transports)) {
      logger.info(`Creating client for ${name}`);
      try {
        const client = this.createClient();

        // Connect with retry logic
        const connectedClient = await this.connectWithRetry(client, transport, name);

        this.outboundConns.set(name, {
          name,
          transport,
          client: connectedClient,
          status: ClientStatus.Connected,
          lastConnected: new Date(),
        });
        logger.info(`Client created for ${name}`);

        // Extract and cache instructions after successful connection
        this.extractAndCacheInstructions(name, connectedClient);

        connectedClient.onclose = () => {
          const clientInfo = this.outboundConns.get(name);
          if (clientInfo) {
            clientInfo.status = ClientStatus.Disconnected;
          }
          // Remove instructions from aggregator when client disconnects
          if (this.instructionAggregator) {
            this.instructionAggregator.removeServer(name);
          }
          logger.info(`Client ${name} disconnected`);
        };

        connectedClient.onerror = (error) => {
          logger.error(`Client ${name} error: ${error}`);
        };
      } catch (error) {
        if (error instanceof OAuthRequiredError) {
          // Handle OAuth required - set client to AwaitingOAuth status
          logger.info(`OAuth authorization required for ${name}`);

          // Try to get authorization URL from OAuth provider
          let authorizationUrl: string | undefined;
          try {
            // Extract OAuth provider from transport if available
            const oauthProvider = transport.oauthProvider;
            if (oauthProvider && typeof oauthProvider.getAuthorizationUrl === 'function') {
              authorizationUrl = oauthProvider.getAuthorizationUrl();
            }
          } catch (urlError) {
            logger.warn(`Could not extract authorization URL for ${name}:`, urlError);
          }

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
            client: this.createClient(),
            status: ClientStatus.Error,
            lastError: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }
    }

    return this.outboundConns;
  }

  /**
   * Connects a client to its transport with retry logic and OAuth support
   * @param client The client to connect
   * @param transport The transport to connect to
   * @param name The name of the client for logging
   * @returns The connected client (may be a new instance after retries)
   */
  private async connectWithRetry(
    client: Client,
    transport: Transport,
    name: string,
    abortSignal?: AbortSignal,
  ): Promise<Client> {
    let retryDelay = CONNECTION_RETRY.INITIAL_DELAY_MS;
    let currentClient = client;

    for (let i = 0; i < CONNECTION_RETRY.MAX_ATTEMPTS; i++) {
      try {
        // Check if operation was aborted before each attempt
        if (abortSignal?.aborted) {
          throw new Error(`Connection aborted: ${abortSignal.reason || 'Request cancelled'}`);
        }

        await currentClient.connect(transport);

        const sv = await currentClient.getServerVersion();
        if (sv?.name === MCP_SERVER_NAME) {
          throw new ClientConnectionError(name, new Error('Aborted to prevent circular dependency'));
        }

        logger.info(`Successfully connected to ${name} with server ${sv?.name} version ${sv?.version}`);
        return currentClient;
      } catch (error) {
        // Handle OAuth authorization flow (managed by SDK)
        if (error instanceof UnauthorizedError) {
          const configManager = AgentConfigManager.getInstance();
          logger.info(`OAuth authorization required for ${name}. Visit ${configManager.getUrl()}/oauth to authorize`);

          // Throw special error that includes OAuth info
          throw new OAuthRequiredError(name, currentClient);
        }
        // Handle other connection errors
        else {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error(`Failed to connect to ${name}: ${errorMessage}`);

          if (i < CONNECTION_RETRY.MAX_ATTEMPTS - 1) {
            logger.info(`Retrying in ${retryDelay}ms...`);

            // Implement cancellable delay
            await new Promise<void>((resolve, reject) => {
              const timeoutId = setTimeout(resolve, retryDelay);

              if (abortSignal) {
                const abortHandler = () => {
                  clearTimeout(timeoutId);
                  reject(new Error(`Connection retry aborted: ${abortSignal.reason || 'Request cancelled'}`));
                };

                if (abortSignal.aborted) {
                  clearTimeout(timeoutId);
                  reject(new Error(`Connection retry aborted: ${abortSignal.reason || 'Request cancelled'}`));
                } else {
                  abortSignal.addEventListener('abort', abortHandler, { once: true });
                }
              }
            });

            retryDelay *= 2; // Exponential backoff

            // Create a new client for retry to avoid "already started" errors
            currentClient = this.createClient();
          } else {
            throw new ClientConnectionError(name, error instanceof Error ? error : new Error(String(error)));
          }
        }
      }
    }

    // This should never be reached due to the throw in the else block above
    throw new ClientConnectionError(name, new Error('Max retries exceeded'));
  }

  /**
   * Gets a client by name with error handling
   * @param clientName The name of the client to get
   * @returns The client instance
   * @throws ClientNotFoundError if the client is not found
   */
  public getClient(clientName: string): OutboundConnection {
    const client = this.outboundConns.get(clientName);
    if (!client) {
      throw new ClientNotFoundError(clientName);
    }
    return client;
  }

  /**
   * Gets all outbound connections
   * @returns Map of all outbound connections
   */
  public getClients(): OutboundConnections {
    return this.outboundConns;
  }

  /**
   * Creates a single client for async loading (used by McpLoadingManager)
   * @param name The name of the client
   * @param transport The transport to connect to
   * @param abortSignal Optional AbortSignal to cancel the operation
   * @returns Promise that resolves when client is connected
   */
  public async createSingleClient(
    name: string,
    transport: AuthProviderTransport,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    // Prevent concurrent creation of the same client
    const existingPromise = this.connectionSemaphore.get(name);
    if (existingPromise) {
      await existingPromise;
      return;
    }

    // Check if operation was aborted before starting
    if (abortSignal?.aborted) {
      throw new Error(`Operation aborted: ${abortSignal.reason || 'Request cancelled'}`);
    }

    // Create connection promise
    const connectionPromise = this.createSingleClientInternal(name, transport, abortSignal);
    this.connectionSemaphore.set(name, connectionPromise);

    try {
      await connectionPromise;
    } finally {
      this.connectionSemaphore.delete(name);
    }
  }

  /**
   * Internal method to create and connect a single client
   */
  private async createSingleClientInternal(
    name: string,
    transport: AuthProviderTransport,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    logger.info(`Creating client for ${name}`);

    // Store transport reference
    this.transports[name] = transport;

    try {
      // Check if operation was aborted
      if (abortSignal?.aborted) {
        throw new Error(`Operation aborted: ${abortSignal.reason || 'Request cancelled'}`);
      }

      const client = this.createClient();

      // Connect with retry logic
      const connectedClient = await this.connectWithRetry(client, transport, name, abortSignal);

      this.outboundConns.set(name, {
        name,
        transport,
        client: connectedClient,
        status: ClientStatus.Connected,
        lastConnected: new Date(),
      });
      logger.info(`Client created for ${name}`);

      // Extract and cache instructions after successful connection
      this.extractAndCacheInstructions(name, connectedClient);

      connectedClient.onclose = () => {
        const clientInfo = this.outboundConns.get(name);
        if (clientInfo) {
          clientInfo.status = ClientStatus.Disconnected;
        }
        // Remove instructions from aggregator when client disconnects
        if (this.instructionAggregator) {
          this.instructionAggregator.removeServer(name);
        }
        logger.info(`Client ${name} disconnected`);
      };

      connectedClient.onerror = (error) => {
        logger.error(`Client ${name} error: ${error}`);
      };
    } catch (error) {
      if (error instanceof OAuthRequiredError) {
        // Handle OAuth required - set client to AwaitingOAuth status
        logger.info(`OAuth authorization required for ${name}`);

        // Try to get authorization URL from OAuth provider
        let authorizationUrl: string | undefined;
        try {
          // Extract OAuth provider from transport if available
          const oauthProvider = transport.oauthProvider;
          if (oauthProvider && typeof oauthProvider.getAuthorizationUrl === 'function') {
            authorizationUrl = oauthProvider.getAuthorizationUrl();
          }
        } catch (urlError) {
          logger.warn(`Could not extract authorization URL for ${name}:`, urlError);
        }

        this.outboundConns.set(name, {
          name,
          transport,
          client: error.client,
          status: ClientStatus.AwaitingOAuth,
          authorizationUrl,
          oauthStartTime: new Date(),
        });

        // Re-throw OAuth error for loading manager to handle
        throw error;
      } else {
        logger.error(`Failed to create client for ${name}: ${error}`);
        this.outboundConns.set(name, {
          name,
          transport,
          client: this.createClient(),
          status: ClientStatus.Error,
          lastError: error instanceof Error ? error : new Error(String(error)),
        });

        // Re-throw error for loading manager to handle
        throw error;
      }
    }
  }

  /**
   * Initialize clients storage without connecting (for async loading)
   * @param transports Record of transport instances
   * @returns Empty connections map (to be populated by async loading)
   */
  public initializeClientsAsync(transports: Record<string, AuthProviderTransport>): OutboundConnections {
    this.transports = transports;
    this.outboundConns.clear();

    logger.info(`Initialized client storage for ${Object.keys(transports).length} transports`);
    return this.outboundConns;
  }

  /**
   * Get transport by name (used by loading manager for retries)
   * @param name The transport name
   * @returns The transport instance or undefined
   */
  public getTransport(name: string): AuthProviderTransport | undefined {
    return this.transports[name];
  }

  /**
   * Get all transport names
   * @returns Array of transport names
   */
  public getTransportNames(): string[] {
    return Object.keys(this.transports);
  }

  /**
   * Executes a client operation with error handling and retry logic
   * @param clientName The name of the client to use
   * @param operation The operation to execute
   * @param options Operation options including timeout and retry settings
   * @param requiredCapability The capability required for this operation
   */
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
}

/**
 * Custom error class for OAuth authorization required
 */
export class OAuthRequiredError extends Error {
  constructor(
    public serverName: string,
    public client: Client,
  ) {
    super(`OAuth authorization required for ${serverName}`);
    this.name = 'OAuthRequiredError';
  }
}
