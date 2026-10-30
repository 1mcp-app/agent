import {
  auth as modernAuth,
  type OAuthClientProvider as ModernProvider,
  StreamableHTTPClientTransport as ModernTransport,
} from '@modelcontextprotocol/client';

import * as dns from 'node:dns/promises';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';

import { auth as legacyAuth } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport as LegacyTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { oauthDigest } from '@src/auth/oauthAuthority.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { type OAuthClientConfig, SDKOAuthClientProvider } from './sdkOAuthClientProvider.js';

vi.mock('node:dns/promises', async (original) => ({ ...(await original<typeof dns>()), lookup: vi.fn() }));

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

async function fixture(legacy: boolean, oauth: Partial<OAuthClientConfig> = {}, privateHostname = false) {
  let base = '';
  let resourceMetadataServed = false;
  const requests: Array<{ url: string; headers: http.IncomingHttpHeaders }> = [];
  const failures: Error[] = [];
  const shape = {
    route: '/mcp',
    metadataPath: '/discovery-document',
    metadataUrl: undefined as string | undefined,
    metadataStatus: 200,
    malformedMetadata: false,
    serverMetadataStatus: 200,
    oidcMetadata: false,
    metadataLocation: undefined as string | undefined,
    resource: undefined as string | undefined,
    resourcePatch: {} as Record<string, unknown>,
    serverPatch: {
      resource: 'https://api.firecrawl.dev/',
      authorization_servers: ['https://www.firecrawl.dev'],
    } as Record<string, unknown>,
  };
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    requests.push({ url: request.url!, headers: request.headers });
    response.setHeader('content-type', 'application/json');
    if (request.url === shape.route) {
      response.writeHead(401, {
        'www-authenticate': `Bearer resource_metadata="${shape.metadataUrl ?? base + shape.metadataPath}"`,
      });
      return response.end('{}');
    }
    if (request.url === shape.metadataPath && !resourceMetadataServed) {
      resourceMetadataServed = true;
      response.statusCode = shape.metadataStatus;
      if (shape.metadataLocation) response.setHeader('location', shape.metadataLocation);
      if (shape.malformedMetadata) return response.end('not-json-sensitive-sentinel');
      return response.end(
        JSON.stringify({
          resource: shape.resource ?? base + shape.route,
          authorization_servers: [base],
          ...shape.resourcePatch,
        }),
      );
    }
    if (request.url === '/.well-known/oauth-authorization-server') {
      response.statusCode = shape.serverMetadataStatus;
      if (shape.serverMetadataStatus !== 200) return response.end('{}');
      return response.end(
        JSON.stringify({
          issuer: base,
          authorization_endpoint: base + '/authorize',
          token_endpoint: base + '/token',
          registration_endpoint: base + '/register',
          response_types_supported: ['code'],
          code_challenge_methods_supported: ['S256'],
          ...shape.serverPatch,
        }),
      );
    }
    if (request.url === '/.well-known/openid-configuration' && shape.oidcMetadata)
      return response.end(
        JSON.stringify({
          issuer: base,
          authorization_endpoint: base + '/authorize',
          token_endpoint: base + '/token',
          registration_endpoint: base + '/register',
          jwks_uri: base + '/keys',
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          code_challenge_methods_supported: ['S256'],
        }),
      );
    if (request.url === '/register')
      return response.end(JSON.stringify({ ...JSON.parse(body), client_id: 'registered-client' }));
    if (request.url === '/token')
      return response.end(JSON.stringify({ access_token: 'fixture-token', token_type: 'Bearer' }));
    response.statusCode = 404;
    response.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  base = `http://127.0.0.1:${address.port}`;
  if (privateHostname) {
    base = `https://private.example:${address.port}`;
    vi.mocked(dns.lookup).mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
    // Keep real loopback sockets and DNS pinning; TLS itself is not under test here.
    vi.spyOn(https, 'request').mockImplementation((...args: Parameters<typeof https.request>) => {
      const [input, options, callback] = args;
      const url = new URL(String(input));
      url.protocol = 'http:';
      return http.request(url, options, callback);
    });
  }
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oauth-discovery-'));
  cleanups.push(() => fs.rmSync(directory, { recursive: true, force: true }));
  const connect = async (overrides: Partial<OAuthClientConfig> = {}) => {
    const provider = new SDKOAuthClientProvider(
      'discovery-fixture',
      {
        redirectUrl: 'http://127.0.0.1:3050/oauth/callback/fixture',
        legacy,
        ...oauth,
        ...overrides,
        authority: {
          owner: 'fixture-runtime',
          source: 'fixture-server',
          route: { kind: 'http', connectionKey: 'fixture-server', url: base + shape.route },
          configuration: oauthDigest(['discovery-fixture', legacy]),
        },
      },
      directory,
    );
    cleanups.push(() => provider.shutdown());
    const requestInit = {
      headers: {
        authorization: 'Bearer resource-secret',
        cookie: 'session=private-cookie',
        'x-api-key': 'private-key',
      },
    };
    const transport = legacy
      ? new LegacyTransport(new URL(base + shape.route), { authProvider: provider, fetch: provider.fetch, requestInit })
      : new ModernTransport(new URL(base + shape.route), {
          authProvider: provider as ModernProvider,
          fetch: provider.fetch,
          requestInit,
        });
    cleanups.push(() => transport.close());
    await expect(
      transport
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } },
        })
        .catch((error: Error) => {
          failures.push(error);
          throw error;
        }),
    ).rejects.toThrow();
    return provider;
  };
  return { base, shape, requests, failures, connect };
}

