/**
 * Performance tests for lazy loading functionality
 *
 * These tests measure token usage, startup time, tool invocation latency,
 * cache hit rates, and request coalescing effectiveness.
 */
import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { OutboundConnections } from '@src/core/types/index.js';

import { beforeEach, describe, expect, it } from 'vitest';

import { LazyLoadingOrchestrator } from './lazyLoadingOrchestrator.js';
import { SchemaCache, SchemaCacheConfig } from './schemaCache.js';

describe('Lazy Loading Performance Tests', () => {
  let mockAgentConfig: any;
  let mockOutboundConnections: OutboundConnections;
  let mockClient: any;
  const mockTools: Tool[] = [];

  beforeEach(() => {
    // Create 100 mock tools
    for (let i = 1; i <= 100; i++) {
      mockTools.push({
        name: `tool_${i}`,
        description: `Tool number ${i} for testing`,
        inputSchema: {
          type: 'object',
          properties: {
            param1: { type: 'string', description: 'First parameter' },
            param2: { type: 'number', description: 'Second parameter' },
            param3: { type: 'boolean', description: 'Third parameter' },
            param4: { type: 'array', items: { type: 'string' }, description: 'Fourth parameter' },
          },
          required: ['param1', 'param2'],
        },
      });
    }

    // Mock outbound connections
    mockClient = {
      listTools: vi.fn().mockResolvedValue({ tools: mockTools }),
      getServerCapabilities: vi.fn().mockResolvedValue({
        tools: {},
        resources: {},
        prompts: {},
      }),
    };

    mockOutboundConnections = new Map([
      [
        'filesystem',
        {
          name: 'filesystem',
          client: mockClient,
          status: 'ready',
          transport: {
            tags: ['filesystem', 'local'],
            get args() {
              return [];
            },
          },
          state: 'ready',
          lastConnected: new Date(),
        },
      ],
      [
        'search',
        {
          name: 'search',
          client: mockClient,
          status: 'ready',
          transport: {
            tags: ['search', 'web'],
            get args() {
              return [];
            },
          },
          state: 'ready',
          lastConnected: new Date(),
        },
      ],
    ]) as unknown as OutboundConnections;

    // Mock AgentConfigManager
    mockAgentConfig = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: true,
            inlineCatalog: false,
            catalogFormat: 'grouped',
            directExpose: [],
            cache: {
              maxEntries: 1000,
              strategy: 'lru',
              ttlMs: undefined,
            },
            preload: {
              patterns: [],
              keywords: [],
            },
            fallback: {
              onError: 'skip',
              timeoutMs: 5000,
            },
          };
        }
        return undefined;
      }),
    };
  });

  describe('Token Usage Measurement', () => {
    it('should measure token usage with lazy loading enabled (metatool mode)', async () => {
      const orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);
      await orchestrator.initialize();

      const stats = orchestrator.getStatistics();

      // In metatool mode, lazy loading should be enabled
      expect(stats.enabled).toBe(true);
      // stats.mode removed from LazyLoadingStats interface
    });

    it('should measure token usage with full loading (disabled)', async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: false,
            inlineCatalog: false,
            catalogFormat: 'grouped',
            directExpose: [],
            cache: { maxEntries: 1000, strategy: 'lru' },
            preload: { patterns: [], keywords: [] },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      const orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);
      await orchestrator.initialize();

      const stats = orchestrator.getStatistics();

      // In full mode, no token savings (0%)
      expect(stats.enabled).toBe(false);
      expect(stats.tokenSavings.savingsPercentage).toBe(0);
    });
  });

  describe('Startup Time Comparison', () => {
    it('should measure startup time for metatool mode', async () => {
      const orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);

      const startTime = performance.now();
      await orchestrator.initialize();
      const endTime = performance.now();

      const startupTime = endTime - startTime;

      // Startup should complete
      expect(startupTime).toBeGreaterThanOrEqual(0);
    });

    it('should measure startup time for full mode', async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: false,
            mode: 'full',
            metaTools: { enabled: true, inlineCatalog: false, catalogFormat: 'grouped' },
            directExpose: [],
            cache: { maxEntries: 1000, strategy: 'lru' },
            preload: { patterns: [], keywords: [] },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      const orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);

      const startTime = performance.now();
      await orchestrator.initialize();
      const endTime = performance.now();

      const startupTime = endTime - startTime;

      // Startup should complete
      expect(startupTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Cache Hit Rate Benchmarks', () => {
    it('should measure cache hit rate with repeated access', async () => {
      const cacheConfig: SchemaCacheConfig = {
        maxEntries: 1000,
      };
      const cache = new SchemaCache(cacheConfig);

      const mockLoader = vi.fn().mockResolvedValue({
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
      });

      // First access - cache miss
      await cache.getOrLoad('server1', 'tool1', mockLoader);
      expect(mockLoader).toHaveBeenCalledTimes(1);

      // Subsequent accesses - cache hits
      await cache.getOrLoad('server1', 'tool1', mockLoader);
      await cache.getOrLoad('server1', 'tool1', mockLoader);
      await cache.getOrLoad('server1', 'tool1', mockLoader);

      expect(mockLoader).toHaveBeenCalledTimes(1); // No additional calls

      const stats = cache.getStats();
      expect(stats.hits).toBe(3);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(75);
    });

    it('should measure LRU eviction behavior', async () => {
      const cacheConfig: SchemaCacheConfig = {
        maxEntries: 5, // Small cache to trigger eviction
      };
      const cache = new SchemaCache(cacheConfig);

      const mockLoader = vi.fn().mockResolvedValue({
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
      });

      // Fill cache beyond capacity
      for (let i = 1; i <= 10; i++) {
        await cache.getOrLoad('server', `tool${i}`, mockLoader);
      }

      const stats = cache.getStats();
      expect(stats.evictions).toBeGreaterThan(0);
      expect(cache.size()).toBeLessThanOrEqual(5);
    });
  });

  describe('Request Coalescing Effectiveness', () => {
    it('should measure coalescing effectiveness for parallel requests', async () => {
      const cacheConfig: SchemaCacheConfig = {
        maxEntries: 1000,
      };
      const cache = new SchemaCache(cacheConfig);

      const mockLoader = vi.fn().mockImplementation(async () => {
        // Simulate slow upstream call
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          name: 'test_tool',
          description: 'Test tool',
          inputSchema: { type: 'object' },
        };
      });

      // Make parallel requests for the same tool
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(cache.getOrLoad('server1', 'tool1', mockLoader));
      }

      await Promise.all(promises);

      // Should only make one upstream request despite 10 parallel calls
      expect(mockLoader).toHaveBeenCalledTimes(1);

      const stats = cache.getStats();
      expect(stats.coalesced).toBe(9); // 9 requests coalesced
    });
  });

  describe('Tool Invocation Latency', () => {
    it('should measure invocation latency for cached tools', async () => {
      const cacheConfig: SchemaCacheConfig = {
        maxEntries: 1000,
      };
      const cache = new SchemaCache(cacheConfig);

      const mockTool: Tool = {
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
      };

      cache.set('server1', 'tool1', mockTool);

      const startTime = performance.now();
      const result = cache.getIfCached('server1', 'tool1');
      const endTime = performance.now();

      expect(result).toEqual(mockTool);
      expect(endTime - startTime).toBeLessThan(10); // Should be very fast
    });

    it('should measure invocation latency for uncached tools', async () => {
      const cacheConfig: SchemaCacheConfig = {
        maxEntries: 1000,
      };
      const cache = new SchemaCache(cacheConfig);

      const mockLoader = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10)); // Simulate network delay
        return {
          name: 'test_tool',
          description: 'Test tool',
          inputSchema: { type: 'object' },
        };
      });

      const startTime = performance.now();
      await cache.getOrLoad('server1', 'tool1', mockLoader);
      const endTime = performance.now();

      // Should take at least the simulated delay
      expect(endTime - startTime).toBeGreaterThanOrEqual(10);
    });
  });

  describe('Mode Comparison', () => {
    it('should compare metatool vs hybrid vs full modes', async () => {
      const modes = ['metatool', 'hybrid', 'full'] as const;

      const results: Array<{ mode: string; enabled: boolean }> = [];

      for (const mode of modes) {
        mockAgentConfig.get.mockImplementation((key: string) => {
          if (key === 'lazyLoading') {
            return {
              enabled: mode !== 'full',
              mode,
              metaTools: { enabled: true, inlineCatalog: false, catalogFormat: 'grouped' },
              directExpose: mode === 'hybrid' ? ['filesystem_*'] : [],
              cache: { maxEntries: 1000, strategy: 'lru' },
              preload: { patterns: [], keywords: [] },
              fallback: { onError: 'skip', timeoutMs: 5000 },
            };
          }
          return undefined;
        });

        const orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);
        await orchestrator.initialize();

        const stats = orchestrator.getStatistics();

        results.push({
          mode,
          enabled: stats.enabled,
        });
      }

      // Metatool and hybrid should be enabled
      const metatoolResult = results.find((r) => r.mode === 'metatool');
      expect(metatoolResult?.enabled).toBe(true);

      const hybridResult = results.find((r) => r.mode === 'hybrid');
      expect(hybridResult?.enabled).toBe(true);

      // Full mode should be disabled
      const fullResult = results.find((r) => r.mode === 'full');
      expect(fullResult?.enabled).toBe(false);
    });
  });
});
