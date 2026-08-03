import type { OutboundConnection, OutboundConnections } from '@src/core/types/client.js';
import { errorIf } from '@src/logger/logger.js';

import {
  parseTemplateConnectionKey,
} from './templateIdentity.js';

/**
 * Interface for accessing template server hash mappings.
 * This abstracts away the dependency on TemplateServerManager.
 */
export interface TemplateHashProvider {
  /**
   * Get the rendered hash for a specific session and template
   */
  getRenderedHashForSession(sessionId: string, templateName: string): string | undefined;

  /**
   * Get all rendered hashes for a specific session
   * Returns Map<templateName, renderedHash>
   */
  getAllRenderedHashesForSession(sessionId: string): Map<string, string> | undefined;
}

/**
 * ConnectionResolver encapsulates the 3-tier connection resolution logic.
 *
 * Key format:
 * - Static servers: name (no colon)
 * - Shareable template servers: name:renderedHash
 * - Per-client template servers: name:sessionId
 *
 * Resolution order:
 * 1. Try an explicitly session-owned template connection
 * 2. Try a rendered template connection mapped to the request session
 * 3. Fall back to direct name lookup (for static servers: name)
 */
export class ConnectionResolver {
  constructor(
    private readonly outboundConns: OutboundConnections,
    private readonly templateHashProvider?: TemplateHashProvider,
  ) {}

  resolveWithKey(clientName: string, sessionId?: string): { key: string; connection: OutboundConnection } | undefined {
    if (sessionId) {
      const sessionKey = `${clientName}:${sessionId}`;
      const sessionConnection = this.outboundConns.get(sessionKey);
      if (sessionConnection && this.isSessionConnectionOwnedBy(sessionKey, sessionConnection, clientName, sessionId)) {
        return { key: sessionKey, connection: sessionConnection };
      }
    }

    if (sessionId) {
      const renderedHash = this.getRenderedHashForSession(sessionId, clientName);
      if (renderedHash) {
        const renderedKey = `${clientName}:${renderedHash}`;
        const renderedConnection = this.outboundConns.get(renderedKey);
        if (
          renderedConnection &&
          this.isRenderedConnectionMappedToSession(renderedKey, renderedConnection, clientName, renderedHash)
        ) {
          return { key: renderedKey, connection: renderedConnection };
        }
      }
    }

    const staticConnection = this.outboundConns.get(clientName);
    if (staticConnection && !staticConnection.templateIdentity) {
      return { key: clientName, connection: staticConnection };
    }

    return undefined;
  }

  /**
   * Resolve outbound connection by client name and session ID.
   *
   * @param clientName The client/server name
   * @param sessionId The session ID (optional)
   * @returns The resolved outbound connection or undefined
   */
  resolve(clientName: string, sessionId?: string): OutboundConnection | undefined {
    return this.resolveWithKey(clientName, sessionId)?.connection;
  }

  /**
   * Filter outbound connections for a specific session.
   *
   * Key format:
   * - Static servers: name (no colon) - always included
   * - Shareable template servers: name:renderedHash - included if session uses this hash
   * - Per-client template servers: name:sessionId - only included if session matches
   *
   * @param sessionId The session ID (optional)
   * @returns A filtered map of outbound connections
   */
  filterForSession(sessionId?: string): OutboundConnections {
    const filtered = new Map<string, OutboundConnection>();
    const renderedHashCache = new Map<string, string | undefined>();

    for (const [key, conn] of this.outboundConns.entries()) {
      const identity = parseTemplateConnectionKey(key);
      if (identity.kind === 'invalid') {
        errorIf(() => ({
          message: 'Invalid connection key format: expected clean name or exactly one colon delimiter',
          meta: { key },
        }));
        continue;
      }

      // Static servers (no : in key) are always included.
      if (identity.kind === 'static') {
        if (!conn.templateIdentity) {
          filtered.set(key, conn);
        }
        continue;
      }

      if (!sessionId) {
        continue;
      }

      if (this.isSessionConnectionOwnedBy(key, conn, identity.templateName, sessionId)) {
        filtered.set(key, conn);
        continue;
      }

      if (!renderedHashCache.has(identity.templateName)) {
        renderedHashCache.set(identity.templateName, this.getRenderedHashForSession(sessionId, identity.templateName));
      }

      const renderedHash = renderedHashCache.get(identity.templateName);
      if (
        renderedHash &&
        this.isRenderedConnectionMappedToSession(key, conn, identity.templateName, renderedHash)
      ) {
        filtered.set(key, conn);
      }
    }

    return filtered;
  }

