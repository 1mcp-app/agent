import { EventEmitter } from 'events';

import { ClientManager } from '@src/core/client/clientManager.js';
import { AuthProviderTransport, OutboundConnections } from '@src/core/types/index.js';
import logger, { debugIf } from '@src/logger/logger.js';

import {
  LoadingState,
  LoadingStateEvent,
  LoadingStateTracker,
  LoadingSummary,
  ServerLoadingInfo,
} from './loadingStateTracker.js';

/**
 * Configuration options for MCP loading behavior
 */
export interface McpLoadingConfig {
  /** Maximum time to wait for each server (ms) */
  readonly serverTimeoutMs: number;
  /** Maximum number of retry attempts per server */
  readonly maxRetries: number;
  /** Initial delay between retries (ms) */
  readonly retryDelayMs: number;
  /** Maximum number of servers to initialize concurrently */
  readonly maxConcurrentLoads: number;
  /** Whether to continue loading other servers if some fail */
  readonly continueOnFailure: boolean;
  /** Whether to enable background retry for failed servers */
  readonly enableBackgroundRetry: boolean;
  /** Interval for background retry attempts (ms) */
  readonly backgroundRetryIntervalMs: number;
}

/**
 * Default configuration for MCP loading
 */
export const DEFAULT_LOADING_CONFIG: McpLoadingConfig = {
  serverTimeoutMs: 30000, // 30 seconds per server
  maxRetries: 3,
  retryDelayMs: 2000, // 2 seconds initial delay
  maxConcurrentLoads: 5, // Load 5 servers at once
  continueOnFailure: true,
  enableBackgroundRetry: true,
  backgroundRetryIntervalMs: 60000, // Retry every minute
};

/**
 * Result of loading a specific server
 */
export interface ServerLoadResult {
  readonly name: string;
  readonly success: boolean;
  readonly error?: Error;
  readonly duration: number;
  readonly retryCount: number;
}

/**
 * Events emitted by McpLoadingManager
 */
export const enum McpLoadingEvent {
  LoadingStarted = 'loading-started',
  ServerLoading = 'server-loading',
  ServerLoaded = 'server-loaded',
  ServerFailed = 'server-failed',
  OAuthRequired = 'oauth-required',
  LoadingProgress = 'loading-progress',
  LoadingComplete = 'loading-complete',
  BackgroundRetry = 'background-retry',
}

export interface McpLoadingEvents {
  [McpLoadingEvent.LoadingStarted]: (serverNames: string[]) => void;
  [McpLoadingEvent.ServerLoading]: (name: string) => void;
  [McpLoadingEvent.ServerLoaded]: (name: string, result: ServerLoadResult) => void;
  [McpLoadingEvent.ServerFailed]: (name: string, result: ServerLoadResult) => void;
  [McpLoadingEvent.OAuthRequired]: (name: string, authUrl?: string) => void;
  [McpLoadingEvent.LoadingProgress]: (summary: LoadingSummary) => void;
  [McpLoadingEvent.LoadingComplete]: (summary: LoadingSummary) => void;
  [McpLoadingEvent.BackgroundRetry]: (name: string, attempt: number) => void;
}

/**
 * Manages asynchronous loading of MCP servers without blocking HTTP server startup
 *
 * This manager coordinates the initialization of multiple MCP servers in parallel,
 * provides real-time status updates, and handles retries and error recovery.
 * The HTTP server can start immediately while this manager loads servers in the background.
 *
 * @example
 * ```typescript
 * const manager = new McpLoadingManager(clientManager, config);
 * manager.on(McpLoadingEvent.LoadingComplete, (summary) => {
 *   console.log(`${summary.ready}/${summary.totalServers} servers ready`);
 * });
 *
 * // Start loading asynchronously
 * const loadingPromise = manager.startAsyncLoading(transports);
 *
 * // HTTP server can start immediately
 * const expressServer = new ExpressServer(serverManager);
 * expressServer.start();
 *
 * // Optionally wait for loading to complete
 * await loadingPromise;
 * ```
 */
export class McpLoadingManager extends EventEmitter {
  private clientManager: ClientManager;
  private config: McpLoadingConfig;
  private stateTracker: LoadingStateTracker;
  private loadingSemaphore: Map<string, Promise<ServerLoadResult>> = new Map();
  private backgroundRetryTimer?: ReturnType<typeof setTimeout>;
  private isShuttingDown: boolean = false;
  private abortControllers: Map<string, AbortController> = new Map();

