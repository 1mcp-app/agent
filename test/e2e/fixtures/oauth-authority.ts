import { auth as modernAuth, type OAuthClientProvider as ModernProvider } from '@modelcontextprotocol/client';

import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { auth as legacyAuth } from '@modelcontextprotocol/sdk/client/auth.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';

import { type OAuthAuthorityContext, oauthDigest } from '@src/auth/oauthAuthority.js';
import { createOAuthAuthorizationFlow } from '@src/auth/oauthAuthorizationFlow.js';
import { type OAuthClientConfig, SDKOAuthClientProvider } from '@src/auth/sdkOAuthClientProvider.js';
import { SDKOAuthServerProvider } from '@src/auth/sdkOAuthServerProvider.js';
import { createCliTokenRoute } from '@src/transport/http/routes/cliTokenRoute.js';
import { createOAuthRoutes } from '@src/transport/http/routes/oauthRoutes.js';

import express from 'express';
import type { Browser, Page } from 'playwright';

export type OAuthEra = 'legacy' | 'modern';

export interface ObservedOAuthRequest {
  readonly method: string;
  readonly path: string;
  readonly body: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

export interface UpstreamAuthorityFixture {
  readonly baseUrl: string;
  readonly resourceUrl: string;
  readonly requests: ObservedOAuthRequest[];
  close(): Promise<void>;
}

export interface AuthoritySurfaceFixture {
  readonly baseUrl: string;
  readonly storageDir: string;
  readonly inboundProvider: SDKOAuthServerProvider;
  setUpstreamProvider(provider: SDKOAuthClientProvider, era: OAuthEra, resourceUrl: string): void;
  close(): Promise<void>;
}

export async function startUpstreamAuthorityFixture(): Promise<UpstreamAuthorityFixture> {
  const requests: ObservedOAuthRequest[] = [];
  let baseUrl = '';
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    const url = new URL(request.url ?? '/', baseUrl);
    requests.push({
      method: request.method ?? 'GET',
      path: url.pathname,
      body,
      headers: request.headers,
    });

    response.setHeader('Cache-Control', 'no-store');
    if (url.pathname.includes('oauth-protected-resource')) {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          resource: `${baseUrl}/mcp`,
          authorization_servers: [baseUrl],
          scopes_supported: ['read'],
        }),
      );
      return;
    }
    if (url.pathname.includes('oauth-authorization-server')) {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          issuer: baseUrl,
          authorization_endpoint: `${baseUrl}/authorize`,
          token_endpoint: `${baseUrl}/token`,
          registration_endpoint: `${baseUrl}/register`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          authorization_response_iss_parameter_supported: true,
          client_id_metadata_document_supported: true,
        }),
      );
      return;
    }
    if (url.pathname === '/register') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ ...JSON.parse(body), client_id: 'fixture-dynamic-client' }));
      return;
    }
    if (url.pathname === '/authorize') {
      const callback = new URL(url.searchParams.get('redirect_uri')!);
      callback.searchParams.set('state', url.searchParams.get('state')!);
      callback.searchParams.set('code', 'fixture-authorization-code');
      callback.searchParams.set('iss', baseUrl);
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(
        `<!doctype html><title>Fixture authorization</title><a href="${escapeHtml(callback.href)}">Approve upstream access</a>`,
      );
      return;
    }
    if (url.pathname === '/token') {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          access_token: 'fixture-upstream-access-token',
          token_type: 'Bearer',
          refresh_token: 'fixture-upstream-refresh-token',
          scope: 'read',
        }),
      );
      return;
    }
    response.statusCode = 404;
    response.end('not found');
  });
  baseUrl = await listen(server);
  return {
    baseUrl,
    resourceUrl: `${baseUrl}/mcp`,
    requests,
    close: () => closeServer(server),
  };
}

