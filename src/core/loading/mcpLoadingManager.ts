import { EventEmitter } from 'events';

import { sanitizeRuntimeScopeError } from '@src/config/runtimeScopeEnv.js';
import { ClientManager } from '@src/core/client/clientManager.js';
import { MCPServerParams, OutboundConnections } from '@src/core/types/index.js';
import logger, { debugIf } from '@src/logger/logger.js';
import { createTransports } from '@src/transport/transportFactory.js';
import { NonRetryableClientConnectionError } from '@src/utils/core/errorTypes.js';
import { getConnectionTimeout } from '@src/utils/core/timeoutUtils.js';

import { type BackendLoadingPolicy, DEFAULT_BACKEND_LOADING_POLICY } from './backendLoadingPolicy.js';
import {
  LoadingState,
  LoadingStateEvent,
  LoadingStateTracker,
  LoadingSummary,
  ServerLoadingInfo,
} from './loadingStateTracker.js';
import { ParallelExecutor } from './parallelExecutor.js';

type AuthProviderTransport = ReturnType<typeof createTransports>[string];

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

interface LoadingSlotWaiter {
  signal?: AbortSignal;
  resolve: (acquired: boolean) => void;
  onAbort?: () => void;
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
  /**
   * Most-recently constructed instance, exposed so runtime collaborators (e.g.
   * ConfigChangeHandler) can route hot-reload add/remove through the single
   * canonical loading pipeline. Mirrors ServerManager.current / ClientManager.current.
   */
  private static _current: McpLoadingManager | undefined;

  public static get current(): McpLoadingManager {
    if (!McpLoadingManager._current) {
      throw new Error('McpLoadingManager not initialized');
    }
    return McpLoadingManager._current;
  }

  private clientManager: ClientManager;
  private config: BackendLoadingPolicy;
  private stateTracker: LoadingStateTracker;
  private backgroundRetryTimer?: ReturnType<typeof setTimeout>;
  private backgroundRetryRunning = false;
  private isShuttingDown: boolean = false;
  /** Per-connection-attempt abort controllers (timeout window only) */
  private abortControllers: Map<string, AbortController> = new Map();
  /**
   * Per-server operation abort controllers.
   *
   * Covers the full lifetime of a `loadServer` or background-retry operation
   * for a given server name — including the retry loop and its sleep delays.
   * Cancelling this controller stops the loop immediately and prevents the
   * operation from writing state back after the server has been removed.
   *
   * Invariant: only ONE entry per server name exists at a time. Starting a new
   * operation for a name (`loadServer`, `performBackgroundRetry`) replaces the
   * previous controller after aborting it via `cancelServerOperation`.
   */
  private serverOpAbortControllers: Map<string, AbortController> = new Map();
  private activeLoadOperations = 0;
  private loadSlotWaiters: LoadingSlotWaiter[] = [];

