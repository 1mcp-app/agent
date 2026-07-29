import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  InvalidGrantError,
  InvalidScopeError,
  InvalidTargetError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';

import { AUTH_CONFIG } from '@src/constants.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import logger from '@src/logger/logger.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SDKOAuthServerProvider } from './sdkOAuthServerProvider.js';

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
    configManager.get('features').auth = true;
  });

  afterEach(() => {
    provider.shutdown();
    AgentConfigManager.getInstance().get('features').auth = originalAuthEnabled;
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
    const before = readOnlyFamily(tempDir);
    provider.shutdown();
    provider = new SDKOAuthServerProvider(tempDir, 'runtime-scope-a');

    const rotated = await provider.exchangeRefreshToken(CLIENT, initial.refresh_token!);
    const after = readOnlyFamily(tempDir);

    expect(rotated.refresh_token).toMatch(/^rt-/);
    expect(rotated.refresh_token).not.toBe(initial.refresh_token);
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.expires).toBe(before.expires);
    expect(after.expires - after.createdAt).toBe(AUTH_CONFIG.SERVER.REFRESH_FAMILY.TTL_MS);
    expect(after.consumedTokenDigests).toHaveLength(1);
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
    expect(readOnlyFamily(tempDir).scopeCeiling).toEqual(SCOPES);
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
    expect(readOnlyFamily(tempDir).status).toBe('revoked');

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

function readOnlyFamily(tempDir: string): Record<string, any> {
  const familyFiles = listFamilyFiles(tempDir);
  expect(familyFiles).toHaveLength(1);
  return JSON.parse(fs.readFileSync(familyFiles[0], 'utf8'));
}
