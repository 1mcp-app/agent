import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

/**
 * Metadata about a transport's restoration state, used for debugging
 * and monitoring session restoration flow.
 */
export interface RestorationInfo {
  isRestored: boolean;
  sessionId?: string;
}

/**
 * RestorableStreamableHTTPServerTransport extends the MCP SDK's StreamableHTTPServerTransport
 * to track whether a transport was restored from persistent storage.
 *
 * This is a minimal wrapper that only adds restoration tracking. Session ID management
 * is handled entirely through the SDK's public `sessionIdGenerator` callback - when
 * restoring a session, we pass a generator that returns the stored session ID.
 *
 * @remarks
 * The restoration flow works as follows:
 * 1. Create transport with `sessionIdGenerator: () => storedSessionId`
 * 2. Connect transport to ServerManager
 * 3. Call virtualInitialize() which triggers SDK's handleRequest
 * 4. SDK calls sessionIdGenerator() internally to get the session ID
 * 5. Call markAsRestored() to indicate successful restoration
 *
 * @example
 * ```typescript
 * const transport = new RestorableStreamableHTTPServerTransport({
 *   sessionIdGenerator: () => originalSessionId,
 * });
 * // After successful virtual initialize...
 * transport.markAsRestored();
 * // Now transport.isRestored() returns true
 * ```
 */
export class RestorableStreamableHTTPServerTransport extends StreamableHTTPServerTransport {
  private _isRestored = false;

  /**
   * Marks this transport as having been restored from persistent storage.
   *
   * This should be called after successful virtual initialization to indicate
   * that the transport is ready to handle requests for a restored session.
   */
  markAsRestored(): void {
    this._isRestored = true;
  }

  /**
   * Returns whether this transport was created for a restored session.
   *
   * @returns true if the transport was restored from persistent storage, false otherwise
   */
  isRestored(): boolean {
    return this._isRestored;
  }

  /**
   * Gets the restoration status for debugging purposes.
   *
   * @returns Object containing restoration metadata
   */
  getRestorationInfo(): RestorationInfo {
    return {
      isRestored: this._isRestored,
      sessionId: this.sessionId,
    };
  }
}
