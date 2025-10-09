import { ClientSessionData } from '@src/auth/sessionTypes.js';
import { AUTH_CONFIG } from '@src/constants.js';
import logger from '@src/logger/logger.js';
import { sanitizeServerName } from '@src/utils/validation/sanitization.js';

import { FileStorageService } from './fileStorageService.js';

/**
 * ClientSessionRepository handles OAuth 2.1 client session storage using the layered storage architecture.
 *
 * This repository manages client sessions for OAuth connections to downstream MCP servers.
 * It follows the same patterns as other repositories (SessionRepository, AuthCodeRepository, etc.)
 * and uses the FileStorageService for consistent data management.
 *
 * Features:
 * - Repository pattern with FileStorageService backend
 * - Server name sanitization for security
 * - Automatic expiration handling
 * - Consistent with other storage repositories
 * - Type-safe client session data management
 *
 * @example
 * ```typescript
 * const storage = new FileStorageService('/path/to/sessions');
 * const repository = new ClientSessionRepository(storage);
 *
 * const sessionData = {
 *   serverName: 'test-server',
 *   clientInfo: JSON.stringify(clientInfo),
 *   tokens: JSON.stringify(tokens),
 *   expires: Date.now() + 3600000,
 *   createdAt: Date.now()
 * };
 *
 * repository.save('test-server', sessionData, 3600000);
 * const session = repository.get('test-server');
 * ```
 */
export class ClientSessionRepository {
  constructor(private storage: FileStorageService) {}

  /**
   * Saves or updates a client session.
   *
   * @param serverName - The server name for the client session
   * @param clientSessionData - The client session data to store
   * @param ttlMs - Time to live in milliseconds
   * @returns The sanitized server name used as key
   */
  save(serverName: string, clientSessionData: ClientSessionData, ttlMs: number): string {
    const sanitizedServerName = sanitizeServerName(serverName);
    const sessionId = this.getSessionId(sanitizedServerName);

    const dataWithExpiry = {
      ...clientSessionData,
      expires: Date.now() + ttlMs,
      createdAt: clientSessionData.createdAt || Date.now(),
    };

    this.storage.writeData(AUTH_CONFIG.CLIENT.SESSION.FILE_PREFIX, sessionId, dataWithExpiry);
    logger.info(`Saved client session for server: ${serverName}`);
    return sanitizedServerName;
  }

  /**
   * Retrieves client session data by server name.
   *
   * @param serverName - The server name to retrieve client session for
   * @returns Client session data if exists and not expired, null otherwise
   */
  get(serverName: string): ClientSessionData | null {
    const sanitizedServerName = sanitizeServerName(serverName);
    const sessionId = this.getSessionId(sanitizedServerName);

    return this.storage.readData<ClientSessionData>(AUTH_CONFIG.CLIENT.SESSION.FILE_PREFIX, sessionId);
  }

  /**
   * Deletes a client session by server name.
   *
   * @param serverName - The server name to delete client session for
   * @returns True if client session was deleted, false if it didn't exist
   */
  delete(serverName: string): boolean {
    const sanitizedServerName = sanitizeServerName(serverName);
    const sessionId = this.getSessionId(sanitizedServerName);

    return this.storage.deleteData(AUTH_CONFIG.CLIENT.SESSION.FILE_PREFIX, sessionId);
  }

  /**
   * Lists all client session server names.
   *
   * This method scans the storage for client session files and extracts
   * the server names from the file names.
   *
   * @returns Array of server names that have client sessions
   */
  list(): string[] {
    // Concatenate FILE_PREFIX and ID_PREFIX to get the full prefix pattern
    const fullPrefix = AUTH_CONFIG.CLIENT.SESSION.FILE_PREFIX + AUTH_CONFIG.CLIENT.SESSION.ID_PREFIX;

    // Get all files that match the full prefix pattern
    const files = this.storage.listFiles(fullPrefix);

    // Extract server names from file names
    return files
      .map((file) => {
        // Remove full prefix and .json suffix to get the server name
        let serverName = file;

        if (serverName.startsWith(fullPrefix)) {
          serverName = serverName.substring(fullPrefix.length);
        }

        if (serverName.endsWith('.json')) {
          serverName = serverName.substring(0, serverName.length - 5);
        }

        return serverName;
      })
      .filter((serverName) => serverName.length > 0);
  }

  /**
   * Creates a standardized session ID for the server name.
   *
   * @param sanitizedServerName - The sanitized server name
   * @returns The session ID for storage
   */
  private getSessionId(sanitizedServerName: string): string {
    return `${AUTH_CONFIG.CLIENT.SESSION.ID_PREFIX}${sanitizedServerName}`;
  }
}
