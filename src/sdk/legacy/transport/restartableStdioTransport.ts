import { Stream } from 'node:stream';

import logger, { debugIf } from '@src/logger/logger.js';
import { StdioClientTransport, StdioServerParameters } from '@src/sdk/legacy/client/stdio.js';
import { Transport } from '@src/sdk/legacy/shared/transport.js';
import { JSONRPCMessage } from '@src/sdk/legacy/types.js';
import { ManagedStdioStderr } from '@src/transport/managedStdioStderr.js';

/**
 * Configuration for the restartable stdio transport
 */
export interface RestartableTransportConfig {
  readonly restartOnExit: boolean;
  readonly maxRestarts?: number; // Default: unlimited
  readonly restartDelay?: number; // Default: 1000ms
}

/**
 * Restart statistics for the transport
 */
export interface RestartStats {
  restartCount: number;
  isRestarting: boolean;
}

/**
 * Wrapper around StdioClientTransport that provides automatic restart functionality
 * Implements Transport interface and adds OAuth provider support
 */
export class RestartableStdioTransport implements Transport {
  private _currentTransport: StdioClientTransport | null = null;
  private _restartCount = 0;
  private _isStarting = false;
  private _isClosing = false;
  private _restartTimer: ReturnType<typeof setTimeout> | null = null;

  // Extended properties for AuthProviderTransport compatibility
  public timeout?: number;
  public tags?: string[];
  public oauthProvider?: unknown;

  // Event handlers
  public onclose?: () => void;
  public onerror?: (error: Error) => void;
  public onmessage?: (message: JSONRPCMessage) => void;

  constructor(
    private readonly serverParams: StdioServerParameters,
    private readonly restartConfig: RestartableTransportConfig,
    private readonly managedStderr?: ManagedStdioStderr,
  ) {
    debugIf(() => ({ message: 'restartableStdioTransport.creating.restartablestdiotransport.for.command.47f816cd' }));
  }

  /**
   * Creates a new underlying transport instance
   */
  private createTransport(): StdioClientTransport {
    const transport = new StdioClientTransport(this.serverParams);
    this.managedStderr?.attach(transport.stderr);

    // Forward event handlers
    transport.onclose = () => this.handleTransportClose();
    transport.onerror = (error) => this.handleTransportError(error);
    transport.onmessage = (message) => this.handleTransportMessage(message);

    return transport;
  }

  /**
   * Handles transport close events
   */
  private handleTransportClose(): void {
    if (this._isClosing) {
      // Expected close, forward the event
      this.onclose?.();
      return;
    }

    // Unexpected close, attempt restart if configured
    if (this.restartConfig.restartOnExit) {
      this.attemptRestart();
    } else {
      // No restart configured, forward close event
      this.onclose?.();
    }
  }

  /**
   * Handles transport error events
   */
  private handleTransportError(error: Error): void {
    logger.error('restartableStdioTransport.transport.error.206094be');
    this.onerror?.(error);
  }

  /**
   * Handles transport message events
   */
  private handleTransportMessage(message: JSONRPCMessage): void {
    this.onmessage?.(message);
  }

  /**
   * Attempts to restart the transport
   */
  private attemptRestart(): void {
    if (this._isClosing) {
      return; // Don't restart if we're intentionally closing
    }

    const maxRestarts = this.restartConfig.maxRestarts;
    if (maxRestarts !== undefined && this._restartCount >= maxRestarts) {
      logger.error('restartableStdioTransport.max.restart.limit.reached.stopping.transport.9801e607');
      this.onerror?.(new Error(`Transport failed after ${maxRestarts} restart attempts`));
      return;
    }

    this._restartCount++;
    const restartDelay = this.restartConfig.restartDelay ?? 1000;

    logger.info('restartableStdioTransport.attempting.transport.restart.in.ms.9f524f64');

    this._restartTimer = setTimeout(async () => {
      this._restartTimer = null;
      try {
        await this.restartTransport();
        logger.info('restartableStdioTransport.transport.restarted.successfully.attempt.471bf3a9');
      } catch (error) {
        logger.error('restartableStdioTransport.transport.restart.failed.9ee7466c', { error: error });
        this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      }
    }, restartDelay);
  }

  /**
   * Restarts the underlying transport
   */
  private async restartTransport(): Promise<void> {
    if (this._isStarting || this._isClosing) {
      return;
    }

    this._isStarting = true;

    try {
      // Close old transport if it exists
      if (this._currentTransport) {
        await this._currentTransport.close();
      }

      // Create and start new transport
      this._currentTransport = this.createTransport();
      await this._currentTransport.start();
    } finally {
      this._isStarting = false;
    }
  }

  /**
   * Starts the transport
   */
  async start(): Promise<void> {
    if (this._currentTransport) {
      throw new Error('RestartableStdioTransport already started!');
    }

    this._isStarting = true;
    this._restartCount = 0;

    try {
      this._currentTransport = this.createTransport();
      await this._currentTransport.start();
      debugIf('restartableStdioTransport.restartablestdiotransport.started.successfully.4b4aa2ac');
    } finally {
      this._isStarting = false;
    }
  }

  /**
   * Gets the stderr stream from the current transport
   */
  get stderr(): Stream | null {
    return this._currentTransport?.stderr ?? null;
  }

  /**
   * Gets the process PID from the current transport
   */
  get pid(): number | null {
    return this._currentTransport?.pid ?? null;
  }

  /**
   * Sends a message through the current transport
   */
  async send(message: JSONRPCMessage): Promise<void> {
    if (!this._currentTransport) {
      throw new Error('Transport not started');
    }

    return this._currentTransport.send(message);
  }

  /**
   * Closes the transport and prevents restart
   */
  async close(): Promise<void> {
    this._isClosing = true;

    // Clear any pending restart timer
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }

    // Close current transport if it exists
    if (this._currentTransport) {
      await this._currentTransport.close();
      this._currentTransport = null;
    }

    await this.managedStderr?.close();

    debugIf('restartableStdioTransport.restartablestdiotransport.closed.9292005e');
  }

  /**
   * Gets restart statistics
   */
  getRestartStats(): RestartStats {
    return {
      restartCount: this._restartCount,
      isRestarting: this._isStarting,
    };
  }
}
