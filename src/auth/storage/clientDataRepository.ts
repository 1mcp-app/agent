import { ClientData } from '@src/auth/sessionTypes.js';
import { AUTH_CONFIG } from '@src/constants.js';
import logger from '@src/logger/logger.js';
import type { OAuthClientInformationFull } from '@src/sdk/contracts/index.js';

import { FileStorageService } from './fileStorageService.js';

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
    logger.info('clientDataRepository.saved.client.data.a2a30621');
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
      logger.info('clientDataRepository.deleted.client.data.26bb95c1');
    }
    return result;
  }
}
