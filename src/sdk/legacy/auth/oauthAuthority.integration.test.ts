import {
  auth as modernAuth,
  type OAuthClientProvider as ModernProvider,
  SSEClientTransport as ModernSseTransport,
  StreamableHTTPClientTransport as ModernTransport,
  UnauthorizedError as ModernUnauthorizedError,
} from '@modelcontextprotocol/client';

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { auth as legacyAuth, UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { SSEClientTransport as LegacySseTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport as LegacyTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { authoritySlot, oauthDigest } from '@src/auth/oauthAuthority.js';
import { ClientSessionRepository } from '@src/auth/storage/clientSessionRepository.js';
import { FileStorageService } from '@src/auth/storage/fileStorageService.js';

import { afterEach, describe, expect, it } from 'vitest';

import { authorizeUpstream, bindCoordinatedOAuthTransport, createCoordinatedOAuthFetch } from './coordinatedOAuth.js';
import { type OAuthClientConfig, SDKOAuthClientProvider } from './sdkOAuthClientProvider.js';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(legacy: boolean, overrides: Partial<OAuthClientConfig> = {}, coordinated = false) {
  const requests: Array<{ path: string; body: string; headers: http.IncomingHttpHeaders }> = [];
  let base = '';
  const behavior: {
    issuers?: string[];
    resource?: string;
    metadataPatch?: Record<string, unknown>;
    metadataStatus?: number;
    corruptMetadata?: boolean;
    tokenStatus?: number;
    tokenHandler?: (body: string, response: http.ServerResponse) => void;
    resourceHandler?: (request: http.IncomingMessage, response: http.ServerResponse) => void;
    failConnection?: boolean;
    challengeResource?: boolean;
  } = {};
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += String(chunk);
    requests.push({ path: req.url!, body, headers: req.headers });
    if (behavior.failConnection) {
      req.socket.destroy();
      return;
    }
    res.setHeader('content-type', 'application/json');
    if (req.url?.includes('oauth-protected-resource'))
      return res.end(
        JSON.stringify({
          resource: behavior.resource ?? base + '/mcp',
          authorization_servers: behavior.issuers ?? [base],
          scopes_supported: ['read'],
        }),
      );
    if (req.url?.includes('oauth-authorization-server')) {
      if (behavior.metadataStatus) {
        res.statusCode = behavior.metadataStatus;
        return res.end('{}');
      }
      if (behavior.corruptMetadata) return res.end('malformed-metadata');
      return res.end(
        JSON.stringify({
          issuer: base,
          authorization_endpoint: base + '/authorize',
          token_endpoint: base + '/token',
          registration_endpoint: base + '/register',
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          authorization_response_iss_parameter_supported: true,
          client_id_metadata_document_supported: true,
          ...behavior.metadataPatch,
        }),
      );
    }
    if (req.url === '/register') return res.end(JSON.stringify({ ...JSON.parse(body), client_id: 'dynamic-client' }));
    if (req.url === '/token') {
      if (behavior.tokenHandler) return behavior.tokenHandler(body, res);
      if (behavior.tokenStatus) res.statusCode = behavior.tokenStatus;
      return res.end(
        JSON.stringify({
          access_token: 'opaque-upstream-token',
          token_type: 'Bearer',
          refresh_token: 'opaque-refresh',
          scope: 'read',
        }),
      );
    }
    if (req.url === '/mcp' && behavior.resourceHandler) return behavior.resourceHandler(req, res);
    if (req.url === '/mcp' && behavior.challengeResource) {
      res.writeHead(401, {
        'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
      });
      return res.end('{}');
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture port');
  base = `http://127.0.0.1:${address.port}`;
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oauth-sdk-'));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const config: OAuthClientConfig = {
    redirectUrl: 'http://127.0.0.1:3050/oauth/callback/server',
    scopes: ['read'],
    legacy,
    authority: {
      owner: 'runtime-a',
      source: 'configured-a',
      route: { kind: 'http', connectionKey: 'configured-a', url: base + '/mcp' },
      configuration: oauthDigest(['configured-a', legacy]),
    },
    ...overrides,
  };
  const create = (changes: Partial<OAuthClientConfig> = {}) => {
    const provider = new SDKOAuthClientProvider('same-display-name', { ...config, ...changes }, dir);
    cleanups.push(() => provider.shutdown());
    return provider;
  };
  const provider = create();
  const authorize = (target = provider, callback?: URLSearchParams) => {
    const options = {
      serverUrl: base + '/mcp',
      fetchFn: target.fetch,
      ...(callback ? { authorizationCode: callback.get('code')!, iss: callback.get('iss') ?? undefined } : {}),
    };
    if (coordinated) return authorizeUpstream(target, legacy, options);
    return legacy ? legacyAuth(target, options) : modernAuth(target as ModernProvider, options);
  };
  const finish = (target: SDKOAuthClientProvider, callback: URLSearchParams) =>
    target.withAuthorizationCallback(callback, () => authorize(target, callback));
  return { provider, authorize, finish, create, requests, base, config, dir, behavior };
}

for (const legacy of [true, false])
  describe(`${legacy ? 'legacy' : 'modern'} released SDK authority contract`, () => {
    it('accepts a root Resource Indicator with an explicitly pinned separate local issuer', async () => {
      const resource = await fixture(legacy);
      const issuer = await fixture(legacy);
      resource.behavior.issuers = [issuer.base];
      resource.behavior.resource = resource.base;
      const provider = resource.create({ issuer: issuer.base });
      expect(await resource.authorize(provider)).toBe('REDIRECT');
      const redirect = new URL(provider.getAuthorizationUrl()!);
      expect(redirect.origin).toBe(issuer.base);
      expect(redirect.searchParams.get('resource')).toBe(resource.base + '/');
      const callback = new URLSearchParams({
        state: redirect.searchParams.get('state')!,
        code: 'synthetic-code',
        iss: issuer.base,
      });
      expect(await resource.finish(provider, callback)).toBe('AUTHORIZED');
      expect(await resource.authorize(provider)).toBe('AUTHORIZED');
      const tokenRequests = issuer.requests.filter((request) => request.path === '/token');
      expect(tokenRequests).toHaveLength(2);
      for (const request of tokenRequests)
        expect(new URLSearchParams(request.body).get('resource')).toBe(resource.base + '/');
      expect(resource.requests.some((request) => request.path === '/token' || request.path === '/register')).toBe(
        false,
      );
      const wrongRoute = resource.create({
        issuer: issuer.base,
        authority: {
          ...resource.config.authority!,
          route: { ...resource.config.authority!.route, url: resource.base + '/other' },
        },
      });
      expect(wrongRoute.tokens()).toBeUndefined();
    });
    it('rejects a discovered separate local issuer unless it is explicitly configured', async () => {
      const resource = await fixture(legacy);
      const issuer = await fixture(legacy);
      resource.behavior.issuers = [issuer.base];
      await expect(resource.authorize()).rejects.toThrow(/OAuth/);
      expect(issuer.requests).toHaveLength(0);
    });
    it('uses discovery, DCR, independent PKCE attempts and restart-safe single-use callback', async () => {
      const f = await fixture(legacy);
      expect(await f.authorize()).toBe('REDIRECT');
      const first = new URL(f.provider.getAuthorizationUrl()!);
      expect(await f.authorize()).toBe('REDIRECT');
      const second = new URL(f.provider.getAuthorizationUrl()!);
      expect(first.searchParams.get('state')).not.toBe(second.searchParams.get('state'));
      expect(first.searchParams.get('code_challenge')).not.toBe(second.searchParams.get('code_challenge'));
      const restarted = f.create();
      const callback = new URLSearchParams({
        state: first.searchParams.get('state')!,
        code: 'synthetic-code',
        iss: f.base,
      });
      const results = await Promise.allSettled([f.finish(restarted, callback), f.finish(f.create(), callback)]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(f.requests.filter((request) => request.path === '/token')).toHaveLength(1);
      expect(new URLSearchParams(f.requests.find((request) => request.path === '/token')!.body).get('resource')).toBe(
        f.base + '/mcp',
      );
      expect((await f.create().tokens())?.access_token).toBe('opaque-upstream-token');
      await expect(f.finish(f.create(), callback)).rejects.toThrow(/OAuth/);
    });
    it.each(['missing-state', 'wrong-state', 'wrong-issuer', 'missing-issuer', 'wrong-redirect', 'provider-error'])(
      'rejects %s without exchanging code',
      async (failure) => {
        const f = await fixture(legacy);
        await f.authorize();
        const callback = new URLSearchParams({
          state: new URL(f.provider.getAuthorizationUrl()!).searchParams.get('state')!,
          code: 'secret-code',
          iss: f.base,
        });
        if (failure === 'missing-state') callback.delete('state');
        if (failure === 'wrong-state') callback.set('state', 'wrong-state');
        if (failure === 'wrong-issuer') callback.set('iss', f.base + '/');
        if (failure === 'missing-issuer') callback.delete('iss');
        if (failure === 'wrong-redirect') callback.set('redirect_uri', 'https://other.example/callback');
        if (failure === 'provider-error') {
          callback.delete('code');
          callback.set('error', 'sensitive-provider-message');
        }
        await expect(f.finish(f.provider, callback)).rejects.toThrow(/OAuth/);
        expect(f.requests.filter((request) => request.path === '/token')).toHaveLength(0);
      },
    );
    it.each(['owner', 'source', 'resource', 'route', 'issuer'])(
      'does not select or complete credentials for wrong %s',
      async (dimension) => {
        const f = await fixture(legacy);
        await f.authorize();
        const first = new URLSearchParams({
          state: new URL(f.provider.getAuthorizationUrl()!).searchParams.get('state')!,
          code: 'first-code',
          iss: f.base,
        });
        // A second independent attempt exists before the original acquires real credentials.
        await f.authorize();
        const callback = new URLSearchParams({
          state: new URL(f.provider.getAuthorizationUrl()!).searchParams.get('state')!,
          code: 'secret-code',
          iss: f.base,
        });
        await f.finish(f.provider, first);
        expect(f.provider.tokens()?.access_token).toBe('opaque-upstream-token');
        const authority = structuredClone(f.config.authority!);
        const changes: Partial<OAuthClientConfig> = { authority };
        if (dimension === 'owner') authority.owner = 'runtime-b';
        if (dimension === 'source') authority.source = 'configured-b';
        if (dimension === 'resource') authority.route.url = f.base + '/other';
        if (dimension === 'route') authority.route.connectionKey = 'other-route';
        if (dimension === 'issuer') changes.issuer = f.base + '/';
        const other = f.create(changes);
        expect(await other.tokens()).toBeUndefined();
        await expect(f.finish(other, callback)).rejects.toThrow(/OAuth/);
        // A foreign provider cannot use the old refresh token even when discovery is attempted.
        await f.authorize(other).catch(() => undefined);
        expect(f.requests.filter((request) => request.path === '/token')).toHaveLength(1);
      },
    );
    it('refreshes opaque credentials under their recorded resource and issuer', async () => {
      const f = await fixture(legacy);
      await f.authorize();
      const callback = new URLSearchParams({
        state: new URL(f.provider.getAuthorizationUrl()!).searchParams.get('state')!,
        code: 'first-code',
        iss: f.base,
      });
      await f.finish(f.provider, callback);
      expect(await f.authorize(f.create())).toBe('AUTHORIZED');
      const requests = f.requests.filter((request) => request.path === '/token');
      expect(requests).toHaveLength(2);
      expect(new URLSearchParams(requests[1].body).get('grant_type')).toBe('refresh_token');
      expect(new URLSearchParams(requests[1].body).get('resource')).toBe(f.base + '/mcp');
    });
    it('a token response cannot resurrect credentials after invalidation', async () => {
      const f = await fixture(legacy);
      await f.authorize();
      const callback = new URLSearchParams({
        state: new URL(f.provider.getAuthorizationUrl()!).searchParams.get('state')!,
        code: 'first-code',
        iss: f.base,
      });
      const save = f.provider.saveTokens.bind(f.provider);
      f.provider.saveTokens = async (tokens, ctx) => {
        await f.provider.invalidateCredentials('all');
        await save(tokens, ctx);
      };
      await expect(f.finish(f.provider, callback)).rejects.toThrow(/OAuth/);
      expect(f.create().tokens()).toBeUndefined();
      expect(f.requests.filter((request) => request.path === '/token')).toHaveLength(1);
    });
    it('strips unrelated resource credentials from all OAuth endpoints', async () => {
      const f = await fixture(legacy, { clientId: 'approved-client' });
      const original = f.provider.fetch;
      const contaminated: typeof fetch = (url, init) =>
        original(url, {
          ...init,
          headers: {
            ...Object.fromEntries(new Headers(init?.headers)),
            authorization: 'Bearer resource-private-token',
            'x-resource-secret': 'private-header',
          },
        });
      const start = legacy
        ? legacyAuth(f.provider, { serverUrl: f.base + '/mcp', fetchFn: contaminated })
        : modernAuth(f.provider as ModernProvider, { serverUrl: f.base + '/mcp', fetchFn: contaminated });
      await start;
      const callback = new URLSearchParams({
        state: new URL(f.provider.getAuthorizationUrl()!).searchParams.get('state')!,
        code: 'first-code',
        iss: f.base,
      });
      await f.provider.withAuthorizationCallback(callback, () =>
        legacy
          ? legacyAuth(f.provider, {
              serverUrl: f.base + '/mcp',
              fetchFn: contaminated,
              authorizationCode: 'first-code',
            })
          : modernAuth(f.provider as ModernProvider, {
              serverUrl: f.base + '/mcp',
              fetchFn: contaminated,
              authorizationCode: 'first-code',
              iss: f.base,
            }),
      );
      for (const request of f.requests) {
        expect(request.headers.authorization).toBeUndefined();
        expect(request.headers['x-resource-secret']).toBeUndefined();
      }
    });
    it('configured preregistration replaces an existing dynamic registration', async () => {
      const f = await fixture(legacy);
      await f.authorize();
      expect(f.provider.clientInformation()?.client_id).toBe('dynamic-client');
      const preregistered = f.create({ clientId: 'approved-client' });
      await f.authorize(preregistered);
      expect(new URL(preregistered.getAuthorizationUrl()!).searchParams.get('client_id')).toBe('approved-client');
      expect(f.requests.filter((request) => request.path === '/register')).toHaveLength(1);
    });
    it('a late discovery commit cannot supersede a later operation in the same generation', async () => {
      const f = await fixture(legacy);
      let release!: () => void;
      let entered!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const arrived = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const save = f.provider.saveDiscoveryState.bind(f.provider);
      let first = true;
      f.provider.saveDiscoveryState = async (state) => {
        if (first) {
          first = false;
          entered();
          await held;
        }
        return save(state);
      };
      const older = f.authorize();
      await arrived;
      expect(await f.authorize(f.create())).toBe('REDIRECT');
      release();
      await expect(older).rejects.toThrow(/OAuth/);
    });
    it('a failed concurrent auth operation cannot poison an already validated operation', async () => {
      const f = await fixture(legacy);
      let release!: () => void;
      let entered!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const arrived = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const save = f.provider.saveDiscoveryState.bind(f.provider);
      let first = true;
      f.provider.saveDiscoveryState = async (state) => {
        if (first) {
          first = false;
          entered();
          await held;
        }
        return save(state);
      };
      const valid = f.authorize();
      await arrived;
      f.behavior.corruptMetadata = true;
      await expect(f.authorize()).rejects.toThrow();
      f.behavior.corruptMetadata = false;
      release();
      expect(await valid).toBe('REDIRECT');
      expect(f.requests.filter((request) => request.path === '/register')).toHaveLength(1);
    });
    it('a late same-generation registration cannot overwrite a committed newer registration', async () => {
      const f = await fixture(legacy);
      let release!: () => void;
      let entered!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const arrived = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const save = f.provider.saveClientInformation.bind(f.provider);
      f.provider.saveClientInformation = async (information, ctx) => {
        entered();
        await held;
        return save(information, ctx);
      };
      const older = f.authorize();
      await arrived;
      const newer = f.create();
      expect(await f.authorize(newer)).toBe('REDIRECT');
      release();
      await expect(older).rejects.toThrow(/OAuth/);
      expect(newer.clientInformation()?.client_id).toBe('dynamic-client');
    });
    it('identical complete token replies cannot move an old refresh into a new generation', async () => {
      const f = await fixture(legacy);
      await f.authorize();
      const callback = () =>
        new URLSearchParams({
          state: new URL(f.provider.getAuthorizationUrl()!).searchParams.get('state')!,
          code: 'synthetic-code',
          iss: f.base,
        });
      await f.finish(f.provider, callback());
      const save = f.provider.saveTokens.bind(f.provider);
      let release!: () => void;
      let entered!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const arrived = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let first = true;
      const replies: unknown[] = [];
      f.provider.saveTokens = async (tokens, ctx) => {
        replies.push(structuredClone(tokens));
        if (first) {
          first = false;
          entered();
          await held;
        }
        return save(tokens, ctx);
      };
      const older = f.authorize();
      await arrived;
      await f.provider.invalidateCredentials('all');
      await f.authorize();
      await f.finish(f.provider, callback());
      const storage = new FileStorageService(f.dir, 'client');
      cleanups.push(() => storage.shutdown());
      const repository = new ClientSessionRepository(storage);
      const before = repository.getBound(authoritySlot(f.config.authority!));
      release();
      await expect(older).rejects.toThrow(/OAuth/);
      expect(replies).toHaveLength(2);
      expect(replies[0]).toEqual(replies[1]);
      expect(repository.getBound(authoritySlot(f.config.authority!))?.revision).toBe(before?.revision);
      expect(f.provider.tokens()?.access_token).toBe('opaque-upstream-token');
    });
    it('the actual transport automatic 401 flow isolates and retries discovery failures', async () => {
      const f = await fixture(legacy);
      f.behavior.challengeResource = true;
      f.behavior.corruptMetadata = true;
      const transport = legacy
        ? new LegacyTransport(new URL(f.base + '/mcp'), { authProvider: f.provider, fetch: f.provider.fetch })
        : new ModernTransport(new URL(f.base + '/mcp'), {
            authProvider: f.provider as ModernProvider,
            fetch: f.provider.fetch,
          });
      cleanups.push(() => transport.close());
      const message = {
        jsonrpc: '2.0' as const,
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } },
      };
      await expect(transport.send(message)).rejects.toThrow();
      expect(f.requests.some((request) => request.path === '/register')).toBe(false);
      f.behavior.corruptMetadata = false;
      // A successful auth redirect still rejects this unauthenticated MCP send.
      await expect(transport.send({ ...message, id: 2 })).rejects.toThrow();
      expect(f.provider.getAuthorizationUrl()).toBeDefined();
      expect(f.requests.filter((request) => request.path === '/register')).toHaveLength(1);
    });
    it('an ordinary resource failure does not poison future transport requests', async () => {
      const f = await fixture(legacy);
      await f.authorize();
      f.behavior.failConnection = true;
      await expect(f.provider.fetch(f.base + '/mcp')).rejects.toThrow(/OAuth/);
      f.behavior.failConnection = false;
      expect((await f.provider.fetch(f.base + '/mcp')).status).toBe(404);
    });
    it('a consumed callback retains its safe Admin return after token network failure', async () => {
      const f = await fixture(legacy);
      await f.authorize();
      const state = new URL(f.provider.getAuthorizationUrl()!).searchParams.get('state')!;
      await f.provider.bindAdminReturn(state, 'https://admin.example');
      f.behavior.failConnection = true;
      await expect(
        f.finish(f.provider, new URLSearchParams({ state, code: 'private-code', iss: f.base })),
      ).rejects.toThrow();
      expect(f.provider.getAdminReturn(state)).toBe('https://admin.example');
    });
    it('a failed discovery can be retried without allowing fallback in the failed operation', async () => {
      const f = await fixture(legacy);
      f.behavior.corruptMetadata = true;
      await expect(f.authorize()).rejects.toThrow();
      expect(f.requests.some((request) => request.path === '/register' || request.path === '/token')).toBe(false);
      f.behavior.corruptMetadata = false;
      expect(await f.authorize()).toBe('REDIRECT');
    });
    it('retries a transient connection failure on the same provider without downgrading', async () => {
      const f = await fixture(legacy);
      f.behavior.failConnection = true;
      await expect(f.authorize()).rejects.toThrow();
      expect(f.requests.some((request) => request.path === '/register' || request.path === '/token')).toBe(false);
      f.behavior.failConnection = false;
      expect(await f.authorize()).toBe('REDIRECT');
    });
    it('ambiguous issuer metadata does not trigger an inferred fallback', async () => {
      const f = await fixture(legacy);
      f.behavior.issuers = [f.base, 'https://other.example'];
      await expect(f.authorize()).rejects.toThrow();
      expect(f.requests.some((request) => request.path === '/register' || request.path === '/token')).toBe(false);
    });
    it('malicious metadata cannot expand endpoint trust', async () => {
      const f = await fixture(legacy);
      f.behavior.metadataPatch = { token_endpoint: 'http://169.254.169.254/private-token-query?secret=hidden' };
      await expect(f.authorize()).rejects.toThrow();
      expect(f.requests.some((request) => request.path === '/register' || request.path === '/token')).toBe(false);
    });
    it('only legacy same-origin discovery permits inferred registration', async () => {
      const f = await fixture(legacy);
      f.behavior.metadataStatus = 404;
      if (legacy) expect(await f.authorize()).toBe('REDIRECT');
      else await expect(f.authorize()).rejects.toThrow();
      expect(f.requests.filter((request) => request.path === '/register')).toHaveLength(legacy ? 1 : 0);
    });
    it('changed discovered destination makes old credentials and attempts ineligible', async () => {
      const f = await fixture(legacy);
      await f.authorize();
      const old = f.create();
      const callback = new URLSearchParams({
        state: new URL(f.provider.getAuthorizationUrl()!).searchParams.get('state')!,
        code: 'private-old-code',
        iss: f.base,
      });
      await f.finish(f.provider, callback);
      expect(f.provider.tokens()?.access_token).toBe('opaque-upstream-token');
      f.behavior.metadataPatch = { token_endpoint: f.base + '/token-new' };
      expect(await f.authorize()).toBe('REDIRECT');
      expect(f.provider.tokens()).toBeUndefined();
      expect(() => old.tokens()).toThrow(/OAuth/);
      expect(f.requests.filter((request) => request.path === '/token')).toHaveLength(1);
    });
    it('an in-flight registration response cannot populate an invalidated generation', async () => {
      const f = await fixture(legacy);
      const save = f.provider.saveClientInformation.bind(f.provider);
      f.provider.saveClientInformation = async (information, ctx) => {
        await f.provider.invalidateCredentials('all');
        await save(information, ctx);
      };
      await expect(f.authorize()).rejects.toThrow(/OAuth/);
      expect(f.create().clientInformation()).toBeUndefined();
    });
    it('an in-flight discovery response cannot undo invalidation', async () => {
      const f = await fixture(legacy);
      await f.authorize();
      const save = f.provider.saveDiscoveryState.bind(f.provider);
      f.provider.saveDiscoveryState = async (state) => {
        await f.provider.invalidateCredentials('all');
        await save(state);
      };
      await expect(f.authorize()).rejects.toThrow(/OAuth/);
      expect(f.create().clientInformation()).toBeUndefined();
    });
    it('configured client wins and no dynamic registration occurs', async () => {
      const f = await fixture(legacy, { clientId: 'approved-client', clientSecret: 'private-client-secret' });
      await f.authorize();
      expect(new URL(f.provider.getAuthorizationUrl()!).searchParams.get('client_id')).toBe('approved-client');
      expect(f.requests.some((request) => request.path === '/register')).toBe(false);
    });
    it('advertised CIMD wins over DCR', async () => {
      const f = await fixture(legacy, { clientMetadataUrl: 'https://client.example/metadata.json' });
      await f.authorize();
      expect(new URL(f.provider.getAuthorizationUrl()!).searchParams.get('client_id')).toBe(
        'https://client.example/metadata.json',
      );
      expect(f.requests.some((request) => request.path === '/register')).toBe(false);
    });
  });

async function login(f: Awaited<ReturnType<typeof fixture>>) {
  expect(await f.authorize()).toBe('REDIRECT');
  const redirect = new URL(f.provider.getAuthorizationUrl()!);
  expect(
    await f.finish(
      f.provider,
      new URLSearchParams({ state: redirect.searchParams.get('state')!, code: 'fixture-code', iss: f.base }),
    ),
  ).toBe('AUTHORIZED');
}

function heldTokens(f: Awaited<ReturnType<typeof fixture>>) {
  let arrived!: () => void;
  const request = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  let response!: http.ServerResponse;
  let count = 0;
  f.behavior.tokenHandler = (_body, res) => {
    response = res;
    count++;
    arrived();
  };
  return {
    request,
    count: () => count,
    disconnect: () => response.destroy(),
    respond: (value: object, status = 200) => {
      response.statusCode = status;
      response.end(JSON.stringify(value));
    },
  };
}

for (const legacy of [true, false])
  describe(`${legacy ? 'legacy' : 'modern'} coordinated refresh`, () => {
    it.each(['rotating', 'stable', 'omitted'])('shares one %s refresh across providers and callers', async (mode) => {
      const f = await fixture(legacy, {}, true);
      await login(f);
      const other = f.create();
      await other.authorize(async () => 'AUTHORIZED');
      const held = heldTokens(f);
      const first = f.authorize();
      await held.request;
      const followers = [f.authorize(), f.authorize(other), f.authorize(other)];
      held.respond({
        access_token: 'winner',
        token_type: 'Bearer',
        ...(mode === 'omitted' ? {} : { refresh_token: mode === 'rotating' ? 'rotated' : 'opaque-refresh' }),
      });
      expect(await Promise.all([first, ...followers])).toEqual(Array(4).fill('AUTHORIZED'));
      expect(held.count()).toBe(1);
      expect(other.tokens()?.refresh_token).toBe(mode === 'rotating' ? 'rotated' : 'opaque-refresh');
    });

    it.each([503, 429, 400, 'network'] as const)(
      'preserves credentials without attempts after temporary HTTP %s',
      async (status) => {
        const f = await fixture(legacy, {}, true);
        await login(f);
        const held = heldTokens(f);
        const first = f.authorize();
        await held.request;
        const follower = f.authorize();
        const settled = Promise.allSettled([first, follower]);
        if (status === 'network') held.disconnect();
        else held.respond({ error: 'server_error' }, status);
        expect((await settled).every((result) => result.status === 'rejected')).toBe(true);
        expect(held.count()).toBe(1);
        expect(f.provider.tokens()?.refresh_token).toBe('opaque-refresh');
        expect(f.provider.getPendingAuthorizationUrl()).toBeUndefined();
        f.behavior.tokenHandler = undefined;
        expect(await f.authorize()).toBe('AUTHORIZED');
      },
    );

    it('shares definitive rejection and one pending authorization across providers', async () => {
      const f = await fixture(legacy, {}, true);
      await login(f);
      const other = f.create();
      await other.authorize(async () => 'AUTHORIZED');
      const held = heldTokens(f);
      const first = f.authorize();
      await held.request;
      const follower = f.authorize(other);
      held.respond({ error: 'invalid_grant' }, 400);
      expect(await Promise.all([first, follower])).toEqual(['REDIRECT', 'REDIRECT']);
      expect(other.getAuthorizationUrl()).toBe(f.provider.getAuthorizationUrl());
      expect(await f.authorize(other)).toBe('REDIRECT');
      expect(held.count()).toBe(1);
      const repository = new ClientSessionRepository(new FileStorageService(f.dir, 'client'));
      const attempts = repository.getBound(authoritySlot(f.config.authority!))!.attempts;
      expect(Object.values(attempts).filter((attempt) => !attempt.consumed)).toHaveLength(1);
    });

    it.each(['invalid_grant', 'success'])('fences a late %s after a newer credential revision', async (response) => {
      const f = await fixture(legacy, {}, true);
      await login(f);
      const snapshot = f.provider.credentialSnapshot()!;
      const held = heldTokens(f);
      const pending = f.authorize();
      await held.request;
      const repository = new ClientSessionRepository(new FileStorageService(f.dir, 'client'));
      await repository.updateBound(authoritySlot(f.config.authority!), snapshot.generation, (record) => {
        record.tokens = JSON.stringify({ access_token: 'newer', refresh_token: 'newer-refresh', token_type: 'Bearer' });
        record.revision++;
      });
      const settled = Promise.allSettled([pending]);
      held.respond(
        response === 'invalid_grant'
          ? { error: 'invalid_grant' }
          : { access_token: 'stale', refresh_token: 'stale-refresh', token_type: 'Bearer' },
        response === 'invalid_grant' ? 400 : 200,
      );
      expect((await settled)[0].status).toBe('rejected');
      await f.provider.invalidateRejectedTokens(snapshot);
      expect(f.provider.tokens()?.refresh_token).toBe('newer-refresh');
      expect(f.provider.getPendingAuthorizationUrl()).toBeUndefined();
    });

    it('fences logout while refresh is pending', async () => {
      const f = await fixture(legacy, {}, true);
      await login(f);
      const held = heldTokens(f);
      const first = f.authorize();
      await held.request;
      const follower = f.authorize();
      const settled = Promise.allSettled([first, follower]);
      await f.provider.invalidateCredentials('tokens');
      held.respond({ access_token: 'stale', refresh_token: 'stale-refresh', token_type: 'Bearer' });
      expect((await settled).every((result) => result.status === 'rejected')).toBe(true);
      expect(f.provider.tokens()).toBeUndefined();
    });

    it('terminates owner and waiters on shutdown', async () => {
      const f = await fixture(legacy, {}, true);
      await login(f);
      const held = heldTokens(f);
      const first = f.authorize();
      await held.request;
      const follower = f.authorize();
      const settled = Promise.allSettled([first, follower]);
      await f.provider.shutdown();
      expect((await settled).every((result) => result.status === 'rejected')).toBe(true);
      held.respond({ access_token: 'stale', token_type: 'Bearer' });
    });

    it('refreshes distinct resources independently despite equal display names', async () => {
      const left = await fixture(legacy, {}, true);
      const right = await fixture(legacy, {}, true);
      await Promise.all([login(left), login(right)]);
      const a = heldTokens(left);
      const b = heldTokens(right);
      const pending = Promise.all([left.authorize(), right.authorize()]);
      await Promise.all([a.request, b.request]);
      a.respond({ access_token: 'left', token_type: 'Bearer' });
      b.respond({ access_token: 'right', token_type: 'Bearer' });
      expect(await pending).toEqual(['AUTHORIZED', 'AUTHORIZED']);
    });
  });

for (const legacy of [true, false])
  describe(`${legacy ? 'legacy' : 'modern'} transport refresh ownership`, () => {
    it('coordinates real SDK transports, preserves headers and replays the exact body once', async () => {
      const f = await fixture(legacy, {}, true);
      await login(f);
      const other = f.create();
      await other.authorize(async () => 'AUTHORIZED');
      f.behavior.resourceHandler = (request, response) => {
        if (request.headers.authorization === 'Bearer winner') {
          response.statusCode = 202;
          response.end();
          return;
        }
        response.writeHead(401, {
          'www-authenticate': `Bearer resource_metadata="${f.base}/.well-known/oauth-protected-resource/mcp"`,
        });
        response.end('{}');
      };
      const held = heldTokens(f);
      const Transport = legacy ? LegacyTransport : ModernTransport;
      const transports = [f.provider, other].map(
        (provider) =>
          new Transport(new URL(f.base + '/mcp'), {
            fetch: createCoordinatedOAuthFetch(provider, legacy, f.base + '/mcp'),
            requestInit: { headers: { 'x-resource-secret': 'resource-only' } },
          }),
      );
      cleanups.push(() => Promise.all(transports.map((transport) => transport.close())).then(() => undefined));
      const first = transports[0].send({ jsonrpc: '2.0', id: 1, method: 'ping' });
      await held.request;
      const second = transports[1].send({ jsonrpc: '2.0', id: 2, method: 'ping' });
      // Both resource challenges must arrive before the refresh completes.
      const original = f.behavior.resourceHandler;
      let challenged!: () => void;
      const challenge = new Promise<void>((resolve) => {
        challenged = resolve;
      });
      f.behavior.resourceHandler = (request, response) => {
        original!(request, response);
        challenged();
      };
      await challenge;
      held.respond({ access_token: 'winner', refresh_token: 'rotated', token_type: 'Bearer' });
      await Promise.all([first, second]);
      expect(held.count()).toBe(1);
      const resources = f.requests.filter((request) => request.path === '/mcp');
      expect(resources).toHaveLength(4);
      expect(resources.map((request) => request.body).sort()).toEqual(
        [1, 1, 2, 2].map((id) => JSON.stringify({ jsonrpc: '2.0', id, method: 'ping' })).sort(),
      );
      expect(resources.every((request) => request.headers['x-resource-secret'] === 'resource-only')).toBe(true);
      expect(
        f.requests
          .filter((request) => request.path === '/token')
          .every((request) => request.headers['x-resource-secret'] === undefined),
      ).toBe(true);
    });

    it('cancels an individual waiter without cancelling the shared refresh', async () => {
      const f = await fixture(legacy, {}, true);
      await login(f);
      f.behavior.resourceHandler = (_request, response) => {
        response.statusCode = 401;
        response.end('{}');
      };
      const held = heldTokens(f);
      const first = f.authorize();
      await held.request;
      const controller = new AbortController();
      const fetch = createCoordinatedOAuthFetch(f.provider, legacy, f.base + '/mcp');
      let challenged!: () => void;
      const challenge = new Promise<void>((resolve) => {
        challenged = resolve;
      });
      f.behavior.resourceHandler = (_request, response) => {
        response.statusCode = 401;
        response.end('{}');
        challenged();
      };
      const waiter = fetch(f.base + '/mcp', { signal: controller.signal });
      await challenge;
      const settled = Promise.allSettled([waiter]);
      controller.abort();
      expect((await settled)[0].status).toBe('rejected');
      held.respond({ access_token: 'winner', token_type: 'Bearer' });
      expect(await first).toBe('AUTHORIZED');
      expect(held.count()).toBe(1);
    });
  });

for (const legacy of [true, false])
  it(`${legacy ? 'legacy' : 'modern'} keeps resource scopes at the owned auth boundary`, async () => {
    const f = await fixture(legacy, { scopes: ['read', 'write'] }, true);
    await login(f);
    f.behavior.resourceHandler = (_request, response) => {
      response.writeHead(403, {
        'www-authenticate': `Bearer error="insufficient_scope", scope="write", resource_metadata="${f.base}/.well-known/oauth-protected-resource/mcp"`,
      });
      response.end('{}');
    };
    const Transport = legacy ? LegacyTransport : ModernTransport;
    const transport = new Transport(new URL(f.base + '/mcp'), {
      fetch: createCoordinatedOAuthFetch(f.provider, legacy, f.base + '/mcp'),
    });
    cleanups.push(() => transport.close());
    await expect(
      transport.send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'write', arguments: {} } }),
    ).rejects.toThrow();
    if (!legacy) {
      expect(new URL(f.provider.getPendingAuthorizationUrl()!).searchParams.get('scope')?.split(' ').sort()).toEqual([
        'read',
        'write',
      ]);
      expect(f.requests.filter((request) => request.path === '/mcp')).toHaveLength(1);
    }
  });

