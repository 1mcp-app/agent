import { randomUUID } from 'node:crypto';

import {
  type BoundClientSession,
  BoundClientSessionSchema,
  OAUTH_AUTHORITY_TTL_MS,
  OAUTH_MAX_ATTEMPTS,
  type OAuthAttempt,
  type OAuthAuthority,
  type OAuthAuthorityContext,
  oauthAuthorityError,
  oauthConfigurationFingerprintAsync,
  oauthDigest,
  sameAuthority,
} from '@src/auth/oauthAuthority.js';
import { ClientSessionData } from '@src/auth/sessionTypes.js';
import { AUTH_CONFIG } from '@src/constants.js';
import logger from '@src/logger/logger.js';
import { sanitizeServerName } from '@src/utils/validation/sanitization.js';

import { z } from 'zod';

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

  async claimContext(slot: string, context: OAuthAuthorityContext, observedGeneration: string | null): Promise<string> {
    // Derivation must not block the event loop or hold the cross-process slot lock.
    const fingerprint = await oauthConfigurationFingerprintAsync(context, slot);
    return this.storage.withExclusiveLock(`oauth-${slot}`, () => {
      const current = this.getClaim(slot);
      const joiningInitial =
        observedGeneration === null && current?.joinable === true && current.fingerprint === fingerprint;
      if (!joiningInitial && (current?.generation ?? null) !== observedGeneration) throw oauthAuthorityError();
      if (current?.fingerprint === fingerprint) return current.generation;
      const generation = randomUUID();
      this.storage.writeDataDurable('oauth-context-', slot, {
        fingerprint,
        generation,
        destinations: {},
        requestVersion: 0,
        joinable: current === null,
        createdAt: Date.now(),
        expires: Date.now() + OAUTH_AUTHORITY_TTL_MS,
      });
      return generation;
    });
  }

  getClaim(slot: string) {
    return this.storage.readData(
      'oauth-context-',
      slot,
      z.object({
        requestVersion: z.number().int().nonnegative().default(0),
        joinable: z.boolean().default(false),
        fingerprint: z.string(),
        generation: z.string(),
        destinations: z.record(z.string(), z.string()).default({}),
        createdAt: z.number(),
        expires: z.number(),
      }),
    );
  }

  async reserveRequest(slot: string, generation: string): Promise<number> {
    return this.storage.withExclusiveLock(`oauth-${slot}`, () => {
      const claim = this.getClaim(slot);
      if (!claim || claim.generation !== generation) throw oauthAuthorityError();
      return claim.requestVersion;
    });
  }

  async pinDestination(slot: string, generation: string, host: string, addresses: string): Promise<void> {
    const current = this.getClaim(slot);
    if (!current || current.generation !== generation) throw oauthAuthorityError();
    const renewBefore = Date.now() + OAUTH_AUTHORITY_TTL_MS - 24 * 60 * 60 * 1000;
    const bound = this.getBound(slot);
    const boundNeedsRenewal = bound ? bound.generation !== generation || bound.expires <= renewBefore : false;
    // Read current ownership on every request; caching it would miss another process's invalidation.
    if (current.destinations[host] === addresses && current.expires > renewBefore && !boundNeedsRenewal) return;
    await this.storage.withExclusiveLock(`oauth-${slot}`, () => {
      const claim = this.getClaim(slot);
      if (!claim || claim.generation !== generation) throw oauthAuthorityError();
      const renewBefore = Date.now() + OAUTH_AUTHORITY_TTL_MS - 24 * 60 * 60 * 1000;
      const record = this.getBound(slot);
      if (record?.generation === generation && record.expires <= renewBefore) {
        record.expires = Date.now() + OAUTH_AUTHORITY_TTL_MS;
        this.storage.writeDataDurable('oauth-bound-', slot, record);
      }
      if (claim.destinations[host] === addresses && claim.expires > renewBefore) return;
      if (!claim.destinations[host] && Object.keys(claim.destinations).length >= 32) throw oauthAuthorityError();
      // Each request validates DNS and pins its own socket; public answers may rotate.
      claim.destinations[host] = addresses;
      claim.expires = Date.now() + OAUTH_AUTHORITY_TTL_MS;
      this.storage.writeDataDurable('oauth-context-', slot, claim);
    });
  }

  getBound(slot: string): BoundClientSession | null {
    return this.storage.readData('oauth-bound-', slot, BoundClientSessionSchema);
  }

  async activate(
    slot: string,
    authority: OAuthAuthority,
    discovery: string,
    claim: string,
    requestVersion?: number,
  ): Promise<BoundClientSession> {
    return this.storage.withExclusiveLock(`oauth-${slot}`, () => {
      const authorityClaim = this.getClaim(slot);
      if (authorityClaim?.generation !== claim) throw oauthAuthorityError();
      if (requestVersion !== undefined && authorityClaim.requestVersion !== requestVersion) throw oauthAuthorityError();
      authorityClaim.requestVersion++;
      authorityClaim.expires = Date.now() + OAUTH_AUTHORITY_TTL_MS;
      this.storage.writeDataDurable('oauth-context-', slot, authorityClaim);
      const current = this.getBound(slot);
      if (current && current.generation === claim && sameAuthority(current.authority, authority)) {
        current.discovery = discovery;
        current.expires = Date.now() + OAUTH_AUTHORITY_TTL_MS;
        this.storage.writeDataDurable('oauth-bound-', slot, current);
        return current;
      }
      let generation = claim;
      if (current && current.generation === claim) {
        generation = randomUUID();
        this.storage.writeDataDurable('oauth-context-', slot, { ...this.getClaim(slot)!, generation, joinable: false });
      }
      const record: BoundClientSession = {
        authority,
        discovery,
        generation,
        revision: 0,
        attempts: {},
        createdAt: Date.now(),
        expires: Date.now() + OAUTH_AUTHORITY_TTL_MS,
      };
      this.storage.writeDataDurable('oauth-bound-', slot, record);
      return record;
    });
  }

  async updateBound(
    slot: string,
    generation: string,
    operation: (record: BoundClientSession) => void,
    requestVersion?: number,
  ): Promise<BoundClientSession> {
    return this.storage.withExclusiveLock(`oauth-${slot}`, () => {
      const record = this.getBound(slot);
      const claim = this.getClaim(slot);
      if (!record || record.generation !== generation || claim?.generation !== generation) throw oauthAuthorityError();
      if (requestVersion !== undefined && claim.requestVersion !== requestVersion) throw oauthAuthorityError();
      operation(record);
      if (requestVersion !== undefined) claim.requestVersion++;
      if (record.generation !== generation) {
        claim.generation = record.generation;
        claim.destinations = {};
        claim.joinable = false;
      }
      claim.expires = Date.now() + OAUTH_AUTHORITY_TTL_MS;
      record.expires = claim.expires;
      this.storage.writeDataDurable('oauth-context-', slot, claim);
      this.storage.writeDataDurable('oauth-bound-', slot, record);
      return record;
    });
  }

  async addAttempt(
    slot: string,
    generation: string,
    state: string,
    attempt: OAuthAttempt,
    requestVersion?: number,
  ): Promise<void> {
    await this.updateBound(
      slot,
      generation,
      (record) => {
        for (const [key, value] of Object.entries(record.attempts)) {
          if (value.expires <= Date.now()) delete record.attempts[key];
        }
        if (Object.keys(record.attempts).length >= OAUTH_MAX_ATTEMPTS)
          throw new Error('Too many pending OAuth authorizations; wait fifteen minutes');
        const key = oauthDigest(state);
        if (record.attempts[key]) throw oauthAuthorityError();
        record.attempts[key] = attempt;
      },
      requestVersion,
    );
  }

  async consumeAttempt(
    slot: string,
    generation: string,
    state: string,
    validate: (attempt: OAuthAttempt) => void,
  ): Promise<OAuthAttempt> {
    let consumed: OAuthAttempt | undefined;
    await this.updateBound(slot, generation, (record) => {
      const attempt = record.attempts[oauthDigest(state)];
      if (!attempt || attempt.consumed || attempt.expires <= Date.now()) throw oauthAuthorityError();
      validate(attempt);
      consumed = structuredClone(attempt);
      attempt.consumed = true;
      // Keep a durable tombstone; never retain PKCE after consumption.
      attempt.verifier = 'x'.repeat(43);
    });
    return consumed!;
  }

  async quarantine(serverName: string): Promise<void> {
    const key = oauthDigest(serverName);
    await this.storage.withExclusiveLock(`oauth-migration-${key}`, () => {
      const old = this.get(serverName);
      if (!old) return;
      // Write protected rollback data before deleting the old source; retry is idempotent.
      this.storage.writeDataDurable('oauth-quarantine-', key, old);
      this.delete(serverName);
    });
  }

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
    logger.info('clientSessionRepository.saved.client.session.for.server.7d984677');
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
