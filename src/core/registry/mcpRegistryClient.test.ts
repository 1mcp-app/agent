import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MCPRegistryClient } from './mcpRegistryClient.js';
import type { RegistryServer } from './types.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

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
        $schema: 'https://schema.org/mcp-server',
        name: 'file-server',
        description: 'A file management server',
        status: 'active',
        repository: {
          url: 'https://github.com/test/file-server',
          source: 'github',
        },
        version: '1.0.0',
        packages: [
          {
            registry_type: 'npm',
            identifier: '@test/file-server',
            version: '1.0.0',
            transport: 'stdio',
          },
        ],
        _meta: {
          id: 'file-server-1',
          published_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          is_latest: true,
        },
      },
      {
        $schema: 'https://schema.org/mcp-server',
        name: 'database-server',
        description: 'A database integration server',
        status: 'active',
        repository: {
          url: 'https://github.com/test/database-server',
          source: 'github',
        },
        version: '2.1.0',
        packages: [
          {
            registry_type: 'npm',
            identifier: '@test/database-server',
            version: '2.1.0',
            transport: 'stdio',
          },
        ],
        _meta: {
          id: 'database-server-1',
          published_at: '2024-01-02T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z',
          is_latest: true,
        },
      },
    ];

    // Reset mock
    mockFetch.mockReset();
  });

  afterEach(() => {
    client.destroy();
  });

  describe('getServers', () => {
    it('should fetch servers successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockServers,
      });

      const result = await client.getServers();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://registry.test.com/servers',
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: 'application/json',
            'User-Agent': '1mcp-agent/0.21.0',
          }),
        }),
      );

      expect(result).toEqual(mockServers);
    });

    it('should handle query parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockServers,
      });

      await client.getServers({ limit: 10, offset: 5 });

      expect(mockFetch).toHaveBeenCalledWith('https://registry.test.com/servers?limit=10&offset=5', expect.any(Object));
    });

    it('should use cache on second request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockServers,
      });

      // First request
      const result1 = await client.getServers();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second request should use cache
      const result2 = await client.getServers();
      expect(mockFetch).toHaveBeenCalledTimes(1); // Still only called once
      expect(result2).toEqual(result1);
    });

    it('should handle HTTP errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(client.getServers()).rejects.toThrow('Failed to fetch servers from registry');
    });

    it('should handle request timeout', async () => {
      const shortTimeoutClient = new MCPRegistryClient({
        baseUrl: 'https://registry.test.com',
        timeout: 10, // 10ms timeout
      });

      mockFetch.mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(resolve, 50)), // 50ms delay
      );

      await expect(shortTimeoutClient.getServers()).rejects.toThrow('Failed to fetch servers from registry');

      shortTimeoutClient.destroy();
    });
  });

  describe('getServerById', () => {
    it('should fetch server by ID successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockServers[0],
      });

      const result = await client.getServerById('file-server-1');

      expect(mockFetch).toHaveBeenCalledWith('https://registry.test.com/servers/file-server-1', expect.any(Object));

      expect(result).toEqual(mockServers[0]);
    });

    it('should encode server ID in URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockServers[0],
      });

      await client.getServerById('server with spaces');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://registry.test.com/servers/server%20with%20spaces',
        expect.any(Object),
      );
    });
  });

  describe('searchServers', () => {
    it('should search servers with query parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockServers.filter((s) => s.name.includes('file')),
      });

      const result = await client.searchServers({
        query: 'file',
        status: 'active',
        registry_type: 'npm',
        limit: 10,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://registry.test.com/servers?limit=10&q=file&status=active&registry_type=npm',
        expect.any(Object),
      );

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('file-server');
    });

    it('should handle empty search results', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const result = await client.searchServers({ query: 'nonexistent' });

      expect(result).toEqual([]);
    });
  });

  describe('getRegistryStatus', () => {
    it('should get basic registry status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockServers.slice(0, 1),
      });

      const result = await client.getRegistryStatus();

      expect(result).toMatchObject({
        available: true,
        url: 'https://registry.test.com',
        response_time_ms: expect.any(Number),
        last_updated: expect.any(String),
      });

      expect(result.stats).toBeUndefined();
    });

    it('should get registry status with statistics', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockServers.slice(0, 1),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockServers,
        });

      const result = await client.getRegistryStatus(true);

      expect(result.stats).toBeDefined();
      expect(result.stats).toMatchObject({
        total_servers: 2,
        active_servers: 2,
        deprecated_servers: 0,
        by_registry_type: { npm: 2 },
        by_transport: { stdio: 2 },
      });
    });

    it('should handle registry unavailable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

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
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockServers,
      });

      // Make initial request
      await client.getServers();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Request should use cache
      await client.getServers();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Invalidate cache
      await client.invalidateCache('/servers.*');

      // New request should hit the server again
      await client.getServers();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should provide cache statistics', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockServers,
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
