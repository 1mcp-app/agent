/**
 * Type definitions for internal properties of the MCP SDK that are not exposed
 * in the public API but are needed for session restoration functionality.
 */

/**
 * Interface representing the internal structure of the web standard transport
 * used within StreamableHTTPServerTransport
 */
export interface InternalWebStandardTransport {
  sessionId: string;
}

/**
 * Interface representing the internal structure of StreamableHTTPServerTransport
 * exposing private properties needed for restoration
 */
export interface InternalStreamableTransport {
  /**
   * The underlying web standard transport instance
   * @internal
   */
  _webStandardTransport?: InternalWebStandardTransport;

  /**
   * Flag indicating if the transport has been initialized
   * @internal
   */
  _initialized?: boolean;

  /**
   * Session ID from public interface
   */
  sessionId?: string;
}
