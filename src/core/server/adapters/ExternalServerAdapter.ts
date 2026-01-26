import type { OutboundConnection, OutboundConnections } from '@src/core/types/client.js';
import type { MCPServerParams } from '@src/core/types/index.js';

import { mapClientStatusToServerStatus, ServerAdapter, ServerContext, ServerStatus, ServerType } from './types.js';

/**
 * ExternalServerAdapter handles external MCP servers with static connections.
 *
 * External servers are configured in mcp.json and have a single, persistent
 * connection that doesn't vary by session. The adapter is a read-only wrapper
 * that provides unified access to these connections.
 *
 * Key format: serverName (no colon)
 */
export class ExternalServerAdapter implements ServerAdapter {
  readonly type = ServerType.External;

  constructor(
    readonly name: string,
    readonly config: MCPServerParams,
    private readonly outboundConns: OutboundConnections,
  ) {}

  /**
   * Resolve the outbound connection for this external server.
   * External servers use direct name lookup (no session dependency).
   */
  resolveConnection(_context?: ServerContext): OutboundConnection | undefined {
    return this.outboundConns.get(this.name);
  }

  /**
   * Get the current status of this external server.
   */
  getStatus(_context?: ServerContext): ServerStatus {
    const conn = this.resolveConnection();
    return conn ? mapClientStatusToServerStatus(conn.status) : ServerStatus.Disconnected;
  }

  /**
   * Check if this external server is available.
   */
  isAvailable(_context?: ServerContext): boolean {
    const status = this.getStatus();
    return status === ServerStatus.Connected;
  }

  /**
   * Get the connection key for this external server.
   * External servers use the server name directly.
   */
  getConnectionKey(_context?: ServerContext): string | undefined {
    return this.name;
  }
}
