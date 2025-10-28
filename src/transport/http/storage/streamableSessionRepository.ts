import { StreamableSessionData } from '@src/auth/sessionTypes.js';
import { FileStorageService } from '@src/auth/storage/fileStorageService.js';
import { AUTH_CONFIG } from '@src/constants.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { InboundConnectionConfig } from '@src/core/types/index.js';
import { TagExpression } from '@src/domains/preset/parsers/tagQueryParser.js';
import { TagQuery } from '@src/domains/preset/types/presetTypes.js';
import logger from '@src/logger/logger.js';

/**
 * Repository for streamable HTTP session operations
 *
 * Manages session persistence with automatic expiration and cleanup.
 * Sessions store configuration needed to restore connections after server restart.
 *
 * Uses Redis-style dual-trigger persistence for performance:
 * - Persists after N requests OR M minutes, whichever comes first
 * - Background flush every 60 seconds for dirty sessions
 */
export class StreamableSessionRepository {
  // Per-session tracking for dual-trigger persistence
  private lastPersistTimes = new Map<string, number>();
  private lastAccessTimes = new Map<string, number>();
  private requestCounts = new Map<string, number>();
  private dirtySessionIds = new Set<string>();

  // In-memory session store (used when persistence is disabled or as cache)
  private inMemorySessions = new Map<string, StreamableSessionData>();