for (const legacy of [true, false])
  describe(`${legacy ? 'legacy' : 'modern'} SSE auth boundary`, () => {
    it('preserves initial consent as an authorization-required outcome', async () => {
      const f = await fixture(legacy, {}, true);
      f.behavior.resourceHandler = (_request, response) => {
        response.statusCode = 401;
        response.end('{}');
      };
      const Transport = legacy ? LegacySseTransport : ModernSseTransport;
      const transport = new Transport(new URL(f.base + '/mcp'), {
        fetch: createCoordinatedOAuthFetch(f.provider, legacy, f.base + '/mcp'),
      });
      bindCoordinatedOAuthTransport(transport, f.provider, legacy, f.base + '/mcp');
      cleanups.push(() => transport.close());
      await expect(transport.start()).rejects.toBeInstanceOf(legacy ? UnauthorizedError : ModernUnauthorizedError);
      expect(f.provider.getPendingAuthorizationUrl()).toBeDefined();
    });
  });

for (const legacy of [true, false])
  it(`${legacy ? 'legacy' : 'modern'} keeps equal display names independent in one runtime store`, async () => {
    const f = await fixture(legacy, {}, true);
    await login(f);
    const other = f.create({
      authority: {
        ...f.config.authority!,
        source: 'configured-b',
        route: { ...f.config.authority!.route, connectionKey: 'configured-b' },
        configuration: oauthDigest(['configured-b']),
      },
    });
    expect(await f.authorize(other)).toBe('REDIRECT');
    const redirect = new URL(other.getAuthorizationUrl()!);
    expect(
      await f.finish(
        other,
        new URLSearchParams({ state: redirect.searchParams.get('state')!, code: 'other-code', iss: f.base }),
      ),
    ).toBe('AUTHORIZED');
    const responses: http.ServerResponse[] = [];
    let arrived!: () => void;
    const both = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    f.behavior.tokenHandler = (_body, response) => {
      responses.push(response);
      if (responses.length === 2) arrived();
    };
    const pending = Promise.all([f.authorize(), f.authorize(other)]);
    await both;
    for (const [index, response] of responses.entries())
      response.end(JSON.stringify({ access_token: `authority-${index}`, token_type: 'Bearer' }));
    expect(await pending).toEqual(['AUTHORIZED', 'AUTHORIZED']);
    expect(responses).toHaveLength(2);
  });

