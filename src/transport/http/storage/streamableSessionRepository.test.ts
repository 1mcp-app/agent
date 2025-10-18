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
});