  // Background flush
  private flushInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private storage: FileStorageService) {
    this.startPeriodicFlush();
  }

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

    // Always store in memory
    this.inMemorySessions.set(sessionId, sessionData);

    // Conditionally persist to disk
    const agentConfig = AgentConfigManager.getInstance();
    if (agentConfig.get('features').sessionPersistence) {
      this.storage.writeData(AUTH_CONFIG.SERVER.STREAMABLE_SESSION.FILE_PREFIX, sessionId, sessionData);
      logger.info(`Created streamable session with persistence: ${sessionId}`);
    } else {
      logger.info(`Created streamable session (memory-only): ${sessionId}`);
    }
  }

  /**
   * Retrieves a session by ID and returns the configuration
   */
  get(sessionId: string): InboundConnectionConfig | null {
    // Check in-memory store first
    let sessionData = this.inMemorySessions.get(sessionId);

    // If not in memory and persistence is enabled, try reading from disk
    if (!sessionData) {
      const agentConfig = AgentConfigManager.getInstance();
      if (agentConfig.get('features').sessionPersistence) {
        const diskData = this.storage.readData<StreamableSessionData>(
          AUTH_CONFIG.SERVER.STREAMABLE_SESSION.FILE_PREFIX,
          sessionId,
        );
        // Cache in memory if found
        if (diskData) {
          sessionData = diskData;
          this.inMemorySessions.set(sessionId, diskData);
        }
      }
    }

    if (!sessionData) {
      return null;
    }

    // Parse JSON fields back to objects with proper error handling
    let tagExpression: TagExpression | undefined;
    if (sessionData.tagExpression) {
      try {
        const parsed = JSON.parse(sessionData.tagExpression) as unknown;
        // Validate that the parsed object conforms to TagExpression interface
        if (parsed && typeof parsed === 'object' && 'type' in parsed) {
          tagExpression = parsed as TagExpression;
        }
      } catch (error) {
        logger.warn(`Failed to parse tagExpression for session ${sessionId}:`, error);
      }
    }

    let tagQuery: TagQuery | undefined;
    if (sessionData.tagQuery) {
      try {
        const parsed = JSON.parse(sessionData.tagQuery) as unknown;
        // Validate that the parsed object conforms to TagQuery interface
        if (parsed && typeof parsed === 'object') {
          tagQuery = parsed as TagQuery;
        }
      } catch (error) {
        logger.warn(`Failed to parse tagQuery for session ${sessionId}:`, error);
      }
    }

    const config: InboundConnectionConfig = {
      tags: sessionData.tags,
      tagExpression,
      tagQuery,
      tagFilterMode: sessionData.tagFilterMode,
      presetName: sessionData.presetName,
      enablePagination: sessionData.enablePagination,
      customTemplate: sessionData.customTemplate,
    };

    return config;
  }

  /**
   * Updates the last accessed timestamp for a session with dual-trigger persistence
   *
   * Uses Redis-style save policy: persists after N requests OR M minutes, whichever comes first.
   * Always updates in-memory timestamps to prevent data loss.
   */
  updateAccess(sessionId: string): void {
    const now = Date.now();

    // Always update in-memory timestamps
    this.lastAccessTimes.set(sessionId, now);
    const count = (this.requestCounts.get(sessionId) || 0) + 1;
    this.requestCounts.set(sessionId, count);
    this.dirtySessionIds.add(sessionId);

    // Update in-memory session data
    const sessionData = this.inMemorySessions.get(sessionId);
    if (sessionData) {
      sessionData.lastAccessedAt = now;
      sessionData.expires = now + AUTH_CONFIG.SERVER.STREAMABLE_SESSION.TTL_MS;
    }

    // Check if persistence is enabled
    const agentConfig = AgentConfigManager.getInstance();
    if (!agentConfig.get('features').sessionPersistence) {
      return;
    }

    // Check dual triggers: N requests OR M minutes (using configurable values)
    const lastPersist = this.lastPersistTimes.get(sessionId) || 0;
    const timeSince = now - lastPersist;
    const persistRequests = agentConfig.get('sessionPersistence').persistRequests;
    const persistIntervalMs = agentConfig.get('sessionPersistence').persistIntervalMinutes * 60 * 1000;

    if (count >= persistRequests || timeSince >= persistIntervalMs) {
      this.persistSessionAccess(sessionId, now);
    }
  }

  /**
   * Deletes a session by ID
   */
  delete(sessionId: string): boolean {
    // Clean up in-memory tracking
    this.lastPersistTimes.delete(sessionId);
    this.lastAccessTimes.delete(sessionId);
    this.requestCounts.delete(sessionId);
    this.dirtySessionIds.delete(sessionId);
    this.inMemorySessions.delete(sessionId);

    // Delete from disk if persistence is enabled
    const agentConfig = AgentConfigManager.getInstance();
    if (agentConfig.get('features').sessionPersistence) {
      const result = this.storage.deleteData(AUTH_CONFIG.SERVER.STREAMABLE_SESSION.FILE_PREFIX, sessionId);
      if (result) {
        logger.info(`Deleted streamable session: ${sessionId}`);
      }
      return result;
    } else {
      logger.info(`Deleted streamable session from memory: ${sessionId}`);
      return true;
    }
  }

  /**
   * Persists session access to disk and resets counters
   */
  private persistSessionAccess(sessionId: string, accessTime: number): void {
    // Check if persistence is enabled (defensive check)
    const agentConfig = AgentConfigManager.getInstance();
    if (!agentConfig.get('features').sessionPersistence) {
      return;
    }

    // Get session data from in-memory store or disk
    let sessionData = this.inMemorySessions.get(sessionId);
    if (!sessionData) {
      const diskData = this.storage.readData<StreamableSessionData>(
        AUTH_CONFIG.SERVER.STREAMABLE_SESSION.FILE_PREFIX,
        sessionId,
      );
      if (diskData) {
        sessionData = diskData;
      }
    }

    if (sessionData) {
      sessionData.lastAccessedAt = accessTime;
      // Extend expiration on access
      sessionData.expires = accessTime + AUTH_CONFIG.SERVER.STREAMABLE_SESSION.TTL_MS;
      this.storage.writeData(AUTH_CONFIG.SERVER.STREAMABLE_SESSION.FILE_PREFIX, sessionId, sessionData);

      // Reset counters and update persist time
      this.lastPersistTimes.set(sessionId, accessTime);
      this.requestCounts.set(sessionId, 0);
      this.dirtySessionIds.delete(sessionId);

      logger.debug(`Persisted access time for streamable session: ${sessionId}`);
    }
  }

  /**
   * Flushes all dirty sessions to disk
   */
  private flushDirtySessions(): void {
    // Check if persistence is enabled
    const agentConfig = AgentConfigManager.getInstance();
    if (!agentConfig.get('features').sessionPersistence) {
      return;
    }

    if (this.dirtySessionIds.size === 0) {
      return;
    }

    const sessionsToFlush = Array.from(this.dirtySessionIds);

    for (const sessionId of sessionsToFlush) {
      const lastAccess = this.lastAccessTimes.get(sessionId);
      if (lastAccess) {
        this.persistSessionAccess(sessionId, lastAccess);
      }
    }

    logger.debug(`Flushed ${sessionsToFlush.length} dirty sessions`);
  }

  /**
   * Starts periodic background flush of dirty sessions
   */
  private startPeriodicFlush(): void {
    // Get flush interval from config
    const agentConfig = AgentConfigManager.getInstance();
    const flushIntervalMs = agentConfig.get('sessionPersistence').backgroundFlushSeconds * 1000;

    this.flushInterval = setInterval(() => {
      this.flushDirtySessions();
    }, flushIntervalMs);
  }

  /**
   * Stops periodic flush and performs final flush of all dirty sessions
   */
  public stopPeriodicFlush(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    // Final flush of all dirty sessions
    this.flushDirtySessions();
    logger.info('Stopped periodic flush and flushed remaining dirty sessions');
  }
}