export async function startAuthoritySurfaceFixture(): Promise<AuthoritySurfaceFixture> {
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), '1mcp-oauth-authority-e2e-'));
  const inboundProvider = new SDKOAuthServerProvider(storageDir, 'oauth-authority-e2e-runtime');
  let provider: SDKOAuthClientProvider | undefined;
  let upstreamEra: OAuthEra = 'modern';
  let upstreamResourceUrl = '';
  const clientInfo = {
    status: 'awaiting_oauth',
    requiresOAuth: true,
    get authorizationUrl(): string | undefined {
      return provider?.getAuthorizationUrl();
    },
    set authorizationUrl(_value: string | undefined) {},
    oauthStartTime: new Date().toISOString(),
    adapter: {} as never,
  };

  const flow = createOAuthAuthorizationFlow({
    storage: {
      getAuthorizationRequest: (id) => inboundProvider.oauthStorage.getAuthorizationRequest(id),
      getClient: (id) => inboundProvider.clientsStore.getClient(id),
      processConsentApproval: (id, scopes) => inboundProvider.oauthStorage.processConsentApproval(id, scopes),
      processConsentDenial: (id) => inboundProvider.oauthStorage.processConsentDenial(id),
      createSessionWithId: (id, clientId, resource, scopes, ttlMs, familyId) =>
        inboundProvider.oauthStorage.sessionRepository.createWithId(id, clientId, resource, scopes, ttlMs, familyId),
    },
    serverRuntime: { getClient: () => clientInfo },
    clientRuntime: {
      initiateOAuth: async () => {
        if (!provider) throw new Error('Upstream provider is unavailable');
        await provider.invalidateCredentials('tokens');
        await startProviderAuthorization(provider, upstreamEra, upstreamResourceUrl);
      },
      completeOAuthAndReconnect: async (_name, callback) => {
        if (!provider) throw new Error('Upstream provider is unavailable');
        const params = typeof callback === 'string' ? new URLSearchParams({ code: callback }) : callback;
        await completeAuthorization(provider, upstreamEra, upstreamResourceUrl, params);
      },
    },
    createTokenId: () => randomBytes(24).toString('base64url'),
    getAuthConfig: () => ({ enabled: true, oauthTokenTtlMs: 60_000 }),
    getAvailableTags: () => ['allowed'],
  });

  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  const server = createServer(app);
  const baseUrl = await listen(server);
  const issuerUrl = new URL(`${baseUrl}/`);
  app.use(
    mcpAuthRouter({
      provider: inboundProvider,
      issuerUrl,
      baseUrl: issuerUrl,
      scopesSupported: ['tag:allowed'],
      authorizationOptions: { rateLimit: false },
      tokenOptions: { rateLimit: false },
      revocationOptions: { rateLimit: false },
      clientRegistrationOptions: { rateLimit: false },
    }),
  );
  app.post('/api/auth/cli-token', createCliTokenRoute(inboundProvider));
  app.use('/oauth', createOAuthRoutes(inboundProvider, undefined, flow));
  app.get('/admin/oauth', (_request, response) => response.type('text').send('OAuth complete'));

  return {
    baseUrl,
    storageDir,
    inboundProvider,
    setUpstreamProvider(nextProvider, era, resourceUrl) {
      provider = nextProvider;
      upstreamEra = era;
      upstreamResourceUrl = resourceUrl;
    },
    async close() {
      inboundProvider.shutdown();
      await closeServer(server);
      fs.rmSync(storageDir, { recursive: true, force: true });
    },
  };
}

export function createUpstreamProvider(options: {
  readonly era: OAuthEra;
  readonly upstream: UpstreamAuthorityFixture;
  readonly surface: AuthoritySurfaceFixture;
  readonly authority?: Partial<OAuthAuthorityContext>;
}): SDKOAuthClientProvider {
  const authority: OAuthAuthorityContext = {
    owner: 'runtime-scope-a',
    source: 'configured-upstream-a',
    route: {
      kind: 'http',
      connectionKey: 'configured-upstream-a',
      url: options.upstream.resourceUrl,
    },
    configuration: oauthDigest(['oauth-authority-e2e', options.era]),
    ...options.authority,
  };
  const config: OAuthClientConfig = {
    redirectUrl: `${options.surface.baseUrl}/oauth/callback/same-display-name`,
    scopes: ['read'],
    legacy: options.era === 'legacy',
    authority,
  };
  return new SDKOAuthClientProvider('same-display-name', config, options.surface.storageDir);
}

