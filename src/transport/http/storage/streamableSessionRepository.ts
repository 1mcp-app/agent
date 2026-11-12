import { StreamableSessionAuthorizationBinding, StreamableSessionData } from '@src/auth/sessionTypes.js';
import { FileStorageService } from '@src/auth/storage/fileStorageService.js';
import { AUTH_CONFIG } from '@src/constants.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { InboundConnectionConfig } from '@src/core/types/index.js';
import { TagExpression } from '@src/domains/preset/parsers/tagQueryParser.js';
import { TagQuery } from '@src/domains/preset/types/presetTypes.js';
import logger from '@src/logger/logger.js';
import { canonicalSessionBinding } from '@src/transport/http/streamableSessionAuthorization.js';
import { logError } from '@src/transport/http/utils/unifiedLogger.js';

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

  private readonly protectedSessions = new Map<string, number>();
  private readonly protectedPersistedExpiries = new Map<string, number>();
  private expirationHandler?: (sessionIds: string[]) => Promise<void>;

  setExpirationHandler(handler: (sessionIds: string[]) => Promise<void>): void {
    this.expirationHandler = handler;
  }

  isExpired(sessionId: string): boolean {
    const data = this.inMemorySessions.get(sessionId);
    if (!data) return false;
    if (this.protectedSessions.has(sessionId)) return false;
    return data.expires <= Date.now();
  }

  getExpiredSessionIds(): string[] {
    return [...this.inMemorySessions.keys()].filter((sessionId) => this.isExpired(sessionId));
  }

  /** Protect both request work and the complete lifetime of an open response stream. */
  protectSession(sessionId: string): (accepted?: boolean) => void {
    const session = this.inMemorySessions.get(sessionId);
    this.protectedSessions.set(sessionId, (this.protectedSessions.get(sessionId) ?? 0) + 1);
    this.refreshProtectedSession(sessionId);
    let released = false;
    return (accepted = true) => {
      if (released) return;
      released = true;
      if (this.inMemorySessions.get(sessionId) !== session) return;
      const remaining = (this.protectedSessions.get(sessionId) ?? 1) - 1;
      if (remaining > 0) this.protectedSessions.set(sessionId, remaining);
      else this.protectedSessions.delete(sessionId);
      // Work that stayed active beyond the TTL gets a full idle interval after completion.
      if (accepted && this.inMemorySessions.has(sessionId)) this.updateAccess(sessionId);
      if (remaining > 0) return;
      if (!session) return;
      if (!this.protectedPersistedExpiries.has(sessionId)) return;
      // Restore the real idle deadline, including an unchanged deadline for rejected work.
      this.lastAccessTimes.set(sessionId, session.lastAccessedAt);
      this.dirtySessionIds.add(sessionId);
      try {
        this.persistSessionAccess(sessionId, session.lastAccessedAt);
      } catch (error) {
        logError('streamableSessionRepository.failed.to.persist.background.session.access.f1b04c62', {
          method: 'releaseProtection',
          sessionId,
          error,
        });
      }
    };
  }

  // Background flush
  private flushInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private storage: FileStorageService) {
    this.startPeriodicFlush();
  }

  /**
   * Creates a new streamable session with the given ID and configuration
   */
  create(
    sessionId: string,
    config: InboundConnectionConfig,
    authorizationBinding?: StreamableSessionAuthorizationBinding,
  ): void {
    const sessionData: StreamableSessionData = {
      ...(authorizationBinding ? { authorizationBinding: canonicalSessionBinding(authorizationBinding) } : {}),
      tags: config.tags,
      tagExpression: config.tagExpression ? JSON.stringify(config.tagExpression) : undefined,
      tagQuery: config.tagQuery ? JSON.stringify(config.tagQuery) : undefined,
      tagFilterMode: config.tagFilterMode,
      presetName: config.presetName,
      enablePagination: config.enablePagination,
      customTemplate: config.customTemplate,
      context: config.context,
      contextProof: config.contextProof,
      expires: Date.now() + this.getSessionTtlMs(),
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    };

    // Always store in memory
    this.inMemorySessions.set(sessionId, sessionData);

    // Conditionally persist to disk
    const agentConfig = AgentConfigManager.getInstance();
    if (agentConfig.get('features').sessionPersistence) {
      this.writeSessionData(sessionId, sessionData);
      logger.info('streamableSessionRepository.created.streamable.session.with.persistence.557ffb00');
    } else {
      logger.info('streamableSessionRepository.created.streamable.session.memory.only.177edf2d');
    }
  }

  /**
   * Retrieves raw session data by ID including initialize response data.
   *
   * This returns the full StreamableSessionData object, not just the config.
   * Used for session restoration where we need access to initialize response data.
   *
   * @param sessionId - The session ID to retrieve
   * @returns The full session data including initializeResponse, or null if not found
   */
  getSessionData(sessionId: string): StreamableSessionData | null {
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

    if (this.isExpired(sessionId)) return null;
    return sessionData || null;
  }

  /**
   * Retrieves a session by ID and returns the configuration
   */
  get(sessionId: string): InboundConnectionConfig | null {
    const sessionData = this.getSessionData(sessionId);
    if (!sessionData) return null;

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
        logger.warn('streamableSessionRepository.failed.to.parse.tagexpression.for.session.3062cdba', { error: error });
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
        logger.warn('streamableSessionRepository.failed.to.parse.tagquery.for.session.e2fdea72', { error: error });
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
      context: sessionData.context,
      contextProof: sessionData.contextProof,
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
      sessionData.expires = now + this.getSessionTtlMs();
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
   * Stores initialize response data for a session to enable proper restoration.
   *
   * This data is used to replay the initialize handshake through the SDK's
   * public API during session restoration, avoiding fragile private property access.
   *
   * @param sessionId - The session ID to update
   * @param initializeResponse - The initialize response data to store
   */
  storeInitializeResponse(
    sessionId: string,
    initializeResponse: {
      protocolVersion: string;
      capabilities: Record<string, unknown>;
      serverInfo: { name: string; version: string };
    },
  ): void {
    try {
      let sessionData = this.inMemorySessions.get(sessionId);

      // If not in memory, try reading from disk
      if (!sessionData) {
        const agentConfig = AgentConfigManager.getInstance();
        if (agentConfig.get('features').sessionPersistence) {
          try {
            const diskData = this.storage.readData<StreamableSessionData>(
              AUTH_CONFIG.SERVER.STREAMABLE_SESSION.FILE_PREFIX,
              sessionId,
            );
            if (diskData) {
              sessionData = diskData;
              this.inMemorySessions.set(sessionId, diskData);
            }
          } catch (readError) {
            logError(
              'streamableSessionRepository.failed.to.read.session.from.disk.for.initialize.response.storage.53a45f52',
              { method: 'storeInitializeResponse', sessionId: sessionId, error: readError },
            );
            return;
          }
        }
      }

      if (sessionData) {
        sessionData.initializeResponse = initializeResponse;

        // Persist to disk if enabled
        const agentConfig = AgentConfigManager.getInstance();
        if (agentConfig.get('features').sessionPersistence) {
          try {
            this.writeSessionData(sessionId, sessionData);
          } catch (writeError) {
            logError('streamableSessionRepository.failed.to.persist.initialize.response.to.disk.1670d212', {
              method: 'storeInitializeResponse',
              sessionId: sessionId,
              error: writeError,
            });
            // Session is in memory, so continue with warning
          }
        }
        logger.debug('streamableSessionRepository.stored.initialize.response.for.session.0bb8db59');
      } else {
        logError('streamableSessionRepository.session.not.found.for.storing.initialize.response.953c2a35', {
          method: 'storeInitializeResponse',
          sessionId: sessionId,
        });
      }
    } catch (error) {
      logError('streamableSessionRepository.unexpected.error.storing.initialize.response.c53c0757', {
        method: 'storeInitializeResponse',
        sessionId: sessionId,
        error: error,
      });
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
    this.protectedSessions.delete(sessionId);
    this.protectedPersistedExpiries.delete(sessionId);

    // Delete from disk if persistence is enabled
    const agentConfig = AgentConfigManager.getInstance();
    if (agentConfig.get('features').sessionPersistence) {
      const result = this.storage.deleteData(AUTH_CONFIG.SERVER.STREAMABLE_SESSION.FILE_PREFIX, sessionId);
      if (result) {
        logger.info('streamableSessionRepository.deleted.streamable.session.3753f41c');
      }
      return result;
    } else {
      logger.info('streamableSessionRepository.deleted.streamable.session.from.memory.b7e93c14');
      return true;
    }
  }

  private writeSessionData(sessionId: string, data: StreamableSessionData): void {
    if (!this.protectedSessions.has(sessionId)) {
      this.storage.writeData(AUTH_CONFIG.SERVER.STREAMABLE_SESSION.FILE_PREFIX, sessionId, data);
      this.protectedPersistedExpiries.delete(sessionId);
      return;
    }
    const expires = Math.max(data.expires, Date.now() + this.getSessionTtlMs());
    this.storage.writeData(AUTH_CONFIG.SERVER.STREAMABLE_SESSION.FILE_PREFIX, sessionId, { ...data, expires });
    this.protectedPersistedExpiries.set(sessionId, expires);
  }

  /** Persist a lease projection without changing the accepted-activity idle deadline. */
  private refreshProtectedSession(sessionId: string): void {
    if (!AgentConfigManager.getInstance().get('features').sessionPersistence) return;
    const data = this.inMemorySessions.get(sessionId);
    if (!data) return;
    const expires = this.protectedPersistedExpiries.get(sessionId) ?? data.expires;
    if (expires > Date.now() + this.getSessionTtlMs() / 2) return;
    try {
      this.writeSessionData(sessionId, data);
    } catch (error) {
      logError('streamableSessionRepository.failed.to.persist.background.session.access.f1b04c62', {
        method: 'refreshProtection',
        sessionId,
        error,
      });
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
      sessionData.expires = accessTime + this.getSessionTtlMs();
      this.writeSessionData(sessionId, sessionData);

      // Reset counters and update persist time
      this.lastPersistTimes.set(sessionId, accessTime);
      this.requestCounts.set(sessionId, 0);
      this.dirtySessionIds.delete(sessionId);

      logger.debug('streamableSessionRepository.persisted.access.time.for.streamable.session.014d887e');
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
        try {
          this.persistSessionAccess(sessionId, lastAccess);
        } catch (error) {
          logError('streamableSessionRepository.failed.to.persist.background.session.access.f1b04c62', {
            method: 'flushDirtySessions',
            sessionId: sessionId,
            error: error,
          });
        }
      }
    }

    logger.debug('streamableSessionRepository.flushed.dirty.sessions.a83d53f1');
  }

  /**
   * Starts periodic background flush of dirty sessions
   */
  private startPeriodicFlush(): void {
    // Get flush interval from config
    const agentConfig = AgentConfigManager.getInstance();
    let flushIntervalMs = agentConfig.get('sessionPersistence').backgroundFlushSeconds * 1000;
    if (!Number.isFinite(flushIntervalMs)) flushIntervalMs = 60_000;
    flushIntervalMs = Math.max(1000, flushIntervalMs);
    let ttlMs = this.getSessionTtlMs();
    if (!Number.isFinite(ttlMs)) ttlMs = flushIntervalMs * 2;
    const intervalMs = Math.max(1000, Math.min(flushIntervalMs, ttlMs / 2));

    this.flushInterval = setInterval(() => {
      const expired = this.getExpiredSessionIds();
      if (this.expirationHandler) {
        void this.expirationHandler(expired);
      } else {
        for (const sessionId of expired) this.delete(sessionId);
      }
      this.flushDirtySessions();
      for (const sessionId of this.protectedSessions.keys()) this.refreshProtectedSession(sessionId);
    }, intervalMs);
    this.flushInterval.unref?.();
  }

  private getSessionTtlMs(): number {
    return AgentConfigManager.getInstance().getSessionTtlMinutes() * 60 * 1000;
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
    logger.info('streamableSessionRepository.stopped.periodic.flush.and.flushed.remaining.dirty.sessions.8bacd338');
  }
}
