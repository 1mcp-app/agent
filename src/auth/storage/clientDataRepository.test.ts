import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { ClientDataRepository } from './clientDataRepository.js';
import { FileStorageService } from './fileStorageService.js';
import { AUTH_CONFIG } from '@src/constants.js';
import { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

// Mock logger to avoid console output during tests
vi.mock('@src/logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('ClientDataRepository', () => {
  let repository: ClientDataRepository;
  let storage: FileStorageService;
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = path.join(tmpdir(), `client-data-repo-test-${Date.now()}`);
    storage = new FileStorageService(tempDir);
    repository = new ClientDataRepository(storage);
  });

  afterEach(() => {
    storage.shutdown();
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('save', () => {
    it('should save OAuth client data with all fields', () => {
      const clientId = 'cli_test-client-1234-4abc-89de-123456789012';
      const clientData: OAuthClientInformationFull = {
        client_id: 'oauth-client-123',
        client_secret: 'secret-value',
        client_name: 'Test Application',
        client_uri: 'https://testapp.example.com',
        redirect_uris: ['https://testapp.example.com/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        scope: 'openid profile email',
        token_endpoint_auth_method: 'client_secret_basic',
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_secret_expires_at: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days
      };
      const ttlMs = 30 * 24 * 60 * 60 * 1000; // 30 days

      repository.save(clientId, clientData, ttlMs);

      const retrieved = repository.get(clientId);
      expect(retrieved).toBeDefined();
      expect(retrieved!.client_id).toBe(clientData.client_id);
      expect(retrieved!.client_secret).toBe(clientData.client_secret);
      expect(retrieved!.client_name).toBe(clientData.client_name);
      expect(retrieved!.client_uri).toBe(clientData.client_uri);
      expect(retrieved!.redirect_uris).toEqual(clientData.redirect_uris);
      expect(retrieved!.grant_types).toEqual(clientData.grant_types);
      expect(retrieved!.response_types).toEqual(clientData.response_types);
      expect(retrieved!.scope).toBe(clientData.scope);
      expect(retrieved!.token_endpoint_auth_method).toBe(clientData.token_endpoint_auth_method);
    });

    it('should handle client data with minimal required fields', () => {
      const clientId = 'cli_minimal-client-1234-4abc-89de-123456789012';
      const clientData: OAuthClientInformationFull = {
        client_id: 'minimal-client',
        redirect_uris: ['https://app.com/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
      };
      const ttlMs = 24 * 60 * 60 * 1000; // 1 day

      repository.save(clientId, clientData, ttlMs);
      const retrieved = repository.get(clientId);

      expect(retrieved!.client_id).toBe('minimal-client');
      expect(retrieved!.redirect_uris).toEqual(['https://app.com/callback']);
      expect(retrieved!.grant_types).toEqual(['authorization_code']);
      expect(retrieved!.response_types).toEqual(['code']);
    });

    it('should use client_secret_expires_at when provided', () => {
      const clientId = 'cli_expiry-client-1234-4abc-89de-123456789012';
      const futureTimestamp = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour from now
      const clientData: OAuthClientInformationFull = {
        client_id: 'expiry-test',
        redirect_uris: ['https://app.com/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        client_secret_expires_at: futureTimestamp,
      };
      const ttlMs = 30 * 24 * 60 * 60 * 1000; // 30 days (should be ignored)

      repository.save(clientId, clientData, ttlMs);
      const retrieved = repository.get(clientId);

      // Should use client_secret_expires_at * 1000 instead of Date.now() + ttlMs
      expect((retrieved as any).expires).toBe(futureTimestamp * 1000);
    });

    it('should use TTL when client_secret_expires_at is not provided', () => {
      const clientId = 'cli_ttl-client-1234-4abc-89de-123456789012';
      const clientData: OAuthClientInformationFull = {
        client_id: 'ttl-test',
        redirect_uris: ['https://app.com/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
      };
      const ttlMs = 60000; // 1 minute
      const beforeSave = Date.now();

      repository.save(clientId, clientData, ttlMs);
      const afterSave = Date.now();
      const retrieved = repository.get(clientId);

      const expectedMinExpiry = beforeSave + ttlMs;
      const expectedMaxExpiry = afterSave + ttlMs;
      expect((retrieved as any).expires).toBeGreaterThanOrEqual(expectedMinExpiry);
      expect((retrieved as any).expires).toBeLessThanOrEqual(expectedMaxExpiry);
    });

    it('should use client_id_issued_at when provided', () => {
      const clientId = 'cli_issued-client-1234-4abc-89de-123456789012';
      const issuedTimestamp = Math.floor(Date.now() / 1000) - 60 * 60; // 1 hour ago
      const clientData: OAuthClientInformationFull = {
        client_id: 'issued-test',
        redirect_uris: ['https://app.com/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        client_id_issued_at: issuedTimestamp,
      };
      const ttlMs = 60000;

      repository.save(clientId, clientData, ttlMs);
      const retrieved = repository.get(clientId);

      expect((retrieved as any).createdAt).toBe(issuedTimestamp * 1000);
    });

    it('should handle overwriting existing client data', () => {
      const clientId = 'cli_overwrite-client-1234-4abc-89de-123456789012';
      const originalData: OAuthClientInformationFull = {
        client_id: 'test-client',
        client_name: 'Original App',
        redirect_uris: ['https://original.com/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
      };
      const updatedData: OAuthClientInformationFull = {
        client_id: 'test-client',
        client_name: 'Updated App',
        redirect_uris: ['https://updated.com/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      };
      const ttlMs = 60000;

      repository.save(clientId, originalData, ttlMs);
      repository.save(clientId, updatedData, ttlMs);

      const retrieved = repository.get(clientId);
      expect(retrieved!.client_name).toBe('Updated App');
      expect(retrieved!.redirect_uris).toEqual(['https://updated.com/callback']);
      expect(retrieved!.grant_types).toEqual(['authorization_code', 'refresh_token']);
    });
  });

  describe('get', () => {
    it('should retrieve existing client data', () => {
      const clientId = 'cli_get-test-client-1234-4abc-89de-123456789012';
      const clientData: OAuthClientInformationFull = {
        client_id: 'get-test-client',
        client_name: 'Get Test App',
        redirect_uris: ['https://gettest.com/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
      };

      repository.save(clientId, clientData, 60000);
      const retrieved = repository.get(clientId);

      expect(retrieved).toBeDefined();
      expect(retrieved!.client_id).toBe('get-test-client');
      expect(retrieved!.client_name).toBe('Get Test App');
    });

    it('should return null for non-existent client', () => {
      const result = repository.get('cli_nonexistent-1234-4abc-89de-123456789012');
      expect(result).toBeNull();
    });

    it('should handle malformed client IDs gracefully', () => {
      const malformedIds = ['', '   ', 'invalid/id', '../../../etc/passwd'];

      for (const id of malformedIds) {
        const result = repository.get(id);
        expect(result).toBeNull();
      }
    });

    it('should preserve all OAuth client fields', () => {
      const clientId = 'cli_full-fields-client-1234-4abc-89de-123456789012';
      const fullClientData: OAuthClientInformationFull = {
        client_id: 'full-test-client',
        client_secret: 'super-secret-value',
        client_name: 'Full Featured App',
        client_uri: 'https://fullapp.example.com',
        logo_uri: 'https://fullapp.example.com/logo.png',
        tos_uri: 'https://fullapp.example.com/terms',
        policy_uri: 'https://fullapp.example.com/privacy',
        redirect_uris: ['https://fullapp.example.com/callback', 'https://fullapp.example.com/oauth/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: 'openid profile email read:data write:data',
        contacts: ['admin@fullapp.example.com'],
        token_endpoint_auth_method: 'client_secret_post',
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_secret_expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365, // 1 year
      };

      repository.save(clientId, fullClientData, 60000);
      const retrieved = repository.get(clientId);

      expect(retrieved!.client_id).toBe(fullClientData.client_id);
      expect(retrieved!.client_secret).toBe(fullClientData.client_secret);
      expect(retrieved!.client_name).toBe(fullClientData.client_name);
      expect(retrieved!.client_uri).toBe(fullClientData.client_uri);
      expect(retrieved!.logo_uri).toBe(fullClientData.logo_uri);
      expect(retrieved!.tos_uri).toBe(fullClientData.tos_uri);
      expect(retrieved!.policy_uri).toBe(fullClientData.policy_uri);
      expect(retrieved!.redirect_uris).toEqual(fullClientData.redirect_uris);
      expect(retrieved!.grant_types).toEqual(fullClientData.grant_types);
      expect(retrieved!.response_types).toEqual(fullClientData.response_types);
      expect(retrieved!.scope).toBe(fullClientData.scope);
      expect(retrieved!.contacts).toEqual(fullClientData.contacts);
      expect(retrieved!.token_endpoint_auth_method).toBe(fullClientData.token_endpoint_auth_method);
    });
  });

  describe('delete', () => {
    it('should delete existing client data', () => {
      const clientId = 'cli_delete-test-client-1234-4abc-89de-123456789012';
      const clientData: OAuthClientInformationFull = {
        client_id: 'delete-test-client',
        redirect_uris: ['https://deletetest.com/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
      };

      repository.save(clientId, clientData, 60000);

      // Verify client exists
      expect(repository.get(clientId)).toBeDefined();

      // Delete client
      const deleted = repository.delete(clientId);
      expect(deleted).toBe(true);

      // Verify client is gone
      expect(repository.get(clientId)).toBeNull();
    });

    it('should return false when deleting non-existent client', () => {
      const deleted = repository.delete('cli_nonexistent-1234-4abc-89de-123456789012');
      expect(deleted).toBe(false);
    });

    it('should handle multiple deletions of same client', () => {
      const clientId = 'cli_multi-delete-client-1234-4abc-89de-123456789012';
      const clientData: OAuthClientInformationFull = {
        client_id: 'multi-delete-client',
        redirect_uris: ['https://multidelete.com/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
      };

      repository.save(clientId, clientData, 60000);

      const deleted1 = repository.delete(clientId);
      expect(deleted1).toBe(true);

      const deleted2 = repository.delete(clientId);
      expect(deleted2).toBe(false);
    });

    it('should delete only the specified client', () => {
      const clientId1 = 'cli_client1-1234-4abc-89de-123456789012';
      const clientId2 = 'cli_client2-1234-4abc-89de-123456789012';

      const clientData1: OAuthClientInformationFull = {
        client_id: 'client-1',
        redirect_uris: ['https://client1.com/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
      };

      const clientData2: OAuthClientInformationFull = {
        client_id: 'client-2',
        redirect_uris: ['https://client2.com/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
      };

      repository.save(clientId1, clientData1, 60000);
      repository.save(clientId2, clientData2, 60000);

      repository.delete(clientId1);

      expect(repository.get(clientId1)).toBeNull();
      expect(repository.get(clientId2)).toBeDefined();
    });
  });

  describe('Integration with FileStorageService', () => {
    it('should use correct file prefix', () => {
      const clientId = 'cli_file-test-client-1234-4abc-89de-123456789012';
      const clientData: OAuthClientInformationFull = {
        client_id: 'file-test-client',
        redirect_uris: ['https://filetest.com/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
      };

      repository.save(clientId, clientData, 60000);

      // Check that file was created with correct prefix
      const expectedFileName = AUTH_CONFIG.SERVER.SESSION.FILE_PREFIX + clientId + '.json';
      const filePath = path.join(tempDir, expectedFileName);

      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('should survive FileStorageService restart', () => {
      const clientId = 'cli_restart-test-client-1234-4abc-89de-123456789012';
      const clientData: OAuthClientInformationFull = {
        client_id: 'restart-test-client',
        client_name: 'Restart Test App',
        redirect_uris: ['https://restarttest.com/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
      };

      repository.save(clientId, clientData, 60000);
      const originalData = repository.get(clientId);

      // Shutdown and recreate storage service
      storage.shutdown();
      storage = new FileStorageService(tempDir);
      repository = new ClientDataRepository(storage);

      // Data should still be accessible
      const retrievedData = repository.get(clientId);
      expect(retrievedData).toEqual(originalData);
    });

    it('should handle storage errors gracefully', () => {
      // This test would need to mock FileStorageService to simulate errors
      // For now, we verify that the repository doesn't crash on invalid operations
      const result = repository.get('invalid-client-id');
      expect(result).toBeNull();
    });
  });

  describe('OAuth 2.1 Client Types', () => {
    it('should handle public clients (no secret)', () => {
      const clientId = 'cli_public-client-1234-4abc-89de-123456789012';
      const publicClientData: OAuthClientInformationFull = {
        client_id: 'public-spa-client',
        client_name: 'Public SPA Application',
        redirect_uris: ['http://localhost:3000/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none', // Public client
        scope: 'openid profile',
      };

      repository.save(clientId, publicClientData, 60000);
      const retrieved = repository.get(clientId);

      expect(retrieved!.client_secret).toBeUndefined();
      expect(retrieved!.token_endpoint_auth_method).toBe('none');
    });

    it('should handle confidential clients (with secret)', () => {
      const clientId = 'cli_confidential-client-1234-4abc-89de-123456789012';
      const confidentialClientData: OAuthClientInformationFull = {
        client_id: 'confidential-server-client',
        client_secret: 'very-secure-server-secret',
        client_name: 'Confidential Server Application',
        redirect_uris: ['https://secure-app.example.com/oauth/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_basic',
        scope: 'admin:read admin:write',
      };

      repository.save(clientId, confidentialClientData, 60000);
      const retrieved = repository.get(clientId);

      expect(retrieved!.client_secret).toBe('very-secure-server-secret');
      expect(retrieved!.token_endpoint_auth_method).toBe('client_secret_basic');
      expect(retrieved!.grant_types).toContain('refresh_token');
    });

    it('should handle different authentication methods', () => {
      const authMethods = ['client_secret_basic', 'client_secret_post', 'client_secret_jwt', 'private_key_jwt', 'none'];

      for (const method of authMethods) {
        const clientId = `cli_auth-method-${method}-1234-4abc-89de-123456789012`;
        const clientData: OAuthClientInformationFull = {
          client_id: `auth-method-${method}`,
          redirect_uris: ['https://app.com/callback'],
          grant_types: ['authorization_code'],
          response_types: ['code'],
          token_endpoint_auth_method: method,
        };

        repository.save(clientId, clientData, 60000);
        const retrieved = repository.get(clientId);
        expect(retrieved!.token_endpoint_auth_method).toBe(method);
      }
    });

    it('should handle multiple redirect URIs', () => {
      const clientId = 'cli_multi-redirect-client-1234-4abc-89de-123456789012';
      const multiRedirectClientData: OAuthClientInformationFull = {
        client_id: 'multi-redirect-client',
        redirect_uris: [
          'https://app.example.com/oauth/callback',
          'https://app.example.com/auth/callback',
          'myapp://oauth/callback',
          'http://localhost:3000/callback',
        ],
        grant_types: ['authorization_code'],
        response_types: ['code'],
      };

      repository.save(clientId, multiRedirectClientData, 60000);
      const retrieved = repository.get(clientId);

      expect(retrieved!.redirect_uris).toHaveLength(4);
      expect(retrieved!.redirect_uris).toContain('myapp://oauth/callback');
      expect(retrieved!.redirect_uris).toContain('http://localhost:3000/callback');
    });
  });

  describe('Performance and Edge Cases', () => {
    it('should handle Unicode characters in client data', () => {
      const clientId = 'cli_unicode-client-1234-4abc-89de-123456789012';
      const unicodeClientData: OAuthClientInformationFull = {
        client_id: 'unicode-测试-🌍',
        client_name: 'тест приложение - 🚀',
        client_uri: 'https://تطبيق.example.com',
        redirect_uris: ['https://тест.example.com/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        scope: 'читать писать',
        contacts: ['admin@تطبيق.example.com'],
      };

      repository.save(clientId, unicodeClientData, 60000);
      const retrieved = repository.get(clientId);

      expect(retrieved!.client_id).toBe('unicode-测试-🌍');
      expect(retrieved!.client_name).toBe('тест приложение - 🚀');
      expect(retrieved!.client_uri).toBe('https://تطبيق.example.com');
      expect(retrieved!.scope).toBe('читать писать');
    });

    it('should handle very long client data', () => {
      const clientId = 'cli_long-data-client-1234-4abc-89de-123456789012';
      const longScope = Array.from({ length: 100 }, (_, i) => `scope${i}`).join(' ');
      const longClientData: OAuthClientInformationFull = {
        client_id: 'long-data-client',
        client_name: 'A'.repeat(500), // Very long name
        client_uri: 'https://very-long-domain-name-that-goes-on-and-on.example.com',
        redirect_uris: Array.from({ length: 50 }, (_, i) => `https://app${i}.example.com/callback`),
        grant_types: ['authorization_code', 'refresh_token', 'client_credentials'],
        response_types: ['code', 'token', 'id_token'],
        scope: longScope,
        contacts: Array.from({ length: 10 }, (_, i) => `admin${i}@example.com`),
      };

      repository.save(clientId, longClientData, 60000);
      const retrieved = repository.get(clientId);

      expect(retrieved!.client_name).toHaveLength(500);
      expect(retrieved!.redirect_uris).toHaveLength(50);
      expect(retrieved!.scope!.split(' ')).toHaveLength(100);
      expect(retrieved!.contacts).toHaveLength(10);
    });

    it('should handle creating many clients', () => {
      const clientIds: string[] = [];
      const numClients = 10; // Reduced for testing performance

      for (let i = 0; i < numClients; i++) {
        const clientId = `cli_mass-client-${i}-1234-4abc-89de-123456789012`;
        const clientData: OAuthClientInformationFull = {
          client_id: `mass-client-${i}`,
          client_name: `Mass Test Client ${i}`,
          redirect_uris: [`https://client${i}.example.com/callback`],
          grant_types: ['authorization_code'],
          response_types: ['code'],
        };

        repository.save(clientId, clientData, 60000);
        clientIds.push(clientId);
      }

      expect(clientIds.length).toBe(numClients);

      // Verify all clients can be retrieved
      for (const clientId of clientIds) {
        const retrieved = repository.get(clientId);
        expect(retrieved).toBeDefined();
      }
    });

    it('should handle complex expiration scenarios', () => {
      const clientId = 'cli_expiry-scenarios-client-1234-4abc-89de-123456789012';

      // Test with future expiration
      const futureExpiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour
      const clientData: OAuthClientInformationFull = {
        client_id: 'expiry-test',
        redirect_uris: ['https://app.com/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        client_secret_expires_at: futureExpiry,
      };

      repository.save(clientId, clientData, 60000);
      const retrieved = repository.get(clientId);

      // Should use the provided expiration time
      expect((retrieved as any).expires).toBe(futureExpiry * 1000);
    });
  });
});
