import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { ServerError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

import { AUTH_CONFIG } from '@src/constants.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SDKOAuthServerProvider } from './sdkOAuthServerProvider.js';

// Mock the McpConfigManager module
vi.mock('@src/config/mcpConfigManager.js', () => {
  const mockConfigManager = {
    getAvailableTags: vi.fn(() => ['context7', 'playwright', 'server-sequential-thinking']),
    getTransportConfig: vi.fn(() => ({})),
    startWatching: vi.fn(),
    stopWatching: vi.fn(),
  };

  return {
    McpConfigManager: {
      getInstance: vi.fn(() => mockConfigManager),
    },
  };
});

describe('SDKOAuthProvider', () => {
  let provider: SDKOAuthServerProvider;
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = path.join(tmpdir(), `test-oauth-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    provider = new SDKOAuthServerProvider(tempDir);
  });

  afterEach(() => {
    // Clean up
    provider.shutdown();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('FileBasedClientsStore', () => {
    it('should register and retrieve OAuth clients', async () => {
      const clientInfo: OAuthClientInformationFull = {
        client_id: 'test-client-123',
        client_id_issued_at: Math.floor(Date.now() / 1000),
        redirect_uris: ['http://localhost:3000/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        client_name: 'Test Client',
      };

      // Register a client
      const registered = provider.clientsStore.registerClient?.(clientInfo);
      expect(registered).toEqual(clientInfo);

      // Retrieve the client
      const retrievedResult = provider.clientsStore.getClient('test-client-123');
      const retrieved = retrievedResult instanceof Promise ? await retrievedResult : retrievedResult;

      expect(retrieved).toBeDefined();
      expect(retrieved!.client_id).toBe(clientInfo.client_id);
      expect(retrieved!.client_name).toBe(clientInfo.client_name);
      expect(retrieved!.redirect_uris).toEqual(clientInfo.redirect_uris);
      expect(retrieved!.grant_types).toEqual(clientInfo.grant_types);
      expect(retrieved!.response_types).toEqual(clientInfo.response_types);
      expect(retrieved!.token_endpoint_auth_method).toBe(clientInfo.token_endpoint_auth_method);
      // The retrieved client will have additional fields like createdAt and expires
      expect(retrieved).toHaveProperty('createdAt');
      expect(retrieved).toHaveProperty('expires');
    });

    it('should return undefined for non-existent clients', async () => {
      const retrievedResult = provider.clientsStore.getClient('non-existent-client');
      const retrieved = retrievedResult instanceof Promise ? await retrievedResult : retrievedResult;
      expect(retrieved).toBeUndefined();
    });
  });

  describe('OAuth Server Provider', () => {
    it('should verify access tokens when auth is disabled', async () => {
      // Mock auth disabled
      const configManager = provider['configManager'];
      const originalIsAuthEnabled = configManager.get('features').auth;
      configManager.get('features').auth = false;

      try {
        const authInfo = await provider.verifyAccessToken('any-token');
        expect(authInfo.clientId).toBe('anonymous');
        // When auth is disabled, all available tags are returned as scopes
        expect(authInfo.scopes).toEqual(
          expect.arrayContaining(['tag:context7', 'tag:playwright', 'tag:server-sequential-thinking']),
        );
      } finally {
        // Restore original method
        configManager.get('features').auth = originalIsAuthEnabled;
      }
    });

    it('should throw error for invalid tokens when auth is enabled', async () => {
      // Mock auth enabled
      const configManager = provider['configManager'];
      const originalIsAuthEnabled = configManager.get('features').auth;
      configManager.get('features').auth = true;

      try {
        await expect(provider.verifyAccessToken('invalid-token')).rejects.toThrow('Invalid or expired access token');
      } finally {
        // Restore original method
        configManager.get('features').auth = originalIsAuthEnabled;
      }
    });

    it('should escape client_name in consent page HTML', () => {
      const maliciousClient: OAuthClientInformationFull = {
        client_id: 'malicious-client',
        client_id_issued_at: Math.floor(Date.now() / 1000),
        redirect_uris: ['http://localhost:3000/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        client_name: '<img src=x onerror=alert(1)>',
      };

      const html = provider['generateConsentPageHtml'](
        maliciousClient,
        'auth-request-123',
        ['context7'],
        ['context7', 'playwright'],
      );

      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
      expect(html).not.toContain('<title>Authorize <img src=x onerror=alert(1)></title>');
      expect(html).not.toContain('<strong><img src=x onerror=alert(1)></strong>');
    });

    it('should escape auth request id and tag values in consent page HTML', () => {
      const client: OAuthClientInformationFull = {
        client_id: 'test-client',
        client_id_issued_at: Math.floor(Date.now() / 1000),
        redirect_uris: ['http://localhost:3000/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        client_name: 'Test Client',
      };
      const maliciousAuthRequestId = 'auth-request-123" autofocus onfocus="alert(1)';
      const maliciousTag = 'context7"><script>alert(1)</script>';

      const html = provider['generateConsentPageHtml'](client, maliciousAuthRequestId, [maliciousTag], [maliciousTag]);

      expect(html).toContain('auth-request-123&quot; autofocus onfocus=&quot;alert(1)');
      expect(html).toContain('context7&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(html).not.toContain(`value="${maliciousAuthRequestId}"`);
      expect(html).not.toContain(`id="scope_${maliciousTag}"`);
      expect(html).not.toContain(`value="tag:${maliciousTag}"`);
      expect(html).not.toContain(`<strong>${maliciousTag}</strong>`);
    });

    it('should set restrictive CSP headers when rendering the consent page', async () => {
      const client: OAuthClientInformationFull = {
        client_id: 'test-client',
        client_id_issued_at: Math.floor(Date.now() / 1000),
        redirect_uris: ['http://localhost:3000/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        client_name: 'Test Client',
      };
      const params: AuthorizationParams = {
        redirectUri: 'http://localhost:3000/callback',
        codeChallenge: 'challenge-123',
        state: 'state-123',
        scopes: ['tag:context7'],
      };
      const response = {
        set: vi.fn(),
        send: vi.fn(),
        removeHeader: vi.fn(),
      } as any;

      await provider['renderConsentPage'](client, params, ['tag:context7'], ['context7'], response);

      expect(response.set).toHaveBeenCalledWith(
        'Content-Security-Policy',
        "default-src 'none'; form-action 'self' http://localhost:3000; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none';",
      );
      expect(response.set).toHaveBeenCalledWith('Content-Type', 'text/html');
      expect(response.send).toHaveBeenCalledTimes(1);
      expect(response.removeHeader).not.toHaveBeenCalledWith('Content-Security-Policy');
    });

    it('discloses renewable access only for clients registered for refresh tokens', () => {
      const refreshClient: OAuthClientInformationFull = {
        client_id: 'refresh-client',
        redirect_uris: ['http://127.0.0.1:3000/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      };
      const accessOnlyClient: OAuthClientInformationFull = {
        ...refreshClient,
        client_id: 'access-only-client',
        grant_types: ['authorization_code'],
      };

      expect(provider['generateConsentPageHtml'](refreshClient, 'request-id', [], [])).toContain(
        'renew this access for up to 30 days',
      );
      expect(provider['generateConsentPageHtml'](accessOnlyClient, 'request-id', [], [])).not.toContain(
        'renew this access',
      );
    });

    it('does not add non-loopback redirect origins to form-action', async () => {
      const client: OAuthClientInformationFull = {
        client_id: 'web-client',
        redirect_uris: ['https://client.example/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      };
      const response = { set: vi.fn(), send: vi.fn() } as any;

      await provider['renderConsentPage'](
        client,
        {
          redirectUri: 'https://client.example/callback',
          codeChallenge: 'challenge',
          scopes: [],
        },
        [],
        [],
        response,
      );

      expect(response.set).toHaveBeenCalledWith(
        'Content-Security-Policy',
        "default-src 'none'; form-action 'self'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none';",
      );
    });

    it.skipIf(process.platform === 'win32')(
      'maps a denied permission heal to an OAuth server_error instead of a bare 500',
      async () => {
        const client: OAuthClientInformationFull = {
          client_id: 'perm-client',
          redirect_uris: ['http://127.0.0.1:3000/callback'],
          grant_types: ['authorization_code'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        };

        const code = provider.oauthStorage.authCodeRepository.create(
          client.client_id,
          'http://127.0.0.1:3000/callback',
          '',
          ['tag:context7'],
          60000,
          'challenge-123',
        );

        // Simulate a legacy permissive credential file, then deny the heal.
        const filePath = provider.oauthStorage.fileStorage.getFilePath(AUTH_CONFIG.SERVER.AUTH_CODE.FILE_PREFIX, code);
        fs.chmodSync(filePath, 0o644);
        const fchmodSpy = vi.spyOn(fs, 'fchmodSync').mockImplementation(() => {
          throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
        });

        try {
          await expect(provider.challengeForAuthorizationCode(client, code)).rejects.toThrow(ServerError);
        } finally {
          fchmodSpy.mockRestore();
        }
      },
    );
  });
});