  private getRenderedHashForSession(sessionId: string, templateName: string): string | undefined {
    if (!this.templateHashProvider) return undefined;

    try {
      return this.templateHashProvider.getRenderedHashForSession(sessionId, templateName);
    } catch (error) {
      errorIf(() => ({
        message: 'Failed to get rendered hash for template connection lookup',
        meta: { sessionId, templateName, error: error instanceof Error ? error.message : String(error) },
      }));
      return undefined;
    }
  }

  private isSessionConnectionOwnedBy(
    key: string,
    connection: OutboundConnection,
    templateName: string,
    sessionId: string,
  ): boolean {
    const identity = connection.templateIdentity;
    return (
      identity?.mode === 'session' &&
      identity.ownerSessionId === sessionId &&
      connection.name === templateName &&
      key === `${templateName}:${identity.ownerSessionId}`
    );
  }

  private isRenderedConnectionMappedToSession(
    key: string,
    connection: OutboundConnection,
    templateName: string,
    renderedHash: string,
  ): boolean {
    const identity = connection.templateIdentity;
    return (
      identity?.mode === 'rendered' &&
      identity.renderedHash === renderedHash &&
      connection.name === templateName &&
      key === `${templateName}:${identity.renderedHash}`
    );
  }

  /**
   * Find any connection for a server by name, regardless of session.
   * This is useful when session context is not available.
   *
   * Resolution order:
   * 1. Try direct name lookup (for static servers)
   * 2. Search for any connection where connection.name matches or key starts with serverName:
   *
   * @param serverName The server name to find
   * @returns The connection key and connection, or undefined
   */
  findByServerName(serverName: string): { key: string; connection: OutboundConnection } | undefined {
    // Direct lookup for static servers
    const directConn = this.outboundConns.get(serverName);
    if (directConn) {
      return { key: serverName, connection: directConn };
    }

    // Search for template servers
    for (const [key, connection] of this.outboundConns.entries()) {
      if (connection.name === serverName || key.startsWith(`${serverName}:`)) {
        return { key, connection };
      }
    }

    return undefined;
  }
}

/**
 * A read-only Map facade that resolves the owning session's connections when
 * handlers use it. It keeps request handlers live across async loading and
 * hot reloads without making another session's template instances visible.
 */
class SessionScopedConnections extends Map<string, OutboundConnection> {
  constructor(
    private readonly outboundConns: OutboundConnections,
    private readonly sessionId: string | undefined,
    private readonly templateHashProvider?: TemplateHashProvider,
  ) {
    super();
  }

  private current(): OutboundConnections {
    return createConnectionResolver(this.outboundConns, this.templateHashProvider).filterForSession(this.sessionId);
  }

  public override get size(): number {
    return this.current().size;
  }

  public override get(key: string): OutboundConnection | undefined {
    return this.current().get(key);
  }

  public override has(key: string): boolean {
    return this.current().has(key);
  }

  public override entries() {
    return this.current().entries();
  }

  public override keys() {
    return this.current().keys();
  }

  public override values() {
    return this.current().values();
  }

  public override [Symbol.iterator]() {
    return this.entries();
  }

  public override forEach(
    callbackfn: (value: OutboundConnection, key: string, map: Map<string, OutboundConnection>) => void,
    thisArg?: unknown,
  ): void {
    this.current().forEach((value, key) => callbackfn.call(thisArg, value, key, this));
  }

  public override set(_key: string, _value: OutboundConnection): this {
    throw new TypeError('Session-scoped connections are read-only');
  }

  public override delete(_key: string): boolean {
    throw new TypeError('Session-scoped connections are read-only');
  }

  public override clear(): void {
    throw new TypeError('Session-scoped connections are read-only');
  }
}

/**
 * Factory function to create a ConnectionResolver with optional template hash provider.
 * This provides a simpler API for common use cases.
 */
export function createConnectionResolver(
  outboundConns: OutboundConnections,
  templateHashProvider?: TemplateHashProvider,
): ConnectionResolver {
  return new ConnectionResolver(outboundConns, templateHashProvider);
}

/**
 * Create a live, read-only view of static servers plus template instances
 * owned by the supplied session.
 */
export function createSessionScopedConnections(
  outboundConns: OutboundConnections,
  sessionId: string | undefined,
  templateHashProvider?: TemplateHashProvider,
): OutboundConnections {
  return new SessionScopedConnections(outboundConns, sessionId, templateHashProvider);
}
