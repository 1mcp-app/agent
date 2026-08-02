import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import {
  RefreshTokenFamilyData,
  RefreshTokenFamilyDataSchema,
  RefreshTokenLookupData,
  RefreshTokenLookupDataSchema,
  SessionData,
  SessionDataSchema,
} from '@src/auth/sessionTypes.js';
import { AUTH_CONFIG } from '@src/constants.js';

import { FileStorageService } from './fileStorageService.js';

export type RefreshTokenConsumptionResult =
  | { status: 'rotated'; family: RefreshTokenFamilyData; refreshToken: string }
  | { status: 'replay'; family: RefreshTokenFamilyData }
  | { status: 'invalid' }
  | { status: 'client_mismatch' };

const REFRESH_FAMILY_LOCK = 'refresh-token-families';

export class RefreshTokenFamilyRepository {
  constructor(
    private readonly storage: FileStorageService,
    private readonly runtimeScopeId: string,
  ) {}

  async create(
    clientId: string,
    scopeCeiling: string[],
    resource: string,
    accessTokenId: string,
    persistAccessSession: (familyId: string) => void,
  ): Promise<{
    family: RefreshTokenFamilyData;
    refreshToken: string;
  }> {
    return this.storage.withExclusiveLock(REFRESH_FAMILY_LOCK, () => {
      const familyId = AUTH_CONFIG.SERVER.REFRESH_FAMILY.ID_PREFIX + randomUUID();
      const refreshToken = createRefreshToken();
      const now = Date.now();
      const family: RefreshTokenFamilyData = {
        familyId,
        runtimeScopeId: this.runtimeScopeId,
        clientId,
        scopeCeiling: [...scopeCeiling],
        resource,
        currentTokenDigest: digestRefreshToken(refreshToken),
        consumedTokenDigests: [],
        accessTokenIds: [accessTokenId],
        status: 'active',
        createdAt: now,
        expires: now + AUTH_CONFIG.SERVER.REFRESH_FAMILY.TTL_MS,
      };

      persistAccessSession(familyId);
      this.saveLookup(family, family.currentTokenDigest, 'current');
      this.save(family);
      return { family, refreshToken };
    });
  }

  findByToken(refreshToken: string): RefreshTokenFamilyData | null {
    return this.locateByDigest(digestRefreshToken(refreshToken))?.family ?? null;
  }

  findById(familyId: string): RefreshTokenFamilyData | null {
    const family = this.storage.readData<RefreshTokenFamilyData>(
      AUTH_CONFIG.SERVER.REFRESH_FAMILY.FILE_PREFIX,
      familyId,
      RefreshTokenFamilyDataSchema,
    );
    return family?.runtimeScopeId === this.runtimeScopeId ? family : null;
  }

  async consume(
    refreshToken: string,
    clientId: string,
    accessTokenId: string,
    persistAccessSession: (familyId: string) => void,
  ): Promise<RefreshTokenConsumptionResult> {
    const digest = digestRefreshToken(refreshToken);
    return this.storage.withExclusiveLock(REFRESH_FAMILY_LOCK, () => {
      const located = this.locateByDigest(digest);
      if (!located || located.family.runtimeScopeId !== this.runtimeScopeId) {
        return { status: 'invalid' };
      }

      const { family } = located;
      if (family.clientId !== clientId) {
        return { status: 'client_mismatch' };
      }

      const tokenState = safeDigestEqual(family.currentTokenDigest, digest)
        ? 'current'
        : family.consumedTokenDigests.some((consumed) => safeDigestEqual(consumed, digest)) ||
            located.lookup?.state === 'consumed'
          ? 'consumed'
          : 'unknown';

      if (tokenState === 'consumed') {
        const revokedFamily = this.revoke(family);
        return { status: 'replay', family: revokedFamily };
      }

      if (tokenState !== 'current' || family.status !== 'active') {
        return { status: 'invalid' };
      }

      const nextRefreshToken = createRefreshToken();
      const nextDigest = digestRefreshToken(nextRefreshToken);
      const activeAccessTokenIds = family.accessTokenIds.filter((tokenId) => this.isAccessSessionActive(tokenId));
      const rotatedFamily: RefreshTokenFamilyData = {
        ...family,
        currentTokenDigest: nextDigest,
        // Older consumed digests remain replay-detectable through lookup records.
        consumedTokenDigests: [family.currentTokenDigest],
        accessTokenIds: [...activeAccessTokenIds, accessTokenId],
      };

      persistAccessSession(family.familyId);
      for (const historicDigest of family.consumedTokenDigests) {
        this.saveLookup(family, historicDigest, 'consumed');
      }
      this.saveLookup(family, family.currentTokenDigest, 'consumed');
      this.saveLookup(family, nextDigest, 'current');
      this.save(rotatedFamily);
      return { status: 'rotated', family: rotatedFamily, refreshToken: nextRefreshToken };
    });
  }

