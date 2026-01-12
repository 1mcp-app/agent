import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import logger from '@src/logger/logger.js';
import type { InternalStreamableTransport } from '@src/transport/http/utils/sdkInternals.js';

/**
 * Metadata about a transport's restoration state, used for debugging
 * and monitoring session restoration flow.
 */
export interface RestorationInfo {
  isRestored: boolean;
  sessionId?: string;
}

/**
 * Result type for operations that may fail.
 */
export interface OperationResult {
  success: boolean;
  error?: string;
}

/**
 * RestorableStreamableHTTPServerTransport extends the MCP SDK's StreamableHTTPServerTransport
 * to provide proper session restoration capabilities with type-safe access to internal properties.
 *
 * This wrapper class encapsulates the initialization logic needed for restored sessions,
 * providing a clean interface that's less likely to break with SDK updates.
 *
 * @remarks
 * The class works by:
 * 1. Storing a restored sessionId that overrides the SDK's getter
 * 2. Providing methods to safely access and modify internal SDK properties
 * 3. Returning success/failure status from operations for proper error handling
 *
 * @example
 * ```typescript
 * // SessionService handles the full restoration flow:
 * const transport = new RestorableStreamableHTTPServerTransport({
 *   sessionIdGenerator: () => originalSessionId,
 * });
 * const initResult = transport.markAsInitialized();
 * transport.setSessionId(originalSessionId);
 * // Now transport.isRestored() returns true
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
   * @returns OperationResult indicating success or failure with error details
   */
  setSessionId(sessionId: string): OperationResult {
    this._restoredSessionId = sessionId;
    try {
      // Access the underlying _webStandardTransport where sessionId is stored
      // StreamableHTTPServerTransport is a wrapper with getter-only sessionId
      // The actual sessionId is on _webStandardTransport which allows setting
      const internalTransport = this as unknown as InternalStreamableTransport;
      const webStandardTransport = internalTransport._webStandardTransport;
      if (webStandardTransport) {
        webStandardTransport.sessionId = sessionId;
        return { success: true };
      }
      return { success: false, error: 'No webStandardTransport found' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`Failed to set sessionId "${sessionId}" on underlying transport: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Override sessionId getter to return restored sessionId if available.
   *
   * This ensures that even if the underlying transport hasn't generated the sessionId yet,
   * we return the correct restored sessionId. If no restored session ID exists, delegates
   * to the parent class's getter by manually accessing the property descriptor.
   *
   * @remarks
   * We cannot use `super.sessionId` directly because this override shadows the parent's
   * getter. Instead, we use Object.getOwnPropertyDescriptor to access the parent's
   * property descriptor and call its getter with the correct context.
   *
   * Type assertion to `object` is safe here because we know the prototype chain exists:
   * this -> RestorableStreamableHTTPServerTransport -> StreamableHTTPServerTransport -> Object.prototype
   * Object.getOwnPropertyDescriptor requires an object type, and TypeScript cannot infer this
   * from the double getPrototypeOf call.
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
    if (!proto) return undefined;
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
   * @returns OperationResult indicating success or failure with error details
   */
  markAsInitialized(): OperationResult {
    try {
      // Use type-safe interface to access internal SDK properties
      // MCP SDK private property _initialized is not exposed in public types
      const internalTransport = this as unknown as InternalStreamableTransport;

      // Accessing private SDK property for session restoration functionality
      if (internalTransport._initialized !== undefined) {
        // Setting private SDK property to mark session as initialized for restoration
        internalTransport._initialized = true;
      }

      this._isRestored = true;
      logger.debug('Transport marked as initialized for restored session');
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`Failed to mark transport as initialized: ${errorMessage}`);
      this._isRestored = false;
      return { success: false, error: errorMessage };
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
    const internalTransport = this as unknown as InternalStreamableTransport;

    return {
      isRestored: this._isRestored,
      // Accessing potentially private sessionId property for debugging
      sessionId: internalTransport.sessionId,
    };
  }
}
