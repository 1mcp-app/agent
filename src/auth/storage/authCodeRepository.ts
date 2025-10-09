import { randomUUID } from 'node:crypto';
import logger from '@src/logger/logger.js';
import { AUTH_CONFIG } from '@src/constants.js';
import { AuthCodeData } from '@src/auth/sessionTypes.js';
import { FileStorageService } from './fileStorageService.js';

/**
 * Repository for authorization code operations
 *
 * Manages OAuth 2.1 authorization codes for token exchange.
 * Authorization codes are short-lived (1 minute) and single-use.
 */
export class AuthCodeRepository {
  constructor(private storage: FileStorageService) {}

  /**
   * Creates a new authorization code
   */
  create(
    clientId: string,
    redirectUri: string,
    resource: string,
    scopes: string[],
    ttlMs: number,
    codeChallenge?: string,
  ): string {
    const code = AUTH_CONFIG.SERVER.AUTH_CODE.ID_PREFIX + randomUUID();
    const authCodeData: AuthCodeData = {
      clientId,
      redirectUri,
      resource,
      scopes,
      codeChallenge,
      expires: Date.now() + ttlMs,
      createdAt: Date.now(),
    };

    this.storage.writeData(AUTH_CONFIG.SERVER.AUTH_CODE.FILE_PREFIX, code, authCodeData);
    logger.info(`Created auth code: ${code} for client: ${clientId}`);
    return code;
  }

  /**
   * Retrieves authorization code data by code
   */
  get(code: string): AuthCodeData | null {
    return this.storage.readData<AuthCodeData>(AUTH_CONFIG.SERVER.AUTH_CODE.FILE_PREFIX, code);
  }

  /**
   * Deletes an authorization code by code
   */
  delete(code: string): boolean {
    const result = this.storage.deleteData(AUTH_CONFIG.SERVER.AUTH_CODE.FILE_PREFIX, code);
    if (result) {
      logger.info(`Deleted auth code: ${code}`);
    }
    return result;
  }
}
