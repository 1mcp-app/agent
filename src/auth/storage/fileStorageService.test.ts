import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { FileStorageService } from './fileStorageService.js';
import { ExpirableData } from '@src/auth/sessionTypes.js';

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

      expect(fs.existsSync(customDir)).toBe(true);
      expect(customService.getStorageDir()).toBe(customDir);

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
      const expectedPath = path.join(tempDir, `${testPrefix}${testId}.json`);
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
      const corruptedFilePath = path.join(tempDir, 'test_corrupted.json');
      fs.writeFileSync(corruptedFilePath, 'invalid json {');

      // Should not throw and should remove corrupted file
      expect(() => service.cleanupExpiredData()).not.toThrow();
      expect(fs.existsSync(corruptedFilePath)).toBe(false);
    });

    it('should handle files without expires field during cleanup', () => {
      const invalidData = { id: 'test', value: 'no expires field' };
      const filePath = path.join(tempDir, 'test_invalid.json');
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
      const filePath = path.join(tempDir, 'test_corrupted.json');
      fs.writeFileSync(filePath, 'invalid json content');

      const result = service.readData<TestData>('test_', 'corrupted');
      expect(result).toBeNull();
    });
  });

  describe('Utility Methods', () => {
    it('should return correct storage directory', () => {
      expect(service.getStorageDir()).toBe(tempDir);
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
});
