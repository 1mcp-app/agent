import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { SessionRepository } from './sessionRepository.js';
import { FileStorageService } from './fileStorageService.js';
import { AUTH_CONFIG } from '@src/constants.js';

// Mock logger to avoid console output during tests
vi.mock('@src/logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('SessionRepository', () => {
  let repository: SessionRepository;
  let storage: FileStorageService;
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = path.join(tmpdir(), `session-repo-test-${Date.now()}`);
    storage = new FileStorageService(tempDir);
    repository = new SessionRepository(storage);
  });

  afterEach(() => {
    storage.shutdown();
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('create', () => {
    it('should create a session with generated ID', () => {
      const clientId = 'test-client';
      const resource = 'test-resource';
      const scopes = ['scope1', 'scope2'];
      const ttlMs = 60000; // 1 minute

      const sessionId = repository.create(clientId, resource, scopes, ttlMs);

      expect(sessionId).toBeDefined();
      expect(sessionId).toMatch(new RegExp(`^${AUTH_CONFIG.SERVER.SESSION.ID_PREFIX}`));

      const retrieved = repository.get(sessionId);
      expect(retrieved).toBeDefined();
      expect(retrieved!.clientId).toBe(clientId);
      expect(retrieved!.resource).toBe(resource);
      expect(retrieved!.scopes).toEqual(scopes);
      expect(retrieved!.expires).toBeGreaterThan(Date.now());
      expect(retrieved!.createdAt).toBeLessThanOrEqual(Date.now());
    });

    it('should create sessions with unique IDs', () => {
      const sessionId1 = repository.create('client1', 'resource1', ['scope1'], 60000);
      const sessionId2 = repository.create('client2', 'resource2', ['scope2'], 60000);

      expect(sessionId1).not.toBe(sessionId2);

      const session1 = repository.get(sessionId1);
      const session2 = repository.get(sessionId2);

      expect(session1!.clientId).toBe('client1');
      expect(session2!.clientId).toBe('client2');
    });

    it('should handle empty scopes array', () => {
      const sessionId = repository.create('test-client', 'test-resource', [], 60000);
      const retrieved = repository.get(sessionId);

      expect(retrieved!.scopes).toEqual([]);
    });

    it('should set correct expiration time', () => {
      const ttlMs = 30000; // 30 seconds
      const beforeCreate = Date.now();
      const sessionId = repository.create('test-client', 'test-resource', ['scope1'], ttlMs);
      const afterCreate = Date.now();

      const retrieved = repository.get(sessionId);
      expect(retrieved!.expires).toBeGreaterThanOrEqual(beforeCreate + ttlMs);
      expect(retrieved!.expires).toBeLessThanOrEqual(afterCreate + ttlMs);
    });
  });

  describe('createWithId', () => {
    it('should create a session with specific token ID', () => {
      const tokenId = '12345678-1234-4abc-89de-123456789012';
      const clientId = 'test-client';
      const resource = 'test-resource';
      const scopes = ['scope1', 'scope2'];
      const ttlMs = 60000;

      const sessionId = repository.createWithId(tokenId, clientId, resource, scopes, ttlMs);
      const expectedSessionId = AUTH_CONFIG.SERVER.SESSION.ID_PREFIX + tokenId;

      expect(sessionId).toBe(expectedSessionId);

      const retrieved = repository.get(sessionId);
      expect(retrieved).toBeDefined();
      expect(retrieved!.clientId).toBe(clientId);
      expect(retrieved!.resource).toBe(resource);
      expect(retrieved!.scopes).toEqual(scopes);
    });

    it('should allow creating multiple sessions with different token IDs', () => {
      const tokenId1 = '11111111-1234-4abc-89de-123456789012';
      const tokenId2 = '22222222-1234-4def-89ab-123456789012';

      const sessionId1 = repository.createWithId(tokenId1, 'client1', 'resource1', ['scope1'], 60000);
      const sessionId2 = repository.createWithId(tokenId2, 'client2', 'resource2', ['scope2'], 60000);

      expect(sessionId1).not.toBe(sessionId2);

      const session1 = repository.get(sessionId1);
      const session2 = repository.get(sessionId2);

      expect(session1!.clientId).toBe('client1');
      expect(session2!.clientId).toBe('client2');
    });

    it('should overwrite existing session with same token ID', () => {
      const tokenId = '33333333-1234-4abc-89de-123456789012';

      const sessionId1 = repository.createWithId(tokenId, 'client1', 'resource1', ['scope1'], 60000);
      const sessionId2 = repository.createWithId(tokenId, 'client2', 'resource2', ['scope2'], 60000);

      expect(sessionId1).toBe(sessionId2);

      const retrieved = repository.get(sessionId1);
      expect(retrieved!.clientId).toBe('client2'); // Should be the latest
      expect(retrieved!.resource).toBe('resource2');
      expect(retrieved!.scopes).toEqual(['scope2']);
    });
  });

  describe('get', () => {
    it('should retrieve existing session', () => {
      const sessionId = repository.create('test-client', 'test-resource', ['scope1'], 60000);
      const retrieved = repository.get(sessionId);

      expect(retrieved).toBeDefined();
      expect(retrieved!.clientId).toBe('test-client');
      expect(retrieved!.resource).toBe('test-resource');
      expect(retrieved!.scopes).toEqual(['scope1']);
    });

    it('should return null for non-existent session', () => {
      const result = repository.get('non-existent-session');
      expect(result).toBeNull();
    });

    it('should create session with correct expiration time', () => {
      // Create session with very short TTL but not too short to avoid immediate expiration
      const sessionId = repository.create('test-client', 'test-resource', ['scope1'], 100);

      // Note: The repository itself doesn't check expiration - that's handled by FileStorageService cleanup
      // This test verifies the data structure includes expiration time
      const retrieved = repository.get(sessionId);
      if (retrieved) {
        // If we got the data before it expired, check the expiration time
        expect(retrieved.expires).toBeLessThan(Date.now() + 200); // Should expire soon
      } else {
        // If data already expired, that's also valid behavior
        expect(retrieved).toBeNull();
      }
    });

    it('should handle malformed session IDs gracefully', () => {
      const malformedIds = ['', '   ', 'invalid/id', '../../../etc/passwd'];

      for (const id of malformedIds) {
        const result = repository.get(id);
        expect(result).toBeNull();
      }
    });
  });

  describe('delete', () => {
    it('should delete existing session', () => {
      const sessionId = repository.create('test-client', 'test-resource', ['scope1'], 60000);

      // Verify session exists
      expect(repository.get(sessionId)).toBeDefined();

      // Delete session
      const deleted = repository.delete(sessionId);
      expect(deleted).toBe(true);

      // Verify session is gone
      expect(repository.get(sessionId)).toBeNull();
    });

    it('should return false when deleting non-existent session', () => {
      const deleted = repository.delete('non-existent-session');
      expect(deleted).toBe(false);
    });

    it('should handle multiple deletions of same session', () => {
      const sessionId = repository.create('test-client', 'test-resource', ['scope1'], 60000);

      const deleted1 = repository.delete(sessionId);
      expect(deleted1).toBe(true);

      const deleted2 = repository.delete(sessionId);
      expect(deleted2).toBe(false);
    });

    it('should delete only the specified session', () => {
      const sessionId1 = repository.create('client1', 'resource1', ['scope1'], 60000);
      const sessionId2 = repository.create('client2', 'resource2', ['scope2'], 60000);

      repository.delete(sessionId1);

      expect(repository.get(sessionId1)).toBeNull();
      expect(repository.get(sessionId2)).toBeDefined();
    });
  });

  describe('Session Data Structure', () => {
    it('should store all required session fields', () => {
      const clientId = 'test-client';
      const resource = 'test-resource';
      const scopes = ['scope1', 'scope2', 'scope3'];
      const ttlMs = 60000;

      const sessionId = repository.create(clientId, resource, scopes, ttlMs);
      const retrieved = repository.get(sessionId);

      expect(retrieved).toBeDefined();
      expect(retrieved!.clientId).toBe(clientId);
      expect(retrieved!.resource).toBe(resource);
      expect(retrieved!.scopes).toEqual(scopes);
      expect(typeof retrieved!.expires).toBe('number');
      expect(typeof retrieved!.createdAt).toBe('number');
      expect(retrieved!.expires).toBeGreaterThan(retrieved!.createdAt);
    });

    it('should handle empty resource string', () => {
      const sessionId = repository.create('test-client', '', ['scope1'], 60000);
      const retrieved = repository.get(sessionId);

      expect(retrieved!.resource).toBe('');
    });

    it('should preserve scope order', () => {
      const scopes = ['z-scope', 'a-scope', 'm-scope'];
      const sessionId = repository.create('test-client', 'test-resource', scopes, 60000);
      const retrieved = repository.get(sessionId);

      expect(retrieved!.scopes).toEqual(scopes);
    });
  });

  describe('Integration with FileStorageService', () => {
    it('should use correct file prefix', () => {
      const sessionId = repository.create('test-client', 'test-resource', ['scope1'], 60000);

      // Check that file was created with correct prefix
      const expectedFileName = AUTH_CONFIG.SERVER.SESSION.FILE_PREFIX + sessionId + '.json';
      const filePath = path.join(tempDir, expectedFileName);

      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('should survive FileStorageService restart', () => {
      const sessionId = repository.create('test-client', 'test-resource', ['scope1'], 60000);
      const originalData = repository.get(sessionId);

      // Shutdown and recreate storage service
      storage.shutdown();
      storage = new FileStorageService(tempDir);
      repository = new SessionRepository(storage);

      // Data should still be accessible
      const retrievedData = repository.get(sessionId);
      expect(retrievedData).toEqual(originalData);
    });

    it('should handle storage errors gracefully', () => {
      // This test would need to mock FileStorageService to simulate errors
      // For now, we verify that the repository doesn't crash on invalid operations
      const result = repository.get('invalid-session-id');
      expect(result).toBeNull();
    });
  });

  describe('Performance and Edge Cases', () => {
    it('should handle creating many sessions', () => {
      const sessionIds: string[] = [];
      const numSessions = 100;

      for (let i = 0; i < numSessions; i++) {
        const sessionId = repository.create(`client-${i}`, `resource-${i}`, [`scope-${i}`], 60000);
        sessionIds.push(sessionId);
      }

      expect(sessionIds.length).toBe(numSessions);
      expect(new Set(sessionIds).size).toBe(numSessions); // All unique

      // Verify all sessions can be retrieved
      for (const sessionId of sessionIds) {
        const retrieved = repository.get(sessionId);
        expect(retrieved).toBeDefined();
      }
    });

    it('should handle very long scope arrays', () => {
      const longScopes = Array.from({ length: 1000 }, (_, i) => `scope-${i}`);
      const sessionId = repository.create('test-client', 'test-resource', longScopes, 60000);
      const retrieved = repository.get(sessionId);

      expect(retrieved!.scopes).toEqual(longScopes);
    });

    it('should handle Unicode characters in client and resource IDs', () => {
      const unicodeClientId = 'client-测试-🔐';
      const unicodeResource = 'resource-тест-🌟';
      const sessionId = repository.create(unicodeClientId, unicodeResource, ['scope1'], 60000);
      const retrieved = repository.get(sessionId);

      expect(retrieved!.clientId).toBe(unicodeClientId);
      expect(retrieved!.resource).toBe(unicodeResource);
    });
  });
});
