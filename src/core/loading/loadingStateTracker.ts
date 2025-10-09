import { EventEmitter } from 'events';
import logger, { debugIf } from '@src/logger/logger.js';
import { secureLogger } from '@src/logger/secureLogger.js';

/**
 * Enum representing possible MCP server loading states
 */
export enum LoadingState {
  /** Server initialization not started */
  Pending = 'pending',
  /** Server is currently initializing */
  Loading = 'loading',
  /** Server successfully initialized and connected */
  Ready = 'ready',
  /** Server failed to initialize */
  Failed = 'failed',
  /** Server requires OAuth authorization */
  AwaitingOAuth = 'awaiting_oauth',
  /** Server initialization was cancelled */
  Cancelled = 'cancelled',
}

/**
 * Detailed information about a server's loading progress
 */
export interface ServerLoadingInfo {
  readonly name: string;
  readonly state: LoadingState;
  startTime?: Date;
  endTime?: Date;
  duration?: number; // milliseconds
  readonly error?: Error;
  readonly authorizationUrl?: string;
  oauthStartTime?: Date;
  readonly retryCount: number;
  readonly lastRetryTime?: Date;
  readonly progress?: {
    readonly phase: string;
    readonly message?: string;
  };
}

/**
 * Overall loading statistics and summary
 */
export interface LoadingSummary {
  readonly totalServers: number;
  readonly pending: number;
  readonly loading: number;
  readonly ready: number;
  readonly failed: number;
  readonly awaitingOAuth: number;
  readonly cancelled: number;
  readonly startTime: Date;
  readonly isComplete: boolean;
  readonly successRate: number; // percentage
  readonly averageLoadTime?: number; // milliseconds
}

/**
 * Events emitted by LoadingStateTracker
 */
export const enum LoadingStateEvent {
  ServerStateChanged = 'server-state-changed',
  LoadingProgress = 'loading-progress',
  LoadingComplete = 'loading-complete',
  ServerReady = 'server-ready',
  ServerFailed = 'server-failed',
  OAuthRequired = 'oauth-required',
}

export interface LoadingStateEvents {
  [LoadingStateEvent.ServerStateChanged]: (name: string, info: ServerLoadingInfo) => void;
  [LoadingStateEvent.LoadingProgress]: (summary: LoadingSummary) => void;
  [LoadingStateEvent.LoadingComplete]: (summary: LoadingSummary) => void;
  [LoadingStateEvent.ServerReady]: (name: string, info: ServerLoadingInfo) => void;
  [LoadingStateEvent.ServerFailed]: (name: string, info: ServerLoadingInfo) => void;
  [LoadingStateEvent.OAuthRequired]: (name: string, info: ServerLoadingInfo) => void;
}

/**
 * Tracks the loading state of MCP servers during async initialization
 *
 * This class provides real-time visibility into server initialization progress,
 * enabling the HTTP server to start immediately while MCP servers load in the background.
 *
 * @example
 * ```typescript
 * const tracker = new LoadingStateTracker();
 * tracker.on(LoadingStateEvent.ServerReady, (name) => console.log(`${name} is ready`));
 * tracker.on(LoadingStateEvent.LoadingComplete, (summary) => console.log('All done!', summary));
 *
 * tracker.startLoading(['server1', 'server2']);
 * tracker.updateServerState('server1', LoadingState.Loading, { phase: 'connecting' });
 * tracker.updateServerState('server1', LoadingState.Ready);
 * ```
 */
export class LoadingStateTracker extends EventEmitter {
  private servers: Map<string, ServerLoadingInfo> = new Map();
  private globalStartTime: Date = new Date();
  private loadingStarted: boolean = false;

  constructor() {
    super();
    this.setMaxListeners(50); // Allow many listeners for server events
  }

  /**
   * Initialize tracking for a list of servers
   */
  public startLoading(serverNames: string[]): void {
    this.loadingStarted = true;
    this.globalStartTime = new Date();

    for (const name of serverNames) {
      this.servers.set(name, {
        name,
        state: LoadingState.Pending,
        retryCount: 0,
      });
    }

    logger.info(`Started tracking loading for ${serverNames.length} servers`);
    this.emitProgress();
  }