  async revokeForClient(family: RefreshTokenFamilyData, clientId: string): Promise<RefreshTokenFamilyData | null> {
    return this.storage.withExclusiveLock(REFRESH_FAMILY_LOCK, () => {
      const currentFamily = this.findById(family.familyId);
      if (!currentFamily || currentFamily.clientId !== clientId) {
        return null;
      }
      return this.revoke(currentFamily);
    });
  }

  private revoke(family: RefreshTokenFamilyData): RefreshTokenFamilyData {
    if (family.status === 'revoked') {
      return family;
    }
    const revokedFamily: RefreshTokenFamilyData = {
      ...family,
      status: 'revoked',
      revokedAt: Date.now(),
    };
    this.save(revokedFamily);
    return revokedFamily;
  }

  private locateByDigest(digest: string): { family: RefreshTokenFamilyData; lookup?: RefreshTokenLookupData } | null {
    const lookup = this.readLookup(digest);
    if (lookup?.runtimeScopeId === this.runtimeScopeId) {
      const family = this.findById(lookup.familyId);
      if (family) {
        return { family, lookup };
      }
    }

    const family = this.list().find((candidate) => tokenDigestMatches(candidate, digest));
    return family ? { family } : null;
  }

  private readLookup(digest: string): RefreshTokenLookupData | null {
    return this.storage.readData<RefreshTokenLookupData>(
      AUTH_CONFIG.SERVER.REFRESH_FAMILY.LOOKUP_FILE_PREFIX,
      lookupId(digest),
      RefreshTokenLookupDataSchema,
    );
  }

  private saveLookup(
    family: RefreshTokenFamilyData,
    tokenDigest: string,
    state: RefreshTokenLookupData['state'],
  ): void {
    this.storage.writeDataDurable(AUTH_CONFIG.SERVER.REFRESH_FAMILY.LOOKUP_FILE_PREFIX, lookupId(tokenDigest), {
      familyId: family.familyId,
      runtimeScopeId: family.runtimeScopeId,
      tokenDigest,
      state,
      createdAt: family.createdAt,
      expires: family.expires,
    });
  }

  private isAccessSessionActive(accessTokenId: string): boolean {
    return (
      this.storage.readData<SessionData>(
        AUTH_CONFIG.SERVER.SESSION.FILE_PREFIX,
        AUTH_CONFIG.SERVER.SESSION.ID_PREFIX + accessTokenId,
        SessionDataSchema,
      ) !== null
    );
  }

  private list(): RefreshTokenFamilyData[] {
    const { FILE_PREFIX, ID_PREFIX } = AUTH_CONFIG.SERVER.REFRESH_FAMILY;
    const extension = AUTH_CONFIG.SERVER.STORAGE.FILE_EXTENSION;
    return this.storage
      .listFiles(FILE_PREFIX)
      .map((fileName) => fileName.slice(FILE_PREFIX.length, -extension.length))
      .filter((familyId) => familyId.startsWith(ID_PREFIX))
      .map((familyId) =>
        this.storage.readData<RefreshTokenFamilyData>(FILE_PREFIX, familyId, RefreshTokenFamilyDataSchema),
      )
      .filter(
        (family): family is RefreshTokenFamilyData => family !== null && family.runtimeScopeId === this.runtimeScopeId,
      );
  }

  private save(family: RefreshTokenFamilyData): void {
    this.storage.writeDataDurable(AUTH_CONFIG.SERVER.REFRESH_FAMILY.FILE_PREFIX, family.familyId, family);
  }
}

export function digestRefreshToken(refreshToken: string): string {
  return createHash('sha256').update(refreshToken).digest('hex');
}

function createRefreshToken(): string {
  return AUTH_CONFIG.SERVER.REFRESH_FAMILY.TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

function lookupId(digest: string): string {
  return AUTH_CONFIG.SERVER.REFRESH_FAMILY.LOOKUP_ID_PREFIX + digest;
}

function tokenDigestMatches(family: RefreshTokenFamilyData, digest: string): boolean {
  return (
    safeDigestEqual(family.currentTokenDigest, digest) ||
    family.consumedTokenDigests.some((consumed) => safeDigestEqual(consumed, digest))
  );
}

function safeDigestEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