for (const legacy of [true, false])
  it(`${legacy ? 'legacy' : 'modern'} rejects a refresh whose token read was superseded before dispatch`, async () => {
    const f = await fixture(legacy, {}, true);
    await login(f);
    const snapshot = f.provider.credentialSnapshot()!;
    const repository = new ClientSessionRepository(new FileStorageService(f.dir, 'client'));
    const fetch = f.provider.fetch;
    let intercepted = false;
    Object.assign(f.provider, {
      fetch: async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        if (!intercepted && new URLSearchParams(String(init?.body ?? '')).get('grant_type') === 'refresh_token') {
          intercepted = true;
          await repository.updateBound(authoritySlot(f.config.authority!), snapshot.generation, (record) => {
            record.tokens = JSON.stringify({
              access_token: 'newer',
              refresh_token: 'newer-refresh',
              token_type: 'Bearer',
            });
            record.revision++;
          });
        }
        return fetch(input, init);
      },
    });
    const before = f.requests.filter((request) => request.path === '/token').length;
    await expect(f.authorize()).rejects.toThrow();
    expect(intercepted).toBe(true);
    expect(f.requests.filter((request) => request.path === '/token')).toHaveLength(before);
    expect(f.provider.tokens()?.refresh_token).toBe('newer-refresh');
    expect(f.provider.getPendingAuthorizationUrl()).toBeUndefined();
  });

