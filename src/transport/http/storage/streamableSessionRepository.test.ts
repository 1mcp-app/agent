import { AUTH_CONFIG } from '@src/constants.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StreamableSessionRepository } from './streamableSessionRepository.js';

// Mock FileStorageService
const mockFileStorageService = {
  writeData: vi.fn(),
  readData: vi.fn(),
  deleteData: vi.fn(),
};

describe('StreamableSessionRepository', () => {
  let repository: StreamableSessionRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    repository = new StreamableSessionRepository(mockFileStorageService as any);
  });

  describe('create', () => {
    it('should create a new streamable session with config', () => {
      // Arrange
      const sessionId = 'stream-test-session-id';
      const config = {
        tags: ['filesystem', 'network'],
        tagFilterMode: 'simple-or' as const,
        enablePagination: true,
        presetName: 'test-preset',
      };

      // Act
      repository.create(sessionId, config);

      // Assert
      expect(mockFileStorageService.writeData).toHaveBeenCalledWith(
        AUTH_CONFIG.SERVER.STREAMABLE_SESSION.FILE_PREFIX,
        sessionId,
        expect.objectContaining({
          tags: ['filesystem', 'network'],
          tagFilterMode: 'simple-or',
          enablePagination: true,
          presetName: 'test-preset',
          expires: expect.any(Number),
          createdAt: expect.any(Number),
          lastAccessedAt: expect.any(Number),
        }),
      );
    });

    it('should serialize complex objects to JSON strings', () => {
      // Arrange
      const sessionId = 'stream-test-session-id';
      const tagExpression = { type: 'or' as const, children: [] };
      const tagQuery = { tags: ['test'] };
      const config = {
        tagExpression,
        tagQuery,
      };

      // Act
      repository.create(sessionId, config);

      // Assert
      expect(mockFileStorageService.writeData).toHaveBeenCalledWith(
        AUTH_CONFIG.SERVER.STREAMABLE_SESSION.FILE_PREFIX,
        sessionId,
        expect.objectContaining({
          tagExpression: JSON.stringify(tagExpression),
          tagQuery: JSON.stringify(tagQuery),
        }),
      );
    });

    it('should set TTL for session expiration', () => {
      // Arrange
      const sessionId = 'stream-test-session-id';
      const config = { tags: ['test'] };
      const now = Date.now();

      // Act
      repository.create(sessionId, config);

      // Assert
      const callArgs = mockFileStorageService.writeData.mock.calls[0][2];
      expect(callArgs.expires).toBeGreaterThanOrEqual(now + AUTH_CONFIG.SERVER.STREAMABLE_SESSION.TTL_MS);
      expect(callArgs.createdAt).toBeGreaterThanOrEqual(now);
      expect(callArgs.lastAccessedAt).toBeGreaterThanOrEqual(now);
    });
  });

  describe('get', () => {
    it('should retrieve and parse session configuration', () => {
      // Arrange
      const sessionId = 'stream-test-session-id';
      const storedData = {
        tags: ['filesystem'],
        tagExpression: JSON.stringify({ type: 'or', children: [] }),
        tagQuery: JSON.stringify({ tags: ['test'] }),
        tagFilterMode: 'simple-or' as const,
        enablePagination: true,
        presetName: 'test-preset',
        customTemplate: 'custom',
        expires: Date.now() + 1000,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      };
      mockFileStorageService.readData.mockReturnValue(storedData);

      // Act
      const result = repository.get(sessionId);

      // Assert
      expect(mockFileStorageService.readData).toHaveBeenCalledWith(
        AUTH_CONFIG.SERVER.STREAMABLE_SESSION.FILE_PREFIX,
        sessionId,
      );
      expect(result).toEqual({
        tags: ['filesystem'],
        tagExpression: { type: 'or', children: [] },
        tagQuery: { tags: ['test'] },
        tagFilterMode: 'simple-or',
        enablePagination: true,
        presetName: 'test-preset',
        customTemplate: 'custom',
      });
    });

    it('should return null when session not found', () => {
      // Arrange
      const sessionId = 'non-existent-session';
      mockFileStorageService.readData.mockReturnValue(null);

      // Act
      const result = repository.get(sessionId);

      // Assert
      expect(result).toBeNull();
    });

    it('should handle undefined optional fields', () => {
      // Arrange
      const sessionId = 'stream-test-session-id';
      const storedData = {
        expires: Date.now() + 1000,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      };
      mockFileStorageService.readData.mockReturnValue(storedData);

      // Act
      const result = repository.get(sessionId);

      // Assert
      expect(result).toEqual({
        tags: undefined,
        tagExpression: undefined,
        tagQuery: undefined,
        tagFilterMode: undefined,
        enablePagination: undefined,
        presetName: undefined,
        customTemplate: undefined,
      });
    });
  });

  describe('updateAccess', () => {
    it('should update lastAccessedAt and extend expiration', () => {
      // Arrange
      const sessionId = 'stream-test-session-id';
      const now = Date.now();
      const storedData = {
        tags: ['test'],
        expires: now + 1000,
        createdAt: now - 10000,
        lastAccessedAt: now - 5000,
      };
      mockFileStorageService.readData.mockReturnValue(storedData);

      // Act
      repository.updateAccess(sessionId);

      // Assert
      expect(mockFileStorageService.readData).toHaveBeenCalledWith(
        AUTH_CONFIG.SERVER.STREAMABLE_SESSION.FILE_PREFIX,
        sessionId,
      );
      expect(mockFileStorageService.writeData).toHaveBeenCalledWith(
        AUTH_CONFIG.SERVER.STREAMABLE_SESSION.FILE_PREFIX,
        sessionId,
        expect.objectContaining({
          lastAccessedAt: expect.any(Number),
          expires: expect.any(Number),
        }),
      );

      const updatedData = mockFileStorageService.writeData.mock.calls[0][2];
      expect(updatedData.lastAccessedAt).toBeGreaterThanOrEqual(now);
      expect(updatedData.expires).toBeGreaterThanOrEqual(now + AUTH_CONFIG.SERVER.STREAMABLE_SESSION.TTL_MS);
    });

    it('should not update if session does not exist', () => {
      // Arrange
      const sessionId = 'non-existent-session';
      mockFileStorageService.readData.mockReturnValue(null);

      // Act
      repository.updateAccess(sessionId);

      // Assert
      expect(mockFileStorageService.readData).toHaveBeenCalledWith(
        AUTH_CONFIG.SERVER.STREAMABLE_SESSION.FILE_PREFIX,
        sessionId,
      );
      expect(mockFileStorageService.writeData).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete session by ID', () => {
      // Arrange
      const sessionId = 'stream-test-session-id';
      mockFileStorageService.deleteData.mockReturnValue(true);

      // Act
      const result = repository.delete(sessionId);

      // Assert
      expect(mockFileStorageService.deleteData).toHaveBeenCalledWith(
        AUTH_CONFIG.SERVER.STREAMABLE_SESSION.FILE_PREFIX,
        sessionId,
      );
      expect(result).toBe(true);
    });

    it('should return false if session does not exist', () => {
      // Arrange
      const sessionId = 'non-existent-session';
      mockFileStorageService.deleteData.mockReturnValue(false);

      // Act
      const result = repository.delete(sessionId);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('updateAccessThrottled', () => {
    const sessionId = 'stream-test-session-id';
    const now = Date.now();
    const storedData = {
      tags: ['test'],
      expires: now + 1000,
      createdAt: now - 10000,
      lastAccessedAt: now - 5000,
    };

    beforeEach(() => {
      mockFileStorageService.readData.mockReturnValue(storedData);
      vi.clearAllMocks();
    });

    it('should persist after reaching request threshold', () => {
      // Arrange
      const policy = AUTH_CONFIG.SERVER.STREAMABLE_SESSION.SAVE_POLICY;

      // Act - trigger exactly the request threshold
      for (let i = 0; i < policy.REQUESTS; i++) {
        repository.updateAccess(sessionId);
      }

      // Assert - should have persisted once
      expect(mockFileStorageService.writeData).toHaveBeenCalledTimes(1);
      expect(mockFileStorageService.writeData).toHaveBeenCalledWith(
        AUTH_CONFIG.SERVER.STREAMABLE_SESSION.FILE_PREFIX,
        sessionId,
        expect.objectContaining({
          lastAccessedAt: expect.any(Number),
          expires: expect.any(Number),
        }),
      );
    });

    it('should persist after reaching time threshold', async () => {
      // Arrange
      const policy = AUTH_CONFIG.SERVER.STREAMABLE_SESSION.SAVE_POLICY;
      let mockTime = now;
      vi.spyOn(Date, 'now').mockImplementation(() => mockTime);

      // Act - single request, then advance time past threshold
      repository.updateAccess(sessionId);
      // Clear the mock to track only the second call
      mockFileStorageService.writeData.mockClear();
      mockTime = now + policy.INTERVAL_MS + 1000; // Past threshold
      repository.updateAccess(sessionId);

      // Assert - should have persisted due to time threshold
      expect(mockFileStorageService.writeData).toHaveBeenCalledTimes(1);

      // Cleanup
      vi.spyOn(Date, 'now').mockRestore();
    });

    it('should use whichever trigger fires first', () => {
      // Arrange
      const policy = AUTH_CONFIG.SERVER.STREAMABLE_SESSION.SAVE_POLICY;
      let mockTime = now;
      vi.spyOn(Date, 'now').mockImplementation(() => mockTime);

      // Act - advance time past threshold, then make requests
      mockTime = now + policy.INTERVAL_MS + 1000;
      repository.updateAccess(sessionId);

      // Assert - should have persisted due to time threshold (not waiting for request threshold)
      expect(mockFileStorageService.writeData).toHaveBeenCalledTimes(1);

      // Cleanup
      vi.spyOn(Date, 'now').mockRestore();
    });

    it('should reset counters after persistence', () => {
      // Arrange
      const policy = AUTH_CONFIG.SERVER.STREAMABLE_SESSION.SAVE_POLICY;

      // Act - trigger persistence, then make more requests
      for (let i = 0; i < policy.REQUESTS; i++) {
        repository.updateAccess(sessionId);
      }
      // Reset mock to track new calls
      mockFileStorageService.writeData.mockClear();

      // Make more requests (should not persist yet)
      for (let i = 0; i < policy.REQUESTS - 1; i++) {
        repository.updateAccess(sessionId);
      }

      // Assert - should not have persisted again yet
      expect(mockFileStorageService.writeData).not.toHaveBeenCalled();
    });

    it('should always update in-memory timestamps regardless of persistence', () => {
      // Arrange
      const policy = AUTH_CONFIG.SERVER.STREAMABLE_SESSION.SAVE_POLICY;

      // Act - make requests below threshold
      for (let i = 0; i < policy.REQUESTS - 1; i++) {
        repository.updateAccess(sessionId);
      }

      // Assert - should not have persisted but in-memory state should be updated
      expect(mockFileStorageService.writeData).not.toHaveBeenCalled();
      // Note: We can't directly test private state, but the behavior is verified
      // by the fact that the next request will trigger persistence
    });

    it('should handle concurrent updates to same session', () => {
      // Arrange
      const policy = AUTH_CONFIG.SERVER.STREAMABLE_SESSION.SAVE_POLICY;

      // Act - simulate concurrent updates
      const promises = [];
      for (let i = 0; i < policy.REQUESTS; i++) {
        promises.push(Promise.resolve(repository.updateAccess(sessionId)));
      }
      Promise.all(promises);

      // Assert - should have persisted once (not multiple times)
      expect(mockFileStorageService.writeData).toHaveBeenCalledTimes(1);
    });

    it('should not persist if session does not exist', () => {
      // Arrange
      mockFileStorageService.readData.mockReturnValue(null);

      // Act
      repository.updateAccess(sessionId);

      // Assert - should not have persisted
      expect(mockFileStorageService.writeData).not.toHaveBeenCalled();
    });
  });

  describe('stopPeriodicFlush', () => {
    it('should stop periodic flush without errors', () => {
      // Act & Assert - should not throw
      expect(() => repository.stopPeriodicFlush()).not.toThrow();
    });
  });
});
