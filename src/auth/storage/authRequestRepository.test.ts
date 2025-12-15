import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { AUTH_CONFIG } from '@src/constants.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthRequestRepository } from './authRequestRepository.js';
import { FileStorageService } from './fileStorageService.js';

// Mock logger to avoid console output during tests
vi.mock('@src/logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  debugIf: vi.fn(),
}));

describe('AuthRequestRepository', () => {
  let repository: AuthRequestRepository;
  let storage: FileStorageService;
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = path.join(tmpdir(), `auth-request-repo-test-${Date.now()}`);
    storage = new FileStorageService(tempDir);
    repository = new AuthRequestRepository(storage);
  });

  afterEach(() => {
    storage.shutdown();
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('create', () => {
    it('should create an authorization request with generated ID', () => {
      const clientId = 'test-client';
      const redirectUri = 'http://localhost:3000/callback';
      const codeChallenge = 'test-challenge';
      const state = 'test-state';
      const resource = 'test-resource';
      const scopes = ['scope1', 'scope2'];

      const authRequestId = repository.create(clientId, redirectUri, codeChallenge, state, resource, scopes);

      expect(authRequestId).toBeDefined();
      expect(authRequestId).toMatch(new RegExp(`^${AUTH_CONFIG.SERVER.AUTH_REQUEST.ID_PREFIX}`));

      const retrieved = repository.get(authRequestId);
      expect(retrieved).toBeDefined();
      expect(retrieved!.clientId).toBe(clientId);
      expect(retrieved!.redirectUri).toBe(redirectUri);
      expect(retrieved!.codeChallenge).toBe(codeChallenge);
      expect(retrieved!.state).toBe(state);
      expect(retrieved!.resource).toBe(resource);
      expect(retrieved!.scopes).toEqual(scopes);
      expect(retrieved!.expires).toBeGreaterThan(Date.now());
      expect(retrieved!.createdAt).toBeLessThanOrEqual(Date.now());
    });

    it('should create authorization requests with unique IDs', () => {
      const authRequestId1 = repository.create('client1', 'uri1', 'challenge1', 'state1', 'resource1', ['scope1']);
      const authRequestId2 = repository.create('client2', 'uri2', 'challenge2', 'state2', 'resource2', ['scope2']);

      expect(authRequestId1).not.toBe(authRequestId2);

      const authRequest1 = repository.get(authRequestId1);
      const authRequest2 = repository.get(authRequestId2);

      expect(authRequest1!.clientId).toBe('client1');
      expect(authRequest2!.clientId).toBe('client2');
    });

    it('should handle minimal parameters (only required ones)', () => {
      const authRequestId = repository.create('test-client', 'http://test.com');
      const retrieved = repository.get(authRequestId);

      expect(retrieved!.clientId).toBe('test-client');
      expect(retrieved!.redirectUri).toBe('http://test.com');
      expect(retrieved!.codeChallenge).toBeUndefined();
      expect(retrieved!.state).toBeUndefined();
      expect(retrieved!.resource).toBeUndefined();
      expect(retrieved!.scopes).toBeUndefined();
    });

    it('should handle optional parameters individually', () => {
      // Test with only code challenge
      const authRequestId1 = repository.create('test-client', 'http://test.com', 'challenge');
      const retrieved1 = repository.get(authRequestId1);
      expect(retrieved1!.codeChallenge).toBe('challenge');
      expect(retrieved1!.state).toBeUndefined();

      // Test with only state
      const authRequestId2 = repository.create('test-client', 'http://test.com', undefined, 'state');
      const retrieved2 = repository.get(authRequestId2);
      expect(retrieved2!.codeChallenge).toBeUndefined();
      expect(retrieved2!.state).toBe('state');

      // Test with only resource
      const authRequestId3 = repository.create('test-client', 'http://test.com', undefined, undefined, 'resource');
      const retrieved3 = repository.get(authRequestId3);
      expect(retrieved3!.resource).toBe('resource');

      // Test with only scopes
      const authRequestId4 = repository.create('test-client', 'http://test.com', undefined, undefined, undefined, [
        'scope1',
      ]);
      const retrieved4 = repository.get(authRequestId4);
      expect(retrieved4!.scopes).toEqual(['scope1']);
    });

    it('should set correct expiration time using config TTL', () => {
      const beforeCreate = Date.now();
      const authRequestId = repository.create('test-client', 'http://test.com');
      const afterCreate = Date.now();

      const retrieved = repository.get(authRequestId);
      const expectedExpiry = beforeCreate + AUTH_CONFIG.SERVER.AUTH_REQUEST.TTL_MS;
      const maxExpectedExpiry = afterCreate + AUTH_CONFIG.SERVER.AUTH_REQUEST.TTL_MS;

      expect(retrieved!.expires).toBeGreaterThanOrEqual(expectedExpiry);
      expect(retrieved!.expires).toBeLessThanOrEqual(maxExpectedExpiry);
    });

    it('should handle Unicode characters in parameters', () => {
      const unicodeClientId = 'client-测试-🔐';
      const unicodeResource = 'resource-тест-🌟';
      const unicodeState = 'state-العربية-🌍';

      const authRequestId = repository.create(
        unicodeClientId,
        'http://test.com',
        'challenge',
        unicodeState,
        unicodeResource,
        ['scope1'],
      );
      const retrieved = repository.get(authRequestId);

      expect(retrieved!.clientId).toBe(unicodeClientId);
      expect(retrieved!.state).toBe(unicodeState);
      expect(retrieved!.resource).toBe(unicodeResource);
    });

    it('should handle empty scopes array vs undefined', () => {
      const authRequestId1 = repository.create('test-client', 'http://test.com', undefined, undefined, undefined, []);
      const retrieved1 = repository.get(authRequestId1);
      expect(retrieved1!.scopes).toEqual([]);

      const authRequestId2 = repository.create(
        'test-client',
        'http://test.com',
        undefined,
        undefined,
        undefined,
        undefined,
      );
      const retrieved2 = repository.get(authRequestId2);
      expect(retrieved2!.scopes).toBeUndefined();
    });
  });

  describe('get', () => {
    it('should retrieve existing authorization request', () => {
      const authRequestId = repository.create('test-client', 'http://test.com', 'challenge', 'state', 'resource', [
        'scope1',
      ]);
      const retrieved = repository.get(authRequestId);

      expect(retrieved).toBeDefined();
      expect(retrieved!.clientId).toBe('test-client');
      expect(retrieved!.redirectUri).toBe('http://test.com');
      expect(retrieved!.codeChallenge).toBe('challenge');
      expect(retrieved!.state).toBe('state');
      expect(retrieved!.resource).toBe('resource');
      expect(retrieved!.scopes).toEqual(['scope1']);
    });

    it('should return null for non-existent authorization request', () => {
      const result = repository.get('code-nonexistent-1234-4abc-89de-123456789012');
      expect(result).toBeNull();
    });

    it('should return authorization request that will expire soon', () => {
      const authRequestId = repository.create('test-client', 'http://test.com');
      const retrieved = repository.get(authRequestId);

      // Should exist even if close to expiration (cleanup happens separately)
      expect(retrieved).toBeDefined();
      expect(retrieved!.expires).toBeGreaterThan(Date.now());
    });

    it('should handle malformed authorization request IDs gracefully', () => {
      const malformedIds = ['', '   ', 'invalid/id', '../../../etc/passwd'];

      for (const id of malformedIds) {
        const result = repository.get(id);
        expect(result).toBeNull();
      }
    });
  });

  describe('delete', () => {
    it('should delete existing authorization request', () => {
      const authRequestId = repository.create('test-client', 'http://test.com', 'challenge');

      // Verify request exists
      expect(repository.get(authRequestId)).toBeDefined();

      // Delete request
      const deleted = repository.delete(authRequestId);
      expect(deleted).toBe(true);

      // Verify request is gone
      expect(repository.get(authRequestId)).toBeNull();
    });

    it('should return false when deleting non-existent authorization request', () => {
      const deleted = repository.delete('code-nonexistent-1234-4abc-89de-123456789012');
      expect(deleted).toBe(false);
    });

    it('should handle multiple deletions of same authorization request', () => {
      const authRequestId = repository.create('test-client', 'http://test.com');

      const deleted1 = repository.delete(authRequestId);
      expect(deleted1).toBe(true);

      const deleted2 = repository.delete(authRequestId);
      expect(deleted2).toBe(false);
    });

    it('should delete only the specified authorization request', () => {
      const authRequestId1 = repository.create('client1', 'http://test1.com');
      const authRequestId2 = repository.create('client2', 'http://test2.com');

      repository.delete(authRequestId1);

      expect(repository.get(authRequestId1)).toBeNull();
      expect(repository.get(authRequestId2)).toBeDefined();
    });
  });

  describe('Authorization Request Data Structure', () => {
    it('should store all authorization request fields correctly', () => {
      const clientId = 'oauth-client-123';
      const redirectUri = 'https://app.example.com/oauth/callback';
      const codeChallenge = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const state = 'af0ifjsldkj';
      const resource = 'https://api.example.com';
      const scopes = ['openid', 'profile', 'email'];

      const authRequestId = repository.create(clientId, redirectUri, codeChallenge, state, resource, scopes);
      const retrieved = repository.get(authRequestId);

      expect(retrieved).toBeDefined();
      expect(retrieved!.clientId).toBe(clientId);
      expect(retrieved!.redirectUri).toBe(redirectUri);
      expect(retrieved!.codeChallenge).toBe(codeChallenge);
      expect(retrieved!.state).toBe(state);
      expect(retrieved!.resource).toBe(resource);
      expect(retrieved!.scopes).toEqual(scopes);
      expect(typeof retrieved!.expires).toBe('number');
      expect(typeof retrieved!.createdAt).toBe('number');
      expect(retrieved!.expires).toBeGreaterThan(retrieved!.createdAt);
    });

    it('should preserve scope order', () => {
      const scopes = ['z-scope', 'a-scope', 'm-scope'];
      const authRequestId = repository.create(
        'test-client',
        'http://test.com',
        undefined,
        undefined,
        undefined,
        scopes,
      );
      const retrieved = repository.get(authRequestId);

      expect(retrieved!.scopes).toEqual(scopes);
    });

    it('should handle different redirect URI formats', () => {
      const redirectUris = [
        'http://localhost:3000/callback',
        'https://app.example.com/oauth/callback',
        'myapp://oauth/callback',
        'http://127.0.0.1:8080/auth',
        'urn:ietf:wg:oauth:2.0:oob', // Out-of-band
      ];

      for (const uri of redirectUris) {
        const authRequestId = repository.create('test-client', uri);
        const retrieved = repository.get(authRequestId);
        expect(retrieved!.redirectUri).toBe(uri);
      }
    });

    it('should handle long PKCE code challenges', () => {
      const longCodeChallenge = 'a'.repeat(128); // Maximum typical length for PKCE
      const authRequestId = repository.create('test-client', 'http://test.com', longCodeChallenge);
      const retrieved = repository.get(authRequestId);

      expect(retrieved!.codeChallenge).toBe(longCodeChallenge);
    });

    it('should handle complex state values', () => {
      const complexState = 'csrf_token=abc123&return_to=/dashboard&lang=en';
      const authRequestId = repository.create('test-client', 'http://test.com', undefined, complexState);
      const retrieved = repository.get(authRequestId);

      expect(retrieved!.state).toBe(complexState);
    });
  });

  describe('Integration with FileStorageService', () => {
    it('should use correct file prefix', () => {
      const authRequestId = repository.create('test-client', 'http://test.com');

      // Check that file was created with correct prefix
      const expectedFileName = AUTH_CONFIG.SERVER.AUTH_REQUEST.FILE_PREFIX + authRequestId + '.json';
      const filePath = path.join(storage.getStorageDir(), expectedFileName);

      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('should survive FileStorageService restart', () => {
      const authRequestId = repository.create('test-client', 'http://test.com', 'challenge', 'state');
      const originalData = repository.get(authRequestId);

      // Shutdown and recreate storage service
      storage.shutdown();
      storage = new FileStorageService(tempDir);
      repository = new AuthRequestRepository(storage);

      // Data should still be accessible
      const retrievedData = repository.get(authRequestId);
      expect(retrievedData).toEqual(originalData);
    });

    it('should handle storage errors gracefully', () => {
      // This test would need to mock FileStorageService to simulate errors
      // For now, we verify that the repository doesn't crash on invalid operations
      const result = repository.get('invalid-request-id');
      expect(result).toBeNull();
    });
  });

  describe('OAuth 2.1 Consent Flow', () => {
    it('should support temporary storage for consent flow', () => {
      // Typical consent flow: store request, show UI, process response
      const authRequestId = repository.create(
        'consent-app',
        'https://app.com/callback',
        'pkce-challenge-value',
        'csrf-state-token',
        'https://api.resource.com',
        ['read:profile', 'write:data'],
      );

      // Request should be available for consent UI
      const forConsentUI = repository.get(authRequestId);
      expect(forConsentUI).toBeDefined();
      expect(forConsentUI!.clientId).toBe('consent-app');
      expect(forConsentUI!.scopes).toEqual(['read:profile', 'write:data']);

      // After consent processing, request should be cleanable
      const deleted = repository.delete(authRequestId);
      expect(deleted).toBe(true);
      expect(repository.get(authRequestId)).toBeNull();
    });

    it('should handle public clients (no secret) with PKCE', () => {
      const authRequestId = repository.create(
        'public-spa-client',
        'http://localhost:3000/callback',
        'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', // PKCE challenge
        'random-state-123',
      );

      const retrieved = repository.get(authRequestId);
      expect(retrieved!.codeChallenge).toBeDefined();
      expect(retrieved!.state).toBeDefined();
    });

    it('should handle confidential clients (with secret)', () => {
      const authRequestId = repository.create(
        'confidential-server-client',
        'https://secure-app.com/oauth/callback',
        undefined, // No PKCE needed for confidential clients
        'server-state-token',
        'https://api.example.com',
        ['admin:read', 'admin:write'],
      );

      const retrieved = repository.get(authRequestId);
      expect(retrieved!.codeChallenge).toBeUndefined();
      expect(retrieved!.state).toBe('server-state-token');
      expect(retrieved!.scopes).toEqual(['admin:read', 'admin:write']);
    });

    it('should store data required for building authorization codes', () => {
      const authRequestId = repository.create(
        'test-client',
        'https://app.com/callback',
        'pkce-challenge',
        'csrf-state',
        'api-resource',
        ['scope1', 'scope2'],
      );

      const retrieved = repository.get(authRequestId);

      // All data needed to create authorization code should be present
      expect(retrieved!.clientId).toBeDefined(); // For auth code
      expect(retrieved!.redirectUri).toBeDefined(); // For validation
      expect(retrieved!.codeChallenge).toBeDefined(); // For PKCE
      expect(retrieved!.state).toBeDefined(); // For state validation
      expect(retrieved!.scopes).toBeDefined(); // For token scopes
    });
  });

  describe('Performance and Edge Cases', () => {
    it('should handle creating many authorization requests', () => {
      const authRequestIds: string[] = [];
      const numRequests = 10; // Reduced for testing performance

      for (let i = 0; i < numRequests; i++) {
        const authRequestId = repository.create(`client-${i}`, `http://test${i}.com`);
        authRequestIds.push(authRequestId);
      }

      expect(authRequestIds.length).toBe(numRequests);
      expect(new Set(authRequestIds).size).toBe(numRequests); // All unique

      // Verify all requests can be retrieved
      for (const authRequestId of authRequestIds) {
        const retrieved = repository.get(authRequestId);
        expect(retrieved).toBeDefined();
      }
    });

    it('should handle very long scope arrays', () => {
      const longScopes = Array.from({ length: 100 }, (_, i) => `scope-${i}`);
      const authRequestId = repository.create(
        'test-client',
        'http://test.com',
        undefined,
        undefined,
        undefined,
        longScopes,
      );
      const retrieved = repository.get(authRequestId);

      expect(retrieved!.scopes).toEqual(longScopes);
    });

    it('should handle complex OAuth parameters', () => {
      const complexCodeChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
      const complexState = encodeURIComponent('return_to=https://app.com/dashboard?tab=settings&user=123');
      const complexResource = 'https://api.example.com/v2/resource?tenant=org123';

      const authRequestId = repository.create(
        'complex-client',
        'https://app.example.com/oauth/callback?version=2',
        complexCodeChallenge,
        complexState,
        complexResource,
        ['openid', 'profile', 'email', 'https://example.com/scopes/read'],
      );

      const retrieved = repository.get(authRequestId);
      expect(retrieved!.codeChallenge).toBe(complexCodeChallenge);
      expect(retrieved!.state).toBe(complexState);
      expect(retrieved!.resource).toBe(complexResource);
    });

    it('should have predictable expiration timing', () => {
      const startTime = Date.now();
      const authRequestId = repository.create('test-client', 'http://test.com');
      const endTime = Date.now();

      const retrieved = repository.get(authRequestId);
      const expectedMinExpiry = startTime + AUTH_CONFIG.SERVER.AUTH_REQUEST.TTL_MS;
      const expectedMaxExpiry = endTime + AUTH_CONFIG.SERVER.AUTH_REQUEST.TTL_MS;

      expect(retrieved!.expires).toBeGreaterThanOrEqual(expectedMinExpiry);
      expect(retrieved!.expires).toBeLessThanOrEqual(expectedMaxExpiry);
    });
  });
});
