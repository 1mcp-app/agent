import { GetRegistryStatusArgs } from '@src/domains/registry/mcpToolSchemas.js';
import { RegistryOptions, RegistryStatusResult } from '@src/domains/registry/types.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanupRegistryHandler, handleGetRegistryStatus } from './registryHandler.js';

// Mock dependencies
vi.mock('@src/domains/registry/mcpRegistryClient.js', () => ({
  createRegistryClient: vi.fn(),
}));

vi.mock('../../../utils/errorHandling.js', () => ({
  withErrorHandling: vi.fn((fn, _errorMessage) => fn),
}));

vi.mock('../../../logger/logger.js', () => ({
  __esModule: true,
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('registryHandler', () => {
  let mockRegistryClient: any;
  let mockCreateRegistryClient: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create mock registry client
    mockRegistryClient = {
      getRegistryStatus: vi.fn(),
      destroy: vi.fn(),
    };

    // Mock the createRegistryClient function
    const { createRegistryClient } = await import('@src/domains/registry/mcpRegistryClient.js');
    mockCreateRegistryClient = createRegistryClient as any;
    mockCreateRegistryClient.mockReturnValue(mockRegistryClient);
  });

  afterEach(() => {
    // Cleanup after each test
    cleanupRegistryHandler();
  });

  describe('handleGetRegistryStatus', () => {
    it('should get registry status without stats', async () => {
      const mockStatusResult: RegistryStatusResult = {
        available: true,
        url: 'https://registry.example.com',
        response_time_ms: 150,
        last_updated: '2023-01-01T00:00:00Z',
      };

      mockRegistryClient.getRegistryStatus.mockResolvedValue(mockStatusResult);

      const args: GetRegistryStatusArgs = {
        include_stats: false,
      };

      const result = await handleGetRegistryStatus(args);

      expect(result).toEqual(mockStatusResult);
      expect(mockRegistryClient.getRegistryStatus).toHaveBeenCalledWith(false);
      expect(mockCreateRegistryClient).toHaveBeenCalledWith(undefined);
    });

    it('should get registry status with stats', async () => {
      const mockStatusResult: RegistryStatusResult = {
        available: true,
        url: 'https://registry.example.com',
        response_time_ms: 200,
        last_updated: '2023-01-01T00:00:00Z',
        stats: {
          total_servers: 100,
          active_servers: 85,
          deprecated_servers: 15,
          by_registry_type: {
            npm: 50,
            pypi: 30,
            docker: 20,
          },
          by_transport: {
            stdio: 70,
            sse: 20,
            webhook: 10,
          },
        },
      };

      mockRegistryClient.getRegistryStatus.mockResolvedValue(mockStatusResult);

      const args: GetRegistryStatusArgs = {
        include_stats: true,
      };

      const result = await handleGetRegistryStatus(args);

      expect(result).toEqual(mockStatusResult);
      expect(mockRegistryClient.getRegistryStatus).toHaveBeenCalledWith(true);
    });

    it('should use registry options when provided', async () => {
      const mockStatusResult: RegistryStatusResult = {
        available: true,
        url: 'https://custom-registry.example.com',
        response_time_ms: 100,
        last_updated: '2023-01-01T00:00:00Z',
      };

      mockRegistryClient.getRegistryStatus.mockResolvedValue(mockStatusResult);

      const args: GetRegistryStatusArgs = {
        include_stats: false,
      };

      const registryOptions: RegistryOptions = {
        url: 'https://custom-registry.example.com',
        timeout: 5000,
        cacheTtl: 300,
      };

      const result = await handleGetRegistryStatus(args, registryOptions);

      expect(result).toEqual(mockStatusResult);
      expect(mockCreateRegistryClient).toHaveBeenCalledWith(registryOptions);
      expect(mockRegistryClient.getRegistryStatus).toHaveBeenCalledWith(false);
    });

    it('should handle default include_stats when undefined', async () => {
      const mockStatusResult: RegistryStatusResult = {
        available: true,
        url: 'https://registry.example.com',
        response_time_ms: 150,
        last_updated: '2023-01-01T00:00:00Z',
      };

      mockRegistryClient.getRegistryStatus.mockResolvedValue(mockStatusResult);

      const args: GetRegistryStatusArgs = {};

      const result = await handleGetRegistryStatus(args);

      expect(result).toEqual(mockStatusResult);
      expect(mockRegistryClient.getRegistryStatus).toHaveBeenCalledWith(false);
    });

    it('should handle registry client errors', async () => {
      const error = new Error('Registry unavailable');
      mockRegistryClient.getRegistryStatus.mockRejectedValue(error);

      const args: GetRegistryStatusArgs = {
        include_stats: false,
      };

      await expect(handleGetRegistryStatus(args)).rejects.toThrow('Failed to get registry status');
    });

    it('should reuse existing registry client with same config', async () => {
      const mockStatusResult: RegistryStatusResult = {
        available: true,
        url: 'https://registry.example.com',
        response_time_ms: 150,
        last_updated: '2023-01-01T00:00:00Z',
      };

      mockRegistryClient.getRegistryStatus.mockResolvedValue(mockStatusResult);

      const args: GetRegistryStatusArgs = {
        include_stats: false,
      };

      // Call twice with same config
      await handleGetRegistryStatus(args);
      await handleGetRegistryStatus(args);

      // Should only create client once
      expect(mockCreateRegistryClient).toHaveBeenCalledTimes(1);
    });

    it('should recreate registry client when config changes', async () => {
      const mockStatusResult: RegistryStatusResult = {
        available: true,
        url: 'https://registry.example.com',
        response_time_ms: 150,
        last_updated: '2023-01-01T00:00:00Z',
      };

      mockRegistryClient.getRegistryStatus.mockResolvedValue(mockStatusResult);

      const args: GetRegistryStatusArgs = {
        include_stats: false,
      };

      const registryOptions1: RegistryOptions = {
        url: 'https://registry1.example.com',
        timeout: 5000,
      };

      const registryOptions2: RegistryOptions = {
        url: 'https://registry2.example.com',
        timeout: 10000,
      };

      // Call with first config
      await handleGetRegistryStatus(args, registryOptions1);

      // Call with different config
      await handleGetRegistryStatus(args, registryOptions2);

      // Should create client twice and destroy once
      expect(mockCreateRegistryClient).toHaveBeenCalledTimes(2);
      expect(mockCreateRegistryClient).toHaveBeenNthCalledWith(1, registryOptions1);
      expect(mockCreateRegistryClient).toHaveBeenNthCalledWith(2, registryOptions2);
      expect(mockRegistryClient.destroy).toHaveBeenCalledTimes(1);
    });
  });

  describe('cleanupRegistryHandler', () => {
    it('should cleanup existing registry client', async () => {
      const mockStatusResult: RegistryStatusResult = {
        available: true,
        url: 'https://registry.example.com',
        response_time_ms: 150,
        last_updated: '2023-01-01T00:00:00Z',
      };

      mockRegistryClient.getRegistryStatus.mockResolvedValue(mockStatusResult);

      // Create a client first
      await handleGetRegistryStatus({ include_stats: false });

      // Cleanup
      cleanupRegistryHandler();

      expect(mockRegistryClient.destroy).toHaveBeenCalledTimes(1);
    });

    it('should handle cleanup when no client exists', () => {
      // Should not throw
      expect(() => cleanupRegistryHandler()).not.toThrow();
    });

    it('should allow creating new client after cleanup', async () => {
      const mockStatusResult: RegistryStatusResult = {
        available: true,
        url: 'https://registry.example.com',
        response_time_ms: 150,
        last_updated: '2023-01-01T00:00:00Z',
      };

      mockRegistryClient.getRegistryStatus.mockResolvedValue(mockStatusResult);

      // Create client, cleanup, then create again
      await handleGetRegistryStatus({ include_stats: false });
      cleanupRegistryHandler();
      await handleGetRegistryStatus({ include_stats: false });

      expect(mockCreateRegistryClient).toHaveBeenCalledTimes(2);
      expect(mockRegistryClient.destroy).toHaveBeenCalledTimes(1);
    });
  });

  describe('singleton behavior', () => {
    it('should maintain singleton client instance across calls', async () => {
      const mockStatusResult: RegistryStatusResult = {
        available: true,
        url: 'https://registry.example.com',
        response_time_ms: 150,
        last_updated: '2023-01-01T00:00:00Z',
      };

      mockRegistryClient.getRegistryStatus.mockResolvedValue(mockStatusResult);

      // Multiple calls with same config
      await handleGetRegistryStatus({ include_stats: false });
      await handleGetRegistryStatus({ include_stats: true });
      await handleGetRegistryStatus({ include_stats: false });

      // Should only create client once
      expect(mockCreateRegistryClient).toHaveBeenCalledTimes(1);
      expect(mockRegistryClient.getRegistryStatus).toHaveBeenCalledTimes(3);
    });

    it('should recreate client when options change from undefined to defined', async () => {
      const mockStatusResult: RegistryStatusResult = {
        available: true,
        url: 'https://registry.example.com',
        response_time_ms: 150,
        last_updated: '2023-01-01T00:00:00Z',
      };

      mockRegistryClient.getRegistryStatus.mockResolvedValue(mockStatusResult);

      // First call with no options
      await handleGetRegistryStatus({ include_stats: false });

      // Second call with options
      const registryOptions: RegistryOptions = {
        url: 'https://custom-registry.example.com',
        timeout: 5000,
      };
      await handleGetRegistryStatus({ include_stats: false }, registryOptions);

      expect(mockCreateRegistryClient).toHaveBeenCalledTimes(2);
      expect(mockCreateRegistryClient).toHaveBeenNthCalledWith(1, undefined);
      expect(mockCreateRegistryClient).toHaveBeenNthCalledWith(2, registryOptions);
      expect(mockRegistryClient.destroy).toHaveBeenCalledTimes(1);
    });
  });
});