  constructor(clientManager: ClientManager, config: Partial<BackendLoadingPolicy> = {}) {
    super();
    this.clientManager = clientManager;
    this.config = { ...DEFAULT_BACKEND_LOADING_POLICY, ...config };
    this.stateTracker = new LoadingStateTracker();
    McpLoadingManager._current = this;

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
   * Bring a single server online at runtime (config hot-reload add / rename).
   *
   * This is the canonical runtime counterpart to {@link startAsyncLoading}: it
   * routes a hot-reload-added server through the SAME loading pipeline
   * (`loadSingleServer`) that boot uses, so the server is tracked in the
   * LoadingStateTracker and gets identical retry + OAuth handling. Previously
   * the config-change path called `ServerManager.startServer` directly, which
   * connected the client but never registered it with the tracker — so the new
   * server was invisible to `/health/mcp` (stuck "connecting", no OAuth button).
   *
   * Idempotent: if the server already exists it is fully unloaded first (via
   * `unloadServer`, which cancels any in-flight load operation), making renames
   * and modified-restart correct without leaving ghost connections or stale
   * tracker entries.
   */
  public async loadServer(name: string, config: MCPServerParams): Promise<void> {
    if (config.disabled) {
      logger.info(`Server ${name} is disabled, skipping load`);
      // Ensure no stale state/connection lingers for a now-disabled server.
      await this.unloadServer(name);
      return;
    }

    // Re-load cleanly if it already exists (rename / functional modify).
    // unloadServer cancels any in-flight operation for this name first.
    if (this.stateTracker.getServerState(name) || this.clientManager.getTransport(name)) {
      await this.unloadServer(name);
    } else {
      // Even if not tracked yet, cancel any lingering operation (e.g. a
      // concurrent loadServer call that has not registered with the tracker yet).
      this.cancelServerOperation(name);
    }

    // Claim a new operation slot for this load attempt.
    const opController = new AbortController();
    this.serverOpAbortControllers.set(name, opController);

    let transport: AuthProviderTransport | undefined;
    try {
      const transports = createTransports({ [name]: config });
      transport = transports[name];
    } catch (error) {
      const safeError = sanitizeRuntimeScopeError(error);
      logger.error(`Failed to create transport for ${name}: ${safeError}`);
      this.stateTracker.registerServer(name);
      this.stateTracker.updateServerState(name, LoadingState.Failed, {
        error: safeError,
      });
      this.serverOpAbortControllers.delete(name);
      return;
    }

    if (!transport) {
      logger.warn(`No transport created for ${name} (possibly disabled); skipping`);
      this.serverOpAbortControllers.delete(name);
      return;
    }

    // Register with the tracker, then run the shared single-server pipeline.
    this.stateTracker.registerServer(name);
    try {
      await this.loadSingleServer(name, transport, opController.signal);
    } finally {
      // Only clean up our own controller — a concurrent loadServer may have
      // replaced it already.
      if (this.serverOpAbortControllers.get(name) === opController) {
        this.serverOpAbortControllers.delete(name);
      }
    }
  }

  /**
   * Take a single server offline at runtime (config hot-reload remove / rename
   * old name). Disconnects the client, closes the transport, and clears the
   * server's entry from the LoadingStateTracker so it does not linger as a
   * "ghost" in `/health/mcp`.
   *
   * Cancels any in-flight `loadServer` or background-retry operation for `name`
   * before cleaning up, so that the loop cannot write state back after removal.
   */
  public async unloadServer(name: string): Promise<void> {
    // Cancel any in-flight load or background-retry for this server FIRST, so
    // the retry loop cannot wake up after removal and re-add connections.
    this.cancelServerOperation(name);

    try {
      await this.clientManager.removeClient(name);
    } catch (error) {
      // Guard against: client not present / transport already closed; we still
      // want to clear tracker state below.
      debugIf(() => ({ message: `unloadServer: removeClient(${name}) noop/err: ${error}` }));
    }
    this.stateTracker.removeServer(name);
    logger.info(`Unloaded MCP server: ${name}`);
  }

  /**
   * Abort and remove the operation-level AbortController for `name`, if one
   * exists. This is the single authoritative way to interrupt a `loadSingleServer`
   * retry loop (including its sleep delays and connection attempt) for a specific
   * server.
   *
   * Safe to call when no operation is in flight — it is a no-op in that case.
   */
  private cancelServerOperation(name: string): void {
    const controller = this.serverOpAbortControllers.get(name);
    if (controller) {
      controller.abort();
      this.serverOpAbortControllers.delete(name);
    }
  }

  /**
   * Load servers with concurrency control using ParallelExecutor
   */
  private async loadServersWithConcurrency(transports: Record<string, AuthProviderTransport>): Promise<void> {
    const executor = new ParallelExecutor<[string, AuthProviderTransport], void>();
    const serverEntries = Object.entries(transports);

    await executor.execute(
      serverEntries,
      async ([name, transport]) => {
        if (this.isShuttingDown) return;

        this.cancelServerOperation(name);
        const opController = new AbortController();
        this.serverOpAbortControllers.set(name, opController);

        try {
          await this.loadSingleServer(name, transport, opController.signal);
        } finally {
          if (this.serverOpAbortControllers.get(name) === opController) {
            this.serverOpAbortControllers.delete(name);
          }
        }
      },
      {
        maxConcurrent: this.config.maxConcurrentLoads,
      },
    );

    logger.info('Initial server loading phase completed');
  }

  /**
   * Load a single server with retry logic.
   *
   * @param opSignal - Operation-level abort signal provided by the caller
   *   (`loadServer` or `performBackgroundRetry`). When this signal fires the
   *   retry loop terminates immediately — without writing a Failed state to the
   *   tracker — because the cancellation was intentional (e.g. `unloadServer`
   *   was called concurrently). The signal is also threaded down into
   *   `createClientWithTimeout` so the active connection attempt is aborted too.
   */
  private async loadSingleServer(
    name: string,
    transport: AuthProviderTransport,
    opSignal?: AbortSignal,
  ): Promise<void> {
    const acquired = await this.acquireLoadSlot(opSignal);
    if (!acquired) return;

    try {
      await this.loadSingleServerWithinSlot(name, transport, opSignal);
    } finally {
      this.releaseLoadSlot();
    }
  }

  private async loadSingleServerWithinSlot(
    name: string,
    transport: AuthProviderTransport,
    opSignal?: AbortSignal,
  ): Promise<void> {
    if (this.isShuttingDown || opSignal?.aborted) return;

    this.emit(McpLoadingEvent.ServerLoading, name);
    this.stateTracker.updateServerState(name, LoadingState.Loading, {
      progress: { phase: 'initializing', message: 'Starting server connection' },
    });

    let lastError: Error | undefined;
    let retryCount = 0;

    while (retryCount <= this.config.maxRetries && !this.isShuttingDown && !opSignal?.aborted) {
      try {
        this.stateTracker.updateServerState(name, LoadingState.Loading, {
          progress: {
            phase: retryCount > 0 ? 'retrying' : 'connecting',
            message: retryCount > 0 ? `Retry attempt ${retryCount}` : 'Connecting to server',
          },
        });

        // Attempt to create and connect client
        await this.createClientWithTimeout(name, transport, opSignal);

        // Success!
        this.stateTracker.updateServerState(name, LoadingState.Ready);
        logger.info(`Successfully loaded MCP server: ${name} (${retryCount} retries)`);
        return;
      } catch (error) {
        // If the operation was cancelled, exit cleanly without marking Failed.
        if (opSignal?.aborted) {
          debugIf(() => ({ message: `loadSingleServer: operation cancelled for ${name}` }));
          return;
        }

        lastError = sanitizeRuntimeScopeError(error);
        // Handle OAuth case specially
        if (lastError.name === 'OAuthRequiredError') {
          logger.info(`OAuth required for ${name}`);
          const authorizationUrl = this.extractAuthorizationUrl(name, transport);
          this.stateTracker.updateServerState(name, LoadingState.AwaitingOAuth, {
            error: lastError,
            authorizationUrl,
          });
          return; // Don't retry OAuth errors
        }

        if (lastError instanceof NonRetryableClientConnectionError) {
          logger.warn(`Failed to load ${name}: ${lastError.message} (non-retryable)`);
          break;
        }

        retryCount++;
        this.stateTracker.incrementRetryCount(name);

        // Handle other errors
        logger.warn(`Failed to load ${name} (attempt ${retryCount}): ${lastError.message}`);

        if (retryCount <= this.config.maxRetries && !this.isShuttingDown && !opSignal?.aborted) {
          const delay = this.config.retryDelayMs * Math.pow(2, retryCount - 1); // Exponential backoff
          logger.info(`Retrying ${name} in ${delay}ms...`);
          try {
            await this.sleep(delay, opSignal);
          } catch {
            // sleep was interrupted by opSignal abort; exit cleanly.
            return;
          }
        }
      }
    }

    // If we exited the loop due to intentional cancellation (per-server abort)
    // or global shutdown, don't mark the server as Failed — the exit was
    // deliberate, not a real failure.
    if (opSignal?.aborted || this.isShuttingDown) return;

    // All retries exhausted
    this.stateTracker.updateServerState(name, LoadingState.Failed, {
      error: lastError || new Error('Unknown error'),
    });

    if (lastError instanceof NonRetryableClientConnectionError) {
      logger.error(`Failed to load ${name} with a non-retryable error, continuing with other servers`);
    } else {
      logger.error(`Failed to load ${name} after ${this.config.maxRetries} retries, continuing with other servers`);
    }
  }

  private acquireLoadSlot(signal?: AbortSignal): Promise<boolean> {
    if (this.isShuttingDown || signal?.aborted) return Promise.resolve(false);
    if (this.activeLoadOperations < this.config.maxConcurrentLoads) {
      this.activeLoadOperations++;
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      const waiter: LoadingSlotWaiter = { signal, resolve };
      if (signal) {
        waiter.onAbort = () => {
          const index = this.loadSlotWaiters.indexOf(waiter);
          if (index >= 0) this.loadSlotWaiters.splice(index, 1);
          resolve(false);
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.loadSlotWaiters.push(waiter);
    });
  }

  private releaseLoadSlot(): void {
    this.activeLoadOperations--;

    while (this.loadSlotWaiters.length > 0) {
      const waiter = this.loadSlotWaiters.shift()!;
      if (waiter.onAbort) waiter.signal?.removeEventListener('abort', waiter.onAbort);
      if (this.isShuttingDown || waiter.signal?.aborted) {
        waiter.resolve(false);
        continue;
      }
      this.activeLoadOperations++;
      waiter.resolve(true);
      break;
    }
  }

  /**
   * Create client with timeout and cancellation support.
   *
   * @param opSignal - Operation-level signal from `loadSingleServer`. When it
   *   fires (e.g. because `unloadServer` was called), it is linked to the
   *   internal per-connection-attempt AbortController so that the active
   *   connection and its timeout are both cancelled.
   */
  private async createClientWithTimeout(
    name: string,
    transport: AuthProviderTransport,
    opSignal?: AbortSignal,
  ): Promise<void> {
    // Create abort controller for this specific server loading operation
    const abortController = new AbortController();
    this.abortControllers.set(name, abortController);

    // Propagate operation-level cancellation to the connection-attempt abort.
    const onOpAbort = () => abortController.abort();
    opSignal?.addEventListener('abort', onOpAbort, { once: true });

    const attemptTimeoutMs = getConnectionTimeout(transport) ?? 30000;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let rejectTimeout: ((error: Error) => void) | undefined;
    const onAttemptAbort = () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      rejectTimeout?.(new Error(`Loading ${name} was cancelled`));
    };
    abortController.signal.addEventListener('abort', onAttemptAbort, { once: true });

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        rejectTimeout = reject;
        timeoutId = setTimeout(() => {
          reject(new Error(`Timeout loading ${name} after ${attemptTimeoutMs}ms`));
          abortController.abort();
        }, attemptTimeoutMs);
      });