for (const legacy of [true, false])
  describe(`${legacy ? 'legacy' : 'modern'} SDK challenge discovery`, () => {
    it('uses an explicit client identity when the provider does not support dynamic registration', async () => {
      const discovery = await fixture(legacy, {
        clientId: 'http://127.0.0.1:3050/',
        autoRegister: false,
        insecureAllowIncompleteMetadata: true,
      });
      discovery.shape.serverPatch = {
        issuer: undefined,
        authorization_endpoint: '/authorize',
        token_endpoint: '/token',
        registration_endpoint: undefined,
        client_id_metadata_document_supported: true,
      };
      const provider = await discovery.connect();
      const authorization = new URL(provider.getAuthorizationUrl()!);
      expect(authorization.searchParams.get('client_id')).toBe('http://127.0.0.1:3050/');
      expect(authorization.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:3050/oauth/callback/fixture');
      expect(discovery.requests.some((request) => request.url === '/register')).toBe(false);
    });
    it('combines independent metadata and private-network opt-ins through SDK registration', async () => {
      const discovery = await fixture(legacy, { insecureAllowIncompleteMetadata: true }, true);
      discovery.shape.serverPatch = {
        issuer: undefined,
        authorization_endpoint: '/authorize',
        token_endpoint: '/token',
      };
      const provider = await discovery.connect({ privateNetworkOrigins: [discovery.base] });
      expect(new URL(provider.getAuthorizationUrl()!).origin).toBe(discovery.base);
      expect(provider.clientInformation()?.client_id).toBe('registered-client');
      const state = new URL(provider.getAuthorizationUrl()!).searchParams.get('state')!;
      const callback = new URLSearchParams({ state, code: 'fixture-code', iss: discovery.base });
      const options = {
        serverUrl: discovery.base + '/mcp',
        authorizationCode: 'fixture-code',
        fetchFn: provider.fetch,
      };
      await expect(
        provider.withAuthorizationCallback(callback, () =>
          legacy ? legacyAuth(provider, options) : modernAuth(provider as ModernProvider, options),
        ),
      ).resolves.toBe('AUTHORIZED');
      expect(provider.tokens()?.access_token).toBe('fixture-token');
    });
    it('does not let insecure metadata compatibility approve private DNS destinations', async () => {
      const discovery = await fixture(legacy, { insecureAllowIncompleteMetadata: true }, true);
      const provider = await discovery.connect();
      expect(provider.getAuthorizationUrl()).toBeUndefined();
      expect(discovery.failures.at(-1)?.message).toContain('private_destination_blocked');
      expect(discovery.requests.map((request) => request.url)).toEqual(['/mcp']);
    });
    it('repairs missing issuer and relative endpoints only with explicit insecure metadata compatibility', async () => {
      const discovery = await fixture(legacy, { insecureAllowIncompleteMetadata: true });
      discovery.shape.serverPatch = {
        issuer: undefined,
        authorization_endpoint: '/authorize',
        token_endpoint: '/token',
        registration_endpoint: '/register',
      };
      const provider = await discovery.connect();
      expect(new URL(provider.getAuthorizationUrl()!).origin).toBe(discovery.base);
      expect(provider.clientInformation()?.client_id).toBe('registered-client');
    });
    it('rejects the same incomplete metadata by default', async () => {
      const discovery = await fixture(legacy);
      discovery.shape.serverPatch = {
        issuer: undefined,
        authorization_endpoint: '/authorize',
        token_endpoint: '/token',
      };
      const provider = await discovery.connect();
      expect(provider.getAuthorizationUrl()).toBeUndefined();
      expect(discovery.failures.at(-1)?.message).toContain('invalid_metadata');
    });
    it('allows same-origin AS discovery when protected-resource metadata is unavailable only with insecure compatibility', async () => {
      const discovery = await fixture(legacy, { insecureAllowIncompleteMetadata: true });
      discovery.shape.metadataStatus = 404;
      discovery.shape.serverPatch = {
        issuer: undefined,
        authorization_endpoint: '/authorize',
        token_endpoint: '/token',
        registration_endpoint: '/register',
      };
      const provider = await discovery.connect();
      expect(new URL(provider.getAuthorizationUrl()!).origin).toBe(discovery.base);
      expect(provider.clientInformation()?.client_id).toBe('registered-client');
    });
    it.each([
      { issuer: 'https://wrong.example' },
      { issuer: '' },
      { token_endpoint: undefined },
      { token_endpoint: '//untrusted.example/token' },
      { token_endpoint: 'https://169.254.169.254/token' },
      { token_endpoint: 'http://unsafe.example/token' },
    ])('keeps authority and endpoint validation with insecure metadata compatibility: %j', async (patch) => {
      const discovery = await fixture(legacy, { insecureAllowIncompleteMetadata: true });
      discovery.shape.serverPatch = patch;
      const provider = await discovery.connect();
      expect(provider.getAuthorizationUrl()).toBeUndefined();
      expect(discovery.requests.some((request) => request.url === '/register')).toBe(false);
    });
    it('registers and produces an authorization URL from Firecrawl-shaped AS metadata', async () => {
      const discovery = await fixture(legacy);
      const provider = await discovery.connect();
      expect(provider.getAuthorizationUrl()).toBeDefined();
      const authorization = new URL(provider.getAuthorizationUrl()!);
      expect(authorization.origin + authorization.pathname).toBe(discovery.base + '/authorize');
      expect(authorization.searchParams.get('client_id')).toBe('registered-client');
      expect(authorization.searchParams.get('resource')).toBe(discovery.base + '/mcp');
      expect(provider.clientInformation()?.client_id).toBe('registered-client');
    });
    it('preserves the Supabase challenge query and matching resource audience through registration', async () => {
      const discovery = await fixture(legacy);
      discovery.shape.route = '/mcp?read_only=true';
      discovery.shape.metadataPath = '/.well-known/oauth-protected-resource?read_only=true';
      discovery.shape.serverPatch = {};
      const provider = await discovery.connect();
      expect(discovery.requests.map((request) => request.url)).toContain(
        '/.well-known/oauth-protected-resource?read_only=true',
      );
      expect(provider.getAuthorizationUrl()).toBeDefined();
      const authorization = new URL(provider.getAuthorizationUrl()!);
      expect(authorization.searchParams.get('resource')).toBe(discovery.base + '/mcp?read_only=true');
      expect(authorization.searchParams.get('client_id')).toBe('registered-client');
    });
    it('reports a bounded invalid-metadata diagnostic for SDK schema failures', async () => {
      const discovery = await fixture(legacy);
      discovery.shape.serverPatch = { response_types_supported: undefined };
      const provider = await discovery.connect();
      expect(provider.getAuthorizationUrl()).toBeUndefined();
      expect(discovery.failures.at(-1)?.message).toBe(
        'OAuth metadata: invalid_metadata. Check the provider OAuth metadata format.',
      );
    });
    it('preserves malformed resource metadata as the cause when SDK discovery falls back', async () => {
      const discovery = await fixture(legacy);
      discovery.shape.malformedMetadata = true;
      const provider = await discovery.connect();
      expect(provider.getAuthorizationUrl()).toBeUndefined();
      expect(discovery.failures.at(-1)?.message).toBe(
        'OAuth metadata: invalid_metadata. Check the provider OAuth metadata format.',
      );
    });
    it.each([500, 503])('preserves terminal AS HTTP %s as a bounded diagnostic', async (status) => {
      const discovery = await fixture(legacy);
      discovery.shape.serverMetadataStatus = status;
      const provider = await discovery.connect();
      expect(provider.getAuthorizationUrl()).toBeUndefined();
      expect(discovery.failures.at(-1)?.message).toBe(
        `OAuth metadata: metadata_http_error (HTTP ${status}). Check provider metadata availability and access policy.`,
      );
    });
    it('preserves the SDK-specific AS 502 fallback policy', async () => {
      const discovery = await fixture(legacy);
      discovery.shape.serverMetadataStatus = 502;
      discovery.shape.oidcMetadata = true;
      const provider = await discovery.connect();
      if (legacy) {
        expect(provider.getAuthorizationUrl()).toBeUndefined();
        expect(discovery.failures.at(-1)?.message).toBe(
          'OAuth metadata: metadata_http_error (HTTP 502). Check provider metadata availability and access policy.',
        );
        return;
      }
      expect(provider.getAuthorizationUrl()).toBeDefined();
      expect(provider.clientInformation()?.client_id).toBe('registered-client');
      expect(discovery.requests.map((request) => request.url)).toContain('/.well-known/openid-configuration');
    });
    if (legacy)
      it('validates newly available AS metadata in the cached legacy callback discovery context', async () => {
        const discovery = await fixture(legacy);
        discovery.shape.serverMetadataStatus = 404;
        const provider = await discovery.connect();
        expect(provider.getAuthorizationUrl()).toBeDefined();
        discovery.shape.serverMetadataStatus = 200;
        const state = new URL(provider.getAuthorizationUrl()!).searchParams.get('state')!;
        const callback = new URLSearchParams({ state, code: 'fixture-code', iss: discovery.base });
        await expect(
          provider.withAuthorizationCallback(callback, () =>
            legacyAuth(provider, {
              serverUrl: discovery.base + '/mcp',
              authorizationCode: 'fixture-code',
              fetchFn: provider.fetch,
            }),
          ),
        ).resolves.toBe('AUTHORIZED');
      });
    it('uses the protected-resource role for an arbitrary challenge URL even at an AS discovery path', async () => {
      const discovery = await fixture(legacy);
      discovery.shape.metadataPath = '/.well-known/oauth-authorization-server';
      discovery.shape.resourcePatch = {
        issuer: 'https://misleading.example',
        authorization_endpoint: 'http://169.254.169.254/ignored',
      };
      const provider = await discovery.connect();
      expect(provider.getAuthorizationUrl()).toBeDefined();
      expect(provider.clientInformation()?.client_id).toBe('registered-client');
    });
    it.each([
      ['wrong issuer', { issuer: 'https://wrong.example' }],
      ['same-origin wrong issuer', { issuer: '/wrong-issuer' }],
      ['missing issuer', { issuer: undefined }],
      ['missing authorization endpoint', { authorization_endpoint: undefined }],
      ['private token destination', { token_endpoint: 'https://169.254.169.254/private?secret=query-sentinel' }],
      ['insecure registration endpoint', { registration_endpoint: 'http://unsafe.example/register' }],
      ['credential-bearing endpoint', { jwks_uri: 'https://user:password@unsafe.example/keys' }],
    ])('rejects AS metadata with %s despite overlapping resource fields', async (_name, patch) => {
      const discovery = await fixture(legacy);
      discovery.shape.serverPatch = {
        resource: discovery.base + '/mcp',
        authorization_servers: [discovery.base],
        ...patch,
      };
      if ('issuer' in patch && patch.issuer === '/wrong-issuer')
        discovery.shape.serverPatch.issuer = discovery.base + '/wrong-issuer';
      const provider = await discovery.connect();
      expect(provider.getAuthorizationUrl()).toBeUndefined();
      expect(discovery.requests.some((request) => request.url === '/register')).toBe(false);
      expect(discovery.failures.map(String).join(' ')).not.toContain('query-sentinel');
    });
    it.each([
      ['missing query', '/mcp'],
      ['changed query', '/mcp?read_only=false'],
      ['different path', '/other?read_only=true'],
      ['different origin', 'https://wrong.example/mcp?read_only=true'],
    ])('rejects a protected resource with %s despite misleading AS fields', async (_name, resource) => {
      const discovery = await fixture(legacy);
      discovery.shape.route = '/mcp?read_only=true';
      discovery.shape.metadataPath = '/arbitrary-metadata?read_only=true';
      discovery.shape.resource = resource.startsWith('/') ? discovery.base + resource : resource;
      discovery.shape.resourcePatch = {
        issuer: discovery.base,
        authorization_endpoint: discovery.base + '/authorize',
        token_endpoint: discovery.base + '/token',
      };
      const provider = await discovery.connect();
      expect(provider.getAuthorizationUrl()).toBeUndefined();
      expect(discovery.requests.some((request) => request.url === '/register')).toBe(false);
    });
    it.each([undefined, [], ['https://one.example', 'https://two.example'], ['https://169.254.169.254']])(
      'rejects invalid protected-resource authorization servers %j',
      async (issuers) => {
        const discovery = await fixture(legacy);
        discovery.shape.resourcePatch = { authorization_servers: issuers, issuer: discovery.base };
        const provider = await discovery.connect();
        expect(provider.getAuthorizationUrl()).toBeUndefined();
        expect(discovery.requests.some((request) => request.url === '/register')).toBe(false);
      },
    );
    it('strips resource credentials from query-bearing discovery and registration', async () => {
      const discovery = await fixture(legacy);
      discovery.shape.metadataPath = '/metadata?secret=query-sentinel';
      const provider = await discovery.connect();
      expect(provider.getAuthorizationUrl()).toBeDefined();
      expect(discovery.requests[0].headers.authorization).toBe('Bearer resource-secret');
      for (const request of discovery.requests.slice(1)) {
        expect(request.headers.authorization).toBeUndefined();
        expect(request.headers.cookie).toBeUndefined();
        expect(request.headers['x-api-key']).toBeUndefined();
      }
    });
    it.each([
      'http://unsafe.example/metadata?secret=query-sentinel',
      'https://169.254.169.254/metadata?secret=query-sentinel',
      'https://user:password@unsafe.example/metadata?secret=query-sentinel',
      'https://unsafe.example/metadata?secret=query-sentinel#fragment',
    ])('rejects an unsafe challenge destination %s', async (url) => {
      const discovery = await fixture(legacy);
      discovery.shape.metadataUrl = url;
      const provider = await discovery.connect();
      expect(provider.getAuthorizationUrl()).toBeUndefined();
      expect(discovery.requests.map((request) => request.url)).toEqual(['/mcp']);
      expect(discovery.failures.map(String).join(' ')).not.toContain('query-sentinel');
    });
    it('rejects a query-bearing discovery hostname resolving to a private address', async () => {
      const discovery = await fixture(legacy);
      discovery.shape.metadataUrl = 'https://discovery.example/metadata?secret=query-sentinel';
      vi.mocked(dns.lookup).mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
      const provider = await discovery.connect();
      expect(provider.getAuthorizationUrl()).toBeUndefined();
      expect(discovery.requests.map((request) => request.url)).toEqual(['/mcp']);
      expect(dns.lookup).toHaveBeenCalledWith('discovery.example', { all: true });
    });
    it('rejects metadata redirects with query values without forwarding credentials', async () => {
      const discovery = await fixture(legacy);
      discovery.shape.metadataPath = '/metadata?secret=query-sentinel';
      discovery.shape.metadataStatus = 302;
      discovery.shape.metadataLocation = discovery.base + '/redirected';
      const provider = await discovery.connect();
      expect(provider.getAuthorizationUrl()).toBeUndefined();
      expect(discovery.requests.map((request) => request.url)).toEqual(['/mcp', '/metadata?secret=query-sentinel']);
      expect(discovery.failures.map(String).join(' ')).not.toContain('query-sentinel');
    });
  });
