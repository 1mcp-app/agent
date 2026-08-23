import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  InvalidGrantError,
  InvalidScopeError,
  InvalidTargetError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';

import { RefreshTokenFamilyDataSchema } from '@src/auth/sessionTypes.js';
import { AUTH_CONFIG } from '@src/constants.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import logger from '@src/logger/logger.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SDKOAuthServerProvider } from './sdkOAuthServerProvider.js';
import { FileStorageService } from './storage/fileStorageService.js';

const CLIENT: OAuthClientInformationFull = {
  client_id: 'refresh-client',
  redirect_uris: ['http://127.0.0.1:3000/callback'],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
};
const OTHER_CLIENT: OAuthClientInformationFull = { ...CLIENT, client_id: 'other-client' };
const ACCESS_ONLY_CLIENT: OAuthClientInformationFull = {
  ...CLIENT,
  client_id: 'access-only-client',
  grant_types: ['authorization_code'],
};
const RESOURCE = 'https://resource.example/mcp';
const SCOPES = ['tag:alpha', 'tag:beta'];

describe('SDKOAuthServerProvider refresh token families', () => {
  let provider: SDKOAuthServerProvider;
  let tempDir: string;
  let originalAuthEnabled: boolean;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '1mcp-refresh-family-'));
    provider = new SDKOAuthServerProvider(tempDir, 'runtime-scope-a');
    const configManager = AgentConfigManager.getInstance();
    originalAuthEnabled = configManager.get('features').auth;
    configManager.updateConfig({ features: { ...configManager.get('features'), auth: true } });
  });

  afterEach(() => {
    provider.shutdown();
    const configManager = AgentConfigManager.getInstance();
    configManager.updateConfig({ features: { ...configManager.get('features'), auth: originalAuthEnabled } });
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('issues refresh tokens only to opted-in clients and persists only their SHA-256 digest', async () => {
    const renewable = await exchangeAuthorizationCode(provider, CLIENT);
    const accessOnly = await exchangeAuthorizationCode(provider, ACCESS_ONLY_CLIENT);

    expect(renewable.refresh_token).toMatch(/^rt-[A-Za-z0-9_-]{43}$/);
    expect(accessOnly).not.toHaveProperty('refresh_token');

    const familyFiles = listFamilyFiles(tempDir);
    expect(familyFiles).toHaveLength(1);
    const stored = fs.readFileSync(familyFiles[0], 'utf8');
    expect(stored).not.toContain(renewable.refresh_token!);
    expect(JSON.parse(stored)).toMatchObject({
      runtimeScopeId: 'runtime-scope-a',
      clientId: CLIENT.client_id,
      scopeCeiling: SCOPES,
      resource: RESOURCE,
      status: 'active',
      currentTokenDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it('persists families across provider restarts and rotation does not extend their fixed expiry', async () => {
    const initial = await exchangeAuthorizationCode(provider, CLIENT);
    const before = readSoleFamily(tempDir);
    provider.shutdown();
    provider = new SDKOAuthServerProvider(tempDir, 'runtime-scope-a');

    const rotated = await provider.exchangeRefreshToken(CLIENT, initial.refresh_token!);
    const after = readSoleFamily(tempDir);

    expect(rotated.refresh_token).toMatch(/^rt-/);
    expect(rotated.refresh_token).not.toBe(initial.refresh_token);
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.expires).toBe(before.expires);
    expect(after.expires - after.createdAt).toBe(AUTH_CONFIG.SERVER.REFRESH_FAMILY.TTL_MS);
    expect(after.consumedTokenDigests).toHaveLength(1);
  });

  it('fails closed and cleans persisted family state after the fixed expiry', async () => {
    const initial = await exchangeAuthorizationCode(provider, CLIENT);
    for (const filePath of [...listFamilyFiles(tempDir), ...listLookupFiles(tempDir)]) {
      const record = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
      fs.writeFileSync(filePath, JSON.stringify({ ...record, expires: Date.now() - 1 }));
    }

    await expect(provider.exchangeRefreshToken(CLIENT, initial.refresh_token!)).rejects.toBeInstanceOf(
      InvalidGrantError,
    );
    await expect(provider.verifyAccessToken(initial.access_token)).rejects.toThrow('Invalid or expired access token');
    expect(listFamilyFiles(tempDir)).toHaveLength(0);
    expect(listLookupFiles(tempDir)).toHaveLength(0);
  });

  it('does not consume the current refresh token when access-session persistence fails', async () => {
    const initial = await exchangeAuthorizationCode(provider, CLIENT);
    const createSession = vi
      .spyOn(provider.oauthStorage.sessionRepository, 'createRefreshFamilyAccessSession')
      .mockImplementation(() => {
        throw new Error('session persistence failed');
      });

    await expect(provider.exchangeRefreshToken(CLIENT, initial.refresh_token!)).rejects.toThrow(
      'session persistence failed',
    );

    createSession.mockRestore();
    await expect(provider.exchangeRefreshToken(CLIENT, initial.refresh_token!)).resolves.toMatchObject({
      refresh_token: expect.stringMatching(/^rt-/),
    });
  });

  it('does not consume the current refresh token when the family commit fails', async () => {
    const initial = await exchangeAuthorizationCode(provider, CLIENT);
    const originalWriteData = FileStorageService.prototype.writeDataDurable;
    let failedFamilyCommit = false;
    const writeData = vi.spyOn(FileStorageService.prototype, 'writeDataDurable').mockImplementation(function (
      this: FileStorageService,
      filePrefix: string,
      id: string,
      data: Parameters<FileStorageService['writeDataDurable']>[2],
    ) {
      if (filePrefix === AUTH_CONFIG.SERVER.REFRESH_FAMILY.FILE_PREFIX && !failedFamilyCommit) {
        failedFamilyCommit = true;
        throw new Error('family commit failed');
      }
      return originalWriteData.call(this, filePrefix, id, data);
    });

    await expect(provider.exchangeRefreshToken(CLIENT, initial.refresh_token!)).rejects.toThrow('family commit failed');
    writeData.mockRestore();

    await expect(provider.exchangeRefreshToken(CLIENT, initial.refresh_token!)).resolves.toMatchObject({
      refresh_token: expect.stringMatching(/^rt-/),
    });
  });

  it('preserves the original scope ceiling and resource while allowing equal or narrower access', async () => {
    const initial = await exchangeAuthorizationCode(provider, CLIENT);

    await expect(
      provider.exchangeRefreshToken(CLIENT, initial.refresh_token!, ['tag:alpha', 'tag:outside']),
    ).rejects.toBeInstanceOf(InvalidScopeError);
    await expect(
      provider.exchangeRefreshToken(CLIENT, initial.refresh_token!, undefined, new URL('https://other.example/mcp')),
    ).rejects.toBeInstanceOf(InvalidTargetError);

    const narrowed = await provider.exchangeRefreshToken(
      CLIENT,
      initial.refresh_token!,
      ['tag:alpha'],
      new URL(RESOURCE),
    );
    expect(narrowed.scope).toBe('tag:alpha');

    const restored = await provider.exchangeRefreshToken(CLIENT, narrowed.refresh_token!);
    expect(restored.scope).toBe(SCOPES.join(' '));
    expect(readSoleFamily(tempDir).scopeCeiling).toEqual(SCOPES);
  });

  it('allows exactly one concurrent rotation and replay revokes the family and every associated access token', async () => {
    const initial = await exchangeAuthorizationCode(provider, CLIENT);
    const attempts = await Promise.allSettled([
      provider.exchangeRefreshToken(CLIENT, initial.refresh_token!),
      provider.exchangeRefreshToken(CLIENT, initial.refresh_token!),
    ]);

    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    const rejection = attempts.find((attempt) => attempt.status === 'rejected') as PromiseRejectedResult;
    expect(rejection.reason).toBeInstanceOf(InvalidGrantError);
    expect(readSoleFamily(tempDir).status).toBe('revoked');

    const successful = (
      attempts.find((attempt) => attempt.status === 'fulfilled') as PromiseFulfilledResult<OAuthTokens>
    ).value;
    await expect(provider.verifyAccessToken(initial.access_token)).rejects.toThrow('Invalid or expired access token');
    await expect(provider.verifyAccessToken(successful.access_token)).rejects.toThrow(
      'Invalid or expired access token',
    );
    await expect(provider.exchangeRefreshToken(CLIENT, successful.refresh_token!)).rejects.toBeInstanceOf(
      InvalidGrantError,
    );
  });

  it('keeps family state bounded while older consumed-token lookups retain replay containment', async () => {
    const initial = await exchangeAuthorizationCode(provider, CLIENT);
    const first = await provider.exchangeRefreshToken(CLIENT, initial.refresh_token!);
    const second = await provider.exchangeRefreshToken(CLIENT, first.refresh_token!);
    await provider.exchangeRefreshToken(CLIENT, second.refresh_token!);

    expect(readSoleFamily(tempDir).consumedTokenDigests).toHaveLength(1);
    await expect(provider.exchangeRefreshToken(CLIENT, initial.refresh_token!)).rejects.toBeInstanceOf(
      InvalidGrantError,
    );
    expect(readSoleFamily(tempDir).status).toBe('revoked');
  });

  it('isolates refresh families by Runtime Scope even when storage is shared', async () => {
    const initial = await exchangeAuthorizationCode(provider, CLIENT);
    const otherScopeProvider = new SDKOAuthServerProvider(tempDir, 'runtime-scope-b');
    try {
      await expect(otherScopeProvider.exchangeRefreshToken(CLIENT, initial.refresh_token!)).rejects.toBeInstanceOf(
        InvalidGrantError,
      );
      await expect(provider.exchangeRefreshToken(CLIENT, initial.refresh_token!)).resolves.toMatchObject({
        refresh_token: expect.stringMatching(/^rt-/),
      });
    } finally {
      otherScopeProvider.shutdown();
    }
  });

  it('propagates replay-cascade deletion failures while revoked family state blocks residual sessions', async () => {
    const initial = await exchangeAuthorizationCode(provider, CLIENT);
    const rotated = await provider.exchangeRefreshToken(CLIENT, initial.refresh_token!);
    const originalUnlinkSync = fs.unlinkSync;
    const unlink = vi.spyOn(fs, 'unlinkSync').mockImplementation((filePath) => {
      if (String(filePath).includes(AUTH_CONFIG.SERVER.SESSION.FILE_PREFIX)) {
        throw new Error('session deletion failed');
      }
      return originalUnlinkSync(filePath);
    });

    await expect(provider.exchangeRefreshToken(CLIENT, initial.refresh_token!)).rejects.toThrow(
      'Failed to revoke access sessions for refresh token family',
    );
    unlink.mockRestore();
    await expect(provider.verifyAccessToken(initial.access_token)).rejects.toThrow('Invalid or expired access token');
    await expect(provider.verifyAccessToken(rotated.access_token)).rejects.toThrow('Invalid or expired access token');
  });

  it('does not mutate a rightful family when another client presents its refresh token', async () => {
    const initial = await exchangeAuthorizationCode(provider, CLIENT);

    await expect(provider.exchangeRefreshToken(OTHER_CLIENT, initial.refresh_token!)).rejects.toBeInstanceOf(
      InvalidGrantError,
    );
    const rightful = await provider.exchangeRefreshToken(CLIENT, initial.refresh_token!);
    expect(rightful.refresh_token).toMatch(/^rt-/);
  });

  it('keeps earlier access tokens valid on normal rotation and applies token-specific revocation semantics', async () => {
    const initial = await exchangeAuthorizationCode(provider, CLIENT);
    const rotated = await provider.exchangeRefreshToken(CLIENT, initial.refresh_token!);

    await expect(provider.verifyAccessToken(initial.access_token)).resolves.toMatchObject({
      clientId: CLIENT.client_id,
    });
    await provider.revokeToken(CLIENT, { token: initial.access_token });
    await expect(provider.verifyAccessToken(initial.access_token)).rejects.toThrow('Invalid or expired access token');
    await expect(provider.verifyAccessToken(rotated.access_token)).resolves.toMatchObject({
      clientId: CLIENT.client_id,
    });

    const next = await provider.exchangeRefreshToken(CLIENT, rotated.refresh_token!);
    await provider.revokeToken(CLIENT, { token: next.refresh_token! });
    await expect(provider.verifyAccessToken(rotated.access_token)).rejects.toThrow('Invalid or expired access token');
    await expect(provider.verifyAccessToken(next.access_token)).rejects.toThrow('Invalid or expired access token');
    await expect(provider.exchangeRefreshToken(CLIENT, next.refresh_token!)).rejects.toBeInstanceOf(InvalidGrantError);

    await expect(provider.revokeToken(CLIENT, { token: 'unknown-token' })).resolves.toBeUndefined();
  });

  it('never passes refresh bearer values to the logger', async () => {
    const debug = vi.spyOn(logger, 'debug');
    const info = vi.spyOn(logger, 'info');
    const warn = vi.spyOn(logger, 'warn');
    const error = vi.spyOn(logger, 'error');
    const initial = await exchangeAuthorizationCode(provider, CLIENT);
    const rotated = await provider.exchangeRefreshToken(CLIENT, initial.refresh_token!);
    await provider.revokeToken(CLIENT, { token: rotated.refresh_token! });

    const logged = JSON.stringify([...debug.mock.calls, ...info.mock.calls, ...warn.mock.calls, ...error.mock.calls]);
    expect(logged).not.toContain(initial.refresh_token!);
    expect(logged).not.toContain(rotated.refresh_token!);
  });
});

async function exchangeAuthorizationCode(
  provider: SDKOAuthServerProvider,
  client: OAuthClientInformationFull,
): Promise<OAuthTokens> {
  const code = provider.oauthStorage.authCodeRepository.create(
    client.client_id,
    client.redirect_uris[0],
    RESOURCE,
    SCOPES,
    60_000,
    'challenge',
  );
  return provider.exchangeAuthorizationCode(client, code, undefined, client.redirect_uris[0], new URL(RESOURCE));
}

function listFamilyFiles(tempDir: string): string[] {
  const serverDir = path.join(tempDir, AUTH_CONFIG.SERVER.STORAGE.DIR, AUTH_CONFIG.SERVER.SESSION.SUBDIR);
  return fs
    .readdirSync(serverDir)
    .filter((fileName) => fileName.startsWith(AUTH_CONFIG.SERVER.REFRESH_FAMILY.FILE_PREFIX))
    .map((fileName) => path.join(serverDir, fileName));
}

function listLookupFiles(tempDir: string): string[] {
  const serverDir = path.join(tempDir, AUTH_CONFIG.SERVER.STORAGE.DIR, AUTH_CONFIG.SERVER.SESSION.SUBDIR);
  return fs
    .readdirSync(serverDir)
    .filter((fileName) => fileName.startsWith(AUTH_CONFIG.SERVER.REFRESH_FAMILY.LOOKUP_FILE_PREFIX))
    .map((fileName) => path.join(serverDir, fileName));
}

function readSoleFamily(tempDir: string) {
  const familyFiles = listFamilyFiles(tempDir);
  expect(familyFiles).toHaveLength(1);
  return RefreshTokenFamilyDataSchema.parse(JSON.parse(fs.readFileSync(familyFiles[0], 'utf8')));
}

describe('authorization-code-atomic (goiabada#77 double-spend)', () => {
  let provider: SDKOAuthServerProvider;
  let tempDir: string;
  let originalAuthEnabled: boolean;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '1mcp-authcode-atomic-'));
    provider = new SDKOAuthServerProvider(tempDir, 'runtime-scope-a');
    const configManager = AgentConfigManager.getInstance();
    originalAuthEnabled = configManager.get('features').auth;
    configManager.updateConfig({ features: { ...configManager.get('features'), auth: true } });
  });

  afterEach(() => {
    provider.shutdown();
    const configManager = AgentConfigManager.getInstance();
    configManager.updateConfig({ features: { ...configManager.get('features'), auth: originalAuthEnabled } });
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('allows exactly one winner for concurrent exchanges of the same code', async () => {
    const code = provider.oauthStorage.authCodeRepository.create(
      CLIENT.client_id,
      CLIENT.redirect_uris[0],
      RESOURCE,
      SCOPES,
      60_000,
      'challenge',
    );

    const attempt = () =>
      provider.exchangeAuthorizationCode(CLIENT, code, undefined, CLIENT.redirect_uris[0], new URL(RESOURCE));

    const results = await Promise.allSettled([attempt(), attempt(), attempt(), attempt(), attempt()]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<OAuthTokens>[];
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    expect(fulfilled).toHaveLength(1);
    expect(rejected.length).toBeGreaterThanOrEqual(4);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(InvalidGrantError);
      expect((r.reason as Error).message).toBe('Invalid or expired authorization code');
    }

    const accessTokens = new Set(fulfilled.map((r) => r.value.access_token));
    expect(accessTokens.size).toBe(1);

    // code is consumed: a later sequential attempt also fails
    await expect(attempt()).rejects.toBeInstanceOf(InvalidGrantError);
    expect(provider.oauthStorage.authCodeRepository.get(code)).toBeNull();
  }, 20_000);

  it('logs do not contain the plaintext authorization code', async () => {
    const infoSpy = vi.spyOn(logger, 'info');
    const debugSpy = vi.spyOn(logger, 'debug');
    const warnSpy = vi.spyOn(logger, 'warn');
    const errorSpy = vi.spyOn(logger, 'error');

    const code = provider.oauthStorage.authCodeRepository.create(
      ACCESS_ONLY_CLIENT.client_id,
      ACCESS_ONLY_CLIENT.redirect_uris[0],
      RESOURCE,
      SCOPES,
      60_000,
      'challenge',
    );
    const tokens = await provider.exchangeAuthorizationCode(
      ACCESS_ONLY_CLIENT,
      code,
      undefined,
      ACCESS_ONLY_CLIENT.redirect_uris[0],
      new URL(RESOURCE),
    );
    expect(tokens.access_token).toBeDefined();

    const allLoggedContent = [
      ...infoSpy.mock.calls,
      ...debugSpy.mock.calls,
      ...warnSpy.mock.calls,
      ...errorSpy.mock.calls,
    ]
      .map((call) => JSON.stringify(call))
      .join('\n');

    expect(allLoggedContent).not.toContain(code);
    expect(allLoggedContent).not.toMatch(/auth_code_code-[0-9a-f-]+/i);
  });

  it('failure paths in storage operations do not expose the plaintext code or path in error logs', async () => {
    const errorSpy = vi.spyOn(logger, 'error');
    const warnSpy = vi.spyOn(logger, 'warn');

    const code = provider.oauthStorage.authCodeRepository.create(
      ACCESS_ONLY_CLIENT.client_id,
      ACCESS_ONLY_CLIENT.redirect_uris[0],
      RESOURCE,
      SCOPES,
      60_000,
      'challenge',
    );

    // Simulate an IO failure during deletion that includes the sensitive file path in the native error message
    const realUnlinkSync = fs.unlinkSync;
    vi.spyOn(fs, 'unlinkSync').mockImplementation((targetPath) => {
      const err = new Error(`EACCES: permission denied, unlink '${String(targetPath)}'`);
      (err as unknown as { code: string }).code = 'EACCES';
      throw err;
    });

    // Attempting to delete triggers the failure path
    expect(() => provider.oauthStorage.authCodeRepository.delete(code)).toThrow();

    const allLoggedErrors = [...errorSpy.mock.calls, ...warnSpy.mock.calls]
      .map((call) => JSON.stringify(call))
      .join('\n');

    expect(allLoggedErrors).not.toContain(code);
    expect(allLoggedErrors).not.toMatch(/auth_code_code-[0-9a-f-]+/i);
    expect(allLoggedErrors).toContain('[REDACTED]');
    expect(allLoggedErrors).toContain('EACCES');

    fs.unlinkSync = realUnlinkSync;
  });

  it('cleanup of expired authorization codes does not log plaintext codes or paths', async () => {
    const debugSpy = vi.spyOn(logger, 'debug');
    const infoSpy = vi.spyOn(logger, 'info');
    const warnSpy = vi.spyOn(logger, 'warn');
    const errorSpy = vi.spyOn(logger, 'error');

    // Create an expired authorization code
    const code = provider.oauthStorage.authCodeRepository.create(
      ACCESS_ONLY_CLIENT.client_id,
      ACCESS_ONLY_CLIENT.redirect_uris[0],
      RESOURCE,
      SCOPES,
      -1000, // Expired in the past
      'challenge',
    );

    const cleanedCount = provider.oauthStorage.fileStorage.cleanupExpiredData();
    expect(cleanedCount).toBeGreaterThanOrEqual(1);

    const allLogged = [...debugSpy.mock.calls, ...infoSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .map((call) => JSON.stringify(call))
      .join('\n');

    expect(allLogged).not.toContain(code);
    expect(allLogged).not.toMatch(/auth_code_code-[0-9a-f-]+/i);
    expect(allLogged).toContain('auth_code_[REDACTED].json');
  });

  it('failure when cleaning temporary files for sensitive codes does not log plaintext codes or paths', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    const errorSpy = vi.spyOn(logger, 'error');

    const storageDir = provider.oauthStorage.fileStorage.getStorageDir();
    const sensitiveTmpFile = `auth_code_code-11112222-3333-4444-5555-666677778888.json.${process.pid}.random.tmp`;
    const sensitiveTmpPath = path.join(storageDir, sensitiveTmpFile);
    fs.writeFileSync(sensitiveTmpPath, 'temp');

    // Age the temporary file so it qualifies for cleanup (>60s)
    const oldTime = (Date.now() - 120_000) / 1000;
    fs.utimesSync(sensitiveTmpPath, oldTime, oldTime);

    // Mock unlinkSync to fail on this file
    const realUnlinkSync = fs.unlinkSync;
    vi.spyOn(fs, 'unlinkSync').mockImplementation((targetPath) => {
      if (String(targetPath).includes('auth_code_code-11112222')) {
        const err = new Error(`EACCES: permission denied, unlink '${String(targetPath)}'`);
        (err as unknown as { code: string }).code = 'EACCES';
        throw err;
      }
      return realUnlinkSync(targetPath);
    });

    try {
      provider.oauthStorage.fileStorage.cleanupExpiredData();

      const allLogged = [...warnSpy.mock.calls, ...errorSpy.mock.calls].map((call) => JSON.stringify(call)).join('\n');

      expect(allLogged).not.toContain('code-11112222-3333-4444-5555-666677778888');
      expect(allLogged).not.toMatch(/auth_code_code-[0-9a-f-]+/i);
      expect(allLogged).toContain('auth_code_[REDACTED].tmp');
      expect(allLogged).toContain('EACCES');
    } finally {
      fs.unlinkSync = realUnlinkSync;
      if (fs.existsSync(sensitiveTmpPath)) {
        fs.unlinkSync(sensitiveTmpPath);
      }
    }
  });
});