      const loadPromise = this.clientManager.createSingleClient(name, transport, abortController.signal);

      await Promise.race([loadPromise, timeoutPromise]);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      rejectTimeout = undefined;
      abortController.signal.removeEventListener('abort', onAttemptAbort);
      if (this.abortControllers.get(name) === abortController) {
        this.abortControllers.delete(name);
      }
      opSignal?.removeEventListener('abort', onOpAbort);
    }
  }

  /**
   * Set up background retry for failed servers.
   *
   * Idempotent: no-ops if a timer is already running. Without this guard,
   * every hot-reload cycle that drives the tracker to a "complete" summary
   * (e.g. unloadServer leaving all remaining servers ready) would fire
   * LoadingComplete again and install a second interval on top of the first,
   * causing failed servers to be retried N times per tick after N hot-reload
   * cycles.
   */
  private setupBackgroundRetry(): void {
    if (!this.config.enableBackgroundRetry || this.isShuttingDown || this.backgroundRetryTimer) {
      return;
    }

    this.backgroundRetryTimer = setInterval(() => {
      void this.performBackgroundRetry();
    }, this.config.backgroundRetryIntervalMs);

    this.backgroundRetryTimer.unref?.();

    logger.info('Background retry enabled for failed servers');
  }

  /**
   * Perform background retry for failed servers
   */
  private async performBackgroundRetry(): Promise<void> {
    if (this.isShuttingDown || this.backgroundRetryRunning) return;
    this.backgroundRetryRunning = true;

    try {
      const failedServers = this.stateTracker
        .getServersByState(LoadingState.Failed)
        .filter((server) => !(server.error instanceof NonRetryableClientConnectionError));

      if (failedServers.length === 0) {
        return;
      }

      logger.info(`Background retry for ${failedServers.length} failed servers`);

      const serversToRetry = failedServers.slice(0, this.config.backgroundRetryMaxServersPerCycle);
      const retryOperations: Promise<void>[] = [];

      for (const serverInfo of serversToRetry) {
        if (this.isShuttingDown) break;

        const { name } = serverInfo;
        const transport = this.clientManager.getTransport(name);
        if (transport) {
          this.emit(McpLoadingEvent.BackgroundRetry, name, serverInfo.retryCount + 1);

          // Cancel any previous operation for this server and claim a new slot.
          this.cancelServerOperation(name);
          const opController = new AbortController();
          this.serverOpAbortControllers.set(name, opController);

          retryOperations.push(
            this.loadSingleServer(name, transport, opController.signal)
              .catch((error: unknown) => {
                const errorMessage = error instanceof Error ? error.message : String(error);
                debugIf(() => ({ message: `Background retry failed for ${name}: ${errorMessage}` }));
              })
              .finally(() => {
                if (this.serverOpAbortControllers.get(name) === opController) {
                  this.serverOpAbortControllers.delete(name);
                }
              }),
          );
        }
      }
      await Promise.allSettled(retryOperations);
    } finally {
      this.backgroundRetryRunning = false;
    }
  }

  /**
   * Get current loading state tracker
   */
  public getStateTracker(): LoadingStateTracker {
    return this.stateTracker;
  }

  private extractAuthorizationUrl(name: string, transport: AuthProviderTransport): string | undefined {
    const clientInfo = this.clientManager.getClients().get(name);
    if (clientInfo?.authorizationUrl) {
      return clientInfo.authorizationUrl;
    }

    try {
      const oauthProvider = transport.oauthProvider;
      if (oauthProvider && typeof oauthProvider.getAuthorizationUrl === 'function') {
        return oauthProvider.getAuthorizationUrl();
      }
    } catch (error) {
      debugIf(() => ({ message: `Could not extract authorization URL for ${name}: ${error}` }));
    }

    return undefined;
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
   * Cancel loading of a specific server.
   *
   * Cancels both the operation-level retry loop (serverOpAbortControllers) and
   * the active connection-attempt timeout (abortControllers). Before this fix,
   * only the connection-attempt abort was signalled, so a server sleeping
   * between retries would continue uninterrupted and could resurface as Loading,
   * Ready, or Failed after the caller believed it was cancelled.
   */
  public cancelServerLoading(serverName: string): void {
    const hasOpController = this.serverOpAbortControllers.has(serverName);
    const hasConnController = this.abortControllers.has(serverName);

    if (!hasOpController && !hasConnController) {
      logger.warn(`No active loading operation found for server: ${serverName}`);
      return;
    }

    logger.info(`Cancelling loading of server: ${serverName}`);

    // Cancel the full retry loop first (interrupts sleep delays and signals the
    // loop to exit cleanly without writing state back).
    this.cancelServerOperation(serverName);

    // Also abort the active connection-attempt controller if one exists (covers
    // the case where we are mid-connect and cancelServerOperation has not yet
    // propagated through createClientWithTimeout).
    const abortController = this.abortControllers.get(serverName);
    if (abortController) {
      abortController.abort();
    }

    // Mark the tracker entry as Cancelled only if the server is still tracked.
    // (cancelServerOperation may have already removed it via unloadServer; guard
    // to avoid "unknown server" warning from updateServerState.)
    if (this.stateTracker.getServerState(serverName)) {
      this.stateTracker.updateServerState(serverName, LoadingState.Cancelled);
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
   * Cancel all currently loading servers.
   *
   * Previously iterated only abortControllers (connection-attempt window), so
   * servers sleeping between retries were invisible and never cancelled. Now
   * collects the union of both maps so every in-flight operation is reached.
   */
  public cancelAllLoading(): void {
    // Union of servers that are either mid-connection-attempt or mid-retry-sleep.
    const allActive = new Set([...this.abortControllers.keys(), ...this.serverOpAbortControllers.keys()]);
    if (allActive.size > 0) {
      logger.info(`Cancelling loading of ${allActive.size} servers`);
      this.cancelServersLoading(Array.from(allActive));
    }
  }

  /**
   * Get list of servers that are currently being loaded and can be cancelled.
   *
   * Returns the union of servers with an active connection attempt and servers
   * sleeping between retries — both are cancellable via cancelServerLoading.
   */
  public getCancellableServers(): string[] {
    return Array.from(new Set([...this.abortControllers.keys(), ...this.serverOpAbortControllers.keys()]));
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

    // Cancel all per-server operation controllers first (interrupts retry loops
    // and sleep delays), then cancel the per-connection-attempt controllers.
    for (const controller of this.serverOpAbortControllers.values()) {
      controller.abort();
    }
    this.serverOpAbortControllers.clear();

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
   * Utility method for sleeping.
   *
   * When `signal` is provided the sleep is cancellable: aborting the signal
   * rejects the returned promise immediately (clearing the underlying timer),
   * which causes the retry loop in `loadSingleServer` to exit without waiting
   * for the full delay.
   */
  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Sleep aborted'));
        return;
      }

      const id = setTimeout(resolve, ms);

      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(id);
          reject(new Error('Sleep aborted'));
        },
        { once: true },
      );
    });
  }
}