  constructor(clientManager: ClientManager, config: Partial<McpLoadingConfig> = {}) {
    super();
    this.clientManager = clientManager;
    this.config = { ...DEFAULT_LOADING_CONFIG, ...config };
    this.stateTracker = new LoadingStateTracker();

    // Forward state tracker events
    this.stateTracker.on(LoadingStateEvent.ServerStateChanged, (name: string, info: ServerLoadingInfo) => {
      if (info.state === LoadingState.Ready) {
        this.emit(McpLoadingEvent.ServerLoaded, name, {
          name,
          success: true,
          duration: info.duration || 0,
          retryCount: info.retryCount,
        });
      } else if (info.state === LoadingState.Failed) {
        this.emit(McpLoadingEvent.ServerFailed, name, {
          name,
          success: false,
          error: info.error,
          duration: info.duration || 0,
          retryCount: info.retryCount,
        });
      } else if (info.state === LoadingState.AwaitingOAuth) {
        this.emit(McpLoadingEvent.OAuthRequired, name, info.authorizationUrl);
      }
    });

    this.stateTracker.on(LoadingStateEvent.LoadingProgress, (summary: LoadingSummary) => {
      this.emit(McpLoadingEvent.LoadingProgress, summary);
    });

    this.stateTracker.on(LoadingStateEvent.LoadingComplete, (summary: LoadingSummary) => {
      this.emit(McpLoadingEvent.LoadingComplete, summary);
      this.setupBackgroundRetry();
    });

    this.setMaxListeners(100); // Allow many listeners
  }

  /**
   * Start asynchronous loading of MCP servers
   * Returns immediately, loading happens in background
   */
  public async startAsyncLoading(transports: Record<string, AuthProviderTransport>): Promise<OutboundConnections> {
    const serverNames = Object.keys(transports);

    if (serverNames.length === 0) {
      logger.info('No MCP servers to load');
      return new Map();
    }

    logger.info(`Starting async loading of ${serverNames.length} MCP servers`);
    this.stateTracker.startLoading(serverNames);
    this.emit(McpLoadingEvent.LoadingStarted, serverNames);

    // Start loading servers with concurrency control
    this.loadServersWithConcurrency(transports);

    // Return current connections (may be empty initially)
    return this.clientManager.getClients();
  }

  /**
   * Load servers with concurrency control
   */
  private async loadServersWithConcurrency(transports: Record<string, AuthProviderTransport>): Promise<void> {
    const serverEntries = Object.entries(transports);
    const semaphore = new Map<string, Promise<void>>();

    // Process servers in batches based on maxConcurrentLoads
    for (let i = 0; i < serverEntries.length; i += this.config.maxConcurrentLoads) {
      const batch = serverEntries.slice(i, i + this.config.maxConcurrentLoads);

      // Start all servers in this batch
      const batchPromises = batch.map(([name, transport]) => {
        const loadPromise = this.loadSingleServer(name, transport);
        semaphore.set(name, loadPromise);
        return loadPromise;
      });

      // Wait for this batch to complete before starting next batch
      await Promise.allSettled(batchPromises);

      // Clean up completed promises
      for (const [name] of batch) {
        semaphore.delete(name);
      }

      if (this.isShuttingDown) {
        logger.info('Loading cancelled due to shutdown');
        break;
      }
    }

    logger.info('Initial server loading phase completed');
  }

  /**
   * Load a single server with retry logic
   */
  private async loadSingleServer(name: string, transport: AuthProviderTransport): Promise<void> {
    if (this.isShuttingDown) return;

    this.emit(McpLoadingEvent.ServerLoading, name);
    this.stateTracker.updateServerState(name, LoadingState.Loading, {
      progress: { phase: 'initializing', message: 'Starting server connection' },
    });

    let lastError: Error | undefined;
    let retryCount = 0;

    while (retryCount <= this.config.maxRetries && !this.isShuttingDown) {
      try {
        this.stateTracker.updateServerState(name, LoadingState.Loading, {
          progress: {
            phase: retryCount > 0 ? 'retrying' : 'connecting',
            message: retryCount > 0 ? `Retry attempt ${retryCount}` : 'Connecting to server',
          },
        });

        // Attempt to create and connect client
        await this.createClientWithTimeout(name, transport);

        // Success!
        this.stateTracker.updateServerState(name, LoadingState.Ready);
        logger.info(`Successfully loaded MCP server: ${name} (${retryCount} retries)`);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        retryCount++;
        this.stateTracker.incrementRetryCount(name);

        // Handle OAuth case specially
        if (lastError.name === 'OAuthRequiredError') {
          logger.info(`OAuth required for ${name}`);
          this.stateTracker.updateServerState(name, LoadingState.AwaitingOAuth, {
            error: lastError,
          });
          return; // Don't retry OAuth errors
        }

        // Handle other errors
        logger.warn(`Failed to load ${name} (attempt ${retryCount}): ${lastError.message}`);

        if (retryCount <= this.config.maxRetries && !this.isShuttingDown) {
          const delay = this.config.retryDelayMs * Math.pow(2, retryCount - 1); // Exponential backoff
          logger.info(`Retrying ${name} in ${delay}ms...`);
          await this.sleep(delay);
        }
      }
    }

    // All retries exhausted
    this.stateTracker.updateServerState(name, LoadingState.Failed, {
      error: lastError || new Error('Unknown error'),
    });

    if (this.config.continueOnFailure) {
      logger.error(`Failed to load ${name} after ${this.config.maxRetries} retries, continuing with other servers`);
    } else {
      logger.error(`Failed to load ${name}, stopping loading process`);
      throw lastError;
    }
  }

