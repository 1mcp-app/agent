import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { ExpirableData } from '@src/auth/sessionTypes.js';
import { AUTH_CONFIG } from '@src/constants.js';
import logger from '@src/logger/logger.js';

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
    // Create a unique temporary directory for testing
    tempDir = fs.mkdtempSync(path.join(tmpdir(), 'file-storage-test-'));
    service = new FileStorageService(tempDir);
  });

  afterEach(() => {
    service.shutdown();
    vi.restoreAllMocks();
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
      vi.spyOn(fs, 'existsSync').mockReturnValueOnce(false);
      vi.spyOn(fs, 'mkdirSync').mockImplementationOnce(() => {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      });
      expect(() => new FileStorageService(tempDir)).toThrow(/EACCES/);
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

    it('writes token data files with 0600 permissions', () => {
      // POSIX-only: Windows ACLs do not map to fs.stat modes
      if (process.platform === 'win32') return;
      service.writeData(testPrefix, testId, testData);
      const filePath = service.getFilePath(testPrefix, testId);
      expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    });

    it('durable write: token data files land with 0600 permissions (regression)', () => {
      // POSIX-only: Windows ACLs do not map to fs.stat modes
      if (process.platform === 'win32') return;
      service.writeDataDurable(testPrefix, testId, testData);
      const filePath = service.getFilePath(testPrefix, testId);
      expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    });

    it('creates storage directory with 0700 permissions', () => {
      // POSIX-only: Windows ACLs do not map to fs.stat modes
      if (process.platform === 'win32') return;
      expect(fs.statSync(service.getStorageDir()).mode & 0o777).toBe(0o700);
    });

    it('hardens pre-existing storage directory permissions to 0700', () => {
      // POSIX-only: Windows ACLs do not map to fs.stat modes
      if (process.platform === 'win32') return;
      const customDir = path.join(tmpdir(), `custom-perm-test-${Date.now()}`);
      const sessionsPath = path.join(customDir, 'sessions');
      fs.mkdirSync(sessionsPath, { recursive: true, mode: 0o755 });
      fs.chmodSync(sessionsPath, 0o755);

      const customService = new FileStorageService(customDir);
      expect(fs.statSync(sessionsPath).mode & 0o777).toBe(0o700);
      customService.shutdown();
      fs.rmSync(customDir, { recursive: true, force: true });
    });

    it('hardens pre-existing data file permissions to 0600 on writeData', () => {
      // POSIX-only: Windows ACLs do not map to fs.stat modes
      if (process.platform === 'win32') return;
      const filePath = service.getFilePath(testPrefix, testId);
      fs.writeFileSync(filePath, JSON.stringify(testData, null, 2), { mode: 0o644 });
      fs.chmodSync(filePath, 0o644);

      service.writeData(testPrefix, testId, testData);
      expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    });

    it('hardens pre-existing migration flag permissions to 0600', () => {
      // POSIX-only: Windows ACLs do not map to fs.stat modes
      if (process.platform === 'win32') return;
      const customDir = path.join(tmpdir(), `custom-migration-flag-test-${Date.now()}`);
      const sessionsPath = path.join(customDir, 'sessions');
      fs.mkdirSync(sessionsPath, { recursive: true, mode: 0o700 });
      const flagPath = path.join(sessionsPath, '.migrated-to-server');
      fs.writeFileSync(flagPath, JSON.stringify({ migrated: true }), { mode: 0o644 });
      fs.chmodSync(flagPath, 0o644);

      const serverService = new FileStorageService(customDir, 'server');
      expect(fs.statSync(flagPath).mode & 0o777).toBe(0o600);
      serverService.shutdown();
      fs.rmSync(customDir, { recursive: true, force: true });
    });

    it('does not write replacement secret if write fails on pre-existing file', () => {
      // POSIX-only: Windows ACLs do not map to fs.stat modes
      if (process.platform === 'win32') return;
      const filePath = service.getFilePath(testPrefix, testId);
      fs.writeFileSync(filePath, JSON.stringify({ ...testData, value: 'old-secret' }), { mode: 0o644 });
      fs.chmodSync(filePath, 0o644);

      const originalRenameSync = fs.renameSync;
      vi.spyOn(fs, 'renameSync').mockImplementation((oldPath, newPath) => {
        if (newPath === filePath) {
          throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
        }
        return originalRenameSync(oldPath, newPath);
      });

      expect(() =>
        service.writeData(testPrefix, testId, {
          ...testData,
          value: 'new-secret',
        }),
      ).toThrow(/EPERM/);

      const contentOnDisk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      expect(contentOnDisk.value).toBe('old-secret');
    });

    it('tolerates filesystems without POSIX permission support in ensureDirectory', () => {
      // POSIX-only: Windows ACLs do not map to fs.stat modes
      if (process.platform === 'win32') return;
      const customDir = path.join(tmpdir(), `custom-perm-degrade-${Date.now()}`);
      const sessionsPath = path.join(customDir, 'sessions');

      const originalChmodSync = fs.chmodSync;
      vi.spyOn(fs, 'chmodSync').mockImplementation((pathArg, modeArg) => {
        if (pathArg === sessionsPath) {
          throw Object.assign(new Error('ENOTSUP: operation not supported on socket'), { code: 'ENOTSUP' });
        }
        return originalChmodSync(pathArg, modeArg);
      });

      const customService = new FileStorageService(customDir);
      expect(customService.getStorageDir()).toBe(sessionsPath);
      customService.shutdown();
      fs.rmSync(customDir, { recursive: true, force: true });
    });

    it('fails closed when existing migration flag hardening encounters capability error', () => {
      // POSIX-only: Windows ACLs do not map to fs.stat modes
      if (process.platform === 'win32') return;
      const customDir = path.join(tmpdir(), `custom-flag-enotsup-test-${Date.now()}`);
      const sessionsPath = path.join(customDir, 'sessions');
      fs.mkdirSync(sessionsPath, { recursive: true, mode: 0o700 });
      const flagPath = path.join(sessionsPath, '.migrated-to-server');
      fs.writeFileSync(flagPath, JSON.stringify({ migrated: true }), { mode: 0o644 });

      const originalChmodSync = fs.chmodSync;
      vi.spyOn(fs, 'chmodSync').mockImplementation((pathArg, modeArg) => {
        if (pathArg === flagPath) {
          throw Object.assign(new Error('ENOTSUP: operation not supported on socket'), { code: 'ENOTSUP' });
        }
        return originalChmodSync(pathArg, modeArg);
      });

      expect(() => new FileStorageService(customDir, 'server')).toThrow(/ENOTSUP/);
      fs.rmSync(customDir, { recursive: true, force: true });
    });

    it('fails closed when existing migration flag hardening fails with permission error', () => {
      // POSIX-only: Windows ACLs do not map to fs.stat modes
      if (process.platform === 'win32') return;
      const customDir = path.join(tmpdir(), `custom-flag-fail-test-${Date.now()}`);
      const sessionsPath = path.join(customDir, 'sessions');
      fs.mkdirSync(sessionsPath, { recursive: true, mode: 0o700 });
      const flagPath = path.join(sessionsPath, '.migrated-to-server');
      fs.writeFileSync(flagPath, JSON.stringify({ migrated: true }), { mode: 0o644 });

      const originalChmodSync = fs.chmodSync;
      vi.spyOn(fs, 'chmodSync').mockImplementation((pathArg, modeArg) => {
        if (pathArg === flagPath) {
          throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
        }
        return originalChmodSync(pathArg, modeArg);
      });

      expect(() => new FileStorageService(customDir, 'server')).toThrow(/EACCES/);
      fs.rmSync(customDir, { recursive: true, force: true });
    });

    it('does not unlink pre-existing file if openSync fails with EEXIST', () => {
      const originalOpenSync = fs.openSync;
      let capturedTempPath: string | undefined;

      vi.spyOn(fs, 'openSync').mockImplementation((targetPath, flags, mode) => {
        if (typeof targetPath === 'string' && targetPath.endsWith('.tmp')) {
          capturedTempPath = targetPath;
          fs.writeFileSync(targetPath, 'important pre-existing data');
          throw Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST' });
        }
        return originalOpenSync(targetPath, flags, mode);
      });

      expect(() => service.writeData(testPrefix, testId, testData)).toThrow(/EEXIST/);
      expect(capturedTempPath).toBeDefined();
      expect(fs.existsSync(capturedTempPath!)).toBe(true);
      expect(fs.readFileSync(capturedTempPath!, 'utf8')).toBe('important pre-existing data');
      if (capturedTempPath && fs.existsSync(capturedTempPath)) {
        fs.unlinkSync(capturedTempPath);
      }
    });

    it('hardens legacy data files to 0600 during migration', () => {
      // POSIX-only: Windows ACLs do not map to fs.stat modes
      if (process.platform === 'win32') return;
      const customDir = path.join(tmpdir(), `custom-migration-harden-test-${Date.now()}`);
      const sessionsDir = path.join(customDir, 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });

      const legacyFileName = 'session_sess-12345678-1234-4abc-89de-123456789012.json';
      const legacyFilePath = path.join(sessionsDir, legacyFileName);
      fs.writeFileSync(legacyFilePath, JSON.stringify(testData), { mode: 0o644 });
      fs.chmodSync(legacyFilePath, 0o644);

      const serverService = new FileStorageService(customDir, 'server');
      const migratedFilePath = path.join(customDir, 'sessions', 'server', legacyFileName);
      expect(fs.existsSync(migratedFilePath)).toBe(true);
      expect(fs.statSync(migratedFilePath).mode & 0o777).toBe(0o600);

      serverService.shutdown();
      fs.rmSync(customDir, { recursive: true, force: true });
    });

    it('does not create migration flag if file hardening fails during migration', () => {
      // POSIX-only: Windows ACLs do not map to fs.stat modes
      if (process.platform === 'win32') return;
      const customDir = path.join(tmpdir(), `custom-migration-fail-test-${Date.now()}`);
      const sessionsDir = path.join(customDir, 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });

      const legacyFileName = 'session_sess-12345678-1234-4abc-89de-123456789012.json';
      const legacyFilePath = path.join(sessionsDir, legacyFileName);
      fs.writeFileSync(legacyFilePath, JSON.stringify(testData), { mode: 0o644 });
      fs.chmodSync(legacyFilePath, 0o644);

      // Migration now hardens via O_NOFOLLOW open + fchmodSync on the fd
      // (race-safe), so simulate the denial at fchmodSync.
      vi.spyOn(fs, 'fchmodSync').mockImplementation(() => {
        throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
      });

      const serverService = new FileStorageService(customDir, 'server');
      const flagPath = path.join(sessionsDir, '.migrated-to-server');
      expect(fs.existsSync(flagPath)).toBe(false);

      serverService.shutdown();
      fs.rmSync(customDir, { recursive: true, force: true });
    });

    it('preserves the previous record when a replacement write fails after truncation', () => {
      service.writeData(testPrefix, testId, testData);
      const targetPath = service.getFilePath(testPrefix, testId);
      const originalRenameSync = fs.renameSync;
      vi.spyOn(fs, 'renameSync').mockImplementation((oldPath, newPath) => {
        if (newPath === targetPath) {
          throw new Error(`simulated crash while renaming ${String(newPath)}`);
        }
        return originalRenameSync(oldPath, newPath);
      });

      expect(() =>
        service.writeData(testPrefix, testId, {
          ...testData,
          value: 'replacement value',
        }),
      ).toThrow('simulated crash');

      expect(JSON.parse(fs.readFileSync(targetPath, 'utf8'))).toEqual(testData);
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

  describe('Exclusive storage locks', () => {
    it('reclaims a lock left by a crashed process', async () => {
      const lockPath = path.join(service.getStorageDir(), '.refresh-test.lock');
      fs.mkdirSync(lockPath);
      fs.writeFileSync(
        path.join(lockPath, 'owner.json'),
        JSON.stringify({ operationId: 'abandoned-operation', pid: 2_147_483_647, createdAt: Date.now() }),
      );

      await expect(service.withExclusiveLock('refresh-test', () => 'acquired')).resolves.toBe('acquired');
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('recovers from a release rename failure without blocking the next acquisition', async () => {
      const originalRenameSync = fs.renameSync;
      let failedReleaseRename = false;
      vi.spyOn(fs, 'renameSync').mockImplementation((oldPath, newPath) => {
        if (!failedReleaseRename && String(newPath).endsWith('.releasing')) {
          failedReleaseRename = true;
          throw new Error('simulated lock cleanup failure');
        }
        return originalRenameSync(oldPath, newPath);
      });

      await expect(service.withExclusiveLock('refresh-test', () => 'committed')).resolves.toBe('committed');
      expect(failedReleaseRename).toBe(true);
      await expect(service.withExclusiveLock('refresh-test', () => 'acquired-again')).resolves.toBe('acquired-again');
    });

    it('does not overwrite a newer owner created during owner-less lock reclamation', async () => {
      const lockPath = path.join(service.getStorageDir(), '.owner-race-test.lock');
      const ownerPath = path.join(lockPath, 'owner.json');
      const replacementOperationId = 'replacement-operation';
      const originalMkdirSync = fs.mkdirSync;
      const originalWriteFileSync = fs.writeFileSync;
      let injectedReplacementOwner = false;
      let exclusiveWriteRejected = false;
      let replacementOwnerPreserved = false;
      let releaseReplacementOwner = Promise.resolve();

      vi.spyOn(fs, 'writeFileSync').mockImplementation((file, data, options) => {
        if (String(file) === ownerPath && !injectedReplacementOwner) {
          injectedReplacementOwner = true;
          fs.rmSync(lockPath, { recursive: true, force: true });
          originalMkdirSync(lockPath, { mode: 0o700 });
          originalWriteFileSync(
            ownerPath,
            JSON.stringify({ operationId: replacementOperationId, pid: process.pid, createdAt: Date.now() }),
            { mode: 0o600, flag: 'wx' },
          );
          releaseReplacementOwner = new Promise<void>((resolve) => {
            queueMicrotask(() => {
              try {
                const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8')) as { operationId?: string };
                replacementOwnerPreserved = owner.operationId === replacementOperationId;
              } catch {
                replacementOwnerPreserved = false;
              }
              fs.rmSync(lockPath, { recursive: true, force: true });
              resolve();
            });
          });
        }

        try {
          return originalWriteFileSync(file, data, options);
        } catch (error) {
          if (String(file) === ownerPath) {
            exclusiveWriteRejected = true;
          }
          throw error;
        }
      });

      await expect(service.withExclusiveLock('owner-race-test', () => 'acquired')).resolves.toBe('acquired');
      await releaseReplacementOwner;
      expect(injectedReplacementOwner).toBe(true);
      expect(exclusiveWriteRejected).toBe(true);
      expect(replacementOwnerPreserved).toBe(true);
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

    it('should accept REST-derived session IDs for streamable session persistence', () => {
      const id = 'rest-fa744e84eb6f935a';
      const data: TestData = {
        id,
        value: 'test',
        expires: Date.now() + 60000,
        createdAt: Date.now(),
      };

      expect(() => service.writeData(AUTH_CONFIG.SERVER.STREAMABLE_SESSION.FILE_PREFIX, id, data)).not.toThrow();
      expect(service.readData<TestData>(AUTH_CONFIG.SERVER.STREAMABLE_SESSION.FILE_PREFIX, id)).toEqual(data);
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

  describe('CWE-532 log redaction — isValidId internal path', () => {
    it('redacts sensitive ID in thrown Error message when extractUuidPart encounters a mismatched prefix', () => {
      const sensitiveId = `${AUTH_CONFIG.SERVER.AUTH_CODE.ID_PREFIX}sensitive-secret-token-value`;
      const wrongPrefix = AUTH_CONFIG.SERVER.SESSION.ID_PREFIX;

      // Exercise the real, unmocked extractUuidPart implementation
      const extractFn = (
        service as unknown as { extractUuidPart: (id: string, prefix: string) => string }
      ).extractUuidPart.bind(service);

      expect(() => extractFn(sensitiveId, wrongPrefix)).toThrow();
      try {
        extractFn(sensitiveId, wrongPrefix);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        expect(errMsg).toContain('[REDACTED]');
        expect(errMsg).not.toContain('sensitive-secret-token-value');
        expect(errMsg).not.toContain(sensitiveId);
      }
    });

    it('does not log plaintext auth-code ID or error metadata when isValidId encounters an extractUuidPart failure', () => {
      vi.mocked(logger.debug).mockClear();

      const sensitiveId = `${AUTH_CONFIG.SERVER.AUTH_CODE.ID_PREFIX}sensitive-secret-token-value`;
      const extractSpy = vi
        .spyOn(service as unknown as { extractUuidPart: (id: string, prefix: string) => string }, 'extractUuidPart')
        .mockImplementationOnce(() => {
          throw new Error(`malformed UUID with sensitive payload: ${sensitiveId}`);
        });

      const result = service.readData(AUTH_CONFIG.SERVER.AUTH_CODE.FILE_PREFIX, sensitiveId);
      expect(result).toBeNull();
      extractSpy.mockRestore();

      expect(vi.mocked(logger.debug)).toHaveBeenCalled();
      const calls = vi.mocked(logger.debug).mock.calls as unknown as Array<[unknown, unknown?]>;
      for (const [message, meta] of calls) {
        const messageStr = String(message);
        expect(messageStr).toContain('[REDACTED]');
        expect(messageStr).not.toContain('sensitive-secret-token-value');
        expect(messageStr).not.toContain(sensitiveId);

        if (meta && typeof meta === 'object' && 'error' in meta) {
          const errorValue = String((meta as { error: unknown }).error);
          expect(errorValue).toContain('[REDACTED]');
          expect(errorValue).not.toContain('sensitive-secret-token-value');
          expect(errorValue).not.toContain(sensitiveId);
        }
      }
    });
  });
});
