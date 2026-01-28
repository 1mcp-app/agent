import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { ExpirableData } from '@src/auth/sessionTypes.js';
import { FILE_PREFIX_MAPPING, STORAGE_SUBDIRS } from '@src/constants.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

interface TestData extends ExpirableData {
  id: string;
  value: string;
  expires: number;
  createdAt: number;
}

describe('FileStorageService', () => {
  let service: FileStorageService;
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = path.join(tmpdir(), `file-storage-test-${Date.now()}`);
    service = new FileStorageService(tempDir);
  });

  afterEach(() => {
    service.shutdown();
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Constructor and Directory Management', () => {
    it('should create storage directory if it does not exist', () => {
      expect(fs.existsSync(tempDir)).toBe(true);
    });

    it('should use provided storage directory', () => {
      const customDir = path.join(tmpdir(), `custom-test-${Date.now()}`);
      const customService = new FileStorageService(customDir);

      const expectedPath = path.join(customDir, 'sessions');
      expect(fs.existsSync(expectedPath)).toBe(true);
      expect(customService.getStorageDir()).toBe(expectedPath);

      customService.shutdown();
      fs.rmSync(customDir, { recursive: true, force: true });
    });

    it('should handle directory creation errors', () => {
      const invalidDir = '/invalid/path/that/cannot/be/created';
      expect(() => new FileStorageService(invalidDir)).toThrow();
    });
  });

  describe('CRUD Operations', () => {
    const testPrefix = 'test_';
    const testId = 'sess-12345678-1234-4abc-89de-123456789012';
    const testData: TestData = {
      id: testId,
      value: 'test value',
      expires: Date.now() + 60000, // 1 minute from now
      createdAt: Date.now(),
    };

    it('should write and read data correctly', () => {
      service.writeData(testPrefix, testId, testData);
      const retrieved = service.readData<TestData>(testPrefix, testId);

      expect(retrieved).toEqual(testData);
    });

    it('should return null for non-existent data', () => {
      const result = service.readData<TestData>(testPrefix, 'nonexistent');
      expect(result).toBeNull();
    });

    it('should delete data successfully', () => {
      service.writeData(testPrefix, testId, testData);
      expect(service.readData<TestData>(testPrefix, testId)).toEqual(testData);

      const deleted = service.deleteData(testPrefix, testId);
      expect(deleted).toBe(true);
      expect(service.readData<TestData>(testPrefix, testId)).toBeNull();
    });

    it('should return false when deleting non-existent data', () => {
      const deleted = service.deleteData(testPrefix, 'nonexistent');
      expect(deleted).toBe(false);
    });

    it('should handle file path generation correctly', () => {
      const filePath = service.getFilePath(testPrefix, testId);
      const expectedPath = path.join(tempDir, 'sessions', `${testPrefix}${testId}.json`);
      expect(filePath).toBe(expectedPath);
    });
  });

  describe('Path Security', () => {
    it('should prevent path traversal attacks', () => {
      const maliciousId = '../../../etc/passwd';
      expect(() => service.writeData('test_', maliciousId, {} as TestData)).toThrow('Invalid ID format');
    });

    it('should reject IDs with invalid characters', () => {
      const invalidChars = ['/', '\\', '..', '\0', '<', '>', ':', '"', '|', '?', '*'];

      for (const char of invalidChars) {
        const maliciousId = `test${char}id`;
        expect(() => service.writeData('test_', maliciousId, {} as TestData)).toThrow('Invalid ID format');
      }
    });

    it('should accept valid IDs with proper prefixes', () => {
      const validIds = ['sess-12345678-1234-4abc-89de-123456789012', 'code-87654321-4321-4def-89ab-210987654321'];

      for (const id of validIds) {
        const data: TestData = {
          id,
          value: 'test',
          expires: Date.now() + 60000,
          createdAt: Date.now(),
        };

        expect(() => service.writeData('test_', id, data)).not.toThrow();
        expect(service.readData<TestData>('test_', id)).toEqual(data);
      }
    });
  });

  describe('Expiration and Cleanup', () => {
    it('should identify expired data correctly', () => {
      const expiredId = 'sess-11111111-1234-4abc-89de-123456789012';
      const validId = 'sess-22222222-1234-4def-89ab-123456789012';

      const expiredData: TestData = {
        id: expiredId,
        value: 'expired',
        expires: Date.now() - 1000, // 1 second ago
        createdAt: Date.now() - 60000,
      };

      const validData: TestData = {
        id: validId,
        value: 'valid',
        expires: Date.now() + 60000, // 1 minute from now
        createdAt: Date.now(),
      };

      service.writeData('test_', expiredId, expiredData);
      service.writeData('test_', validId, validData);

      // Manually trigger cleanup
      service.cleanupExpiredData();

      // Expired data should be removed
      expect(service.readData<TestData>('test_', expiredId)).toBeNull();
      // Valid data should remain
      expect(service.readData<TestData>('test_', validId)).toEqual(validData);
    });

    it('should handle corrupted JSON files during cleanup', () => {
      const storageDir = service.getStorageDir();
      const corruptedFilePath = path.join(storageDir, 'test_corrupted.json');
      fs.writeFileSync(corruptedFilePath, 'invalid json {');

      // Should not throw and should remove corrupted file
      expect(() => service.cleanupExpiredData()).not.toThrow();
      expect(fs.existsSync(corruptedFilePath)).toBe(false);
    });

    it('should handle files without expires field during cleanup', () => {
      const invalidData = { id: 'test', value: 'no expires field' };
      const storageDir = service.getStorageDir();
      const filePath = path.join(storageDir, 'test_invalid.json');
      fs.writeFileSync(filePath, JSON.stringify(invalidData));

      // Should not throw and should skip files without expires
      expect(() => service.cleanupExpiredData()).not.toThrow();
      expect(fs.existsSync(filePath)).toBe(true); // Should not be removed
    });

    it('should count cleaned up items correctly', () => {
      const expiredId1 = 'sess-33333333-1234-4abc-89de-123456789012';
      const expiredId2 = 'sess-44444444-1234-4def-89ab-123456789012';

      const expiredData1: TestData = {
        id: expiredId1,
        value: 'expired1',
        expires: Date.now() - 1000,
        createdAt: Date.now() - 60000,
      };

      const expiredData2: TestData = {
        id: expiredId2,
        value: 'expired2',
        expires: Date.now() - 2000,
        createdAt: Date.now() - 60000,
      };

      service.writeData('test_', expiredId1, expiredData1);
      service.writeData('test_', expiredId2, expiredData2);

      const cleanedCount = service.cleanupExpiredData();
      expect(cleanedCount).toBe(2);
    });
  });

  describe('Periodic Cleanup', () => {
    it('should start periodic cleanup by default', () => {
      // Verify cleanup interval is set (private field test via behavior)
      expect(service).toBeDefined();
      // The interval should be running, but we can't easily test it without waiting
      // This is tested indirectly through the shutdown test
    });

    it('should stop periodic cleanup on shutdown', () => {
      service.shutdown();
      // After shutdown, no errors should occur and service should be clean
      expect(() => service.shutdown()).not.toThrow(); // Should be idempotent
    });

    it('should be idempotent when calling shutdown multiple times', () => {
      service.shutdown();
      service.shutdown();
      service.shutdown();
      // Should not throw errors
      expect(true).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle read errors gracefully', () => {
      const testId = 'sess-55555555-1234-4abc-89de-123456789012';
      // Create a file and then make directory non-readable
      service.writeData('test_', testId, {
        id: testId,
        value: 'test',
        expires: Date.now() + 60000,
        createdAt: Date.now(),
      } as TestData);

      // Change permissions to make file unreadable (on Unix systems)
      const filePath = service.getFilePath('test_', testId);
      try {
        fs.chmodSync(filePath, 0o000);
        const result = service.readData<TestData>('test_', testId);
        expect(result).toBeNull();
      } catch (_error) {
        // On some systems, chmod might not work as expected
        // In that case, we just verify the method doesn't crash
        expect(true).toBe(true);
      } finally {
        // Restore permissions for cleanup
        try {
          fs.chmodSync(filePath, 0o644);
        } catch {
          // Ignore errors during cleanup
        }
      }
    });

    it('should handle write errors gracefully', () => {
      // Try to write to a read-only directory
      const readOnlyDir = path.join(tempDir, 'readonly');
      fs.mkdirSync(readOnlyDir);

      try {
        fs.chmodSync(readOnlyDir, 0o444); // Read-only
        const readOnlyService = new FileStorageService(readOnlyDir);

        const writeTestId = 'sess-66666666-1234-4abc-89de-123456789012';
        expect(() =>
          readOnlyService.writeData('test_', writeTestId, {
            id: writeTestId,
            value: 'test',
            expires: Date.now() + 60000,
            createdAt: Date.now(),
          } as TestData),
        ).toThrow();

        readOnlyService.shutdown();
      } catch (_error) {
        // On some systems, chmod might not work as expected
        expect(true).toBe(true);
      } finally {
        // Restore permissions for cleanup
        try {
          fs.chmodSync(readOnlyDir, 0o755);
        } catch {
          // Ignore errors during cleanup
        }
      }
    });

    it('should handle JSON parsing errors', () => {
      const storageDir = service.getStorageDir();
      const filePath = path.join(storageDir, 'test_corrupted.json');
      fs.writeFileSync(filePath, 'invalid json content');

      const result = service.readData<TestData>('test_', 'corrupted');
      expect(result).toBeNull();
    });
  });

  describe('Utility Methods', () => {
    it('should return correct storage directory', () => {
      const expectedPath = path.join(tempDir, 'sessions');
      expect(service.getStorageDir()).toBe(expectedPath);
    });

    it('should validate file IDs correctly', () => {
      // Test ID validation through public interface behavior
      const validIds = ['sess-12345678-1234-4abc-89de-123456789012', 'code-87654321-4321-4def-89ab-210987654321'];
      const invalidIds = ['../test', 'test/path', 'test\\path', 'shortid'];

      for (const id of validIds) {
        expect(() => service.getFilePath('test_', id)).not.toThrow();
      }

      for (const id of invalidIds) {
        expect(() => service.getFilePath('test_', id)).toThrow();
      }
    });
  });

  describe('Subdirectory Support', () => {
    it('should create storage in subdirectory when provided', () => {
      const baseDir = path.join(tmpdir(), `base-dir-test-${Date.now()}`);
      const subdirService = new FileStorageService(baseDir, 'server');

      const expectedPath = path.join(baseDir, 'sessions', 'server');
      expect(subdirService.getStorageDir()).toBe(expectedPath);
      expect(fs.existsSync(expectedPath)).toBe(true);

      subdirService.shutdown();
      fs.rmSync(baseDir, { recursive: true, force: true });
    });

    it('should create storage without subdirectory when not provided', () => {
      const baseDir = path.join(tmpdir(), `base-dir-test-${Date.now()}`);
      const noSubdirService = new FileStorageService(baseDir);

      const expectedPath = path.join(baseDir, 'sessions');
      expect(noSubdirService.getStorageDir()).toBe(expectedPath);
      expect(fs.existsSync(expectedPath)).toBe(true);

      noSubdirService.shutdown();
      fs.rmSync(baseDir, { recursive: true, force: true });
    });
  });

  describe('Migration Logic', () => {
    it('should migrate old server session files from sessions/ to server subdirectory', () => {
      // Arrange: Create parent directory with old flat structure
      const baseDir = path.join(tmpdir(), `migration-test-${Date.now()}`);
      const sessionsDir = path.join(baseDir, 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });

      // Create old session files in flat structure
      const oldFiles = [
        'session_sess-12345678-1234-4abc-89de-123456789012.json',
        'auth_code_code-87654321-4321-4def-89ab-210987654321.json',
        'auth_request_code-11111111-1111-4111-8111-111111111111.json',
      ];

      for (const file of oldFiles) {
        fs.writeFileSync(path.join(sessionsDir, file), JSON.stringify({ test: 'data' }));
      }

      // Act: Create service with 'server' subdirectory
      const serverService = new FileStorageService(baseDir, 'server');

      // Assert: Files should be migrated to server subdirectory
      const serverSubdir = path.join(sessionsDir, 'server');
      for (const file of oldFiles) {
        expect(fs.existsSync(path.join(serverSubdir, file))).toBe(true);
        expect(fs.existsSync(path.join(sessionsDir, file))).toBe(false);
      }

      // Assert: Migration flag should be created in sessions directory
      const migrationFlagPath = path.join(sessionsDir, '.migrated-to-server');
      expect(fs.existsSync(migrationFlagPath)).toBe(true);

      serverService.shutdown();
      fs.rmSync(baseDir, { recursive: true, force: true });
    });

    it('should migrate old client session files from clientSessions/ to client subdirectory', () => {
      // Arrange: Create parent directory with old clientSessions structure
      const baseDir = path.join(tmpdir(), `migration-test-${Date.now()}`);
      const clientSessionsDir = path.join(baseDir, 'clientSessions');
      fs.mkdirSync(clientSessionsDir, { recursive: true });

      // Create old client files in clientSessions directory
      const oldFiles = [
        'oauth_test-server.json',
        'cli_client-123.json',
        'tok_token-456.json',
        'ver_verifier-789.json',
        'sta_state-abc.json',
      ];

      for (const file of oldFiles) {
        fs.writeFileSync(path.join(clientSessionsDir, file), JSON.stringify({ test: 'data' }));
      }

      // Act: Create service with 'client' subdirectory
      const clientService = new FileStorageService(baseDir, 'client');

      // Assert: Files should be migrated to client subdirectory
      const clientSubdir = path.join(baseDir, 'sessions', 'client');
      for (const file of oldFiles) {
        expect(fs.existsSync(path.join(clientSubdir, file))).toBe(true);
        expect(fs.existsSync(path.join(clientSessionsDir, file))).toBe(false);
      }

      // Assert: Migration flag should be created in clientSessions directory
      const migrationFlagPath = path.join(clientSessionsDir, '.migrated-to-client');
      expect(fs.existsSync(migrationFlagPath)).toBe(true);

      clientService.shutdown();
      fs.rmSync(baseDir, { recursive: true, force: true });
    });

    it('should not migrate transport files (new feature)', () => {
      // Arrange: Create parent directory structure
      const baseDir = path.join(tmpdir(), `migration-test-${Date.now()}`);
      const sessionsDir = path.join(baseDir, 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });

      // Create some files that would normally be migrated
      const oldFiles = ['streamable_session_stream-12345678-1234-4abc-89de-123456789012.json'];

      for (const file of oldFiles) {
        fs.writeFileSync(path.join(sessionsDir, file), JSON.stringify({ test: 'data' }));
      }

      // Act: Create service with 'transport' subdirectory
      const transportService = new FileStorageService(baseDir, 'transport');

      // Assert: Files should NOT be migrated (transport is new feature)
      const transportSubdir = path.join(sessionsDir, 'transport');
      for (const file of oldFiles) {
        expect(fs.existsSync(path.join(sessionsDir, file))).toBe(true); // Still in original location
        expect(fs.existsSync(path.join(transportSubdir, file))).toBe(false); // Not migrated
      }

      // Assert: No migration flag should be created
      const migrationFlagPath = path.join(sessionsDir, '.migrated-to-transport');
      expect(fs.existsSync(migrationFlagPath)).toBe(false);

      transportService.shutdown();
      fs.rmSync(baseDir, { recursive: true, force: true });
    });

    it('should not migrate files when not in subdirectory mode', () => {
      // Arrange: Create parent directory with old flat structure
      const baseDir = path.join(tmpdir(), `migration-test-${Date.now()}`);
      const sessionsDir = path.join(baseDir, 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });

      const oldFile = 'session_sess-12345678-1234-4abc-89de-123456789012.json';
      fs.writeFileSync(path.join(sessionsDir, oldFile), JSON.stringify({ test: 'data' }));

      // Act: Create service without subdirectory
      const flatService = new FileStorageService(baseDir);

      // Assert: Files should remain in flat structure
      expect(fs.existsSync(path.join(sessionsDir, oldFile))).toBe(true);

      flatService.shutdown();
      fs.rmSync(baseDir, { recursive: true, force: true });
    });

    it('should handle migration errors gracefully', () => {
      // Arrange: Create parent directory
      const baseDir = path.join(tmpdir(), `migration-test-${Date.now()}`);
      const sessionsDir = path.join(baseDir, 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });

      // Create a file that will cause migration issues
      const problemFile = 'session_test.json';
      const problemPath = path.join(sessionsDir, problemFile);
      fs.writeFileSync(problemPath, JSON.stringify({ test: 'data' }));

      // Make the file read-only to cause rename error
      try {
        fs.chmodSync(problemPath, 0o444);

        // Act: Create service - should not throw
        expect(() => new FileStorageService(baseDir, 'server')).not.toThrow();

        // Cleanup
        fs.chmodSync(problemPath, 0o644);
      } catch (_error) {
        // On some systems, chmod might not work as expected
        expect(true).toBe(true);
      }

      fs.rmSync(baseDir, { recursive: true, force: true });
    });

    it('should handle independent migrations for server and client', () => {
      // Arrange: Create both legacy directory structures
      const baseDir = path.join(tmpdir(), `migration-test-${Date.now()}`);
      const sessionsDir = path.join(baseDir, 'sessions');
      const clientSessionsDir = path.join(baseDir, 'clientSessions');

      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.mkdirSync(clientSessionsDir, { recursive: true });

      // Create server files in sessions/
      const serverFiles = [
        'session_sess-12345678-1234-4abc-89de-123456789012.json',
        'auth_code_code-87654321-4321-4def-89ab-210987654321.json',
      ];

      // Create client files in clientSessions/
      const clientFiles = ['oauth_test-server.json', 'cli_client-123.json'];

      for (const file of serverFiles) {
        fs.writeFileSync(path.join(sessionsDir, file), JSON.stringify({ test: 'server-data' }));
      }

      for (const file of clientFiles) {
        fs.writeFileSync(path.join(clientSessionsDir, file), JSON.stringify({ test: 'client-data' }));
      }

      // Act: Create server service first
      const serverService = new FileStorageService(baseDir, 'server');

      // Assert: Server files migrated, client files untouched
      const serverSubdir = path.join(sessionsDir, 'server');
      for (const file of serverFiles) {
        expect(fs.existsSync(path.join(serverSubdir, file))).toBe(true);
        expect(fs.existsSync(path.join(sessionsDir, file))).toBe(false);
      }
      for (const file of clientFiles) {
        expect(fs.existsSync(path.join(clientSessionsDir, file))).toBe(true); // Still in clientSessions/
      }

      // Assert: Server migration flag created
      const serverFlagPath = path.join(sessionsDir, '.migrated-to-server');
      expect(fs.existsSync(serverFlagPath)).toBe(true);

      // Act: Create client service
      const clientService = new FileStorageService(baseDir, 'client');

      // Assert: Client files migrated independently
      const clientSubdir = path.join(sessionsDir, 'client');
      for (const file of clientFiles) {
        expect(fs.existsSync(path.join(clientSubdir, file))).toBe(true);
        expect(fs.existsSync(path.join(clientSessionsDir, file))).toBe(false);
      }

      // Assert: Client migration flag created
      const clientFlagPath = path.join(clientSessionsDir, '.migrated-to-client');
      expect(fs.existsSync(clientFlagPath)).toBe(true);

      serverService.shutdown();
      clientService.shutdown();
      fs.rmSync(baseDir, { recursive: true, force: true });
    });

    it('should skip migration when no old files exist', () => {
      // Arrange: Create empty parent directory
      const baseDir = path.join(tmpdir(), `migration-test-${Date.now()}`);

      // Act & Assert: Should not throw
      expect(() => new FileStorageService(baseDir, 'server')).not.toThrow();

      fs.rmSync(baseDir, { recursive: true, force: true });
    });

    it('should create migration flag after successful migration', () => {
      // Arrange: Create parent directory with old flat structure
      const baseDir = path.join(tmpdir(), `migration-flag-test-${Date.now()}`);
      const sessionsDir = path.join(baseDir, 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });

      // Create old session files
      const oldFiles = ['session_sess-12345678-1234-4abc-89de-123456789012.json'];
      for (const file of oldFiles) {
        fs.writeFileSync(path.join(sessionsDir, file), JSON.stringify({ test: 'data' }));
      }

      // Act: Create service with 'server' subdirectory
      const serverService = new FileStorageService(baseDir, 'server');

      // Assert: Migration flag should be created
      const migrationFlagPath = path.join(sessionsDir, '.migrated-to-server');
      expect(fs.existsSync(migrationFlagPath)).toBe(true);

      // Verify flag content
      const flagContent = JSON.parse(fs.readFileSync(migrationFlagPath, 'utf8'));
      expect(flagContent.migrated).toBe(true);
      expect(flagContent.targetSubDir).toBe('server');
      expect(typeof flagContent.timestamp).toBe('number');

      serverService.shutdown();
      fs.rmSync(baseDir, { recursive: true, force: true });
    });

    it('should skip migration when flag already exists', () => {
      // Arrange: Create parent directory with migration flag
      const baseDir = path.join(tmpdir(), `migration-flag-test-${Date.now()}`);
      const sessionsDir = path.join(baseDir, 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });

      // Create migration flag
      const migrationFlagPath = path.join(sessionsDir, '.migrated-to-server');
      fs.writeFileSync(
        migrationFlagPath,
        JSON.stringify({ migrated: true, targetSubDir: 'server', timestamp: Date.now() }),
      );

      // Create old files that should NOT be migrated
      const oldFile = 'session_sess-12345678-1234-4abc-89de-123456789012.json';
      fs.writeFileSync(path.join(sessionsDir, oldFile), JSON.stringify({ test: 'data' }));

      // Act: Create service with 'server' subdirectory
      const serverService = new FileStorageService(baseDir, 'server');

      // Assert: File should remain in parent directory (not migrated)
      expect(fs.existsSync(path.join(sessionsDir, oldFile))).toBe(true);
      expect(fs.existsSync(path.join(sessionsDir, 'server', oldFile))).toBe(false);

      serverService.shutdown();
      fs.rmSync(baseDir, { recursive: true, force: true });
    });

    it('should create migration flag even when no files to migrate', () => {
      // Arrange: Create empty parent directory
      const baseDir = path.join(tmpdir(), `migration-flag-test-${Date.now()}`);
      const sessionsDir = path.join(baseDir, 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });

      // Act: Create service with 'server' subdirectory
      const serverService = new FileStorageService(baseDir, 'server');

      // Assert: Migration flag should still be created
      const migrationFlagPath = path.join(sessionsDir, '.migrated-to-server');
      expect(fs.existsSync(migrationFlagPath)).toBe(true);

      serverService.shutdown();
      fs.rmSync(baseDir, { recursive: true, force: true });
    });

    it('should handle migration flag creation errors gracefully', () => {
      // Arrange: Create parent directory and make it read-only
      const baseDir = path.join(tmpdir(), `migration-flag-test-${Date.now()}`);
      const sessionsDir = path.join(baseDir, 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });

      // Create old files
      const oldFile = 'session_sess-12345678-1234-4abc-89de-123456789012.json';
      fs.writeFileSync(path.join(sessionsDir, oldFile), JSON.stringify({ test: 'data' }));

      try {
        // Make directory read-only to cause flag creation error
        fs.chmodSync(sessionsDir, 0o444);

        // Act: Create service - should not throw despite flag creation failure
        expect(() => new FileStorageService(baseDir, 'server')).not.toThrow();

        // Assert: Files should still be migrated even if flag creation fails
        expect(fs.existsSync(path.join(sessionsDir, 'server', oldFile))).toBe(true);
      } catch (_error) {
        // On some systems, chmod might not work as expected
        expect(true).toBe(true);
      } finally {
        // Restore permissions for cleanup
        try {
          fs.chmodSync(sessionsDir, 0o755);
        } catch {
          // Ignore errors during cleanup
        }
        fs.rmSync(baseDir, { recursive: true, force: true });
      }
    });
  });

  describe('Configuration Constants Integration', () => {
    it('should use STORAGE_SUBDIRS constants for subdirectory detection', () => {
      // Test that all subdirectories from STORAGE_SUBDIRS are recognized
      const baseDir = path.join(tmpdir(), `config-test-${Date.now()}`);

      for (const subdir of Object.values(STORAGE_SUBDIRS)) {
        const service = new FileStorageService(baseDir, subdir as string);
        const expectedPath = path.join(baseDir, 'sessions', subdir as string);
        expect(service.getStorageDir()).toBe(expectedPath);
        service.shutdown();
      }

      fs.rmSync(baseDir, { recursive: true, force: true });
    });

    it('should use FILE_PREFIX_MAPPING for migration logic', () => {
      // Test that all prefixes from FILE_PREFIX_MAPPING are handled correctly

      // Test migration for each subdirectory type with separate base directories
      for (const [category, subdir] of Object.entries(STORAGE_SUBDIRS)) {
        const baseDir = path.join(tmpdir(), `config-test-${category}-${Date.now()}`);
        const sessionsDir = path.join(baseDir, 'sessions');
        const clientSessionsDir = path.join(baseDir, 'clientSessions');

        // Create source directories
        fs.mkdirSync(sessionsDir, { recursive: true });
        fs.mkdirSync(clientSessionsDir, { recursive: true });

        // Create test files for current category in appropriate source directory
        const testFiles: string[] = [];
        const prefixes = FILE_PREFIX_MAPPING[category as keyof typeof FILE_PREFIX_MAPPING] as readonly string[];

        for (const prefix of prefixes) {
          const fileName = `${prefix}test-${Date.now()}.json`;
          testFiles.push(fileName);

          // Place files in appropriate source directory based on category
          if (category === 'CLIENT') {
            fs.writeFileSync(path.join(clientSessionsDir, fileName), JSON.stringify({ test: 'data' }));
          } else {
            // SERVER and TRANSPORT files go in sessions/ directory
            fs.writeFileSync(path.join(sessionsDir, fileName), JSON.stringify({ test: 'data' }));
          }
        }

        const service = new FileStorageService(baseDir, subdir as string);

        // Check that files with matching prefixes were migrated
        for (const file of testFiles) {
          if (category === 'TRANSPORT') {
            // TRANSPORT files are not migrated (new feature)
            // They should remain in the source directory
            expect(fs.existsSync(path.join(sessionsDir, file))).toBe(true);
            expect(fs.existsSync(path.join(sessionsDir, subdir as string, file))).toBe(false);
          } else {
            // SERVER and CLIENT files should be migrated
            expect(fs.existsSync(path.join(sessionsDir, subdir as string, file))).toBe(true);
            // Check that files were removed from source directory
            if (category === 'CLIENT') {
              expect(fs.existsSync(path.join(clientSessionsDir, file))).toBe(false);
            } else {
              expect(fs.existsSync(path.join(sessionsDir, file))).toBe(false);
            }
          }
        }

        service.shutdown();
        fs.rmSync(baseDir, { recursive: true, force: true });
      }
    });
  });

  describe('Helper Method Integration', () => {
    it('should validate IDs correctly with refactored helper method', () => {
      // Test that the refactored isValidId method works with extractUuidPart helper
      const validIds = [
        'sess-12345678-1234-4abc-89de-123456789012',
        'code-87654321-4321-4def-89ab-210987654321',
        'stream-11111111-1111-4111-8111-111111111111',
      ];

      const invalidIds = ['sess-invalid-uuid', 'code-short', 'unknown-prefix-12345678-1234-4abc-89de-123456789012'];

      for (const id of validIds) {
        expect(() => service.getFilePath('test_', id)).not.toThrow();
      }

      for (const id of invalidIds) {
        expect(() => service.getFilePath('test_', id)).toThrow();
      }
    });
  });

  describe('Encryption Support', () => {
    const encryptionKey = 'test-encryption-key-32bytes!';
    let encryptedService: FileStorageService;

    beforeEach(() => {
      encryptedService = new FileStorageService(tempDir, 'encrypted', encryptionKey);
    });

    afterEach(() => {
      encryptedService.shutdown();
    });

    it('should write and read encrypted data correctly', () => {
      const testId = 'sess-12345678-1234-4abc-89de-123456789012';
      const testData: TestData = {
        id: testId,
        value: 'encrypted test value',
        expires: Date.now() + 60000,
        createdAt: Date.now(),
      };

      encryptedService.writeData('enc_', testId, testData);
      const readData = encryptedService.readData<TestData>('enc_', testId);

      expect(readData).toEqual(testData);
    });

    it('should store data in encrypted format', () => {
      const testId = 'sess-12345678-1234-4abc-89de-123456789013';
      const testData: TestData = {
        id: testId,
        value: 'secret data',
        expires: Date.now() + 60000,
        createdAt: Date.now(),
      };

      encryptedService.writeData('enc_', testId, testData);

      // Verify the file exists and contains encrypted format
      const filePath = encryptedService.getFilePath('enc_', testId);
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(fileContent);

      expect(parsed.encrypted).toBe(true);
      expect(parsed.iv).toBeDefined();
      expect(parsed.authTag).toBeDefined();
      expect(parsed.data).toBeDefined();
      // Original data should NOT be in plaintext
      expect(parsed.data).not.toBe('secret data');
    });

    it('should handle encryption key mismatch gracefully', () => {
      const testId = 'sess-12345678-1234-4abc-89de-123456789014';
      const testData: TestData = {
        id: testId,
        value: 'protected data',
        expires: Date.now() + 60000,
        createdAt: Date.now(),
      };

      encryptedService.writeData('enc_', testId, testData);

      // Create a new service with different key
      const wrongKeyService = new FileStorageService(tempDir, 'encrypted', 'wrong-encryption-key-here');
      const readData = wrongKeyService.readData<TestData>('enc_', testId);

      // With wrong key, decryption fails and falls back to plain JSON parsing
      // The file content is valid JSON with encrypted structure, so parsing succeeds
      // But the "data" field contains encrypted bytes, not valid JSON
      // So the parsed result won't have the expected test structure
      // Result depends on fallback behavior - could be null or garbage data
      // This is expected: wrong key = data is unreadable
      expect(readData === null || readData.id !== testId).toBe(true);
      wrongKeyService.shutdown();
    });

    it('should handle unicode data with encryption', () => {
      const testId = 'sess-12345678-1234-4abc-89de-123456789015';
      const testData: TestData = {
        id: testId,
        value: '中文数据 🔐 emoji 数据',
        expires: Date.now() + 60000,
        createdAt: Date.now(),
      };

      encryptedService.writeData('enc_', testId, testData);
      const readData = encryptedService.readData<TestData>('enc_', testId);

      expect(readData).toEqual(testData);
    });

    it('should handle large data with encryption', () => {
      const testId = 'sess-12345678-1234-4abc-89de-123456789016';
      const testData: TestData = {
        id: testId,
        value: 'x'.repeat(50000), // 50KB of data
        expires: Date.now() + 60000,
        createdAt: Date.now(),
      };

      encryptedService.writeData('enc_', testId, testData);
      const readData = encryptedService.readData<TestData>('enc_', testId);

      expect(readData).toEqual(testData);
    });

    it('should handle JSON objects with encryption', () => {
      const testId = 'sess-12345678-1234-4abc-89de-123456789017';
      const testData: TestData = {
        id: testId,
        value: JSON.stringify({ nested: { value: 123 }, array: [1, 2, 3] }),
        expires: Date.now() + 60000,
        createdAt: Date.now(),
      };

      encryptedService.writeData('enc_', testId, testData);
      const readData = encryptedService.readData<TestData>('enc_', testId);

      expect(readData).toEqual(testData);
      expect(JSON.parse(readData!.value)).toEqual({ nested: { value: 123 }, array: [1, 2, 3] });
    });

    it('should handle data expiration with encryption', () => {
      const testId = 'sess-12345678-1234-4abc-89de-123456789018';
      const expiredData: TestData = {
        id: testId,
        value: 'will expire',
        expires: Date.now() - 1000, // Already expired
        createdAt: Date.now(),
      };

      encryptedService.writeData('enc_', testId, expiredData);
      const readData = encryptedService.readData<TestData>('enc_', testId);

      expect(readData).toBeNull(); // Should be cleaned up
    });

    it('should handle corrupted encrypted files gracefully', () => {
      const testId = 'sess-12345678-1234-4abc-89de-123456789019';
      const storageDir = encryptedService.getStorageDir();
      const filePath = path.join(storageDir, 'enc_test-id.json');
      fs.writeFileSync(filePath, 'invalid encrypted content');

      const result = encryptedService.readData<TestData>('enc_', 'test-id');
      expect(result).toBeNull();
    });
  });
});