  /**
   * Update the state of a specific server
   */
  public updateServerState(
    name: string,
    state: LoadingState,
    updates: Partial<Pick<ServerLoadingInfo, 'error' | 'authorizationUrl' | 'oauthStartTime' | 'progress'>> = {},
  ): void {
    const existing = this.servers.get(name);
    if (!existing) {
      logger.warn(`Attempted to update unknown server: ${name}`);
      return;
    }

    const now = new Date();
    const info: ServerLoadingInfo = {
      ...existing,
      state,
      ...updates,
    };

    // Handle state-specific updates
    switch (state) {
      case LoadingState.Loading:
        if (!info.startTime) {
          info.startTime = now;
        }
        break;

      case LoadingState.Ready:
      case LoadingState.Failed:
      case LoadingState.Cancelled:
        info.endTime = now;
        if (info.startTime) {
          info.duration = now.getTime() - info.startTime.getTime();
        }
        break;

      case LoadingState.AwaitingOAuth:
        if (!info.oauthStartTime) {
          info.oauthStartTime = now;
        }
        break;
    }

    this.servers.set(name, info);

    const stateDescription = state === LoadingState.AwaitingOAuth ? 'requiring authorization' : state;
    secureLogger.debug(
      `Server ${name} state changed to ${stateDescription}${updates.progress ? ` (${updates.progress.phase})` : ''}`,
    );

    // Emit specific events
    this.emit(LoadingStateEvent.ServerStateChanged, name, info);

    switch (state) {
      case LoadingState.Ready:
        this.emit(LoadingStateEvent.ServerReady, name, info);
        break;
      case LoadingState.Failed:
        this.emit(LoadingStateEvent.ServerFailed, name, info);
        break;
      case LoadingState.AwaitingOAuth:
        this.emit(LoadingStateEvent.OAuthRequired, name, info);
        break;
    }

    this.emitProgress();
  }

  /**
   * Increment retry count for a server
   */
  public incrementRetryCount(name: string): void {
    const info = this.servers.get(name);
    if (info) {
      const updated: ServerLoadingInfo = {
        ...info,
        retryCount: info.retryCount + 1,
        lastRetryTime: new Date(),
      };
      this.servers.set(name, updated);
      debugIf(() => ({ message: `Server ${name} retry count: ${updated.retryCount}` }));
    }
  }

  /**
   * Get current state of a specific server
   */
  public getServerState(name: string): ServerLoadingInfo | undefined {
    return this.servers.get(name);
  }

  /**
   * Get all server states
   */
  public getAllServerStates(): Map<string, ServerLoadingInfo> {
    return new Map(this.servers);
  }

  /**
   * Get current loading summary
   */
  public getSummary(): LoadingSummary {
    const states = Array.from(this.servers.values());
    const pending = states.filter((s) => s.state === LoadingState.Pending).length;
    const loading = states.filter((s) => s.state === LoadingState.Loading).length;
    const ready = states.filter((s) => s.state === LoadingState.Ready).length;
    const failed = states.filter((s) => s.state === LoadingState.Failed).length;
    const awaitingOAuth = states.filter((s) => s.state === LoadingState.AwaitingOAuth).length;
    const cancelled = states.filter((s) => s.state === LoadingState.Cancelled).length;

    const completedStates = states.filter(
      (s) => s.state === LoadingState.Ready || s.state === LoadingState.Failed || s.state === LoadingState.Cancelled,
    );

    const isComplete = pending === 0 && loading === 0;
    const successRate = states.length > 0 ? (ready / states.length) * 100 : 0;

    const averageLoadTime =
      completedStates.length > 0
        ? completedStates.filter((s) => s.duration !== undefined).reduce((sum, s) => sum + (s.duration || 0), 0) /
          completedStates.length
        : undefined;

    return {
      totalServers: states.length,
      pending,
      loading,
      ready,
      failed,
      awaitingOAuth,
      cancelled,
      startTime: this.globalStartTime,
      isComplete,
      successRate,
      averageLoadTime,
    };
  }

  /**
   * Check if loading is complete (all servers in final state)
   */
  public isLoadingComplete(): boolean {
    return this.getSummary().isComplete;
  }

  /**
   * Get servers in a specific state
   */
  public getServersByState(state: LoadingState): ServerLoadingInfo[] {
    return Array.from(this.servers.values()).filter((s) => s.state === state);
  }

  /**
   * Reset all tracking state
   */
  public reset(): void {
    this.servers.clear();
    this.loadingStarted = false;
    this.globalStartTime = new Date();
    logger.info('Loading state tracker reset');
  }

  /**
   * Emit progress event with current summary
   */
  private emitProgress(): void {
    if (!this.loadingStarted) return;

    const summary = this.getSummary();
    this.emit(LoadingStateEvent.LoadingProgress, summary);

    if (summary.isComplete) {
      logger.info(
        `Loading complete: ${summary.ready}/${summary.totalServers} servers ready (${summary.successRate.toFixed(1)}% success rate)`,
      );
      this.emit(LoadingStateEvent.LoadingComplete, summary);
    }
  }
}