export async function startProviderAuthorization(
  provider: SDKOAuthClientProvider,
  era: OAuthEra,
  resourceUrl: string,
): Promise<void> {
  const result =
    era === 'legacy'
      ? await legacyAuth(provider, { serverUrl: resourceUrl, fetchFn: provider.fetch })
      : await modernAuth(provider as ModernProvider, { serverUrl: resourceUrl, fetchFn: provider.fetch });
  if (result !== 'REDIRECT') throw new Error(`Expected OAuth redirect, received ${String(result)}`);
}

export async function completeAuthorization(
  provider: SDKOAuthClientProvider,
  era: OAuthEra,
  resourceUrl: string,
  callback: URLSearchParams,
): Promise<void> {
  await provider.withAuthorizationCallback(callback, async () => {
    if (era === 'legacy') {
      await legacyAuth(provider, {
        serverUrl: resourceUrl,
        fetchFn: provider.fetch,
        authorizationCode: callback.get('code')!,
      });
      return;
    }
    await modernAuth(provider as ModernProvider, {
      serverUrl: resourceUrl,
      fetchFn: provider.fetch,
      authorizationCode: callback.get('code')!,
      iss: callback.get('iss') ?? undefined,
    });
  });
}

export async function acquireBrowserGrant(browser: Browser, surface: AuthoritySurfaceFixture): Promise<string> {
  let callbackUrl: URL | undefined;
  const callbackServer = createServer((request, response) => {
    callbackUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    response.end('Authorization complete');
  });
  const callbackBase = await listen(callbackServer);
  const redirectUri = `${callbackBase}/callback`;
  try {
    const registration = await fetch(`${surface.baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Authority Matrix Browser',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
    });
    if (!registration.ok) throw new Error(`Inbound client registration failed with HTTP ${registration.status}`);
    const { client_id: clientId } = (await registration.json()) as { client_id: string };
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const authorizationUrl = new URL(`${surface.baseUrl}/authorize`);
    authorizationUrl.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'tag:allowed',
      state: 'inbound-browser-state',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: `${surface.baseUrl}/mcp`,
    }).toString();
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(authorizationUrl.href);
      await page.getByRole('button', { name: 'Approve' }).click();
      await waitUntil(() => callbackUrl !== undefined);
    } finally {
      await context.close();
    }
    const tokenResponse = await postForm(`${surface.baseUrl}/token`, {
      grant_type: 'authorization_code',
      client_id: clientId,
      code: callbackUrl!.searchParams.get('code')!,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      resource: `${surface.baseUrl}/mcp`,
    });
    if (!tokenResponse.ok) throw new Error(`Inbound token exchange failed with HTTP ${tokenResponse.status}`);
    const tokens = (await tokenResponse.json()) as { access_token: string };
    return tokens.access_token;
  } finally {
    await closeServer(callbackServer);
  }
}

export async function acquireCliGrant(surface: AuthoritySurfaceFixture): Promise<string> {
  const response = await fetch(`${surface.baseUrl}/api/auth/cli-token`, { method: 'POST' });
  if (!response.ok) throw new Error(`CLI token request failed with HTTP ${response.status}`);
  const result = (await response.json()) as { token: string };
  return result.token;
}

export async function openUpstreamAuthorization(page: Page, surface: AuthoritySurfaceFixture): Promise<URL> {
  await page.goto(`${surface.baseUrl}/oauth/authorize/same-display-name`);
  const href = await page.getByRole('link', { name: 'Approve upstream access' }).getAttribute('href');
  if (!href) throw new Error('Upstream authorization fixture did not expose a callback');
  return new URL(href);
}

export async function approveOpenUpstreamAuthorization(page: Page, surface: AuthoritySurfaceFixture): Promise<void> {
  await page.getByRole('link', { name: 'Approve upstream access' }).click();
  await page.waitForURL(`${surface.baseUrl}/admin/oauth?success=1`);
}

async function postForm(url: string, fields: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not bind a TCP port');
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for OAuth callback');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
