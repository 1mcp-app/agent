import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { RefreshTokenFamilyData } from '@src/auth/sessionTypes.js';
import { AUTH_CONFIG } from '@src/constants.js';

import { FileStorageService } from './fileStorageService.js';

export type RefreshTokenConsumptionResult =
  | { status: 'rotated'; family: RefreshTokenFamilyData; refreshToken: string }
  | { status: 'replay'; family: RefreshTokenFamilyData }
  | { status: 'invalid' }
  | { status: 'client_mismatch' };

export class RefreshTokenFamilyRepository {
  constructor(
    private readonly storage: FileStorageService,
    private readonly runtimeScopeId: string,
  ) {}

  create(
    clientId: string,
    scopeCeiling: string[],
    resource: string,
    accessTokenId: string,
  ): {
    family: RefreshTokenFamilyData;
    refreshToken: string;
  } {
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

    this.save(family);
    return { family, refreshToken };
  }

  findByToken(refreshToken: string): RefreshTokenFamilyData | null {
    const digest = digestRefreshToken(refreshToken);
    return this.list().find((family) => tokenDigestMatches(family, digest)) ?? null;
  }

  getTokenState(family: RefreshTokenFamilyData, refreshToken: string): 'current' | 'consumed' | 'unknown' {
    const digest = digestRefreshToken(refreshToken);
    if (safeDigestEqual(family.currentTokenDigest, digest)) {
      return 'current';
    }
    if (family.consumedTokenDigests.some((consumed) => safeDigestEqual(consumed, digest))) {
      return 'consumed';
    }
    return 'unknown';
  }

  consume(refreshToken: string, clientId: string, accessTokenId: string): RefreshTokenConsumptionResult {
    const digest = digestRefreshToken(refreshToken);
    const family = this.list().find((candidate) => tokenDigestMatches(candidate, digest));
    if (!family || family.runtimeScopeId !== this.runtimeScopeId) {
      return { status: 'invalid' };
    }

    if (family.clientId !== clientId) {
      return { status: 'client_mismatch' };
    }

    if (family.consumedTokenDigests.some((consumed) => safeDigestEqual(consumed, digest))) {
      const revokedFamily = this.revoke(family);
      return { status: 'replay', family: revokedFamily };
    }

    if (family.status !== 'active' || !safeDigestEqual(family.currentTokenDigest, digest)) {
      return { status: 'invalid' };
    }

    const nextRefreshToken = createRefreshToken();
    const rotatedFamily: RefreshTokenFamilyData = {
      ...family,
      currentTokenDigest: digestRefreshToken(nextRefreshToken),
      consumedTokenDigests: [...family.consumedTokenDigests, family.currentTokenDigest],
      accessTokenIds: [...family.accessTokenIds, accessTokenId],
    };
    this.save(rotatedFamily);
    return { status: 'rotated', family: rotatedFamily, refreshToken: nextRefreshToken };
  }

  revokeForClient(family: RefreshTokenFamilyData, clientId: string): RefreshTokenFamilyData | null {
    if (family.runtimeScopeId !== this.runtimeScopeId || family.clientId !== clientId) {
      return null;
    }
    return this.revoke(family);
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

  private list(): RefreshTokenFamilyData[] {
    const { FILE_PREFIX, ID_PREFIX } = AUTH_CONFIG.SERVER.REFRESH_FAMILY;
    const extension = AUTH_CONFIG.SERVER.STORAGE.FILE_EXTENSION;
    return this.storage
      .listFiles(FILE_PREFIX)
      .map((fileName) => fileName.slice(FILE_PREFIX.length, -extension.length))
      .filter((familyId) => familyId.startsWith(ID_PREFIX))
      .map((familyId) => this.storage.readData<RefreshTokenFamilyData>(FILE_PREFIX, familyId))
      .filter((family): family is RefreshTokenFamilyData => family !== null);
  }

  private save(family: RefreshTokenFamilyData): void {
    this.storage.writeData(AUTH_CONFIG.SERVER.REFRESH_FAMILY.FILE_PREFIX, family.familyId, family);
  }
}

export function digestRefreshToken(refreshToken: string): string {
  return createHash('sha256').update(refreshToken).digest('hex');
}

function createRefreshToken(): string {
  return AUTH_CONFIG.SERVER.REFRESH_FAMILY.TOKEN_PREFIX + randomBytes(32).toString('base64url');
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
