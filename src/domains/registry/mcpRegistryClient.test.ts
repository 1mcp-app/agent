// Import axios after mocking
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MCPRegistryClient } from './mcpRegistryClient.js';
import type { RegistryServer } from './types.js';

// Mock axios instance
const mockAxiosInstance = {
  get: vi.fn(),
};

// Mock axios module
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => mockAxiosInstance),
    get: vi.fn(),
    isAxiosError: vi.fn(),
  },
  isAxiosError: vi.fn(),
}));

describe('MCPRegistryClient', () => {
  let client: MCPRegistryClient;
  let mockServers: RegistryServer[];

  beforeEach(() => {
    client = new MCPRegistryClient({
      baseUrl: 'https://registry.test.com',
      timeout: 5000,
      cache: {
        defaultTtl: 300,
        maxSize: 100,
        cleanupInterval: 10000,
      },
    });

    mockServers = [
      {
        $schema: 'https://static.modelcontextprotocol.io/schemas/2025-07-09/server.schema.json',
        name: 'file-server',
        description: 'A file management server',
        status: 'active',
        repository: {
          url: 'https://github.com/test/file-server',
          source: 'github',
        },
        version: '1.0.0',
        remotes: [
          {
            type: 'streamable-http',
            url: 'npx @test/file-server',
          },
        ],
        _meta: {
          'io.modelcontextprotocol.registry/official': {
            publishedAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
            isLatest: true,
            status: 'active',
          },
        },
      },
      {
        $schema: 'https://static.modelcontextprotocol.io/schemas/2025-07-09/server.schema.json',
        name: 'database-server',
        description: 'A database integration server',
        status: 'active',
        repository: {
          url: 'https://github.com/test/database-server',
          source: 'github',
        },
        version: '2.1.0',
        remotes: [
          {
            type: 'sse',
            url: 'https://database.example.com/sse',
          },
        ],
        _meta: {
          'io.modelcontextprotocol.registry/official': {
            publishedAt: '2024-01-02T00:00:00Z',
            updatedAt: '2024-01-02T00:00:00Z',
            isLatest: true,
            status: 'active',
          },
        },
      },
    ];

    // Reset mocks
    vi.clearAllMocks();
    mockAxiosInstance.get.mockReset();
  });

  afterEach(() => {
    client.destroy();
  });

  describe('getServers', () => {
    it('should fetch servers successfully', async () => {
      const mockServerResponses = mockServers.map((server) => ({
        server,
        _meta: {
          'io.modelcontextprotocol.registry/official': server._meta['io.modelcontextprotocol.registry/official'],
        },
      }));
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: {
          servers: mockServerResponses,
          metadata: { count: 2 },
        },
      });

      const result = await client.getServers();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('https://registry.test.com/v0.1/servers');
      expect(result).toEqual(mockServers);
    });

    it('should handle query parameters', async () => {
      const mockServerResponses = mockServers.map((server) => ({
        server,
        _meta: {
          'io.modelcontextprotocol.registry/official': server._meta['io.modelcontextprotocol.registry/official'],
        },
      }));
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: {
          servers: mockServerResponses,
          metadata: { count: 2 },
        },
      });

      await client.getServers({ limit: 10, cursor: 'test-cursor-123' });

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        'https://registry.test.com/v0.1/servers?limit=10&cursor=test-cursor-123',
      );
    });

    it('should use cache on second request', async () => {
      const mockServerResponses = mockServers.map((server) => ({
        server,
        _meta: {
          'io.modelcontextprotocol.registry/official': server._meta['io.modelcontextprotocol.registry/official'],
        },
      }));
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: {
          servers: mockServerResponses,
          metadata: { count: 2 },
        },
      });

      // First request
      const result1 = await client.getServers();
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);

      // Second request should use cache
      const result2 = await client.getServers();
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1); // Still only called once
      expect(result2).toEqual(result1);
    });

    it('should handle HTTP errors', async () => {
      const axiosError = {
        response: {
          status: 500,
          statusText: 'Internal Server Error',
        },
      };
      mockAxiosInstance.get.mockRejectedValueOnce(axiosError);
      vi.mocked(axios.isAxiosError).mockReturnValueOnce(true);

      await expect(client.getServers()).rejects.toThrow('Failed to fetch servers from registry');
    });

    it('should handle request timeout', async () => {
      const shortTimeoutClient = new MCPRegistryClient({
        baseUrl: 'https://registry.test.com',
        timeout: 10, // 10ms timeout
      });

      const timeoutError = {
        code: 'ECONNABORTED',
      };
      mockAxiosInstance.get.mockRejectedValueOnce(timeoutError);
      vi.mocked(axios.isAxiosError).mockReturnValueOnce(true);

      await expect(shortTimeoutClient.getServers()).rejects.toThrow('Failed to fetch servers from registry');

      shortTimeoutClient.destroy();
    });
  });

  describe('getServerById', () => {
    it('should fetch server by ID successfully', async () => {
      const mockServerResponse = {
        server: mockServers[0],
        _meta: {
          'io.modelcontextprotocol.registry/official':
            mockServers[0]._meta['io.modelcontextprotocol.registry/official'],
        },
      };
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: {
          servers: [mockServerResponse],
          metadata: { count: 1 },
        },
      });

      const result = await client.getServerById('file-server-1');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        'https://registry.test.com/v0.1/servers/file-server-1/versions',
      );
      expect(result).toEqual(mockServers[0]);
    });

    it('should encode server ID in URL', async () => {
      const mockServerResponse = {
        server: mockServers[0],
        _meta: {
          'io.modelcontextprotocol.registry/official':
            mockServers[0]._meta['io.modelcontextprotocol.registry/official'],
        },
      };
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: {
          servers: [mockServerResponse],
          metadata: { count: 1 },
        },
      });

      await client.getServerById('server with spaces');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        'https://registry.test.com/v0.1/servers/server%20with%20spaces/versions',
      );
    });
  });

  describe('searchServers', () => {
    it('should search servers with query parameters', async () => {
      const filteredServers = mockServers.filter((s) => s.name.includes('file'));
      const mockServerResponses = filteredServers.map((server) => ({
        server,
        _meta: {
          'io.modelcontextprotocol.registry/official': server._meta['io.modelcontextprotocol.registry/official'],
        },
      }));
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: {
          servers: mockServerResponses,
          metadata: { count: 1 },
        },
      });

      const result = await client.searchServers({
        query: 'file',
        status: 'active',
        registry_type: 'npm',
        limit: 10,
      });

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('https://registry.test.com/v0.1/servers?limit=10&search=file');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('file-server');
    });

    it('should handle empty search results', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: {
          servers: [],
          metadata: { count: 0 },
        },
      });

      const result = await client.searchServers({ query: 'nonexistent' });

      expect(result).toEqual([]);
    });
  });

  describe('getRegistryStatus', () => {
    it('should get basic registry status', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: { status: 'ok', github_client_id: 'test-client-id' },
      });

      const result = await client.getRegistryStatus();

      expect(result).toMatchObject({
        available: true,
        url: 'https://registry.test.com',
        response_time_ms: expect.any(Number),
        last_updated: expect.any(String),
        github_client_id: 'test-client-id',
      });

      expect(result.stats).toBeUndefined();
    });

    it('should get registry status with statistics', async () => {
      mockAxiosInstance.get
        .mockResolvedValueOnce({
          data: { status: 'ok', github_client_id: 'test-client-id' },
        })
        .mockResolvedValueOnce({
          data: {
            servers: mockServers.map((server) => ({
              server,
              _meta: {
                'io.modelcontextprotocol.registry/official': server._meta['io.modelcontextprotocol.registry/official'],
              },
            })),
            metadata: { count: 2 },
          },
        });

      const result = await client.getRegistryStatus(true);

      expect(result.stats).toBeDefined();
      expect(result.stats).toMatchObject({
        total_servers: 2,
        active_servers: 2,
        deprecated_servers: 0,
        by_registry_type: { unknown: 2 },
        by_transport: { 'streamable-http': 1, sse: 1 },
      });
    });

    it('should handle registry unavailable', async () => {
      mockAxiosInstance.get.mockRejectedValueOnce(new Error('Network error'));
      vi.mocked(axios.isAxiosError).mockReturnValueOnce(false);

      const result = await client.getRegistryStatus();

      expect(result).toMatchObject({
        available: false,
        url: 'https://registry.test.com',
        response_time_ms: expect.any(Number),
        last_updated: expect.any(String),
      });
    });
  });

  describe('cache management', () => {
    it('should invalidate cache by pattern', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          servers: mockServers,
          metadata: { count: 2 },
        },
      });

      // Make initial request
      await client.getServers();
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);

      // Request should use cache
      await client.getServers();
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);

      // Invalidate cache
      await client.invalidateCache('/servers.*');

      // New request should hit the server again
      await client.getServers();
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
    });

    it('should provide cache statistics', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          servers: mockServers,
          metadata: { count: 2 },
        },
      });

      await client.getServers();

      const stats = client.getCacheStats();
      expect(stats).toMatchObject({
        totalEntries: expect.any(Number),
        validEntries: expect.any(Number),
        maxSize: 100,
      });
    });
  });
});
