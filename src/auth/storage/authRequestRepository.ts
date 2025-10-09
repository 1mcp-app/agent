import { randomUUID } from 'node:crypto';
import logger from '@src/logger/logger.js';
import { AUTH_CONFIG } from '@src/constants.js';
import { AuthRequestData } from '@src/auth/sessionTypes.js';
import { FileStorageService } from './fileStorageService.js';

/**
 * Repository for authorization request operations
 *
 * Manages temporary authorization requests used in the consent flow.
 * These store OAuth parameters securely server-side while user reviews consent.
 */
export class AuthRequestRepository {
  constructor(private storage: FileStorageService) {}

  /**
   * Creates a new authorization request
   */
  create(
    clientId: string,
    redirectUri: string,
    codeChallenge?: string,
    state?: string,
    resource?: string,
    scopes?: string[],
  ): string {
    const authRequestId = AUTH_CONFIG.SERVER.AUTH_REQUEST.ID_PREFIX + randomUUID();
    const authRequestData: AuthRequestData = {
      clientId,
      redirectUri,
      codeChallenge,
      state,
      resource,
      scopes,
      expires: Date.now() + AUTH_CONFIG.SERVER.AUTH_REQUEST.TTL_MS,
      createdAt: Date.now(),
    };

    this.storage.writeData(AUTH_CONFIG.SERVER.AUTH_REQUEST.FILE_PREFIX, authRequestId, authRequestData);
    logger.info(`Created auth request: ${authRequestId} for client: ${clientId}`);
    return authRequestId;
  }

  /**
   * Retrieves authorization request data by ID
   */
  get(authRequestId: string): AuthRequestData | null {
    return this.storage.readData<AuthRequestData>(AUTH_CONFIG.SERVER.AUTH_REQUEST.FILE_PREFIX, authRequestId);
  }

  /**
   * Deletes an authorization request by ID
   */
  delete(authRequestId: string): boolean {
    const result = this.storage.deleteData(AUTH_CONFIG.SERVER.AUTH_REQUEST.FILE_PREFIX, authRequestId);
    if (result) {
      logger.info(`Deleted auth request: ${authRequestId}`);
    }
    return result;
  }
}
