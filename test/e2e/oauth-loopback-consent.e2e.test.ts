import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';

import { SDKOAuthServerProvider } from '@src/auth/sdkOAuthServerProvider.js';
import { McpConfigManager } from '@src/config/mcpConfigManager.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { createOAuthRoutes } from '@src/transport/http/routes/oauthRoutes.js';

import express from 'express';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let resolveCallback: ((url: URL) => void) | undefined;

describe('OAuth loopback consent browser flow', () => {
  let authServer: Server;
  let callbackServer: Server;
  let authBaseUrl: string;
  let callbackUrl: string;
  let browser: Browser;
  let provider: SDKOAuthServerProvider;
  let storageDir: string;
  let originalAuthEnabled: boolean;

  beforeAll(async () => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), '1mcp-oauth-browser-'));
    originalAuthEnabled = AgentConfigManager.getInstance().get('features').auth;
    AgentConfigManager.getInstance().get('features').auth = true;
    vi.spyOn(McpConfigManager, 'getInstance').mockReturnValue({
      getAvailableTags: () => ['test', 'other'],
    } as unknown as McpConfigManager);

    callbackServer = createServer((request, response) => {
      resolveCallback?.(new URL(request.url ?? '/', callbackUrl));
      resolveCallback = undefined;
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end('Authorization complete');
    });
    callbackUrl = `${await listenOnLoopback(callbackServer)}/callback`;

    const app = express();
    app.use(express.urlencoded({ extended: false }));
    authServer = createServer(app);
    authBaseUrl = await listenOnLoopback(authServer);
    provider = new SDKOAuthServerProvider(storageDir, 'browser-runtime-scope');
    const issuerUrl = new URL(`${authBaseUrl}/`);
    app.use(
      mcpAuthRouter({
        provider,
        issuerUrl,
        baseUrl: issuerUrl,
        scopesSupported: ['tag:test', 'tag:other'],
        authorizationOptions: { rateLimit: false },
        tokenOptions: { rateLimit: false },
        revocationOptions: { rateLimit: false },
        clientRegistrationOptions: { rateLimit: false },
      }),
    );
    app.use('/oauth', createOAuthRoutes(provider));
    browser = await chromium.launch({ headless: true });
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
    provider?.shutdown();
    await closeServer(authServer);
    await closeServer(callbackServer);
    fs.rmSync(storageDir, { recursive: true, force: true });
    AgentConfigManager.getInstance().get('features').auth = originalAuthEnabled;
    vi.restoreAllMocks();
  });

  it('completes DCR, cross-port loopback consent, PKCE exchange, and refresh rotation', async () => {
    const registrationResponse = await fetch(`${authBaseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Loopback Browser Client',
        redirect_uris: ['http://127.0.0.1:1/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
    });
    expect(registrationResponse.status, await registrationResponse.clone().text()).toBe(201);
    const client = (await registrationResponse.json()) as { client_id: string };

    const codeVerifier = randomBytes(48).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const resource = `${authBaseUrl}/mcp`;
    const authorizationUrl = new URL(`${authBaseUrl}/authorize`);
    authorizationUrl.search = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: callbackUrl,
      scope: 'tag:test tag:other',
      state: 'browser-state',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      resource,
    }).toString();

    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      const consentResponse = await page.goto(authorizationUrl.toString());
      expect(consentResponse?.status()).toBe(200);
      expect(consentResponse?.headers()['content-security-policy']).toContain(
        `form-action 'self' ${new URL(callbackUrl).origin}`,
      );
      await page.getByText('renew this access for up to 30 days').waitFor({ state: 'visible' });

      const callbackReceived = waitForCallback();
      await page.getByRole('button', { name: 'Approve' }).click();
      const callback = await callbackReceived;
      expect(callback.searchParams.get('state')).toBe('browser-state');
      const authorizationCode = callback.searchParams.get('code');
      expect(authorizationCode).toMatch(/^code-/);

      const tokenResponse = await postForm(`${authBaseUrl}/token`, {
        grant_type: 'authorization_code',
        client_id: client.client_id,
        code: authorizationCode!,
        redirect_uri: callbackUrl,
        code_verifier: codeVerifier,
        resource,
      });
      expect(tokenResponse.status, await tokenResponse.clone().text()).toBe(200);
      const tokens = (await tokenResponse.json()) as { access_token: string; refresh_token: string; scope: string };
      expect(tokens.access_token).toMatch(/^tk-/);
      expect(tokens.refresh_token).toMatch(/^rt-[A-Za-z0-9_-]{43}$/);

      const expandedScopeResponse = await postForm(`${authBaseUrl}/token`, {
        grant_type: 'refresh_token',
        client_id: client.client_id,
        refresh_token: tokens.refresh_token,
        scope: 'tag:test tag:outside',
        resource,
      });
      expect(expandedScopeResponse.status).toBe(400);
      await expect(expandedScopeResponse.json()).resolves.toMatchObject({ error: 'invalid_scope' });

      const wrongResourceResponse = await postForm(`${authBaseUrl}/token`, {
        grant_type: 'refresh_token',
        client_id: client.client_id,
        refresh_token: tokens.refresh_token,
        resource: `${authBaseUrl}/other`,
      });
      expect(wrongResourceResponse.status).toBe(400);
      await expect(wrongResourceResponse.json()).resolves.toMatchObject({ error: 'invalid_target' });

      const refreshResponse = await postForm(`${authBaseUrl}/token`, {
        grant_type: 'refresh_token',
        client_id: client.client_id,
        refresh_token: tokens.refresh_token,
        scope: 'tag:test',
        resource,
      });
      expect(refreshResponse.status, await refreshResponse.clone().text()).toBe(200);
      const rotated = (await refreshResponse.json()) as { access_token: string; refresh_token: string; scope: string };
      expect(rotated.access_token).toMatch(/^tk-/);
      expect(rotated.refresh_token).toMatch(/^rt-/);
      expect(rotated.refresh_token).not.toBe(tokens.refresh_token);
      expect(rotated.scope).toBe('tag:test');

      const replayResponse = await postForm(`${authBaseUrl}/token`, {
        grant_type: 'refresh_token',
        client_id: client.client_id,
        refresh_token: tokens.refresh_token,
        resource,
      });
      expect(replayResponse.status).toBe(400);
      await expect(replayResponse.json()).resolves.toMatchObject({ error: 'invalid_grant' });
      await expect(provider.verifyAccessToken(tokens.access_token)).rejects.toThrow('Invalid or expired access token');
      await expect(provider.verifyAccessToken(rotated.access_token)).rejects.toThrow(
        'Invalid or expired access token',
      );

      const secondVerifier = randomBytes(48).toString('base64url');
      const secondChallenge = createHash('sha256').update(secondVerifier).digest('base64url');
      const secondAuthorizationUrl = new URL(`${authBaseUrl}/authorize`);
      secondAuthorizationUrl.search = new URLSearchParams({
        response_type: 'code',
        client_id: client.client_id,
        redirect_uri: callbackUrl,
        scope: 'tag:test',
        state: 'revocation-state',
        code_challenge: secondChallenge,
        code_challenge_method: 'S256',
        resource,
      }).toString();

      await page.goto(secondAuthorizationUrl.toString());
      const secondCallbackReceived = waitForCallback();
      await page.getByRole('button', { name: 'Approve' }).click();
      const secondCallback = await secondCallbackReceived;
      const secondTokenResponse = await postForm(`${authBaseUrl}/token`, {
        grant_type: 'authorization_code',
        client_id: client.client_id,
        code: secondCallback.searchParams.get('code')!,
        redirect_uri: callbackUrl,
        code_verifier: secondVerifier,
        resource,
      });
      expect(secondTokenResponse.status).toBe(200);
      const secondTokens = (await secondTokenResponse.json()) as { access_token: string; refresh_token: string };

      const revocationResponse = await postForm(`${authBaseUrl}/revoke`, {
        token: secondTokens.refresh_token,
        client_id: client.client_id,
      });
      expect(revocationResponse.status, await revocationResponse.clone().text()).toBe(200);
      await expect(provider.verifyAccessToken(secondTokens.access_token)).rejects.toThrow(
        'Invalid or expired access token',
      );
      const revokedRefreshResponse = await postForm(`${authBaseUrl}/token`, {
        grant_type: 'refresh_token',
        client_id: client.client_id,
        refresh_token: secondTokens.refresh_token,
        resource,
      });
      expect(revokedRefreshResponse.status).toBe(400);
      await expect(revokedRefreshResponse.json()).resolves.toMatchObject({ error: 'invalid_grant' });
    } finally {
      await context.close();
    }
  }, 30_000);
});

function waitForCallback(): Promise<URL> {
  return new Promise<URL>((resolve) => {
    resolveCallback = resolve;
  });
}

async function listenOnLoopback(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Test server did not bind to a loopback port');
  }
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (!server?.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function postForm(url: string, values: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values),
  });
}