for (const legacy of [true, false])
  it(`${legacy ? 'legacy' : 'modern'} cannot publish an already received refresh response after shutdown`, async () => {
    const f = await fixture(legacy, {}, true);
    await login(f);
    let entered!: () => void;
    let release!: () => void;
    let finished!: () => void;
    const arrived = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const completion = new Promise<void>((resolve) => {
      finished = resolve;
    });
    const save = f.provider.saveTokens.bind(f.provider);
    f.provider.saveTokens = async (tokens, context) => {
      entered();
      await held;
      try {
        await save(tokens, context);
      } finally {
        finished();
      }
    };
    f.behavior.tokenHandler = (_body, response) =>
      response.end(JSON.stringify({ access_token: 'stale', refresh_token: 'stale-refresh', token_type: 'Bearer' }));
    const pending = Promise.allSettled([f.authorize()]);
    await arrived;
    await f.provider.shutdown();
    release();
    await completion;
    expect((await pending)[0].status).toBe('rejected');
    expect(f.provider.tokens()?.refresh_token).toBe('opaque-refresh');
  });

describe('modern scope recovery across refresh outcomes', () => {
  it('handles a replay scope challenge after a successful refresh without replaying the Tool after consent', async () => {
    const f = await fixture(false, { scopes: ['read', 'write'] }, true);
    await login(f);
    f.behavior.tokenHandler = (_body, response) =>
      response.end(
        JSON.stringify({ access_token: 'winner', refresh_token: 'rotated', token_type: 'Bearer', scope: 'read' }),
      );
    f.behavior.resourceHandler = (request, response) => {
      response.writeHead(request.headers.authorization === 'Bearer winner' ? 403 : 401, {
        'www-authenticate':
          request.headers.authorization === 'Bearer winner'
            ? 'Bearer error="insufficient_scope", scope="write"'
            : 'Bearer',
      });
      response.end('{}');
    };
    const transport = new ModernTransport(new URL(f.base + '/mcp'), {
      fetch: createCoordinatedOAuthFetch(f.provider, false, f.base + '/mcp'),
    });
    cleanups.push(() => transport.close());
    await expect(
      transport.send({ jsonrpc: '2.0', id: 20, method: 'tools/call', params: { name: 'write', arguments: {} } }),
    ).rejects.toBeInstanceOf(ModernUnauthorizedError);
    expect(new URL(f.provider.getPendingAuthorizationUrl()!).searchParams.get('scope')?.split(' ').sort()).toEqual([
      'read',
      'write',
    ]);
    expect(f.requests.filter((request) => request.path === '/mcp')).toHaveLength(2);
    expect(f.requests.filter((request) => request.path === '/token')).toHaveLength(2);
  });

  it('waits for a narrower refresh, then creates the required scope consent', async () => {
    const f = await fixture(false, { scopes: ['read', 'write'] }, true);
    await login(f);
    const held = heldTokens(f);
    const refreshing = f.authorize();
    await held.request;
    let challenged!: () => void;
    const challenge = new Promise<void>((resolve) => {
      challenged = resolve;
    });
    f.behavior.resourceHandler = (_request, response) => {
      response.writeHead(403, { 'www-authenticate': 'Bearer error="insufficient_scope", scope="write"' });
      response.end('{}');
      challenged();
    };
    const transport = new ModernTransport(new URL(f.base + '/mcp'), {
      fetch: createCoordinatedOAuthFetch(f.provider, false, f.base + '/mcp'),
    });
    cleanups.push(() => transport.close());
    const requesting = transport.send({
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: { name: 'write', arguments: {} },
    });
    const settled = Promise.allSettled([requesting]);
    await challenge;
    held.respond({ access_token: 'winner', refresh_token: 'rotated', token_type: 'Bearer', scope: 'read' });
    expect(await refreshing).toBe('AUTHORIZED');
    expect((await settled)[0].status).toBe('rejected');
    expect(new URL(f.provider.getPendingAuthorizationUrl()!).searchParams.get('scope')?.split(' ').sort()).toEqual([
      'read',
      'write',
    ]);
    expect(held.count()).toBe(1);
  });

  it('does not reuse a narrower pending consent for a wider scope challenge', async () => {
    const f = await fixture(false, { scopes: ['read', 'write'] }, true);
    expect(await authorizeUpstream(f.provider, false, { serverUrl: f.base + '/mcp', scope: 'read' })).toBe('REDIRECT');
    const narrow = f.provider.getPendingAuthorizationUrl();
    f.behavior.resourceHandler = (_request, response) => {
      response.writeHead(403, { 'www-authenticate': 'Bearer error="insufficient_scope", scope="write"' });
      response.end('{}');
    };
    const transport = new ModernTransport(new URL(f.base + '/mcp'), {
      fetch: createCoordinatedOAuthFetch(f.provider, false, f.base + '/mcp'),
    });
    cleanups.push(() => transport.close());
    const operation = () =>
      transport.send({ jsonrpc: '2.0', id: 22, method: 'tools/call', params: { name: 'write', arguments: {} } });
    await expect(operation()).rejects.toBeInstanceOf(ModernUnauthorizedError);
    const wider = f.provider.getPendingAuthorizationUrl();
    expect(wider).not.toBe(narrow);
    expect(new URL(wider!).searchParams.get('scope')?.split(' ').sort()).toEqual(['read', 'write']);
    await expect(operation()).rejects.toBeInstanceOf(ModernUnauthorizedError);
    expect(f.provider.getPendingAuthorizationUrl()).toBe(wider);
  });
});

