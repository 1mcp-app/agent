import { randomUUID } from 'node:crypto';
import logger from '@src/logger/logger.js';
import { AUTH_CONFIG } from '@src/constants.js';
import { SessionData } from '@src/auth/sessionTypes.js';
import { FileStorageService } from './fileStorageService.js';

/**
 * Repository for session operations
 *
 * Manages OAuth 2.1 sessions with automatic expiration and cleanup.
 * Sessions store user authorization state and granted scopes.
 */
export class SessionRepository {
  constructor(private storage: FileStorageService) {}

  /**
   * Creates a new session
   */
  create(clientId: string, resource: string, scopes: string[], ttlMs: number): string {
    const sessionId = AUTH_CONFIG.SERVER.SESSION.ID_PREFIX + randomUUID();
    const sessionData: SessionData = {
      clientId,
      resource,
      scopes,
      expires: Date.now() + ttlMs,
      createdAt: Date.now(),
    };

    this.storage.writeData(AUTH_CONFIG.SERVER.SESSION.FILE_PREFIX, sessionId, sessionData);
    logger.info(`Created session: ${sessionId} for client: ${clientId}`);
    return sessionId;
  }

  /**
   * Creates a session with a specific token ID (for access tokens)
   */
  createWithId(tokenId: string, clientId: string, resource: string, scopes: string[], ttlMs: number): string {
    const sessionId = AUTH_CONFIG.SERVER.SESSION.ID_PREFIX + tokenId;
    const sessionData: SessionData = {
      clientId,
      resource,
      scopes,
      expires: Date.now() + ttlMs,
      createdAt: Date.now(),
    };

    this.storage.writeData(AUTH_CONFIG.SERVER.SESSION.FILE_PREFIX, sessionId, sessionData);
    logger.info(`Created session with ID: ${sessionId} for client: ${clientId}`);
    return sessionId;
  }

  /**
   * Retrieves a session by ID
   */
  get(sessionId: string): SessionData | null {
    return this.storage.readData<SessionData>(AUTH_CONFIG.SERVER.SESSION.FILE_PREFIX, sessionId);
  }

  /**
   * Deletes a session by ID
   */
  delete(sessionId: string): boolean {
    const result = this.storage.deleteData(AUTH_CONFIG.SERVER.SESSION.FILE_PREFIX, sessionId);
    if (result) {
      logger.info(`Deleted session: ${sessionId}`);
    }
    return result;
  }
}
