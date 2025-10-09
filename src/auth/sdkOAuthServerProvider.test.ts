import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

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
      const originalIsAuthEnabled = configManager.isAuthEnabled;
      configManager.isAuthEnabled = () => false;

      try {
        const authInfo = await provider.verifyAccessToken('any-token');
        expect(authInfo.clientId).toBe('anonymous');
        // When auth is disabled, all available tags are returned as scopes
        expect(authInfo.scopes).toEqual(
          expect.arrayContaining(['tag:context7', 'tag:playwright', 'tag:server-sequential-thinking']),
        );
      } finally {
        // Restore original method
        configManager.isAuthEnabled = originalIsAuthEnabled;
      }
    });

    it('should throw error for invalid tokens when auth is enabled', async () => {
      // Mock auth enabled
      const configManager = provider['configManager'];
      const originalIsAuthEnabled = configManager.isAuthEnabled;
      configManager.isAuthEnabled = () => true;

      try {
        await expect(provider.verifyAccessToken('invalid-token')).rejects.toThrow('Invalid or expired access token');
      } finally {
        // Restore original method
        configManager.isAuthEnabled = originalIsAuthEnabled;
      }
    });
  });
});
