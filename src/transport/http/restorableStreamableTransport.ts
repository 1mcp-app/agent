import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import logger from '@src/logger/logger.js';

/**
 * Information about the restoration state of a transport
 */
export interface RestorationInfo {
  isRestored: boolean;
  sessionId?: string;
}

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
  private _restoredSessionId?: string;

  /**
   * Sets the sessionId for a restored session.
   *
   * When restoring a session, we need to ensure the sessionId is available immediately
   * without waiting for the sessionIdGenerator to be called by the SDK. This method
   * directly sets the sessionId on the underlying transport.
   *
   * @param sessionId - The sessionId to set for the restored session
   */
  setSessionId(sessionId: string): void {
    this._restoredSessionId = sessionId;
    try {
      // Access the underlying _webStandardTransport where sessionId is stored
      // Reason: StreamableHTTPServerTransport is a wrapper with getter-only sessionId
      // The actual sessionId is on _webStandardTransport which allows setting
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      const internalTransport = this as any;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
      const webStandardTransport = internalTransport._webStandardTransport;
      if (webStandardTransport) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        webStandardTransport.sessionId = sessionId;
      }
    } catch (error) {
      logger.warn('Could not set sessionId on underlying transport:', error);
    }
  }

  /**
   * Override sessionId getter to return restored sessionId if available.
   *
   * This ensures that even if the underlying transport hasn't generated the sessionId yet,
   * we return the correct restored sessionId.
   */
  override get sessionId(): string | undefined {
    // First check if we have a restored sessionId
    if (this._restoredSessionId) {
      return this._restoredSessionId;
    }
    // Otherwise delegate to parent class's getter directly
    // Use Object.getOwnPropertyDescriptor to get the parent's property descriptor
    // and call the getter with the parent's context
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const proto = Object.getPrototypeOf(Object.getPrototypeOf(this));
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'sessionId');
    if (descriptor?.get) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return descriptor.get.call(this);
    }
    return undefined;
  }

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
  getRestorationInfo(): RestorationInfo {
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
