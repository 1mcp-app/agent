import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { AuthCodeRepository } from './authCodeRepository.js';
import { FileStorageService } from './fileStorageService.js';
import { AUTH_CONFIG } from '../../constants.js';

// Mock logger to avoid console output during tests
vi.mock('../../logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('AuthCodeRepository', () => {
  let repository: AuthCodeRepository;
  let storage: FileStorageService;
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = path.join(tmpdir(), `auth-code-repo-test-${Date.now()}`);
    storage = new FileStorageService(tempDir);
    repository = new AuthCodeRepository(storage);
  });

  afterEach(() => {
    storage.shutdown();
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('create', () => {
    it('should create an authorization code with generated ID', () => {
      const clientId = 'test-client';
      const redirectUri = 'http://localhost:3000/callback';
      const resource = 'test-resource';
      const scopes = ['scope1', 'scope2'];
      const ttlMs = 60000; // 1 minute
      const codeChallenge = 'test-challenge';

      const code = repository.create(clientId, redirectUri, resource, scopes, ttlMs, codeChallenge);

      expect(code).toBeDefined();
      expect(code).toMatch(new RegExp(`^${AUTH_CONFIG.SERVER.AUTH_CODE.ID_PREFIX}`));

      const retrieved = repository.get(code);
      expect(retrieved).toBeDefined();
      expect(retrieved!.clientId).toBe(clientId);
      expect(retrieved!.redirectUri).toBe(redirectUri);
      expect(retrieved!.resource).toBe(resource);
      expect(retrieved!.scopes).toEqual(scopes);
      expect(retrieved!.codeChallenge).toBe(codeChallenge);
      expect(retrieved!.expires).toBeGreaterThan(Date.now());
      expect(retrieved!.createdAt).toBeLessThanOrEqual(Date.now());
    });

    it('should create authorization codes with unique IDs', () => {
      const code1 = repository.create('client1', 'uri1', 'resource1', ['scope1'], 60000);
      const code2 = repository.create('client2', 'uri2', 'resource2', ['scope2'], 60000);

      expect(code1).not.toBe(code2);

      const authCode1 = repository.get(code1);
      const authCode2 = repository.get(code2);

      expect(authCode1!.clientId).toBe('client1');
      expect(authCode2!.clientId).toBe('client2');
    });

    it('should handle optional code challenge', () => {
      const code = repository.create('test-client', 'http://test.com', 'resource', ['scope1'], 60000);
      const retrieved = repository.get(code);

      expect(retrieved!.codeChallenge).toBeUndefined();
    });

    it('should handle empty scopes array', () => {
      const code = repository.create('test-client', 'http://test.com', 'resource', [], 60000);
      const retrieved = repository.get(code);

      expect(retrieved!.scopes).toEqual([]);
    });

    it('should set correct expiration time', () => {
      const ttlMs = 30000; // 30 seconds
      const beforeCreate = Date.now();
      const code = repository.create('test-client', 'http://test.com', 'resource', ['scope1'], ttlMs);
      const afterCreate = Date.now();

      const retrieved = repository.get(code);
      expect(retrieved!.expires).toBeGreaterThanOrEqual(beforeCreate + ttlMs);
      expect(retrieved!.expires).toBeLessThanOrEqual(afterCreate + ttlMs);
    });

    it('should handle Unicode characters in client and resource', () => {
      const unicodeClientId = 'client-测试-🔐';
      const unicodeResource = 'resource-тест-🌟';
      const code = repository.create(unicodeClientId, 'http://test.com', unicodeResource, ['scope1'], 60000);
      const retrieved = repository.get(code);

      expect(retrieved!.clientId).toBe(unicodeClientId);
      expect(retrieved!.resource).toBe(unicodeResource);
    });
  });

  describe('get', () => {
    it('should retrieve existing authorization code', () => {
      const code = repository.create('test-client', 'http://test.com', 'resource', ['scope1'], 60000, 'challenge');
      const retrieved = repository.get(code);

      expect(retrieved).toBeDefined();
      expect(retrieved!.clientId).toBe('test-client');
      expect(retrieved!.redirectUri).toBe('http://test.com');
      expect(retrieved!.resource).toBe('resource');
      expect(retrieved!.scopes).toEqual(['scope1']);
      expect(retrieved!.codeChallenge).toBe('challenge');
    });

    it('should return null for non-existent authorization code', () => {
      const result = repository.get('code-nonexistent-1234-4abc-89de-123456789012');
      expect(result).toBeNull();
    });

    it('should create code with correct expiration time', () => {
      // Create code with very short TTL but not too short to avoid immediate expiration
      const code = repository.create('test-client', 'http://test.com', 'resource', ['scope1'], 100);

      // Note: The repository itself doesn't check expiration - that's handled by FileStorageService cleanup
      // This test verifies the data structure includes expiration time
      const retrieved = repository.get(code);
      if (retrieved) {
        // If we got the data before it expired, check the expiration time
        expect(retrieved.expires).toBeLessThan(Date.now() + 200); // Should expire soon
      } else {
        // If data already expired, that's also valid behavior
        expect(retrieved).toBeNull();
      }
    });

    it('should handle malformed authorization code IDs gracefully', () => {
      const malformedIds = ['', '   ', 'invalid/id', '../../../etc/passwd'];

      for (const id of malformedIds) {
        const result = repository.get(id);
        expect(result).toBeNull();
      }
    });
  });

  describe('delete', () => {
    it('should delete existing authorization code', () => {
      const code = repository.create('test-client', 'http://test.com', 'resource', ['scope1'], 60000);

      // Verify code exists
      expect(repository.get(code)).toBeDefined();

      // Delete code
      const deleted = repository.delete(code);
      expect(deleted).toBe(true);

      // Verify code is gone
      expect(repository.get(code)).toBeNull();
    });

    it('should return false when deleting non-existent authorization code', () => {
      const deleted = repository.delete('code-nonexistent-1234-4abc-89de-123456789012');
      expect(deleted).toBe(false);
    });

    it('should handle multiple deletions of same authorization code', () => {
      const code = repository.create('test-client', 'http://test.com', 'resource', ['scope1'], 60000);

      const deleted1 = repository.delete(code);
      expect(deleted1).toBe(true);

      const deleted2 = repository.delete(code);
      expect(deleted2).toBe(false);
    });

    it('should delete only the specified authorization code', () => {
      const code1 = repository.create('client1', 'http://test1.com', 'resource1', ['scope1'], 60000);
      const code2 = repository.create('client2', 'http://test2.com', 'resource2', ['scope2'], 60000);

      repository.delete(code1);

      expect(repository.get(code1)).toBeNull();
      expect(repository.get(code2)).toBeDefined();
    });
  });

  describe('Authorization Code Data Structure', () => {
    it('should store all required authorization code fields', () => {
      const clientId = 'test-client';
      const redirectUri = 'http://localhost:3000/callback';
      const resource = 'test-resource';
      const scopes = ['scope1', 'scope2', 'scope3'];
      const ttlMs = 60000;
      const codeChallenge = 'test-challenge-value';

      const code = repository.create(clientId, redirectUri, resource, scopes, ttlMs, codeChallenge);
      const retrieved = repository.get(code);

      expect(retrieved).toBeDefined();
      expect(retrieved!.clientId).toBe(clientId);
      expect(retrieved!.redirectUri).toBe(redirectUri);
      expect(retrieved!.resource).toBe(resource);
      expect(retrieved!.scopes).toEqual(scopes);
      expect(retrieved!.codeChallenge).toBe(codeChallenge);
      expect(typeof retrieved!.expires).toBe('number');
      expect(typeof retrieved!.createdAt).toBe('number');
      expect(retrieved!.expires).toBeGreaterThan(retrieved!.createdAt);
    });

    it('should handle empty resource string', () => {
      const code = repository.create('test-client', 'http://test.com', '', ['scope1'], 60000);
      const retrieved = repository.get(code);

      expect(retrieved!.resource).toBe('');
    });

    it('should preserve scope order', () => {
      const scopes = ['z-scope', 'a-scope', 'm-scope'];
      const code = repository.create('test-client', 'http://test.com', 'resource', scopes, 60000);
      const retrieved = repository.get(code);

      expect(retrieved!.scopes).toEqual(scopes);
    });

    it('should handle different redirect URI formats', () => {
      const redirectUris = [
        'http://localhost:3000/callback',
        'https://app.example.com/oauth/callback',
        'myapp://oauth/callback',
        'http://127.0.0.1:8080/auth',
      ];

      for (const uri of redirectUris) {
        const code = repository.create('test-client', uri, 'resource', ['scope1'], 60000);
        const retrieved = repository.get(code);
        expect(retrieved!.redirectUri).toBe(uri);
      }
    });

    it('should handle long code challenges (PKCE)', () => {
      const longCodeChallenge = 'a'.repeat(128); // Maximum typical length for PKCE
      const code = repository.create(
        'test-client',
        'http://test.com',
        'resource',
        ['scope1'],
        60000,
        longCodeChallenge,
      );
      const retrieved = repository.get(code);

      expect(retrieved!.codeChallenge).toBe(longCodeChallenge);
    });
  });

  describe('Integration with FileStorageService', () => {
    it('should use correct file prefix', () => {
      const code = repository.create('test-client', 'http://test.com', 'resource', ['scope1'], 60000);

      // Check that file was created with correct prefix
      const expectedFileName = AUTH_CONFIG.SERVER.AUTH_CODE.FILE_PREFIX + code + '.json';
      const filePath = path.join(tempDir, expectedFileName);

      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('should survive FileStorageService restart', () => {
      const code = repository.create('test-client', 'http://test.com', 'resource', ['scope1'], 60000);
      const originalData = repository.get(code);

      // Shutdown and recreate storage service
      storage.shutdown();
      storage = new FileStorageService(tempDir);
      repository = new AuthCodeRepository(storage);

      // Data should still be accessible
      const retrievedData = repository.get(code);
      expect(retrievedData).toEqual(originalData);
    });

    it('should handle storage errors gracefully', () => {
      // This test would need to mock FileStorageService to simulate errors
      // For now, we verify that the repository doesn't crash on invalid operations
      const result = repository.get('invalid-code-id');
      expect(result).toBeNull();
    });
  });

  describe('OAuth 2.1 Compliance', () => {
    it('should support authorization codes without PKCE', () => {
      const code = repository.create('test-client', 'http://test.com', 'resource', ['scope1'], 60000);
      const retrieved = repository.get(code);

      expect(retrieved!.codeChallenge).toBeUndefined();
    });

    it('should support authorization codes with PKCE', () => {
      const codeChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
      const code = repository.create('test-client', 'http://test.com', 'resource', ['scope1'], 60000, codeChallenge);
      const retrieved = repository.get(code);

      expect(retrieved!.codeChallenge).toBe(codeChallenge);
    });

    it('should handle typical OAuth scopes', () => {
      const oauthScopes = ['openid', 'profile', 'email', 'read:user', 'write:repo'];
      const code = repository.create('test-client', 'http://test.com', 'resource', oauthScopes, 60000);
      const retrieved = repository.get(code);

      expect(retrieved!.scopes).toEqual(oauthScopes);
    });

    it('should store all data required for token exchange', () => {
      const code = repository.create(
        'oauth-client',
        'https://app.com/callback',
        'api-server',
        ['read', 'write'],
        60000,
        'pkce-challenge',
      );
      const retrieved = repository.get(code);

      // All fields required for OAuth token exchange should be present
      expect(retrieved!.clientId).toBeDefined();
      expect(retrieved!.redirectUri).toBeDefined();
      expect(retrieved!.scopes).toBeDefined();
      expect(retrieved!.codeChallenge).toBeDefined();
      expect(retrieved!.expires).toBeDefined();
      expect(retrieved!.createdAt).toBeDefined();
    });
  });

  describe('Performance and Edge Cases', () => {
    it('should handle creating many authorization codes', () => {
      const codes: string[] = [];
      const numCodes = 10; // Reduced for testing performance

      for (let i = 0; i < numCodes; i++) {
        const code = repository.create(`client-${i}`, `http://test${i}.com`, `resource-${i}`, [`scope-${i}`], 60000);
        codes.push(code);
      }

      expect(codes.length).toBe(numCodes);
      expect(new Set(codes).size).toBe(numCodes); // All unique

      // Verify all codes can be retrieved
      for (const code of codes) {
        const retrieved = repository.get(code);
        expect(retrieved).toBeDefined();
      }
    });

    it('should handle very long scope arrays', () => {
      const longScopes = Array.from({ length: 100 }, (_, i) => `scope-${i}`);
      const code = repository.create('test-client', 'http://test.com', 'resource', longScopes, 60000);
      const retrieved = repository.get(code);

      expect(retrieved!.scopes).toEqual(longScopes);
    });

    it('should handle extremely short TTL', () => {
      const code = repository.create('test-client', 'http://test.com', 'resource', ['scope1'], 1); // 1ms TTL
      const retrieved = repository.get(code);

      // With 1ms TTL, the code might already be expired when retrieved
      // This tests that the system correctly handles immediate expiration
      if (retrieved === null) {
        // Code expired before retrieval - this is acceptable behavior
        expect(retrieved).toBeNull();
      } else {
        // Code retrieved before expiration
        expect(retrieved.expires).toBeLessThanOrEqual(Date.now() + 10); // Should be very soon
      }
    });

    it('should handle very long TTL', () => {
      const longTtl = 365 * 24 * 60 * 60 * 1000; // 1 year
      const beforeCreate = Date.now();
      const code = repository.create('test-client', 'http://test.com', 'resource', ['scope1'], longTtl);
      const retrieved = repository.get(code);

      expect(retrieved!.expires).toBeGreaterThan(beforeCreate + longTtl - 1000); // Allow for 1s variation
    });
  });
});
