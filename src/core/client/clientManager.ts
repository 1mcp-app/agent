import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { CONNECTION_RETRY, MCP_CLIENT_CAPABILITIES, MCP_SERVER_NAME, MCP_SERVER_VERSION } from '@src/constants.js';
import { InstructionAggregator } from '@src/core/instructions/instructionAggregator.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
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
        debouncedNotificationMethods: [
          'notifications/tools/list_changed',
          'notifications/resources/list_changed',
          'notifications/prompts/list_changed',
        ],
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
   * @param abortSignal Optional abort signal to cancel the operation
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
    let currentTransport = transport;

    for (let i = 0; i < CONNECTION_RETRY.MAX_ATTEMPTS; i++) {
      try {
        // Check if operation was aborted before each attempt
        if (abortSignal?.aborted) {
          throw new Error(`Connection aborted: ${abortSignal.reason || 'Request cancelled'}`);
        }

        // Connect with timeout from transport config
        // Priority: connectionTimeout > timeout (deprecated fallback)
        const authTransport = currentTransport as AuthProviderTransport;
        const timeout = authTransport.connectionTimeout ?? authTransport.timeout;
        await currentClient.connect(currentTransport, timeout ? { timeout } : undefined);

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

            // Clean up failed transport
            try {
              await currentTransport.close();
            } catch (closeError) {
              debugIf(() => ({ message: `Error closing transport during retry: ${closeError}` }));
            }

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

            // For HTTP/SSE transports, we need to recreate both client and transport
            // because these transports cannot be restarted once started
            if (
              currentTransport instanceof StreamableHTTPClientTransport ||
              currentTransport instanceof SSEClientTransport
            ) {
              currentTransport = this.recreateHttpTransport(currentTransport as AuthProviderTransport);
              currentClient = this.createClient();
            } else {
              // For STDIO transports, we can reuse the transport but need a new client
              currentClient = this.createClient();
            }
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
   * Recreates an HTTP or SSE transport with the same configuration
   * This is necessary because HTTP transports cannot be restarted once started
   * @param transport The original transport to recreate
   * @returns A new transport instance with the same configuration
   */
  private recreateHttpTransport(transport: AuthProviderTransport): AuthProviderTransport {
    // Type guard for HTTP-based transports
    if (!(transport instanceof StreamableHTTPClientTransport) && !(transport instanceof SSEClientTransport)) {
      throw new Error('Transport recreation only supported for HTTP and SSE transports');
    }

    // Extract URL with proper typing
    type TransportWithUrl = { _url: URL };
    const transportUrl = (transport as unknown as TransportWithUrl)._url;

    // Get OAuth provider from AuthProviderTransport
    const authTransport = transport as AuthProviderTransport;
    const oauthProvider = authTransport.oauthProvider;

    // Create new transport based on original type
    let newTransport: AuthProviderTransport;
    if (transport instanceof StreamableHTTPClientTransport) {
      const httpTransport = new StreamableHTTPClientTransport(transportUrl, {
        authProvider: oauthProvider,
      });
      newTransport = httpTransport as AuthProviderTransport;
    } else {
      const sseTransport = new SSEClientTransport(transportUrl, {
        authProvider: oauthProvider,
      });
      newTransport = sseTransport as AuthProviderTransport;
    }

    // Copy transport properties from AuthProviderTransport
    newTransport.oauthProvider = oauthProvider;
    newTransport.connectionTimeout = authTransport.connectionTimeout;
    newTransport.requestTimeout = authTransport.requestTimeout;
    newTransport.timeout = authTransport.timeout; // Keep for backward compatibility
    newTransport.tags = authTransport.tags;

    return newTransport;
  }

  /**
   * Complete OAuth flow and reconnect client with fresh transport
   * This recreates both transport and client since HTTP transports cannot be restarted
   * @param serverName The name of the server to reconnect
   * @param authorizationCode The OAuth authorization code from the callback
   * @throws ClientNotFoundError if the client is not found
   * @throws Error if transport does not support OAuth or reconnection fails
   */
  public async completeOAuthAndReconnect(serverName: string, authorizationCode: string): Promise<void> {
    const clientInfo = this.outboundConns.get(serverName);
    if (!clientInfo) {
      throw new ClientNotFoundError(serverName);
    }

    // Type guard for OAuth-capable transports
    const transport = clientInfo.transport;
    if (!(transport instanceof StreamableHTTPClientTransport) && !(transport instanceof SSEClientTransport)) {
      throw new Error(`Transport for ${serverName} does not support OAuth (requires HTTP or SSE transport)`);
    }

    logger.info(`Completing OAuth and reconnecting ${serverName}...`);

    try {
      // 1. Complete OAuth flow
      await transport.finishAuth(authorizationCode);

      // 2. Close old transport
      await transport.close();

      // 3. Create new transport using helper
      const newTransport = this.recreateHttpTransport(transport);

      // 4. Create and connect new client with timeout
      // Priority: connectionTimeout > timeout (deprecated fallback)
      const newClient = this.createClient();
      const timeout = newTransport.connectionTimeout ?? newTransport.timeout;
      await newClient.connect(newTransport, timeout ? { timeout } : undefined);

      // 5. Discover capabilities
      const capabilities = newClient.getServerCapabilities();

      // 6. Cache instructions
      this.extractAndCacheInstructions(serverName, newClient);

      // 7. Update connection info (create new object to handle readonly properties)
      const updatedInfo: OutboundConnection = {
        name: serverName,
        transport: newTransport,
        client: newClient,
        status: ClientStatus.Connected,
        lastConnected: new Date(),
        capabilities,
        instructions: clientInfo.instructions, // Preserve existing instructions if any
        lastError: undefined,
      };
      this.outboundConns.set(serverName, updatedInfo);

      // 8. Update transports map
      this.transports[serverName] = newTransport;

      logger.info(`OAuth reconnection completed successfully for ${serverName}`);
    } catch (error) {
      logger.error(`OAuth reconnection failed for ${serverName}:`, error);
      throw error;
    }
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
