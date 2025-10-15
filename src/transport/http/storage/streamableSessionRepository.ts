import { StreamableSessionData } from '@src/auth/sessionTypes.js';
import { FileStorageService } from '@src/auth/storage/fileStorageService.js';
import { AUTH_CONFIG } from '@src/constants.js';
import { InboundConnectionConfig } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';

/**
 * Repository for streamable HTTP session operations
 *
 * Manages session persistence with automatic expiration and cleanup.
 * Sessions store configuration needed to restore connections after server restart.
 */
export class StreamableSessionRepository {
  constructor(private storage: FileStorageService) {}

  /**
   * Creates a new streamable session with the given ID and configuration
   */
  create(sessionId: string, config: InboundConnectionConfig): void {
    const sessionData: StreamableSessionData = {
      tags: config.tags,
      tagExpression: config.tagExpression ? JSON.stringify(config.tagExpression) : undefined,
      tagQuery: config.tagQuery ? JSON.stringify(config.tagQuery) : undefined,
      tagFilterMode: config.tagFilterMode,
      presetName: config.presetName,
      enablePagination: config.enablePagination,
      customTemplate: config.customTemplate,
      expires: Date.now() + AUTH_CONFIG.SERVER.STREAMABLE_SESSION.TTL_MS,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    };

    this.storage.writeData(AUTH_CONFIG.SERVER.STREAMABLE_SESSION.FILE_PREFIX, sessionId, sessionData);
    logger.info(`Created streamable session: ${sessionId}`);
  }

  /**
   * Retrieves a session by ID and returns the configuration
   */
  get(sessionId: string): InboundConnectionConfig | null {
    const sessionData = this.storage.readData<StreamableSessionData>(
      AUTH_CONFIG.SERVER.STREAMABLE_SESSION.FILE_PREFIX,
      sessionId,
    );

    if (!sessionData) {
      return null;
    }

    // Parse JSON fields back to objects
    const config: InboundConnectionConfig = {
      tags: sessionData.tags,
      tagExpression: sessionData.tagExpression ? JSON.parse(sessionData.tagExpression) : undefined,
      tagQuery: sessionData.tagQuery ? JSON.parse(sessionData.tagQuery) : undefined,
      tagFilterMode: sessionData.tagFilterMode,
      presetName: sessionData.presetName,
      enablePagination: sessionData.enablePagination,
      customTemplate: sessionData.customTemplate,
    };

    return config;
  }

  /**
   * Updates the last accessed timestamp for a session
   */
  updateAccess(sessionId: string): void {
    const sessionData = this.storage.readData<StreamableSessionData>(
      AUTH_CONFIG.SERVER.STREAMABLE_SESSION.FILE_PREFIX,
      sessionId,
    );

    if (sessionData) {
      sessionData.lastAccessedAt = Date.now();
      // Extend expiration on access
      sessionData.expires = Date.now() + AUTH_CONFIG.SERVER.STREAMABLE_SESSION.TTL_MS;
      this.storage.writeData(AUTH_CONFIG.SERVER.STREAMABLE_SESSION.FILE_PREFIX, sessionId, sessionData);
      logger.debug(`Updated access time for streamable session: ${sessionId}`);
    }
  }

  /**
   * Deletes a session by ID
   */
  delete(sessionId: string): boolean {
    const result = this.storage.deleteData(AUTH_CONFIG.SERVER.STREAMABLE_SESSION.FILE_PREFIX, sessionId);
    if (result) {
      logger.info(`Deleted streamable session: ${sessionId}`);
    }
    return result;
  }
}
