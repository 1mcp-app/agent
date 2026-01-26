import type { TemplateServerManager } from '@src/core/server/templateServerManager.js';
import type { OutboundConnection, OutboundConnections } from '@src/core/types/client.js';
import type { MCPServerParams } from '@src/core/types/index.js';

import { mapClientStatusToServerStatus, ServerAdapter, ServerContext, ServerStatus, ServerType } from './types.js';

/**
 * TemplateServerAdapter handles template-based MCP servers with dynamic connections.
 *
 * Template servers are instantiated per session with rendered configurations.
 * They can be either:
 * - Shareable: Multiple sessions share the same instance (key: name:renderedHash)
 * - Per-client: Each session gets its own instance (key: name:sessionId)
 *
 * The adapter wraps TemplateServerManager for session-to-hash lookups and uses
 * the existing OutboundConnections map for connection data.
 */
export class TemplateServerAdapter implements ServerAdapter {
  readonly type = ServerType.Template;

  constructor(
    readonly name: string,
    readonly config: MCPServerParams,
    private readonly outboundConns: OutboundConnections,
    private readonly templateManager: TemplateServerManager,
  ) {}

  /**
   * Build the possible connection keys for a session.
   * Returns keys in priority order: session-scoped first, then hash-based.
   */
  private buildConnectionKeys(sessionId: string): string[] {
    const keys: string[] = [`${this.name}:${sessionId}`];

    const renderedHash = this.templateManager.getRenderedHashForSession(sessionId, this.name);
    if (renderedHash) {
      keys.push(`${this.name}:${renderedHash}`);
    }

    return keys;
  }

  /**
   * Resolve the outbound connection for this template server.
   * Uses session-based resolution with hash lookup for shareable servers.
   */
  resolveConnection(context?: ServerContext): OutboundConnection | undefined {
    const sessionId = context?.sessionId;
    if (!sessionId) {
      return undefined;
    }

    for (const key of this.buildConnectionKeys(sessionId)) {
      const conn = this.outboundConns.get(key);
      if (conn) {
        return conn;
      }
    }

    return undefined;
  }

  /**
   * Get the current status of this template server.
   */
  getStatus(context?: ServerContext): ServerStatus {
    const conn = this.resolveConnection(context);
    return conn ? mapClientStatusToServerStatus(conn.status) : ServerStatus.Disconnected;
  }

  /**
   * Check if this template server is available for the given context.
   */
  isAvailable(context?: ServerContext): boolean {
    const status = this.getStatus(context);
    return status === ServerStatus.Connected;
  }

  /**
   * Get the connection key for this template server.
   * Returns the key used in the outbound connections map.
   */
  getConnectionKey(context?: ServerContext): string | undefined {
    const sessionId = context?.sessionId;
    if (!sessionId) {
      return undefined;
    }

    return this.buildConnectionKeys(sessionId).find((key) => this.outboundConns.has(key));
  }
}
