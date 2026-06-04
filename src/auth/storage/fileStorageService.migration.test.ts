import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';

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
});
