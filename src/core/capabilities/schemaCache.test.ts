import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SchemaCache } from './schemaCache.js';

describe('SchemaCache', () => {
  let cache: SchemaCache;
  let mockLoader: any;

  beforeEach(() => {
    cache = new SchemaCache({ maxEntries: 3, ttlMs: 1000 });
    mockLoader = vi.fn();
  });

  describe('Basic Caching', () => {
    it('should cache tool schemas', async () => {
      const mockTool: Tool = {
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
      };

      mockLoader.mockResolvedValue(mockTool);

      const result1 = await cache.getOrLoad('server1', 'test_tool', mockLoader);
      const result2 = await cache.getOrLoad('server1', 'test_tool', mockLoader);

      expect(result1).toEqual(mockTool);
      expect(result2).toEqual(mockTool);
      expect(mockLoader).toHaveBeenCalledTimes(1); // Called only once, second hit cache
    });

    it('should track cache hits and misses', () => {
      const stats = cache.getStats();

      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });

    it('should calculate hit rate correctly', async () => {
      const mockTool: Tool = {
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
      };

      mockLoader.mockResolvedValue(mockTool);

      await cache.getOrLoad('server1', 'tool1', mockLoader); // Miss
      await cache.getOrLoad('server1', 'tool1', mockLoader); // Hit
      await cache.getOrLoad('server1', 'tool2', mockLoader); // Miss
      await cache.getOrLoad('server1', 'tool2', mockLoader); // Hit

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(2);
      expect(stats.hitRate).toBe(50);
    });
  });

  describe('LRU Eviction', () => {
    it('should evict oldest entry when cache is full', async () => {
      const mockTool: Tool = {
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
      };

      mockLoader.mockResolvedValue(mockTool);

      // Fill cache to max capacity (3 entries)
      await cache.getOrLoad('server1', 'tool1', mockLoader);
      await cache.getOrLoad('server1', 'tool2', mockLoader);
      await cache.getOrLoad('server1', 'tool3', mockLoader);

      expect(cache.size()).toBe(3);

      // Add one more - should evict oldest
      await cache.getOrLoad('server1', 'tool4', mockLoader);

      expect(cache.size()).toBe(3);
      expect(cache.has('server1', 'tool1')).toBe(false); // Oldest evicted
      expect(cache.has('server1', 'tool4')).toBe(true); // New entry added

      const stats = cache.getStats();
      expect(stats.evictions).toBe(1);
    });
  });

  describe('TTL Expiration', () => {
    it('should expire entries after TTL', async () => {
      const mockTool: Tool = {
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
      };

      mockLoader.mockResolvedValue(mockTool);

      // Cache a tool
      await cache.getOrLoad('server1', 'tool1', mockLoader);
      expect(cache.has('server1', 'tool1')).toBe(true);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should be expired now
      expect(cache.has('server1', 'tool1')).toBe(false);

      // Next call should reload
      await cache.getOrLoad('server1', 'tool1', mockLoader);
      expect(mockLoader).toHaveBeenCalledTimes(2);
    });

    it('should not expire when TTL is disabled', async () => {
      const noTtlCache = new SchemaCache({ maxEntries: 10 });
      const mockTool: Tool = {
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
      };

      mockLoader.mockResolvedValue(mockTool);

      await noTtlCache.getOrLoad('server1', 'tool1', mockLoader);

      // Wait longer than previous TTL
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should still be cached (no TTL)
      expect(noTtlCache.has('server1', 'tool1')).toBe(true);
    });
  });

  describe('Request Coalescing', () => {
    it('should coalesce parallel requests for the same tool', async () => {
      const mockTool: Tool = {
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
      };

      let loadCount = 0;
      mockLoader.mockImplementation(async () => {
        loadCount++;
        // Simulate slow loading
        await new Promise((resolve) => setTimeout(resolve, 100));
        return mockTool;
      });

      // Make parallel requests for the same tool
      const [result1, result2, result3] = await Promise.all([
        cache.getOrLoad('server1', 'tool1', mockLoader),
        cache.getOrLoad('server1', 'tool1', mockLoader),
        cache.getOrLoad('server1', 'tool1', mockLoader),
      ]);

      expect(result1).toEqual(mockTool);
      expect(result2).toEqual(mockTool);
      expect(result3).toEqual(mockTool);

      // Should only load once (coalesced)
      expect(loadCount).toBe(1);
      expect(mockLoader).toHaveBeenCalledTimes(1);

      const stats = cache.getStats();
      expect(stats.coalesced).toBe(2); // 2 requests coalesced
    });

    it('should not coalesce requests for different tools', async () => {
      const mockTool: Tool = {
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
      };

      mockLoader.mockResolvedValue(mockTool);

      // Make parallel requests for different tools
      await Promise.all([
        cache.getOrLoad('server1', 'tool1', mockLoader),
        cache.getOrLoad('server1', 'tool2', mockLoader),
        cache.getOrLoad('server1', 'tool3', mockLoader),
      ]);

      expect(mockLoader).toHaveBeenCalledTimes(3);

      const stats = cache.getStats();
      expect(stats.coalesced).toBe(0);
    });
  });

  describe('Manual Cache Operations', () => {
    it('should manually set cache entries', () => {
      const mockTool: Tool = {
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
      };

      cache.set('server1', 'tool1', mockTool);

      expect(cache.has('server1', 'tool1')).toBe(true);
      expect(cache.getIfCached('server1', 'tool1')).toEqual(mockTool);
    });

    it('should manually delete cache entries', async () => {
      const mockTool: Tool = {
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
      };

      mockLoader.mockResolvedValue(mockTool);

      await cache.getOrLoad('server1', 'tool1', mockLoader);
      expect(cache.has('server1', 'tool1')).toBe(true);

      cache.delete('server1', 'tool1');
      expect(cache.has('server1', 'tool1')).toBe(false);
    });

    it('should get cached tool without loading', () => {
      const mockTool: Tool = {
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
      };

      cache.set('server1', 'tool1', mockTool);

      const result = cache.getIfCached('server1', 'tool1');
      expect(result).toEqual(mockTool);

      const notCached = cache.getIfCached('server1', 'tool2');
      expect(notCached).toBeNull();
    });

    it('should clear all cached entries', async () => {
      const mockTool: Tool = {
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
      };

      mockLoader.mockResolvedValue(mockTool);

      await cache.getOrLoad('server1', 'tool1', mockLoader);
      await cache.getOrLoad('server1', 'tool2', mockLoader);
      await cache.getOrLoad('server1', 'tool3', mockLoader);

      expect(cache.size()).toBe(3);

      cache.clear();

      expect(cache.size()).toBe(0);
      expect(cache.has('server1', 'tool1')).toBe(false);
      expect(cache.has('server1', 'tool2')).toBe(false);
      expect(cache.has('server1', 'tool3')).toBe(false);
    });
  });

  describe('Cache Statistics', () => {
    it('should return correct cache size', async () => {
      const mockTool: Tool = {
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
      };

      mockLoader.mockResolvedValue(mockTool);

      expect(cache.size()).toBe(0);

      await cache.getOrLoad('server1', 'tool1', mockLoader);
      expect(cache.size()).toBe(1);

      await cache.getOrLoad('server1', 'tool2', mockLoader);
      expect(cache.size()).toBe(2);
    });

    it('should reset statistics', async () => {
      const mockTool: Tool = {
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
      };

      mockLoader.mockResolvedValue(mockTool);

      await cache.getOrLoad('server1', 'tool1', mockLoader);
      await cache.getOrLoad('server1', 'tool1', mockLoader);

      let stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);

      cache.resetStats();

      stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });

    it('should list all cached tools', async () => {
      const mockTool: Tool = {
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
      };

      mockLoader.mockResolvedValue(mockTool);

      await cache.getOrLoad('server1', 'tool1', mockLoader);
      await cache.getOrLoad('server2', 'tool2', mockLoader);
      await cache.getOrLoad('server3', 'tool3', mockLoader);

      const cachedTools = cache.getCachedTools();

      expect(cachedTools).toHaveLength(3);
      expect(cachedTools).toContainEqual({ server: 'server1', toolName: 'tool1' });
      expect(cachedTools).toContainEqual({ server: 'server2', toolName: 'tool2' });
      expect(cachedTools).toContainEqual({ server: 'server3', toolName: 'tool3' });
    });
  });

  describe('Batch Preloading', () => {
    it('should preload multiple tools in parallel', async () => {
      const mockTool: Tool = {
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
      };

      mockLoader.mockResolvedValue(mockTool);

      const toolsToPreload = [
        { server: 'server1', toolName: 'tool1' },
        { server: 'server2', toolName: 'tool2' },
        { server: 'server3', toolName: 'tool3' },
      ];

      await cache.preload(toolsToPreload, mockLoader);

      expect(cache.size()).toBe(3);
      expect(cache.has('server1', 'tool1')).toBe(true);
      expect(cache.has('server2', 'tool2')).toBe(true);
      expect(cache.has('server3', 'tool3')).toBe(true);
    });

    it('should continue preloading even if some tools fail', async () => {
      const mockTool: Tool = {
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
      };

      mockLoader
        .mockResolvedValueOnce(mockTool)
        .mockRejectedValueOnce(new Error('Load failed'))
        .mockResolvedValueOnce(mockTool);

      const toolsToPreload = [
        { server: 'server1', toolName: 'tool1' },
        { server: 'server2', toolName: 'tool2' },
        { server: 'server3', toolName: 'tool3' },
      ];

      await cache.preload(toolsToPreload, mockLoader);

      // Should have 2 successful entries, not 3
      expect(cache.size()).toBe(2);
      expect(cache.has('server1', 'tool1')).toBe(true);
      expect(cache.has('server2', 'tool2')).toBe(false); // Failed
      expect(cache.has('server3', 'tool3')).toBe(true);
    });
  });
});
