import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import logger from '@src/logger/logger.js';

/**
 * RestorableStreamableHTTPServerTransport extends the MCP SDK's StreamableHTTPServerTransport
 * to provide proper session restoration capabilities with type-safe access to internal properties.
 *
 * This wrapper class encapsulates the initialization logic needed for restored sessions,
 * providing a clean interface that's less likely to break with SDK updates.
 *
 * @example
 * ```typescript
 * // For session restoration
 * const transport = new RestorableStreamableHTTPServerTransport({
 *   sessionIdGenerator: () => sessionId,
 * });
 * transport.markAsInitialized();
 *
 * // Check if session was restored
 * if (transport.isRestored()) {
 *   // Handle restored session logic
 * }
 * ```
 */
export class RestorableStreamableHTTPServerTransport extends StreamableHTTPServerTransport {
  private _isRestored = false;

  /**
   * Marks the transport as initialized for restored sessions.
   *
   * When restoring a session, the client won't send an initialize request again
   * because from the client's perspective, the session is already initialized.
   * The MCP SDK checks the _initialized flag and rejects requests if it's false.
   * This method safely sets that flag to allow the restored session to work.
   *
   * @throws Will log a warning if initialization fails but won't throw an error
   */
  markAsInitialized(): void {
    try {
      // Use type-safe interface to access internal SDK properties
      // Reason: MCP SDK private property _initialized is not exposed in public types
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      const internalTransport = this as any;

      // Reason: Accessing private SDK property for session restoration functionality
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (internalTransport._initialized !== undefined) {
        // Reason: Setting private SDK property to mark session as initialized for restoration
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        internalTransport._initialized = true;
      }

      this._isRestored = true;
      logger.debug('Transport marked as initialized for restored session');
    } catch (error) {
      logger.warn('Could not mark transport as initialized:', error);
      // Don't throw - let the session attempt to work without the flag
    }
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
  getRestorationInfo(): { isRestored: boolean; sessionId?: string } {
    // Use type-safe interface to access potentially private sessionId
    // Reason: sessionId property may not be exposed in public SDK types
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
    const internalTransport = this as any;

    return {
      isRestored: this._isRestored,
      // Reason: Accessing potentially private sessionId property for debugging
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
      sessionId: internalTransport.sessionId,
    };
  }
}
