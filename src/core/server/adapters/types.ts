import type { OutboundConnection } from '@src/core/types/client.js';
import { ClientStatus } from '@src/core/types/client.js';
import type { MCPServerParams } from '@src/core/types/index.js';

/**
 * Server types supported by 1MCP
 */
export enum ServerType {
  /** External MCP servers configured in mcp.json */
  External = 'external',
  /** Template-based servers that render per session */
  Template = 'template',
  /** Internal 1MCP tools and capabilities */
  Internal = 'internal',
}

/**
 * Server status enumeration
 */
export enum ServerStatus {
  /** Server is connected and ready */
  Connected = 'connected',
  /** Server is disconnected */
  Disconnected = 'disconnected',
  /** Server is in error state */
  Error = 'error',
  /** Server is awaiting OAuth authorization */
  AwaitingOAuth = 'awaiting_oauth',
  /** Server is being initialized */
  Initializing = 'initializing',
}

/**
 * Context information for server operations
 */
export interface ServerContext {
  /** Session ID for the current request */
  sessionId?: string;
  /** Additional context data */
  metadata?: Record<string, unknown>;
}

/**
 * ServerAdapter provides a unified interface for all server types.
 *
 * This interface abstracts the differences between:
 * - External servers (static connections)
 * - Template servers (session-based or hash-based connections)
 * - Internal servers (1MCP built-in capabilities)
 *
 * Each adapter implementation handles the specific connection resolution
 * logic for its server type.
 */
export interface ServerAdapter {
  /**
   * The server name (clean name without hash or session suffix)
   */
  readonly name: string;

  /**
   * The server type
   */
  readonly type: ServerType;

  /**
   * The server configuration
   */
  readonly config: MCPServerParams;

  /**
   * Resolve the outbound connection for this server.
   *
   * For external servers: Returns the static connection
   * For template servers: Resolves based on session/hash
   * For internal servers: Returns the internal connection
   *
   * @param context Optional context for resolution (e.g., sessionId)
   * @returns The resolved outbound connection or undefined
   */
  resolveConnection(context?: ServerContext): OutboundConnection | undefined;

  /**
   * Get the current status of this server
   *
   * @param context Optional context for status check
   * @returns The server status
   */
  getStatus(context?: ServerContext): ServerStatus;

  /**
   * Check if this server is available for the given context
   *
   * @param context Optional context for availability check
   * @returns True if server is available
   */
  isAvailable(context?: ServerContext): boolean;

  /**
   * Get the connection key used in the outbound connections map
   *
   * For external servers: Returns the server name
   * For template servers: Returns name:hash or name:sessionId
   * For internal servers: Returns the internal identifier
   *
   * @param context Optional context for key resolution
   * @returns The connection key or undefined
   */
  getConnectionKey(context?: ServerContext): string | undefined;
}

/**
 * Factory function type for creating server adapters
 */
export type ServerAdapterFactory = (name: string, config: MCPServerParams, ...args: unknown[]) => ServerAdapter;

/**
 * Options for server adapter creation
 */
export interface ServerAdapterOptions {
  /** Server name */
  name: string;
  /** Server configuration */
  config: MCPServerParams;
  /** Server type */
  type: ServerType;
  /** Additional adapter-specific options */
  metadata?: Record<string, unknown>;
}

/**
 * Map ClientStatus to ServerStatus.
 * Shared utility to eliminate duplication across adapters.
 */
export function mapClientStatusToServerStatus(status: ClientStatus): ServerStatus {
  switch (status) {
    case ClientStatus.Connected:
      return ServerStatus.Connected;
    case ClientStatus.Disconnected:
      return ServerStatus.Disconnected;
    case ClientStatus.Error:
      return ServerStatus.Error;
    case ClientStatus.AwaitingOAuth:
      return ServerStatus.AwaitingOAuth;
    default:
      return ServerStatus.Disconnected;
  }
}
