import logger from '@src/logger/logger.js';
import { AUTH_CONFIG } from '@src/constants.js';
import { ClientData } from '@src/auth/sessionTypes.js';
import { FileStorageService } from './fileStorageService.js';
import { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

/**
 * Repository for OAuth client data operations
 *
 * Manages registered OAuth client information with automatic expiration.
 * Client data is stored for a configurable period (default 30 days).
 */
export class ClientDataRepository {
  constructor(private storage: FileStorageService) {}

  /**
   * Saves OAuth client data
   */
  save(clientId: string, data: OAuthClientInformationFull, ttlMs: number): string {
    const clientData: ClientData = {
      ...data,
      expires: data.client_secret_expires_at ? data.client_secret_expires_at * 1000 : Date.now() + ttlMs,
      createdAt: data.client_id_issued_at ? data.client_id_issued_at * 1000 : Date.now(),
    };

    this.storage.writeData(AUTH_CONFIG.SERVER.SESSION.FILE_PREFIX, clientId, clientData);
    logger.info(`Saved client data: ${clientId}`);
    return clientId;
  }

  /**
   * Retrieves OAuth client data by client ID
   */
  get(clientId: string): OAuthClientInformationFull | null {
    const clientData = this.storage.readData<ClientData>(AUTH_CONFIG.SERVER.SESSION.FILE_PREFIX, clientId);
    return clientData;
  }

  /**
   * Deletes OAuth client data by client ID
   */
  delete(clientId: string): boolean {
    const result = this.storage.deleteData(AUTH_CONFIG.SERVER.SESSION.FILE_PREFIX, clientId);
    if (result) {
      logger.info(`Deleted client data: ${clientId}`);
    }
    return result;
  }
}
