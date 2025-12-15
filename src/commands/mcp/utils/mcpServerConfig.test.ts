import { getServer, setServer } from '@src/commands/shared/baseConfigUtils.js';
import type { MCPServerParams } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getInstallationMetadata,
  removeInstallationMetadata,
  setInstallationMetadata,
  updateInstallationMetadata,
} from './mcpServerConfig.js';

// Extended type for testing metadata functionality
interface MCPServerParamsWithMetadata extends MCPServerParams {
  _metadata?: {
    installedAt: string;
    installedBy?: string;
    version: string;
    registryId?: string;
    lastUpdated?: string;
  };
}

// Mock dependencies
vi.mock('@src/commands/shared/baseConfigUtils.js');
vi.mock('@src/logger/logger.js', () => ({
  default: {
    warn: vi.fn(),
    error: vi.fn(),
  },
  debugIf: vi.fn(),
}));

const mockSetServer = vi.mocked(setServer);
const mockGetServer = vi.mocked(getServer) as ReturnType<typeof vi.mocked<typeof getServer>> & {
  (serverName: string): MCPServerParams | MCPServerParamsWithMetadata | null;
};
const mockLoggerWarn = vi.mocked(logger.warn);
const mockLoggerError = vi.mocked(logger.error);

describe('mcpServerConfig - Installation Metadata Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('setInstallationMetadata', () => {
    it('should set installation metadata for a server', () => {
      // Arrange
      const serverName = 'test-server';
      const metadata = {
        version: '1.0.0',
        registryId: 'registry-123',
        installedBy: 'cli',
      };
      const existingServer: MCPServerParams = {
        type: 'stdio',
        command: 'echo',
      };
      mockGetServer.mockReturnValue(existingServer);

      // Act
      setInstallationMetadata(serverName, metadata);

      // Assert
      expect(mockGetServer).toHaveBeenCalledWith(serverName);
      const expectedServer: MCPServerParamsWithMetadata = {
        type: 'stdio',
        command: 'echo',
        _metadata: {
          installedAt: expect.any(String),
          version: '1.0.0',
          registryId: 'registry-123',
          installedBy: 'cli',
          lastUpdated: expect.any(String),
        },
      };
      expect(mockSetServer).toHaveBeenCalledWith(serverName, expectedServer);
    });

    it('should work with only required metadata fields', () => {
      // Arrange
      const serverName = 'test-server';
      const metadata = {
        version: '2.0.0',
      };
      const existingServer: MCPServerParams = {
        type: 'http',
        url: 'http://localhost:3000',
      };
      mockGetServer.mockReturnValue(existingServer);

      // Act
      setInstallationMetadata(serverName, metadata);

      // Assert
      const expectedServer: MCPServerParamsWithMetadata = {
        type: 'http',
        url: 'http://localhost:3000',
        _metadata: {
          installedAt: expect.any(String),
          version: '2.0.0',
          registryId: undefined,
          installedBy: undefined,
          lastUpdated: expect.any(String),
        },
      };
      expect(mockSetServer).toHaveBeenCalledWith(serverName, expectedServer);
    });

    it('should handle server that does not exist', () => {
      // Arrange
      const serverName = 'non-existent-server';
      const metadata = {
        version: '1.0.0',
      };
      mockGetServer.mockReturnValue(null);

      // Act
      setInstallationMetadata(serverName, metadata);

      // Assert
      expect(mockLoggerWarn).toHaveBeenCalledWith('Cannot set metadata for non-existent server: non-existent-server');
      expect(mockSetServer).not.toHaveBeenCalled();
    });

    it('should generate ISO timestamps', () => {
      // Arrange
      const serverName = 'test-server';
      const metadata = { version: '1.0.0' };
      const existingServer: MCPServerParams = { type: 'stdio', command: 'echo' };
      mockGetServer.mockReturnValue(existingServer);
      const beforeCall = new Date().toISOString();

      // Act
      setInstallationMetadata(serverName, metadata);

      // Assert
      expect(mockSetServer).toHaveBeenCalled();
      const calledWith = mockSetServer.mock.calls[0][1] as MCPServerParamsWithMetadata;
      expect(calledWith._metadata?.installedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(calledWith._metadata?.installedAt && calledWith._metadata.installedAt >= beforeCall).toBe(true);
      expect(calledWith._metadata?.lastUpdated && calledWith._metadata.lastUpdated >= beforeCall).toBe(true);
    });
  });

  describe('updateInstallationMetadata', () => {
    it('should update existing metadata', () => {
      // Arrange
      const serverName = 'test-server';
      const updates = { version: '2.0.0' };
      const serverWithMetadata: MCPServerParamsWithMetadata = {
        type: 'stdio',
        command: 'echo',
        _metadata: {
          installedAt: '2023-01-01T00:00:00.000Z',
          version: '1.0.0',
          registryId: 'registry-123',
          installedBy: 'cli',
        },
      };
      mockGetServer.mockReturnValue(serverWithMetadata);

      // Act
      updateInstallationMetadata(serverName, updates);

      // Assert
      const expectedServer: MCPServerParamsWithMetadata = {
        type: 'stdio',
        command: 'echo',
        _metadata: {
          installedAt: '2023-01-01T00:00:00.000Z',
          version: '2.0.0',
          registryId: 'registry-123',
          installedBy: 'cli',
          lastUpdated: expect.any(String),
        },
      };
      expect(mockSetServer).toHaveBeenCalledWith(serverName, expectedServer);
    });

    it('should handle server that does not exist', () => {
      // Arrange
      const serverName = 'non-existent-server';
      const updates = { version: '2.0.0' };
      mockGetServer.mockReturnValue(null);

      // Act
      updateInstallationMetadata(serverName, updates);

      // Assert
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        'Cannot update metadata for non-existent server: non-existent-server',
      );
      expect(mockSetServer).not.toHaveBeenCalled();
    });

    it('should handle server without existing metadata', () => {
      // Arrange
      const serverName = 'test-server';
      const updates = { version: '2.0.0' };
      const serverWithoutMetadata: MCPServerParams = {
        type: 'stdio',
        command: 'echo',
      };
      mockGetServer.mockReturnValue(serverWithoutMetadata);

      // Act
      updateInstallationMetadata(serverName, updates);

      // Assert
      expect(mockLoggerWarn).toHaveBeenCalledWith('No metadata found for server: test-server');
      expect(mockSetServer).not.toHaveBeenCalled();
    });

    it('should update lastUpdated timestamp', () => {
      // Arrange
      const serverName = 'test-server';
      const updates = { version: '2.0.0' };
      const beforeCall = new Date().toISOString();
      const serverWithMetadata: MCPServerParamsWithMetadata = {
        type: 'stdio',
        command: 'echo',
        _metadata: {
          installedAt: '2023-01-01T00:00:00.000Z',
          version: '1.0.0',
        },
      };
      mockGetServer.mockReturnValue(serverWithMetadata);

      // Act
      updateInstallationMetadata(serverName, updates);

      // Assert
      const calledWith = mockSetServer.mock.calls[0][1] as MCPServerParamsWithMetadata;
      expect(calledWith._metadata?.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(calledWith._metadata?.lastUpdated && calledWith._metadata.lastUpdated >= beforeCall).toBe(true);
    });
  });

  describe('getInstallationMetadata', () => {
    it('should return formatted metadata for server with metadata', () => {
      // Arrange
      const serverName = 'test-server';
      const serverWithMetadata: MCPServerParamsWithMetadata = {
        type: 'stdio',
        command: 'echo',
        _metadata: {
          installedAt: '2023-01-01T12:00:00.000Z',
          version: '1.0.0',
          registryId: 'registry-123',
          installedBy: 'cli',
          lastUpdated: '2023-01-02T12:00:00.000Z',
        },
      };
      mockGetServer.mockReturnValue(serverWithMetadata);

      // Act
      const result = getInstallationMetadata(serverName);

      // Assert
      expect(result).toEqual({
        installedAt: new Date('2023-01-01T12:00:00.000Z'),
        installedBy: 'cli',
        version: '1.0.0',
        registryId: 'registry-123',
        lastUpdated: new Date('2023-01-02T12:00:00.000Z'),
      });
    });

    it('should handle server without metadata', () => {
      // Arrange
      const serverName = 'test-server';
      const serverWithoutMetadata: MCPServerParams = {
        type: 'stdio',
        command: 'echo',
      };
      mockGetServer.mockReturnValue(serverWithoutMetadata);

      // Act
      const result = getInstallationMetadata(serverName);

      // Assert
      expect(result).toBeNull();
    });

    it('should handle server that does not exist', () => {
      // Arrange
      const serverName = 'non-existent-server';
      mockGetServer.mockReturnValue(null);

      // Act
      const result = getInstallationMetadata(serverName);

      // Assert
      expect(result).toBeNull();
    });

    it('should handle metadata without lastUpdated', () => {
      // Arrange
      const serverName = 'test-server';
      const serverWithMetadata: MCPServerParamsWithMetadata = {
        type: 'stdio',
        command: 'echo',
        _metadata: {
          installedAt: '2023-01-01T12:00:00.000Z',
          version: '1.0.0',
          registryId: 'registry-123',
          installedBy: 'cli',
        },
      };
      mockGetServer.mockReturnValue(serverWithMetadata);

      // Act
      const result = getInstallationMetadata(serverName);

      // Assert
      expect(result).toEqual({
        installedAt: new Date('2023-01-01T12:00:00.000Z'),
        installedBy: 'cli',
        version: '1.0.0',
        registryId: 'registry-123',
        lastUpdated: undefined,
      });
    });

    it('should handle errors and return null', () => {
      // Arrange
      const serverName = 'test-server';
      mockGetServer.mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      // Act
      const result = getInstallationMetadata(serverName);

      // Assert
      expect(result).toBeNull();
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Failed to get installation metadata for test-server: Error: Unexpected error',
      );
    });
  });

  describe('removeInstallationMetadata', () => {
    it('should remove metadata from server', () => {
      // Arrange
      const serverName = 'test-server';
      const serverWithMetadata: MCPServerParamsWithMetadata = {
        type: 'stdio',
        command: 'echo',
        _metadata: {
          installedAt: '2023-01-01T12:00:00.000Z',
          version: '1.0.0',
        },
      };
      mockGetServer.mockReturnValue(serverWithMetadata);

      // Act
      removeInstallationMetadata(serverName);

      // Assert
      expect(mockSetServer).toHaveBeenCalledWith(serverName, {
        type: 'stdio',
        command: 'echo',
      });
    });

    it('should handle server that does not exist', () => {
      // Arrange
      const serverName = 'non-existent-server';
      mockGetServer.mockReturnValue(null);

      // Act
      removeInstallationMetadata(serverName);

      // Assert
      expect(mockSetServer).not.toHaveBeenCalled();
    });

    it('should handle server without metadata', () => {
      // Arrange
      const serverName = 'test-server';
      const serverWithoutMetadata: MCPServerParams = {
        type: 'stdio',
        command: 'echo',
      };
      mockGetServer.mockReturnValue(serverWithoutMetadata);

      // Act
      removeInstallationMetadata(serverName);

      // Assert
      expect(mockSetServer).toHaveBeenCalledWith(serverName, {
        type: 'stdio',
        command: 'echo',
      });
    });
  });

  describe('Integration with re-exported functions', () => {
    it('should re-export all functions from baseConfigUtils', () => {
      // This test verifies that the re-export is working by checking
      // that the functions are available and callable
      expect(typeof setInstallationMetadata).toBe('function');
      expect(typeof updateInstallationMetadata).toBe('function');
      expect(typeof getInstallationMetadata).toBe('function');
      expect(typeof removeInstallationMetadata).toBe('function');

      // Verify that re-exported functions from baseConfigUtils are also available
      // We can check this by importing them and ensuring they exist
      expect(typeof getServer).toBe('function');
      expect(typeof setServer).toBe('function');
    });
  });
});
