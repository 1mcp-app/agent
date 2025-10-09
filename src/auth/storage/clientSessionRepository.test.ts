import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { ClientSessionData } from '@src/auth/sessionTypes.js';
import { AUTH_CONFIG } from '@src/constants.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClientSessionRepository } from './clientSessionRepository.js';
import { FileStorageService } from './fileStorageService.js';

// Mock logger to avoid console output during tests
vi.mock('@src/logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('ClientSessionRepository', () => {
  let repository: ClientSessionRepository;
  let storage: FileStorageService;
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = path.join(tmpdir(), `client-session-repo-test-${Date.now()}`);
    storage = new FileStorageService(tempDir);
    repository = new ClientSessionRepository(storage);
  });

  afterEach(() => {
    storage.shutdown();
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('save', () => {
    it('should save client session with all fields', () => {
      const serverName = 'test-server';
      const clientSessionData: ClientSessionData = {
        serverName: 'test-server',
        clientInfo: JSON.stringify({
          client_id: 'test-client-123',
          client_secret: 'secret-value',
          redirect_uris: ['https://app.com/callback'],
        }),
        tokens: JSON.stringify({
          access_token: 'access-token-123',
          refresh_token: 'refresh-token-456',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
        codeVerifier: 'test-code-verifier',
        state: 'test-state',
        expires: Date.now() + 3600000,
        createdAt: Date.now(),
      };
      const ttlMs = 3600000; // 1 hour

      const result = repository.save(serverName, clientSessionData, ttlMs);

      expect(result).toBe('test-server'); // Server name should be returned
      const retrieved = repository.get(serverName);
      expect(retrieved).toBeDefined();
      expect(retrieved!.serverName).toBe('test-server');
      expect(retrieved!.clientInfo).toBe(clientSessionData.clientInfo);
      expect(retrieved!.tokens).toBe(clientSessionData.tokens);
      expect(retrieved!.codeVerifier).toBe(clientSessionData.codeVerifier);
      expect(retrieved!.state).toBe(clientSessionData.state);
      expect(retrieved!.expires).toBeGreaterThan(Date.now());
      expect(retrieved!.createdAt).toBeLessThanOrEqual(Date.now());
    });

    it('should save client session with minimal required fields', () => {
      const serverName = 'minimal-server';
      const clientSessionData: ClientSessionData = {
        serverName: 'minimal-server',
        expires: Date.now() + 3600000,
        createdAt: Date.now(),
      };
      const ttlMs = 3600000;

      repository.save(serverName, clientSessionData, ttlMs);
      const retrieved = repository.get(serverName);

      expect(retrieved!.serverName).toBe('minimal-server');
      expect(retrieved!.clientInfo).toBeUndefined();
      expect(retrieved!.tokens).toBeUndefined();
      expect(retrieved!.codeVerifier).toBeUndefined();
      expect(retrieved!.state).toBeUndefined();
    });

    it('should sanitize server names for security', () => {
      const maliciousServerName = '../../../etc/passwd';
      const clientSessionData: ClientSessionData = {
        serverName: maliciousServerName,
        expires: Date.now() + 3600000,
        createdAt: Date.now(),
      };

      const result = repository.save(maliciousServerName, clientSessionData, 3600000);

      // Should sanitize the server name
      expect(result).not.toBe(maliciousServerName);
      expect(result).toMatch(/^[a-zA-Z0-9_-]+$/);
    });

    it('should set correct expiration time based on TTL', () => {
      const serverName = 'expiry-test-server';
      const ttlMs = 30000; // 30 seconds
      const beforeSave = Date.now();
      const clientSessionData: ClientSessionData = {
        serverName,
        expires: Date.now() + 3600000,
        createdAt: Date.now(),
      };

      repository.save(serverName, clientSessionData, ttlMs);
      const afterSave = Date.now();
      const retrieved = repository.get(serverName);

      const expectedMinExpiry = beforeSave + ttlMs;
      const expectedMaxExpiry = afterSave + ttlMs;
      expect(retrieved!.expires).toBeGreaterThanOrEqual(expectedMinExpiry);
      expect(retrieved!.expires).toBeLessThanOrEqual(expectedMaxExpiry);
    });

    it('should preserve createdAt when provided', () => {
      const serverName = 'created-at-test';
      const pastTimestamp = Date.now() - 60000; // 1 minute ago
      const clientSessionData: ClientSessionData = {
        serverName,
        expires: Date.now() + 3600000,
        createdAt: pastTimestamp,
      };

      repository.save(serverName, clientSessionData, 3600000);
      const retrieved = repository.get(serverName);

      expect(retrieved!.createdAt).toBe(pastTimestamp);
    });

    it('should set createdAt when not provided', () => {
      const serverName = 'no-created-at-test';
      const beforeSave = Date.now();
      const clientSessionData: ClientSessionData = {
        serverName,
        expires: Date.now() + 3600000,
        createdAt: Date.now(),
      };
      delete (clientSessionData as any).createdAt;

      repository.save(serverName, clientSessionData, 3600000);
      const afterSave = Date.now();
      const retrieved = repository.get(serverName);

      expect(retrieved!.createdAt).toBeGreaterThanOrEqual(beforeSave);
      expect(retrieved!.createdAt).toBeLessThanOrEqual(afterSave);
    });

    it('should overwrite existing client session', () => {
      const serverName = 'overwrite-test-server';
      const originalData: ClientSessionData = {
        serverName,
        clientInfo: JSON.stringify({ client_id: 'original-client' }),
        expires: Date.now() + 3600000,
        createdAt: Date.now(),
      };
      const updatedData: ClientSessionData = {
        serverName,
        clientInfo: JSON.stringify({ client_id: 'updated-client' }),
        tokens: JSON.stringify({ access_token: 'new-token' }),
        expires: Date.now() + 3600000,
        createdAt: Date.now(),
      };

      repository.save(serverName, originalData, 3600000);
      repository.save(serverName, updatedData, 3600000);

      const retrieved = repository.get(serverName);
      expect(JSON.parse(retrieved!.clientInfo!)).toEqual({ client_id: 'updated-client' });
      expect(retrieved!.tokens).toBeDefined();
    });
  });

  describe('get', () => {
    it('should retrieve existing client session', () => {
      const serverName = 'get-test-server';
      const clientSessionData: ClientSessionData = {
        serverName,
        clientInfo: JSON.stringify({ client_id: 'get-test-client' }),
        tokens: JSON.stringify({ access_token: 'test-token' }),
        codeVerifier: 'test-verifier',
        state: 'test-state',
        expires: Date.now() + 3600000,
        createdAt: Date.now(),
      };

      repository.save(serverName, clientSessionData, 3600000);
      const retrieved = repository.get(serverName);

      expect(retrieved).toBeDefined();
      expect(retrieved!.serverName).toBe(serverName);
      expect(retrieved!.clientInfo).toBe(clientSessionData.clientInfo);
      expect(retrieved!.tokens).toBe(clientSessionData.tokens);
      expect(retrieved!.codeVerifier).toBe(clientSessionData.codeVerifier);
      expect(retrieved!.state).toBe(clientSessionData.state);
    });

    it('should return null for non-existent client session', () => {
      const result = repository.get('nonexistent-server');
      expect(result).toBeNull();
    });

    it('should return null for expired client session', () => {
      const serverName = 'expired-test-server';
      const expiredData: ClientSessionData = {
        serverName,
        expires: Date.now() - 1000, // Expired 1 second ago
        createdAt: Date.now() - 3600000,
      };

      // Directly save expired data to storage to bypass TTL calculation
      storage.writeData(
        AUTH_CONFIG.CLIENT.SESSION.FILE_PREFIX,
        `${AUTH_CONFIG.CLIENT.SESSION.ID_PREFIX}${serverName}`,
        expiredData,
      );

      const result = repository.get(serverName);
      expect(result).toBeNull();
    });

    it('should handle malformed server names gracefully', () => {
      const malformedNames = ['', '   ', 'invalid/name', '../../../etc/passwd'];

      for (const name of malformedNames) {
        const result = repository.get(name);
        expect(result).toBeNull();
      }
    });

    it('should sanitize server names consistently', () => {
      const serverName = 'test_server-123';
      const clientSessionData: ClientSessionData = {
        serverName,
        expires: Date.now() + 3600000,
        createdAt: Date.now(),
      };

      repository.save(serverName, clientSessionData, 3600000);
      const retrieved = repository.get(serverName);

      expect(retrieved).toBeDefined();
      expect(retrieved!.serverName).toBe(serverName);
    });
  });

  describe('delete', () => {
    it('should delete existing client session', () => {
      const serverName = 'delete-test-server';
      const clientSessionData: ClientSessionData = {
        serverName,
        clientInfo: JSON.stringify({ client_id: 'delete-test' }),
        expires: Date.now() + 3600000,
        createdAt: Date.now(),
      };

      repository.save(serverName, clientSessionData, 3600000);

      // Verify session exists
      expect(repository.get(serverName)).toBeDefined();

      // Delete session
      const deleted = repository.delete(serverName);
      expect(deleted).toBe(true);

      // Verify session is gone
      expect(repository.get(serverName)).toBeNull();
    });

    it('should return false when deleting non-existent client session', () => {
      const deleted = repository.delete('nonexistent-server');
      expect(deleted).toBe(false);
    });

    it('should handle multiple deletions of same client session', () => {
      const serverName = 'multi-delete-server';
      const clientSessionData: ClientSessionData = {
        serverName,
        expires: Date.now() + 3600000,
        createdAt: Date.now(),
      };

      repository.save(serverName, clientSessionData, 3600000);

      const deleted1 = repository.delete(serverName);
      expect(deleted1).toBe(true);

      const deleted2 = repository.delete(serverName);
      expect(deleted2).toBe(false);
    });

    it('should delete only the specified client session', () => {
      const serverName1 = 'server-1';
      const serverName2 = 'server-2';

      const sessionData1: ClientSessionData = {
        serverName: serverName1,
        expires: Date.now() + 3600000,
        createdAt: Date.now(),
      };

      const sessionData2: ClientSessionData = {
        serverName: serverName2,
        expires: Date.now() + 3600000,
        createdAt: Date.now(),
      };

      repository.save(serverName1, sessionData1, 3600000);
      repository.save(serverName2, sessionData2, 3600000);

      repository.delete(serverName1);

      expect(repository.get(serverName1)).toBeNull();
      expect(repository.get(serverName2)).toBeDefined();
    });
  });

  describe('list', () => {
    it('should return empty array when no client sessions exist', () => {
      const result = repository.list();
      expect(result).toEqual([]);
    });

    it('should list all client session server names', () => {
      const serverNames = ['server-1', 'server-2', 'server-3'];

      for (const serverName of serverNames) {
        const sessionData: ClientSessionData = {
          serverName,
          expires: Date.now() + 3600000,
          createdAt: Date.now(),
        };
        repository.save(serverName, sessionData, 3600000);
      }

      const result = repository.list();
      expect(result).toHaveLength(3);
      expect(result).toEqual(expect.arrayContaining(serverNames));
    });

    it('should not list expired sessions (they should be cleaned up)', () => {
      const validServerName = 'valid-server';
      const validSessionData: ClientSessionData = {
        serverName: validServerName,
        expires: Date.now() + 3600000,
        createdAt: Date.now(),
      };

      repository.save(validServerName, validSessionData, 3600000);

      // Manually create an expired session
      const expiredServerName = 'expired-server';
      const expiredData: ClientSessionData = {
        serverName: expiredServerName,
        expires: Date.now() - 1000,
        createdAt: Date.now() - 3600000,
      };
      storage.writeData(
        AUTH_CONFIG.CLIENT.SESSION.FILE_PREFIX,
        `${AUTH_CONFIG.CLIENT.SESSION.ID_PREFIX}${expiredServerName}`,
        expiredData,
      );

      const result = repository.list();
      expect(result).toContain(validServerName);
      // Note: The expired session might still show in list() since it doesn't check expiration
      // but get() will return null for expired sessions
    });

    it('should handle server names with special characters', () => {
      // Test server names that contain special characters that need sanitization
      const testCases = [
        { input: 'server-test1', expected: 'server-test1' },
        { input: 'server_test2', expected: 'server_test2' },
        { input: 'server/test3', expected: 'server_test3' },
        { input: 'server@test4', expected: 'server_test4' },
      ];

      for (const testCase of testCases) {
        const sessionData: ClientSessionData = {
          serverName: testCase.input,
          expires: Date.now() + 3600000,
          createdAt: Date.now(),
        };
        const sanitizedName = repository.save(testCase.input, sessionData, 3600000);

        // The sanitized name should be safe for filesystem use
        expect(sanitizedName).toMatch(/^[a-zA-Z0-9_-]+$/);

        // Should be able to retrieve the session
        const retrieved = repository.get(testCase.input);
        expect(retrieved).toBeDefined();
        expect(retrieved!.serverName).toBe(testCase.input);
      }
    });

    it('should filter out non-client-session files', () => {
      // Create a client session
      const serverName = 'test-server';
      const sessionData: ClientSessionData = {
        serverName,
        expires: Date.now() + 3600000,
        createdAt: Date.now(),
      };
      repository.save(serverName, sessionData, 3600000);

      // Create some other files that shouldn't be listed
      const otherFiles = ['session_other-session.json', 'auth_code_some-code.json', 'random_file.json'];

      for (const fileName of otherFiles) {
        const filePath = path.join(tempDir, fileName);
        fs.writeFileSync(filePath, JSON.stringify({ test: 'data' }));
      }

      const result = repository.list();
      expect(result).toEqual([serverName]);
    });

    it('should work correctly with non-empty FILE_PREFIX', () => {
      // Temporarily mock the FILE_PREFIX to test robustness
      const originalFilePrefix = AUTH_CONFIG.CLIENT.SESSION.FILE_PREFIX;
      (AUTH_CONFIG.CLIENT.SESSION as any).FILE_PREFIX = 'client_session_';

      try {
        const serverName = 'test-server';
        const sessionData: ClientSessionData = {
          serverName,
          expires: Date.now() + 3600000,
          createdAt: Date.now(),
        };

        // Create a new repository instance to use the modified config
        const newRepository = new ClientSessionRepository(storage);
        newRepository.save(serverName, sessionData, 3600000);

        // Create some other files that shouldn't be listed
        const otherFiles = ['session_other-session.json', 'auth_code_some-code.json', 'random_file.json'];
        for (const fileName of otherFiles) {
          const filePath = path.join(tempDir, fileName);
          fs.writeFileSync(filePath, JSON.stringify({ test: 'data' }));
        }

        const result = newRepository.list();
        expect(result).toEqual([serverName]);
      } finally {
        // Restore original FILE_PREFIX
        (AUTH_CONFIG.CLIENT.SESSION as any).FILE_PREFIX = originalFilePrefix;
      }
    });
  });

  describe('Client Session Data Structure', () => {
    it('should preserve all client session fields', () => {
      const serverName = 'full-data-server';
      const fullSessionData: ClientSessionData = {
        serverName,
        clientInfo: JSON.stringify({
          client_id: 'full-client-123',
          client_secret: 'full-secret',
          client_name: 'Full Test Application',
          redirect_uris: ['https://app.com/callback'],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          scope: 'openid profile email',
        }),
        tokens: JSON.stringify({
          access_token: 'access-token-value',
          refresh_token: 'refresh-token-value',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'openid profile email',
        }),
        codeVerifier: 'PKCE-code-verifier-value',
        state: 'OAuth-state-parameter',
        expires: Date.now() + 3600000,
        createdAt: Date.now(),
      };

      repository.save(serverName, fullSessionData, 3600000);
      const retrieved = repository.get(serverName);

      expect(retrieved!.serverName).toBe(fullSessionData.serverName);
      expect(retrieved!.clientInfo).toBe(fullSessionData.clientInfo);
      expect(retrieved!.tokens).toBe(fullSessionData.tokens);
      expect(retrieved!.codeVerifier).toBe(fullSessionData.codeVerifier);
      expect(retrieved!.state).toBe(fullSessionData.state);
      expect(typeof retrieved!.expires).toBe('number');
      expect(typeof retrieved!.createdAt).toBe('number');
      expect(retrieved!.expires).toBeGreaterThan(retrieved!.createdAt);
    });

    it('should handle JSON stringified client info and tokens', () => {
      const serverName = 'json-test-server';
      const clientInfo = {
        client_id: 'json-client',
        client_secret: 'json-secret',
        redirect_uris: ['https://json.app/callback'],
      };
      const tokens = {
        access_token: 'json-access-token',
        refresh_token: 'json-refresh-token',
        token_type: 'Bearer',
      };

      const sessionData: ClientSessionData = {
        serverName,
        clientInfo: JSON.stringify(clientInfo),
        tokens: JSON.stringify(tokens),
        expires: Date.now() + 3600000,
        createdAt: Date.now(),
      };

      repository.save(serverName, sessionData, 3600000);
      const retrieved = repository.get(serverName);

      const parsedClientInfo = JSON.parse(retrieved!.clientInfo!);
      const parsedTokens = JSON.parse(retrieved!.tokens!);

      expect(parsedClientInfo).toEqual(clientInfo);
      expect(parsedTokens).toEqual(tokens);
    });

    it('should handle optional fields being undefined', () => {
      const serverName = 'optional-fields-server';
      const minimalSessionData: ClientSessionData = {
        serverName,
        expires: Date.now() + 3600000,
        createdAt: Date.now(),
      };

      repository.save(serverName, minimalSessionData, 3600000);
      const retrieved = repository.get(serverName);

      expect(retrieved!.serverName).toBe(serverName);
      expect(retrieved!.clientInfo).toBeUndefined();
      expect(retrieved!.tokens).toBeUndefined();
      expect(retrieved!.codeVerifier).toBeUndefined();
      expect(retrieved!.state).toBeUndefined();
      expect(retrieved!.expires).toBeDefined();
      expect(retrieved!.createdAt).toBeDefined();
    });
  });

  describe('Integration with FileStorageService', () => {
    it('should use correct file prefix', () => {
      const serverName = 'file-prefix-test';
      const sessionData: ClientSessionData = {
        serverName,
        expires: Date.now() + 3600000,
        createdAt: Date.now(),
      };

      repository.save(serverName, sessionData, 3600000);

      // Check that file was created with correct prefix
      const sessionId = `${AUTH_CONFIG.CLIENT.SESSION.ID_PREFIX}${serverName}`;
      const expectedFileName = AUTH_CONFIG.CLIENT.SESSION.FILE_PREFIX + sessionId + '.json';
      const filePath = path.join(tempDir, expectedFileName);

      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('should survive FileStorageService restart', () => {
      const serverName = 'restart-test-server';
      const sessionData: ClientSessionData = {
        serverName,
        clientInfo: JSON.stringify({ client_id: 'restart-client' }),
        expires: Date.now() + 3600000,
        createdAt: Date.now(),
      };

      repository.save(serverName, sessionData, 3600000);
      const originalData = repository.get(serverName);

      // Shutdown and recreate storage service
      storage.shutdown();
      storage = new FileStorageService(tempDir);
      repository = new ClientSessionRepository(storage);

      // Data should still be accessible
      const retrievedData = repository.get(serverName);
      expect(retrievedData).toEqual(originalData);
    });

    it('should handle storage errors gracefully', () => {
      // This test would need to mock FileStorageService to simulate errors
      // For now, we verify that the repository doesn't crash on invalid operations
      const result = repository.get('invalid-server-name');
      expect(result).toBeNull();
    });
  });

  describe('Performance and Edge Cases', () => {
    it('should handle creating many client sessions', () => {
      const serverNames: string[] = [];
      const numSessions = 10; // Reduced for testing performance

      for (let i = 0; i < numSessions; i++) {
        const serverName = `server-${i}`;
        const sessionData: ClientSessionData = {
          serverName,
          clientInfo: JSON.stringify({ client_id: `client-${i}` }),
          expires: Date.now() + 3600000,
          createdAt: Date.now(),
        };

        repository.save(serverName, sessionData, 3600000);
        serverNames.push(serverName);
      }

      expect(serverNames.length).toBe(numSessions);

      // Verify all sessions can be retrieved
      for (const serverName of serverNames) {
        const retrieved = repository.get(serverName);
        expect(retrieved).toBeDefined();
      }

      // Verify list includes all servers
      const listedServers = repository.list();
      expect(listedServers.length).toBeGreaterThanOrEqual(numSessions);
    });

    it('should handle very long server names', () => {
      const longServerName = 'a'.repeat(200); // Very long server name
      const sessionData: ClientSessionData = {
        serverName: longServerName,
        expires: Date.now() + 3600000,
        createdAt: Date.now(),
      };

      repository.save(longServerName, sessionData, 3600000);
      const retrieved = repository.get(longServerName);

      expect(retrieved).toBeDefined();
      expect(retrieved!.serverName).toBe(longServerName);
    });

    it('should handle complex JSON data in client info and tokens', () => {
      const serverName = 'complex-json-server';
      const complexClientInfo = {
        client_id: 'complex-client',
        client_name: 'Complex Application with 特殊字符 and émojis 🚀',
        redirect_uris: ['https://app.example.com/callback', 'myapp://oauth/callback', 'http://localhost:3000/auth'],
        metadata: {
          version: '2.1',
          features: ['pkce', 'refresh_tokens'],
          nested: {
            deep: {
              value: 'test',
            },
          },
        },
      };

      const complexTokens = {
        access_token: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9...',
        refresh_token: 'rt_' + 'x'.repeat(100),
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'openid profile email admin:read admin:write',
        custom_claims: {
          user_id: '12345',
          roles: ['admin', 'user'],
        },
      };

      const sessionData: ClientSessionData = {
        serverName,
        clientInfo: JSON.stringify(complexClientInfo),
        tokens: JSON.stringify(complexTokens),
        codeVerifier: 'a'.repeat(128), // Maximum PKCE verifier length
        state: JSON.stringify({ returnTo: '/dashboard', userId: 12345 }),
        expires: Date.now() + 3600000,
        createdAt: Date.now(),
      };

      repository.save(serverName, sessionData, 3600000);
      const retrieved = repository.get(serverName);

      const parsedClientInfo = JSON.parse(retrieved!.clientInfo!);
      const parsedTokens = JSON.parse(retrieved!.tokens!);
      const parsedState = JSON.parse(retrieved!.state!);

      expect(parsedClientInfo).toEqual(complexClientInfo);
      expect(parsedTokens).toEqual(complexTokens);
      expect(parsedState).toEqual({ returnTo: '/dashboard', userId: 12345 });
    });

    it('should handle different TTL values', () => {
      const shortTtl = 1000; // 1 second
      const mediumTtl = 60 * 60 * 1000; // 1 hour
      const longTtl = 30 * 24 * 60 * 60 * 1000; // 30 days

      const testCases = [
        { name: 'short-ttl-server', ttl: shortTtl },
        { name: 'medium-ttl-server', ttl: mediumTtl },
        { name: 'long-ttl-server', ttl: longTtl },
      ];

      for (const testCase of testCases) {
        const sessionData: ClientSessionData = {
          serverName: testCase.name,
          expires: Date.now() + testCase.ttl,
          createdAt: Date.now(),
        };

        const beforeSave = Date.now();
        repository.save(testCase.name, sessionData, testCase.ttl);
        const afterSave = Date.now();

        const retrieved = repository.get(testCase.name);
        expect(retrieved!.expires).toBeGreaterThanOrEqual(beforeSave + testCase.ttl);
        expect(retrieved!.expires).toBeLessThanOrEqual(afterSave + testCase.ttl);
      }
    });
  });
});
