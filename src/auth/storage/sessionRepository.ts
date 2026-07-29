import { randomUUID } from 'node:crypto';

import { SessionData, SessionDataSchema } from '@src/auth/sessionTypes.js';
import { AUTH_CONFIG } from '@src/constants.js';
import logger from '@src/logger/logger.js';

import { FileStorageService } from './fileStorageService.js';

export interface RefreshFamilyAccessSessionInput {
  tokenId: string;
  clientId: string;
  resource: string;
  scopes: string[];
  ttlMs: number;
  familyId: string;
}

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
  createWithId(
    tokenId: string,
    clientId: string,
    resource: string,
    scopes: string[],
    ttlMs: number,
    refreshFamilyId?: string,
  ): string {
    return this.persistWithId({ tokenId, clientId, resource, scopes, ttlMs, refreshFamilyId }, false);
  }

  /**
   * Persists a refresh-family access session before the family commit point.
   */
  createRefreshFamilyAccessSession(input: RefreshFamilyAccessSessionInput): string {
    return this.persistWithId(
      {
        tokenId: input.tokenId,
        clientId: input.clientId,
        resource: input.resource,
        scopes: input.scopes,
        ttlMs: input.ttlMs,
        refreshFamilyId: input.familyId,
      },
      true,
    );
  }

  private persistWithId(
    input: {
      tokenId: string;
      clientId: string;
      resource: string;
      scopes: string[];
      ttlMs: number;
      refreshFamilyId?: string;
    },
    durable: boolean,
  ): string {
    const sessionId = AUTH_CONFIG.SERVER.SESSION.ID_PREFIX + input.tokenId;
    const sessionData: SessionData = {
      clientId: input.clientId,
      resource: input.resource,
      scopes: input.scopes,
      refreshFamilyId: input.refreshFamilyId,
      expires: Date.now() + input.ttlMs,
      createdAt: Date.now(),
    };

    if (durable) {
      this.storage.writeDataDurable(AUTH_CONFIG.SERVER.SESSION.FILE_PREFIX, sessionId, sessionData);
    } else {
      this.storage.writeData(AUTH_CONFIG.SERVER.SESSION.FILE_PREFIX, sessionId, sessionData);
    }
    logger.info(`Created session with ID: ${sessionId} for client: ${input.clientId}`);
    return sessionId;
  }

  /**
   * Retrieves a session by ID
   */
  get(sessionId: string): SessionData | null {
    return this.storage.readData<SessionData>(AUTH_CONFIG.SERVER.SESSION.FILE_PREFIX, sessionId, SessionDataSchema);
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