  /**
   * Create client with timeout and cancellation support
   */
  private async createClientWithTimeout(name: string, transport: AuthProviderTransport): Promise<void> {
    // Create abort controller for this specific server loading operation
    const abortController = new AbortController();
    this.abortControllers.set(name, abortController);

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        const timeoutId = setTimeout(() => {
          abortController.abort();
          reject(new Error(`Timeout loading ${name} after ${this.config.serverTimeoutMs}ms`));
        }, this.config.serverTimeoutMs);

        // Clear timeout if operation is aborted
        abortController.signal.addEventListener('abort', () => {
          clearTimeout(timeoutId);
          reject(new Error(`Loading ${name} was cancelled`));
        });
      });

      const loadPromise = this.clientManager.createSingleClient(name, transport, abortController.signal);

      await Promise.race([loadPromise, timeoutPromise]);
    } finally {
      // Clean up abort controller
      this.abortControllers.delete(name);
    }
  }

  /**
   * Set up background retry for failed servers
   */
  private setupBackgroundRetry(): void {
    if (!this.config.enableBackgroundRetry || this.isShuttingDown) {
      return;
    }

    this.backgroundRetryTimer = setInterval(() => {
      this.performBackgroundRetry();
    }, this.config.backgroundRetryIntervalMs);

    logger.info('Background retry enabled for failed servers');
  }

  /**
   * Perform background retry for failed servers
   */
  private async performBackgroundRetry(): Promise<void> {
    if (this.isShuttingDown) return;

    const failedServers = this.stateTracker.getServersByState(LoadingState.Failed);

    if (failedServers.length === 0) {
      return;
    }

    logger.info(`Background retry for ${failedServers.length} failed servers`);

    // Retry a subset of failed servers to avoid overwhelming the system
    const serversToRetry = failedServers.slice(0, 3); // Retry max 3 at a time

    for (const serverInfo of serversToRetry) {
      if (this.isShuttingDown) break;

      const transport = this.clientManager.getTransport(serverInfo.name);
      if (transport) {
        this.emit(McpLoadingEvent.BackgroundRetry, serverInfo.name, serverInfo.retryCount + 1);

        // Don't wait for completion, let it run in background
        this.loadSingleServer(serverInfo.name, transport).catch((error: unknown) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          debugIf(() => ({ message: `Background retry failed for ${serverInfo.name}: ${errorMessage}` }));
        });
      }
    }
  }

  /**
   * Get current loading state tracker
   */
  public getStateTracker(): LoadingStateTracker {
    return this.stateTracker;
  }

  /**
   * Get current loading summary
   */
  public getSummary(): LoadingSummary {
    return this.stateTracker.getSummary();
  }

  /**
   * Check if a specific server is ready
   */
  public isServerReady(name: string): boolean {
    const state = this.stateTracker.getServerState(name);
    return state?.state === LoadingState.Ready;
  }

  /**
   * Get list of ready servers
   */
  public getReadyServers(): string[] {
    return this.stateTracker.getServersByState(LoadingState.Ready).map((s) => s.name);
  }

  /**
   * Get list of failed servers
   */
  public getFailedServers(): string[] {
    return this.stateTracker.getServersByState(LoadingState.Failed).map((s) => s.name);
  }

  /**
   * Cancel loading of a specific server
   */
  public cancelServerLoading(serverName: string): void {
    const abortController = this.abortControllers.get(serverName);
    if (abortController) {
      logger.info(`Cancelling loading of server: ${serverName}`);
      abortController.abort();
      this.stateTracker.updateServerState(serverName, LoadingState.Cancelled);
    } else {
      logger.warn(`No active loading operation found for server: ${serverName}`);
    }
  }

  /**
   * Cancel loading of multiple servers
   */
  public cancelServersLoading(serverNames: string[]): void {
    for (const serverName of serverNames) {
      this.cancelServerLoading(serverName);
    }
  }

  /**
   * Cancel all currently loading servers
   */
  public cancelAllLoading(): void {
    const loadingServers = Array.from(this.abortControllers.keys());
    if (loadingServers.length > 0) {
      logger.info(`Cancelling loading of ${loadingServers.length} servers`);
      this.cancelServersLoading(loadingServers);
    }
  }

  /**
   * Get list of servers that are currently being loaded and can be cancelled
   */
  public getCancellableServers(): string[] {
    return Array.from(this.abortControllers.keys());
  }

  /**
   * Shutdown the loading manager
   */
  public shutdown(): void {
    this.isShuttingDown = true;

    if (this.backgroundRetryTimer) {
      clearInterval(this.backgroundRetryTimer);
      this.backgroundRetryTimer = undefined;
    }

    // Cancel any active loading operations
    this.cancelAllLoading();

    // Update state for any remaining pending/loading servers
    const pendingServers = this.stateTracker.getServersByState(LoadingState.Pending);
    const loadingServers = this.stateTracker.getServersByState(LoadingState.Loading);

    for (const server of [...pendingServers, ...loadingServers]) {
      this.stateTracker.updateServerState(server.name, LoadingState.Cancelled);
    }

    logger.info('MCP loading manager shutdown complete');
  }

  /**
   * Utility method for sleeping
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
