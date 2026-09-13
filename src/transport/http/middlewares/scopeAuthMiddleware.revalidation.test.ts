import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

import { SDKOAuthServerProvider } from '@src/auth/sdkOAuthServerProvider.js';
import { AUTH_CONFIG } from '@src/constants.js';
import { type AgentConfig, AgentConfigManager } from '@src/core/server/agentConfig.js';

import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createScopeAuthMiddleware, getAuthInfo, revalidateAuthInfo } from './scopeAuthMiddleware.js';

const client: OAuthClientInformationFull = {
  client_id: 'continuation-owner',
  redirect_uris: ['http://127.0.0.1/callback'],
};

describe('native continuation authentication fence', () => {
  let directory: string;
  let provider: SDKOAuthServerProvider;
  let tokenId: string;
  let token: string;
  let features: AgentConfig['features'];

  beforeEach(() => {
    const config = AgentConfigManager.getInstance();
    features = config.get('features');
    config.updateConfig({ features: { ...config.get('features'), auth: true, scopeValidation: true } });
    directory = mkdtempSync(join(tmpdir(), '1mcp-auth-fence-'));
    provider = new SDKOAuthServerProvider(directory, 'auth-fence-runtime');
    tokenId = randomUUID();
    token = AUTH_CONFIG.SERVER.TOKEN.ID_PREFIX + tokenId;
    provider.oauthStorage.sessionRepository.createWithId(tokenId, client.client_id, '', ['tag:a', 'tag:b'], 60_000);
  });

  afterEach(() => {
    provider.shutdown();
    AgentConfigManager.getInstance().updateConfig({ features });
    rmSync(directory, { recursive: true, force: true });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function admit() {
    const req = { headers: { authorization: `Bearer ${token}` } } as Request;
    const res = { locals: {}, status: vi.fn(), json: vi.fn(), set: vi.fn() } as unknown as Response;
    const next = vi.fn();
    await createScopeAuthMiddleware(provider)(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    const auth = getAuthInfo(res)!;
    expect(auth).toBeDefined();
    return auth;
  }

  function updateGrant(update: { scopes?: string[]; clientId?: string; expires?: number }) {
    const sessionId = AUTH_CONFIG.SERVER.SESSION.ID_PREFIX + tokenId;
    const session = provider.oauthStorage.sessionRepository.get(sessionId)!;
    provider.oauthStorage.fileStorage.writeData(AUTH_CONFIG.SERVER.SESSION.FILE_PREFIX, sessionId, {
      ...session,
      ...update,
    });
  }

  it('reuses the injected provider and refuses a token revoked while validation was pending', async () => {
    const verify = vi.spyOn(provider, 'verifyAccessToken');
    const auth = await admit();
    expect(await revalidateAuthInfo(auth)).toBe(true);
    let finishValidation!: () => void;
    const validation = new Promise<void>((resolve) => {
      finishValidation = resolve;
    });
    const effect = vi.fn();
    const claim = validation.then(async () => {
      if (await revalidateAuthInfo(auth)) effect();
    });
    await provider.revokeToken(client, { token });
    finishValidation();
    await claim;
    expect(effect).not.toHaveBeenCalled();
    expect(verify).toHaveBeenCalledTimes(3);
  });

  it.each([
    { scopes: ['tag:a'] },
    { scopes: ['tag:a', 'tag:b', 'tag:c'] },
    { clientId: 'another-owner' },
    { expires: Date.now() + 120_000 },
  ])('rejects a changed stored grant without trusting the original snapshot: %j', async (change) => {
    const auth = await admit();
    let finishValidation!: () => void;
    const validation = new Promise<void>((resolve) => {
      finishValidation = resolve;
    });
    const claim = validation.then(() => revalidateAuthInfo(auth));
    updateGrant(change);
    finishValidation();
    expect(await claim).toBe(false);
  });

  it('normalizes scope ordering and duplicates but rejects expiry', async () => {
    const auth = await admit();
    updateGrant({ scopes: ['tag:b', 'tag:a', 'tag:a'] });
    expect(await revalidateAuthInfo(auth)).toBe(true);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60_001);
    expect(await revalidateAuthInfo(auth)).toBe(false);
  });

  it('fails closed for copied auth records and verifier failures', async () => {
    const auth = await admit();
    expect(await revalidateAuthInfo({ ...auth })).toBe(false);
    expect(await revalidateAuthInfo(undefined)).toBe(false);
    vi.spyOn(provider, 'verifyAccessToken').mockRejectedValue(new Error('sensitive verifier failure'));
    expect(await revalidateAuthInfo(auth)).toBe(false);
  });
});
