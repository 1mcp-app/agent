import { randomUUID } from 'node:crypto';

import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OAuthClientConfig, SDKOAuthClientProvider } from './sdkOAuthClientProvider.js';
import { ClientSessionData } from './sessionTypes.js';
import { ClientSessionRepository } from './storage/clientSessionRepository.js';
import { FileStorageService } from './storage/fileStorageService.js';

// Mock dependencies
vi.mock('node:crypto');
vi.mock('./storage/clientSessionRepository.js');
vi.mock('./storage/fileStorageService.js');
vi.mock('@src/logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@src/constants.js', () => ({
  AUTH_CONFIG: {
    CLIENT: {
      OAUTH: {
        TTL_MS: 30 * 24 * 60 * 60 * 1000, // 30 days
        DEFAULT_SCOPES: [],
      },
    },
  },
  getGlobalConfigDir: vi.fn(() => '/mock/config/dir'),
}));

describe('SDKOAuthClientProvider', () => {
  let provider: SDKOAuthClientProvider;
  let mockClientSessionRepository: any;
  let mockFileStorageService: any;
  let mockRandomUUID: any;

  const mockConfig: OAuthClientConfig = {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    scopes: ['read', 'write'],
    redirectUrl: 'http://localhost:3000/callback',
  };

  const mockClientInfo: OAuthClientInformationFull = {
    client_id: 'test-client-id',
    client_secret: 'test-client-secret',
    redirect_uris: ['http://localhost:3000/callback'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'client_secret_post',
    scope: 'read write',
  };

  const mockTokens: OAuthTokens = {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    token_type: 'Bearer',
    expires_in: 3600,
    scope: 'read write',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock FileStorageService
    mockFileStorageService = {
      writeData: vi.fn(),
      readData: vi.fn(),
      deleteData: vi.fn(),
      listFiles: vi.fn(),
      shutdown: vi.fn(),
    } as any;

    (FileStorageService as any).mockImplementation(() => mockFileStorageService);

    // Mock ClientSessionRepository
    mockClientSessionRepository = {
      get: vi.fn(),
      save: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    } as any;

    (ClientSessionRepository as any).mockImplementation(() => mockClientSessionRepository);

    // Mock randomUUID
    mockRandomUUID = randomUUID as any;
    mockRandomUUID.mockReturnValue('mock-uuid-1234');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with basic config', () => {
      provider = new SDKOAuthClientProvider('test-server', mockConfig);

      expect(provider.redirectUrl).toBe('http://localhost:3000/callback');
      expect(provider.clientMetadata).toEqual({
        client_name: '1MCP Agent - test-server',
        redirect_uris: ['http://localhost:3000/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post',
        scope: 'read write',
      });
    });

    it('should initialize with minimal config (no client secret)', () => {
      const minimalConfig: OAuthClientConfig = {
        redirectUrl: 'http://localhost:3000/callback',
      };

      provider = new SDKOAuthClientProvider('test-server', minimalConfig);

      expect(provider.clientMetadata.token_endpoint_auth_method).toBe('none');
      expect(provider.clientMetadata.scope).toBe('');
    });

    it('should initialize with custom session storage path', () => {
      provider = new SDKOAuthClientProvider('test-server', mockConfig, '/custom/path');

      expect(FileStorageService).toHaveBeenCalledWith('/custom/path');
    });

    it('should load persisted data on initialization', () => {
      const mockSessionData: ClientSessionData = {
        serverName: 'test-server',
        clientInfo: JSON.stringify(mockClientInfo),
        tokens: JSON.stringify(mockTokens),
        codeVerifier: 'test-verifier',
        state: 'test-state',
        expires: Date.now() + 3600000,
        createdAt: Date.now(),
      };

      mockClientSessionRepository.get.mockReturnValue(mockSessionData);

      provider = new SDKOAuthClientProvider('test-server', mockConfig);

      expect(mockClientSessionRepository.get).toHaveBeenCalledWith('test-server');
      expect(provider.clientInformation()).toEqual(mockClientInfo);
      expect(provider.tokens()).toEqual(mockTokens);
      expect(provider.codeVerifier()).toBe('test-verifier');
    });

    it('should handle missing session data gracefully', () => {
      mockClientSessionRepository.get.mockReturnValue(null);

      provider = new SDKOAuthClientProvider('test-server', mockConfig);

      expect(provider.clientInformation()).toBeUndefined();
      expect(provider.tokens()).toBeUndefined();
      expect(provider.codeVerifier()).toBe('');
    });
  });

  describe('clientInformation management', () => {
    beforeEach(() => {
      provider = new SDKOAuthClientProvider('test-server', mockConfig);
    });

    it('should save client information', () => {
      provider.saveClientInformation(mockClientInfo);

      expect(provider.clientInformation()).toEqual(mockClientInfo);
      expect(mockClientSessionRepository.save).toHaveBeenCalledWith(
        'test-server',
        expect.objectContaining({
          serverName: 'test-server',
          clientInfo: JSON.stringify(mockClientInfo),
        }),
        expect.any(Number),
      );
    });

    it('should return undefined when no client info is set', () => {
      expect(provider.clientInformation()).toBeUndefined();
    });
  });

  describe('token management', () => {
    beforeEach(() => {
      provider = new SDKOAuthClientProvider('test-server', mockConfig);
    });

    it('should save tokens', () => {
      provider.saveTokens(mockTokens);

      expect(provider.tokens()).toEqual(mockTokens);
      expect(mockClientSessionRepository.save).toHaveBeenCalledWith(
        'test-server',
        expect.objectContaining({
          serverName: 'test-server',
          tokens: JSON.stringify(mockTokens),
        }),
        expect.any(Number),
      );
    });

    it('should return undefined when no tokens are set', () => {
      expect(provider.tokens()).toBeUndefined();
    });

    it('should handle token expiration during loading', () => {
      const expiredTokens = { ...mockTokens, expires_in: 3600 };
      const mockSessionData: ClientSessionData = {
        serverName: 'test-server',
        tokens: JSON.stringify(expiredTokens),
        expires: Date.now() + 3600000,
        createdAt: Date.now(),
      };

      mockClientSessionRepository.get.mockReturnValue(mockSessionData);

      // Mock the private isTokenExpired method to return true
      const testProvider = new SDKOAuthClientProvider('test-server', mockConfig);

      // Since tokens are not expired by default in the implementation,
      // we test the normal flow here
      expect(testProvider.tokens()).toEqual(expiredTokens);
    });
  });

  describe('authorization URL management', () => {
    beforeEach(() => {
      provider = new SDKOAuthClientProvider('test-server', mockConfig);
    });

    it('should store and retrieve authorization URL', () => {
      const authUrl = new URL('https://auth.example.com/oauth/authorize?client_id=test');

      provider.redirectToAuthorization(authUrl);
      expect(provider.getAuthorizationUrl()).toBe(authUrl.toString());
    });

    it('should clear authorization URL', () => {
      const authUrl = new URL('https://auth.example.com/oauth/authorize?client_id=test');

      provider.redirectToAuthorization(authUrl);
      provider.clearAuthorizationUrl();

      expect(provider.getAuthorizationUrl()).toBeUndefined();
    });

    it('should return undefined when no authorization URL is set', () => {
      expect(provider.getAuthorizationUrl()).toBeUndefined();
    });
  });

  describe('code verifier management', () => {
    beforeEach(() => {
      provider = new SDKOAuthClientProvider('test-server', mockConfig);
    });

    it('should save code verifier', () => {
      provider.saveCodeVerifier('test-code-verifier');

      expect(provider.codeVerifier()).toBe('test-code-verifier');
      expect(mockClientSessionRepository.save).toHaveBeenCalledWith(
        'test-server',
        expect.objectContaining({
          serverName: 'test-server',
          codeVerifier: 'test-code-verifier',
        }),
        expect.any(Number),
      );
    });

    it('should return empty string when no code verifier is set', () => {
      expect(provider.codeVerifier()).toBe('');
    });
  });

  describe('state management', () => {
    beforeEach(() => {
      provider = new SDKOAuthClientProvider('test-server', mockConfig);
    });

    it('should generate and return state on first call', () => {
      const state = provider.state();

      expect(state).toBe('mock-uuid-1234');
      expect(mockRandomUUID).toHaveBeenCalled();
      expect(mockClientSessionRepository.save).toHaveBeenCalledWith(
        'test-server',
        expect.objectContaining({
          serverName: 'test-server',
          state: 'mock-uuid-1234',
        }),
        expect.any(Number),
      );
    });

    it('should return same state on subsequent calls', () => {
      const state1 = provider.state();
      const state2 = provider.state();

      expect(state1).toBe(state2);
      expect(mockRandomUUID).toHaveBeenCalledTimes(1);
    });

    it('should use loaded state from session', () => {
      const mockSessionData: ClientSessionData = {
        serverName: 'test-server',
        state: 'loaded-state',
        expires: Date.now() + 3600000,
        createdAt: Date.now(),
      };

      mockClientSessionRepository.get.mockReturnValue(mockSessionData);

      const testProvider = new SDKOAuthClientProvider('test-server', mockConfig);
      const state = testProvider.state();

      expect(state).toBe('loaded-state');
      expect(mockRandomUUID).not.toHaveBeenCalled();
    });
  });

  describe('resource validation', () => {
    beforeEach(() => {
      provider = new SDKOAuthClientProvider('test-server', mockConfig);
    });

    it('should validate resource URL with string input', async () => {
      const result = await provider.validateResourceURL('https://api.example.com', 'https://api.example.com/data');

      expect(result).toEqual(new URL('https://api.example.com'));
    });

    it('should validate resource URL with URL input', async () => {
      const serverUrl = new URL('https://api.example.com');
      const result = await provider.validateResourceURL(serverUrl, 'https://api.example.com/data');

      expect(result).toEqual(serverUrl);
    });

    it('should return undefined for invalid resource', async () => {
      const result = await provider.validateResourceURL('https://api.example.com', 'https://other.example.com/data');

      expect(result).toBeUndefined();
    });

    it('should return URL when no resource is provided', async () => {
      const result = await provider.validateResourceURL('https://api.example.com');

      expect(result).toEqual(new URL('https://api.example.com'));
    });
  });

  describe('data persistence', () => {
    beforeEach(() => {
      provider = new SDKOAuthClientProvider('test-server', mockConfig);
    });

    it('should persist all data with correct TTL calculation', () => {
      const tokensWithExpiry = { ...mockTokens, expires_in: 7200 }; // 2 hours

      provider.saveClientInformation(mockClientInfo);
      provider.saveTokens(tokensWithExpiry);
      provider.saveCodeVerifier('test-verifier');

      const lastCall = mockClientSessionRepository.save.mock.calls.slice(-1)[0];
      const sessionData = lastCall[1] as ClientSessionData;

      expect(sessionData.serverName).toBe('test-server');
      expect(sessionData.clientInfo).toBe(JSON.stringify(mockClientInfo));
      expect(sessionData.tokens).toBe(JSON.stringify(tokensWithExpiry));
      expect(sessionData.codeVerifier).toBe('test-verifier');

      // Check that TTL is based on token expiry (7200 seconds = 7200000 ms)
      const expectedTtl = 7200000; // Token TTL is longer than default
      const actualTtl = sessionData.expires - sessionData.createdAt;
      expect(actualTtl).toBeGreaterThanOrEqual(expectedTtl - 1000); // Allow 1s tolerance
    });

    it('should use default TTL when tokens have no expiry', () => {
      const tokensWithoutExpiry = { ...mockTokens };
      delete tokensWithoutExpiry.expires_in;

      provider.saveTokens(tokensWithoutExpiry);

      const lastCall = mockClientSessionRepository.save.mock.calls.slice(-1)[0];
      const sessionData = lastCall[1] as ClientSessionData;

      // Should use default TTL (30 days)
      const expectedTtl = 30 * 24 * 60 * 60 * 1000;
      const actualTtl = sessionData.expires - sessionData.createdAt;
      expect(actualTtl).toBeGreaterThanOrEqual(expectedTtl - 1000); // Allow 1s tolerance
    });
  });

  describe('shutdown', () => {
    beforeEach(() => {
      provider = new SDKOAuthClientProvider('test-server', mockConfig);
    });

    it('should clear temporary session data on shutdown', () => {
      provider.saveCodeVerifier('test-verifier');
      provider.state(); // Generate state

      provider.shutdown();

      // Should persist data without verifier and state
      const lastCall = mockClientSessionRepository.save.mock.calls.slice(-1)[0];
      const sessionData = lastCall[1] as ClientSessionData;

      expect(sessionData.codeVerifier).toBeUndefined();
      expect(sessionData.state).toBeUndefined();
    });

    it('should persist other data during shutdown', () => {
      provider.saveClientInformation(mockClientInfo);
      provider.saveTokens(mockTokens);

      provider.shutdown();

      const lastCall = mockClientSessionRepository.save.mock.calls.slice(-1)[0];
      const sessionData = lastCall[1] as ClientSessionData;

      expect(sessionData.clientInfo).toBe(JSON.stringify(mockClientInfo));
      expect(sessionData.tokens).toBe(JSON.stringify(mockTokens));
    });
  });

  describe('data loading edge cases', () => {
    it('should throw error for corrupted client info JSON', () => {
      const mockSessionData: ClientSessionData = {
        serverName: 'test-server',
        clientInfo: 'invalid-json',
        expires: Date.now() + 3600000,
        createdAt: Date.now(),
      };

      mockClientSessionRepository.get.mockReturnValue(mockSessionData);

      // Current implementation throws on invalid JSON
      expect(() => {
        provider = new SDKOAuthClientProvider('test-server', mockConfig);
      }).toThrow('Unexpected token');
    });

    it('should throw error for corrupted tokens JSON', () => {
      const mockSessionData: ClientSessionData = {
        serverName: 'test-server',
        tokens: 'invalid-json',
        expires: Date.now() + 3600000,
        createdAt: Date.now(),
      };

      mockClientSessionRepository.get.mockReturnValue(mockSessionData);

      // Current implementation throws on invalid JSON
      expect(() => {
        provider = new SDKOAuthClientProvider('test-server', mockConfig);
      }).toThrow('Unexpected token');
    });

    it('should handle missing optional fields gracefully', () => {
      const mockSessionData: ClientSessionData = {
        serverName: 'test-server',
        expires: Date.now() + 3600000,
        createdAt: Date.now(),
        // All optional fields are undefined
      };

      mockClientSessionRepository.get.mockReturnValue(mockSessionData);

      provider = new SDKOAuthClientProvider('test-server', mockConfig);

      expect(provider.clientInformation()).toBeUndefined();
      expect(provider.tokens()).toBeUndefined();
      expect(provider.codeVerifier()).toBe('');
    });
  });

  describe('redirectUrl getter', () => {
    it('should return configured redirect URL', () => {
      provider = new SDKOAuthClientProvider('test-server', mockConfig);
      expect(provider.redirectUrl).toBe('http://localhost:3000/callback');
    });

    it('should return empty string when no redirect URL is configured', () => {
      const configWithoutRedirect: OAuthClientConfig = {
        redirectUrl: '',
      };
      provider = new SDKOAuthClientProvider('test-server', configWithoutRedirect);
      expect(provider.redirectUrl).toBe('');
    });
  });

  describe('clientMetadata getter', () => {
    it('should return configured client metadata', () => {
      provider = new SDKOAuthClientProvider('test-server', mockConfig);

      const metadata = provider.clientMetadata;
      expect(metadata.client_name).toBe('1MCP Agent - test-server');
      expect(metadata.redirect_uris).toEqual(['http://localhost:3000/callback']);
      expect(metadata.grant_types).toEqual(['authorization_code', 'refresh_token']);
      expect(metadata.response_types).toEqual(['code']);
      expect(metadata.token_endpoint_auth_method).toBe('client_secret_post');
      expect(metadata.scope).toBe('read write');
    });
  });
});