for (const legacy of [true, false])
  it(`${legacy ? 'legacy' : 'modern'} replays a delayed obsolete 401 with newer credentials without refreshing again`, async () => {
    const f = await fixture(legacy, {}, true);
    await login(f);
    let arrived!: () => void;
    const request = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    let stale!: http.ServerResponse;
    f.behavior.resourceHandler = (incoming, response) => {
      if (incoming.headers.authorization === 'Bearer winner') {
        response.statusCode = 202;
        response.end();
        return;
      }
      stale = response;
      arrived();
    };
    f.behavior.tokenHandler = (_body, response) =>
      response.end(JSON.stringify({ access_token: 'winner', refresh_token: 'rotated', token_type: 'Bearer' }));
    const Transport = legacy ? LegacyTransport : ModernTransport;
    const transport = new Transport(new URL(f.base + '/mcp'), {
      fetch: createCoordinatedOAuthFetch(f.provider, legacy, f.base + '/mcp'),
    });
    cleanups.push(() => transport.close());
    const pending = transport.send({ jsonrpc: '2.0', id: 23, method: 'ping' });
    await request;
    expect(await f.authorize()).toBe('AUTHORIZED');
    stale.statusCode = 401;
    stale.end('{}');
    await pending;
    expect(f.requests.filter((entry) => entry.path === '/token')).toHaveLength(2);
    expect(f.provider.tokens()?.refresh_token).toBe('rotated');
  });

for (const legacy of [true, false])
  it(`${legacy ? 'legacy' : 'modern'} treats a provider outage as transient even when it returns invalid_grant`, async () => {
    const f = await fixture(legacy, {}, true);
    await login(f);
    f.behavior.tokenHandler = (_body, response) => {
      response.statusCode = 503;
      response.end(JSON.stringify({ error: 'invalid_grant' }));
    };
    await expect(f.authorize()).rejects.toThrow();
    expect(f.provider.tokens()?.refresh_token).toBe('opaque-refresh');
    expect(f.provider.getPendingAuthorizationUrl()).toBeUndefined();
  });

for (const legacy of [true, false])
  it(`${legacy ? 'legacy' : 'modern'} preserves credentials after a malformed provider outage body`, async () => {
    const f = await fixture(legacy, {}, true);
    await login(f);
    f.behavior.tokenHandler = (_body, response) => {
      response.statusCode = 503;
      response.end('not-json');
    };
    await expect(f.authorize()).rejects.toThrow();
    expect(f.provider.tokens()?.refresh_token).toBe('opaque-refresh');
    expect(f.provider.getPendingAuthorizationUrl()).toBeUndefined();
  });
