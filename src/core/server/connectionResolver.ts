import type { OutboundConnection, OutboundConnections } from '@src/core/types/client.js';
import { errorIf } from '@src/logger/logger.js';

import {
  createRenderedIdentity,
  createSessionIdentity,
  createStaticIdentity,
  parseTemplateConnectionKey,
  serializeTemplateIdentity,
  type TemplateIdentity,
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
 * 1. Try session-scoped key (for per-client template servers: name:sessionId)
 * 2. Try rendered hash-based key (for shareable template servers: name:renderedHash)
 * 3. Fall back to direct name lookup (for static servers: name)
 */
export class ConnectionResolver {
  constructor(
    private readonly outboundConns: OutboundConnections,
    private readonly templateHashProvider?: TemplateHashProvider,
  ) {}

  resolveWithKey(clientName: string, sessionId?: string): { key: string; connection: OutboundConnection } | undefined {
    const candidates: TemplateIdentity[] = [];
    if (sessionId) {
      candidates.push(createSessionIdentity(clientName, sessionId));
    }

    if (sessionId && this.templateHashProvider) {
      try {
        const renderedHash = this.templateHashProvider.getRenderedHashForSession(sessionId, clientName);
        if (renderedHash) {
          candidates.push(createRenderedIdentity(clientName, renderedHash));
        }
      } catch (error) {
        errorIf(() => ({
          message: 'Failed to get rendered hash for template connection lookup',
          meta: { clientName, sessionId, error: error instanceof Error ? error.message : String(error) },
        }));
      }
    }

    candidates.push(createStaticIdentity(clientName));

    for (const identity of candidates) {
      const key = serializeTemplateIdentity(identity);
      const conn = this.outboundConns.get(key);
      if (conn) {
        return { key, connection: conn };
      }
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

    // Get rendered hashes for this session
    const sessionHashes = this.getSessionRenderedHashes(sessionId);

    for (const [key, conn] of this.outboundConns.entries()) {
      const identity = parseTemplateConnectionKey(key);
      if (identity.kind === 'invalid') {
        errorIf(() => ({
          message: 'Invalid connection key format: expected clean name or exactly one colon delimiter',
          meta: { key },
        }));
        continue;
      }

      // Static servers (no : in key) - always include
      if (identity.kind === 'static') {
        filtered.set(key, conn);
        continue;
      }

      // Per-client template servers (format: name:sessionId) - only include if session matches
      const suffix = identity.kind === 'session' ? identity.sessionId : identity.renderedHash;

      if (suffix === sessionId) {
        filtered.set(key, conn);
        continue;
      }

      // Shareable template servers (format: name:renderedHash) - include if this session uses this hash
      if (
        sessionHashes &&
        sessionHashes.has(identity.templateName) &&
        sessionHashes.get(identity.templateName) === suffix
      ) {
        filtered.set(key, conn);
      }
    }

    return filtered;
  }

  /**
   * Get all rendered hashes for a specific session.
   * @param sessionId The session ID (optional)
   * @returns Map of templateName to renderedHash, or undefined if no session
   */
  private getSessionRenderedHashes(sessionId?: string): Map<string, string> | undefined {
    if (!sessionId || !this.templateHashProvider) {
      return undefined;
    }
    return this.templateHashProvider.getAllRenderedHashesForSession(sessionId);
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
 * Factory function to create a ConnectionResolver with optional template hash provider.
 * This provides a simpler API for common use cases.
 */
export function createConnectionResolver(
  outboundConns: OutboundConnections,
  templateHashProvider?: TemplateHashProvider,
): ConnectionResolver {
  return new ConnectionResolver(outboundConns, templateHashProvider);
}
