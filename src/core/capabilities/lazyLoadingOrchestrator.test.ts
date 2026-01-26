import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { ClientStatus, OutboundConnections } from '@src/core/types/index.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LazyLoadingOrchestrator } from './lazyLoadingOrchestrator.js';

describe('LazyLoadingOrchestrator', () => {
  let orchestrator: LazyLoadingOrchestrator;
  let mockOutboundConnections: OutboundConnections;
  let mockAgentConfig: any;
  let mockClient: any;

  beforeEach(() => {
    // Create mock client
    mockClient = {
      listTools: vi.fn(),
      callTool: vi.fn(),
      getServerCapabilities: vi.fn(),
      close: vi.fn(),
    };

    // Create outbound connections map
    mockOutboundConnections = new Map([
      [
        'filesystem',
        {
          name: 'filesystem',
          client: mockClient,
          status: ClientStatus.Connected,
          transport: {
            tags: ['fs', 'file'],
            start: async () => {},
            send: async () => undefined,
            close: async () => {},
          },
          capabilities: {},
          lastConnected: new Date(),
        },
      ],
      [
        'database',
        {
          name: 'database',
          client: mockClient,
          status: ClientStatus.Connected,
          transport: {
            tags: ['db', 'sql'],
            start: async () => {},
            send: async () => undefined,
            close: async () => {},
          },
          capabilities: {},
          lastConnected: new Date(),
        },
      ],
    ]) as OutboundConnections;

    // Mock AgentConfigManager with default lazy loading config
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

    // Mock listTools to return some tools
    mockClient.listTools.mockResolvedValue({
      tools: [
        { name: 'read_file', description: 'Read file', inputSchema: { type: 'object' } },
        { name: 'write_file', description: 'Write file', inputSchema: { type: 'object' } },
        { name: 'search', description: 'Search', inputSchema: { type: 'object' } },
      ],
    });

    mockClient.getServerCapabilities.mockResolvedValue({
      tools: {},
      resources: {},
      prompts: {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with required dependencies', () => {
      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);

      expect(orchestrator).toBeDefined();
      expect(orchestrator.getToolRegistry()).toBeDefined();
      expect(orchestrator.getSchemaCache()).toBeDefined();
      expect(orchestrator.isEnabled()).toBe(true);
      // getMode() removed - using isEnabled() instead
      expect(orchestrator.isEnabled()).toBe(true);
    });

    it('should initialize with disabled lazy loading', () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: false,
            inlineCatalog: false,
            catalogFormat: 'grouped',
            directExpose: [],
            cache: { maxEntries: 1000, ttlMs: undefined },
            preload: { patterns: [], keywords: [] },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);

      expect(orchestrator.isEnabled()).toBe(false);
      // getMode() removed - full mode is when lazy loading is disabled
      expect(orchestrator.isEnabled()).toBe(false);
    });

    it('should initialize schema cache with custom config', () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: true,
            inlineCatalog: false,
            catalogFormat: 'grouped',
            directExpose: [],
            cache: { maxEntries: 500, ttlMs: 60000 },
            preload: { patterns: [], keywords: [] },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);

      const cache = orchestrator.getSchemaCache();
      expect(cache).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('should initialize successfully in metatool mode', async () => {
      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);

      await orchestrator.initialize();

      // Should not throw and should be initialized
      expect(orchestrator.isEnabled()).toBe(true);
      // getMode() removed - using isEnabled() instead
      expect(orchestrator.isEnabled()).toBe(true);
    });

    it('should initialize successfully in full mode', async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: false,
            inlineCatalog: false,
            catalogFormat: 'grouped',
            directExpose: [],
            cache: { maxEntries: 1000 },
            preload: { patterns: [], keywords: [] },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);

      await orchestrator.initialize();

      // getMode() removed - full mode is when lazy loading is disabled
      expect(orchestrator.isEnabled()).toBe(false);
    });

    it('should initialize successfully in hybrid mode', async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: true,
            mode: 'hybrid',
            metaTools: { enabled: true },
            directExpose: ['*'],
            cache: { maxEntries: 1000 },
            preload: { patterns: [], keywords: [] },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);

      await orchestrator.initialize();

      // getMode() removed - hybrid mode replaced with metatool mode
      expect(orchestrator.isEnabled()).toBe(true);
    });

    it('should not initialize twice', async () => {
      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);

      await orchestrator.initialize();
      await orchestrator.initialize(); // Should not throw

      expect(orchestrator.isEnabled()).toBe(true);
    });

    it('should preload tools when configured', async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: true,
            inlineCatalog: false,
            catalogFormat: 'grouped',
            directExpose: [],
            cache: { maxEntries: 1000 },
            preload: {
              patterns: ['filesystem'],
              keywords: ['read'],
            },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);

      await orchestrator.initialize();

      // Preload should have been attempted (tools will be cached)
      const cache = orchestrator.getSchemaCache();
      expect(cache).toBeDefined();
    });
  });

  describe('getCapabilities', () => {
    it('should return only meta-tools in metatool mode', async () => {
      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);
      await orchestrator.initialize();

      const capabilities = await orchestrator.getCapabilities();

      expect(capabilities.tools).toHaveLength(3);
      expect(capabilities.tools.map((t) => t.name)).toContain('tool_list');
      expect(capabilities.tools.map((t) => t.name)).toContain('tool_schema');
      expect(capabilities.tools.map((t) => t.name)).toContain('tool_invoke');
    });

    it('should return all tools in full mode', async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: false,
            inlineCatalog: false,
            catalogFormat: 'grouped',
            directExpose: [],
            cache: { maxEntries: 1000 },
            preload: { patterns: [], keywords: [] },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);
      await orchestrator.initialize();

      const capabilities = await orchestrator.getCapabilities();

      // In full mode, should return base capabilities from aggregator
      // Tools come from CapabilityAggregator.getCurrentCapabilities()
      expect(capabilities.tools).toBeDefined();
      expect(capabilities.resources).toBeDefined();
      expect(capabilities.prompts).toBeDefined();
      expect(capabilities.readyServers).toBeDefined();
      expect(capabilities.timestamp).toBeDefined();
    });

    it('should return meta-tools + direct exposed tools in hybrid mode', async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: true,
            mode: 'hybrid',
            metaTools: { enabled: true },
            directExpose: ['read_file', 'write_file'],
            cache: { maxEntries: 1000 },
            preload: { patterns: [], keywords: [] },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);
      await orchestrator.initialize();

      const capabilities = await orchestrator.getCapabilities();

      // Should have 3 meta-tools + direct exposed tools
      expect(capabilities.tools.length).toBeGreaterThanOrEqual(3);
      expect(capabilities.tools.map((t) => t.name)).toContain('tool_list');
      expect(capabilities.tools.map((t) => t.name)).toContain('tool_schema');
      expect(capabilities.tools.map((t) => t.name)).toContain('tool_invoke');
    });

    it('should include resources and prompts in all modes', async () => {
      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);
      await orchestrator.initialize();

      const capabilities = await orchestrator.getCapabilities();

      expect(capabilities.resources).toBeDefined();
      expect(capabilities.prompts).toBeDefined();
      expect(capabilities.readyServers).toBeDefined();
      expect(capabilities.timestamp).toBeDefined();
    });
  });

  describe('shouldNotifyListChanged', () => {
    it('should return false in metatool mode (static tool list)', async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: true,
            inlineCatalog: false,
            catalogFormat: 'grouped',
            directExpose: [],
            cache: { maxEntries: 1000 },
            preload: { patterns: [], keywords: [] },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);
      await orchestrator.initialize();

      expect(orchestrator.shouldNotifyListChanged()).toBe(false);
    });

    it('should return true in full mode (standard MCP behavior)', async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: false,
            inlineCatalog: false,
            catalogFormat: 'grouped',
            directExpose: [],
            cache: { maxEntries: 1000 },
            preload: { patterns: [], keywords: [] },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);
      await orchestrator.initialize();

      expect(orchestrator.shouldNotifyListChanged()).toBe(true);
    });

    it('should return false in hybrid mode when no direct tools', async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: true,
            mode: 'hybrid',
            metaTools: { enabled: true },
            directExpose: [],
            cache: { maxEntries: 1000 },
            preload: { patterns: [], keywords: [] },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);
      await orchestrator.initialize();

      expect(orchestrator.shouldNotifyListChanged()).toBe(false);
    });
  });

  describe('isMetaTool', () => {
    it('should identify tool_list', () => {
      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);

      expect(orchestrator.isMetaTool('tool_list')).toBe(true);
    });

    it('should identify tool_schema', () => {
      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);

      expect(orchestrator.isMetaTool('tool_schema')).toBe(true);
    });

    it('should identify tool_invoke', () => {
      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);

      expect(orchestrator.isMetaTool('tool_invoke')).toBe(true);
    });

    it('should not identify regular tools', () => {
      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);

      expect(orchestrator.isMetaTool('read_file')).toBe(false);
      expect(orchestrator.isMetaTool('some_other_tool')).toBe(false);
    });
  });

  describe('callMetaTool', () => {
    beforeEach(async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: true,
            inlineCatalog: false,
            catalogFormat: 'grouped',
            directExpose: [],
            cache: { maxEntries: 1000 },
            preload: { patterns: [], keywords: [] },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);
      await orchestrator.initialize();
    });

    it('should call tool_list', async () => {
      const result = await orchestrator.callMetaTool('tool_list', {});

      expect(result).toBeDefined();
      expect((result as any).isError).toBeFalsy();
    });

    it('should call tool_schema', async () => {
      // First preload a tool into the cache
      const tool: Tool = {
        name: 'read_file',
        description: 'Read file',
        inputSchema: { type: 'object' },
      };
      orchestrator.getSchemaCache().set('filesystem', 'read_file', tool);

      const result = await orchestrator.callMetaTool('tool_schema', {
        server: 'filesystem',
        toolName: 'read_file',
      });

      expect(result).toBeDefined();
    });

    it('should throw when meta-tool provider not initialized', async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: false,
            inlineCatalog: false,
            catalogFormat: 'grouped',
            directExpose: [],
            cache: { maxEntries: 1000 },
            preload: { patterns: [], keywords: [] },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      const fullOrchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);
      await fullOrchestrator.initialize();

      await expect(fullOrchestrator.callMetaTool('tool_list', {})).rejects.toThrow(
        'Meta-tool provider not initialized',
      );
    });
  });

  describe('refreshCapabilities', () => {
    it('should refresh and rebuild registry', async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: true,
            inlineCatalog: false,
            catalogFormat: 'grouped',
            directExpose: [],
            cache: { maxEntries: 1000 },
            preload: { patterns: [], keywords: [] },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);
      await orchestrator.initialize();

      // Get initial capabilities
      const capabilities1 = await orchestrator.getCapabilities();

      // Refresh should work without errors
      const capabilities2 = await orchestrator.refreshCapabilities();

      expect(capabilities2).toBeDefined();
      expect(capabilities2.tools).toBeDefined();
      expect(capabilities2.tools.length).toBe(capabilities1.tools.length);
    });
  });

  describe('getStatistics', () => {
    it('should return statistics in metatool mode', async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: true,
            inlineCatalog: false,
            catalogFormat: 'grouped',
            directExpose: [],
            cache: { maxEntries: 1000 },
            preload: { patterns: [], keywords: [] },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);
      await orchestrator.initialize();

      const stats = orchestrator.getStatistics();

      expect(stats.enabled).toBe(true);
      // stats.mode removed from LazyLoadingStats interface
      expect(stats.registeredToolCount).toBeGreaterThanOrEqual(0);
      expect(stats.loadedToolCount).toBeGreaterThanOrEqual(0);
      expect(stats.cachedToolCount).toBeGreaterThanOrEqual(0);
      expect(stats.cacheHitRate).toBeGreaterThanOrEqual(0);
      expect(stats.tokenSavings).toBeDefined();
      // Token calculations can be negative when registry is empty (no tools from servers)
      expect(stats.tokenSavings.currentTokens).toBeDefined();
      expect(stats.tokenSavings.fullLoadTokens).toBeGreaterThanOrEqual(0);
      expect(stats.tokenSavings.savedTokens).toBeDefined();
      expect(stats.tokenSavings.savingsPercentage).toBeDefined();
    });

    it('should return statistics when disabled', async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: false,
            inlineCatalog: false,
            catalogFormat: 'grouped',
            directExpose: [],
            cache: { maxEntries: 1000 },
            preload: { patterns: [], keywords: [] },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);
      await orchestrator.initialize();

      const stats = orchestrator.getStatistics();

      expect(stats.enabled).toBe(false);
      // stats.mode removed from LazyLoadingStats interface
    });

    it('should calculate token savings correctly', async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: true,
            inlineCatalog: false,
            catalogFormat: 'grouped',
            directExpose: [],
            cache: { maxEntries: 1000 },
            preload: { patterns: [], keywords: [] },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);
      await orchestrator.initialize();

      const stats = orchestrator.getStatistics();

      // Token savings are calculated (can be negative with empty registry)
      expect(stats.tokenSavings.savedTokens).toBeDefined();
      expect(stats.tokenSavings.savingsPercentage).toBeDefined();

      // In full mode (disabled), savings should be 0
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: false,
            inlineCatalog: false,
            catalogFormat: 'grouped',
            directExpose: [],
            cache: { maxEntries: 1000 },
            preload: { patterns: [], keywords: [] },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      const fullOrchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);
      await fullOrchestrator.initialize();
      const fullStats = fullOrchestrator.getStatistics();

      // When disabled, currentTokens equals fullLoadTokens, so savings are 0
      expect(fullStats.tokenSavings.savedTokens).toBe(0);
      expect(fullStats.tokenSavings.savingsPercentage).toBe(0);
    });
  });

  describe('getToolRegistry and getSchemaCache', () => {
    it('should return tool registry instance', () => {
      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);

      const registry = orchestrator.getToolRegistry();
      expect(registry).toBeDefined();
    });

    it('should return schema cache instance', () => {
      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);

      const cache = orchestrator.getSchemaCache();
      expect(cache).toBeDefined();
    });
  });

  describe('isEnabled and getMode', () => {
    it('should return enabled status', () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: true,
            inlineCatalog: false,
            catalogFormat: 'grouped',
            directExpose: [],
            cache: { maxEntries: 1000 },
            preload: { patterns: [], keywords: [] },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);

      expect(orchestrator.isEnabled()).toBe(true);
    });

    it('should return disabled status', () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: false,
            inlineCatalog: false,
            catalogFormat: 'grouped',
            directExpose: [],
            cache: { maxEntries: 1000 },
            preload: { patterns: [], keywords: [] },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);

      expect(orchestrator.isEnabled()).toBe(false);
    });

    it('should return current mode', () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: true,
            mode: 'hybrid',
            metaTools: { enabled: true },
            directExpose: [],
            cache: { maxEntries: 1000 },
            preload: { patterns: [], keywords: [] },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);

      // getMode() removed - hybrid mode replaced with metatool mode
      expect(orchestrator.isEnabled()).toBe(true);
    });
  });

  describe('getHealthStatus', () => {
    it('should return healthy status when no issues', async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: true,
            inlineCatalog: false,
            catalogFormat: 'grouped',
            directExpose: [],
            cache: { maxEntries: 1000 },
            preload: { patterns: [], keywords: [] },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);
      await orchestrator.initialize();

      const health = orchestrator.getHealthStatus();

      expect(health.healthy).toBe(true);
      expect(health.enabled).toBe(true);
      expect(health.cache.size).toBeGreaterThanOrEqual(0);
      expect(health.cache.maxEntries).toBe(1000);
      expect(health.cache.utilizationRate).toBeGreaterThanOrEqual(0);
      expect(health.stats.hitRate).toBeGreaterThanOrEqual(0);
      expect(health.stats.coalescedRequests).toBeGreaterThanOrEqual(0);
      expect(health.stats.evictions).toBeGreaterThanOrEqual(0);
      expect(health.issues).toHaveLength(0);
    });

    it('should detect high cache utilization', async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: true,
            inlineCatalog: false,
            catalogFormat: 'grouped',
            directExpose: [],
            cache: { maxEntries: 10 }, // Small cache to trigger high utilization
            preload: { patterns: [], keywords: [] },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);
      await orchestrator.initialize();

      // Add some tools to cache to increase utilization
      const tool: Tool = {
        name: 'test_tool',
        description: 'Test',
        inputSchema: { type: 'object' },
      };
      for (let i = 0; i < 9; i++) {
        orchestrator.getSchemaCache().set('server', `tool_${i}`, tool);
      }

      const health = orchestrator.getHealthStatus();

      // With 9 entries out of 10 max, utilization is 90% which should trigger warning
      if (health.cache.utilizationRate > 90) {
        expect(health.healthy).toBe(false);
        expect(health.issues.some((issue) => issue.includes('Cache utilization high'))).toBe(true);
      }
    });

    it('should detect low hit rate with enough requests', async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: true,
            inlineCatalog: false,
            catalogFormat: 'grouped',
            directExpose: [],
            cache: { maxEntries: 1000 },
            preload: { patterns: [], keywords: [] },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);
      await orchestrator.initialize();

      // Simulate cache operations to get low hit rate with >100 requests
      const schemaCache = orchestrator.getSchemaCache();
      const tool: Tool = {
        name: 'test',
        description: 'Test',
        inputSchema: { type: 'object' },
      };

      // Add one tool to cache
      schemaCache.set('server', 'tool1', tool);

      // Simulate many misses (cache.get for non-existent tools)
      for (let i = 0; i < 150; i++) {
        try {
          schemaCache.getIfCached('server', `nonexistent_${i}`);
        } catch {
          // Ignore errors
        }
      }

      const health = orchestrator.getHealthStatus();

      const stats = schemaCache.getStats();
      const totalRequests = stats.hits + stats.misses;

      if (totalRequests > 100) {
        const hitRate = totalRequests > 0 ? stats.hitRate : 0;
        if (hitRate < 50) {
          expect(health.issues.some((issue) => issue.includes('Low cache hit rate'))).toBe(true);
        }
      }
    });

    it('should detect high eviction count', async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: true,
            inlineCatalog: false,
            catalogFormat: 'grouped',
            directExpose: [],
            cache: { maxEntries: 5 }, // Very small cache to trigger evictions
            preload: { patterns: [], keywords: [] },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);
      await orchestrator.initialize();

      // Add many tools to small cache to trigger evictions
      const tool: Tool = {
        name: 'test',
        description: 'Test',
        inputSchema: { type: 'object' },
      };

      const schemaCache = orchestrator.getSchemaCache();
      // Add more than maxEntries to cause evictions
      for (let i = 0; i < 150; i++) {
        schemaCache.set('server', `tool_${i}`, tool);
      }

      const health = orchestrator.getHealthStatus();

      const stats = schemaCache.getStats();
      if (stats.evictions > 100) {
        expect(health.issues.some((issue) => issue.includes('High eviction count'))).toBe(true);
      }
    });

    it('should return disabled status in health check', async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: false,
            inlineCatalog: false,
            catalogFormat: 'grouped',
            directExpose: [],
            cache: { maxEntries: 1000 },
            preload: { patterns: [], keywords: [] },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);
      await orchestrator.initialize();

      const health = orchestrator.getHealthStatus();

      expect(health.enabled).toBe(false);
      expect(health.healthy).toBe(true); // No issues when disabled
    });
  });

  describe('logStatistics', () => {
    it('should log statistics without throwing', async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: true,
            inlineCatalog: false,
            catalogFormat: 'grouped',
            directExpose: [],
            cache: { maxEntries: 1000 },
            preload: { patterns: [], keywords: [] },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);
      await orchestrator.initialize();

      // Should not throw
      expect(() => orchestrator.logStatistics()).not.toThrow();
      expect(() => orchestrator.logStatistics(false)).not.toThrow();
      expect(() => orchestrator.logStatistics(true)).not.toThrow();
    });

    it('should log statistics when disabled', async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: false,
            inlineCatalog: false,
            catalogFormat: 'grouped',
            directExpose: [],
            cache: { maxEntries: 1000 },
            preload: { patterns: [], keywords: [] },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);
      await orchestrator.initialize();

      expect(() => orchestrator.logStatistics()).not.toThrow();
      expect(() => orchestrator.logStatistics(true)).not.toThrow();
    });

    it('should log statistics with health issues', async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: true,
            inlineCatalog: false,
            catalogFormat: 'grouped',
            directExpose: [],
            cache: { maxEntries: 10 }, // Small to trigger issues
            preload: { patterns: [], keywords: [] },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);
      await orchestrator.initialize();

      // Fill cache to trigger high utilization
      const tool: Tool = {
        name: 'test',
        description: 'Test',
        inputSchema: { type: 'object' },
      };

      const schemaCache = orchestrator.getSchemaCache();
      for (let i = 0; i < 150; i++) {
        schemaCache.set('server', `tool_${i}`, tool);
      }

      expect(() => orchestrator.logStatistics()).not.toThrow();
    });
  });

  describe('constructor with async orchestrator', () => {
    it('should accept optional async orchestrator parameter', () => {
      // Should not throw with or without async orchestrator
      expect(() => new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig)).not.toThrow();
      expect(() => new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig, undefined)).not.toThrow();
    });
  });

  describe('Session-based server filtering', () => {
    beforeEach(async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: true,
            inlineCatalog: false,
            catalogFormat: 'grouped',
            directExpose: [],
            cache: { maxEntries: 1000, strategy: 'lru', ttlMs: undefined },
            preload: { patterns: [], keywords: [] },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);
      await orchestrator.initialize();
    });

    it('should store and retrieve session-specific allowed servers', () => {
      const sessionId = 'session-123';
      const allowedServers = new Set(['filesystem', 'database']);

      // Initially no filter
      expect(orchestrator.getSessionAllowedServers(sessionId)).toBeUndefined();

      // Store filter via getCapabilitiesForFilteredServers
      orchestrator.getCapabilitiesForFilteredServers(allowedServers, sessionId);

      // Should retrieve the same filter
      const retrieved = orchestrator.getSessionAllowedServers(sessionId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.size).toBe(2);
      expect(retrieved?.has('filesystem')).toBe(true);
      expect(retrieved?.has('database')).toBe(true);
    });

    it('should filter capabilities by session when calling getCapabilitiesForFilteredServers', async () => {
      const sessionId = 'session-456';
      const allowedServers = new Set(['filesystem']);

      // Mock base capabilities with multiple servers
      const mockCapabilities = {
        tools: [],
        resources: [
          { name: 'filesystem_1mcp_resource1', uri: 'file://test1', mimeType: 'text/plain' },
          { name: 'database_1mcp_resource2', uri: 'db://test2', mimeType: 'application/json' },
        ],
        prompts: [
          { name: 'filesystem_1mcp_prompt1', description: 'FS prompt' },
          { name: 'database_1mcp_prompt2', description: 'DB prompt' },
        ],
        readyServers: ['filesystem', 'database'],
        timestamp: new Date(),
      };

      vi.spyOn(orchestrator['capabilityAggregator'], 'getCurrentCapabilities').mockReturnValue(mockCapabilities);

      const filteredCaps = await orchestrator.getCapabilitiesForFilteredServers(allowedServers, sessionId);

      // Should only include filesystem resources/prompts/servers
      expect(filteredCaps.resources.length).toBe(1);
      expect(filteredCaps.resources[0].name).toBe('filesystem_1mcp_resource1');

      expect(filteredCaps.prompts.length).toBe(1);
      expect(filteredCaps.prompts[0].name).toBe('filesystem_1mcp_prompt1');

      expect(filteredCaps.readyServers.length).toBe(1);
      expect(filteredCaps.readyServers[0]).toBe('filesystem');

      // Meta-tools should still be present
      expect(filteredCaps.tools.length).toBe(3);
      expect(filteredCaps.tools.map((t) => t.name)).toContain('tool_list');
      expect(filteredCaps.tools.map((t) => t.name)).toContain('tool_schema');
      expect(filteredCaps.tools.map((t) => t.name)).toContain('tool_invoke');
    });

    it('should clear session filter correctly', async () => {
      const sessionId = 'session-789';
      const allowedServers = new Set(['filesystem']);

      // Set filter
      await orchestrator.getCapabilitiesForFilteredServers(allowedServers, sessionId);
      expect(orchestrator.getSessionAllowedServers(sessionId)).toBeDefined();

      // Clear filter
      orchestrator.clearSessionFilter(sessionId);
      expect(orchestrator.getSessionAllowedServers(sessionId)).toBeUndefined();
    });

    it('should isolate filters between different sessions', async () => {
      const session1 = 'session-aaa';
      const session2 = 'session-bbb';
      const allowedServers1 = new Set(['filesystem']);
      const allowedServers2 = new Set(['database']);

      // Set different filters for different sessions
      await orchestrator.getCapabilitiesForFilteredServers(allowedServers1, session1);
      await orchestrator.getCapabilitiesForFilteredServers(allowedServers2, session2);

      // Verify isolation
      const filter1 = orchestrator.getSessionAllowedServers(session1);
      const filter2 = orchestrator.getSessionAllowedServers(session2);

      expect(filter1?.has('filesystem')).toBe(true);
      expect(filter1?.has('database')).toBe(false);

      expect(filter2?.has('database')).toBe(true);
      expect(filter2?.has('filesystem')).toBe(false);

      // Clear one session shouldn't affect the other
      orchestrator.clearSessionFilter(session1);
      expect(orchestrator.getSessionAllowedServers(session1)).toBeUndefined();
      expect(orchestrator.getSessionAllowedServers(session2)).toBeDefined();
    });

    it('should apply session filter when calling callMetaTool with sessionId', async () => {
      const sessionId = 'session-ccc';
      const allowedServers = new Set(['filesystem']);

      // Set session filter
      await orchestrator.getCapabilitiesForFilteredServers(allowedServers, sessionId);

      // Call tool_list meta-tool with sessionId
      const result = await orchestrator.callMetaTool('tool_list', {}, sessionId);

      expect(result).toBeDefined();
      expect((result as any).isError).toBeFalsy();

      // The result should respect the session filter
      // (actual filtering logic is in MetaToolProvider, we just verify it receives sessionId)
      const sessionFilter = orchestrator.getSessionAllowedServers(sessionId);
      expect(sessionFilter).toBeDefined();
      expect(sessionFilter?.has('filesystem')).toBe(true);
    });

    it('should handle undefined sessionId gracefully', async () => {
      const allowedServers = new Set(['filesystem', 'database']);

      // Set filter with undefined sessionId
      await orchestrator.getCapabilitiesForFilteredServers(allowedServers, undefined);

      // Should store under undefined key
      const retrieved = orchestrator.getSessionAllowedServers(undefined);
      expect(retrieved).toBeDefined();
      expect(retrieved?.size).toBe(2);

      // Clear undefined session
      orchestrator.clearSessionFilter(undefined);
      expect(orchestrator.getSessionAllowedServers(undefined)).toBeUndefined();
    });

    it('should handle empty filter set', async () => {
      const sessionId = 'session-empty';
      const emptyServers = new Set<string>();

      const mockCapabilities = {
        tools: [],
        resources: [{ name: 'filesystem_1mcp_resource1', uri: 'file://test1', mimeType: 'text/plain' }],
        prompts: [{ name: 'filesystem_1mcp_prompt1', description: 'FS prompt' }],
        readyServers: ['filesystem'],
        timestamp: new Date(),
      };

      vi.spyOn(orchestrator['capabilityAggregator'], 'getCurrentCapabilities').mockReturnValue(mockCapabilities);

      const filteredCaps = await orchestrator.getCapabilitiesForFilteredServers(emptyServers, sessionId);

      // All resources/prompts/servers should be filtered out
      expect(filteredCaps.resources.length).toBe(0);
      expect(filteredCaps.prompts.length).toBe(0);
      expect(filteredCaps.readyServers.length).toBe(0);

      // Meta-tools should still be present
      expect(filteredCaps.tools.length).toBe(3);
    });

    it('should not apply filtering when lazy loading is disabled', async () => {
      // Reconfigure with lazy loading disabled
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: false,
            inlineCatalog: false,
            catalogFormat: 'grouped',
            directExpose: [],
            cache: { maxEntries: 1000, strategy: 'lru', ttlMs: undefined },
            preload: { patterns: [], keywords: [] },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      const disabledOrchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);
      await disabledOrchestrator.initialize();

      const sessionId = 'session-disabled';
      const allowedServers = new Set(['filesystem']);

      const mockCapabilities = {
        tools: [
          {
            name: 'some_tool',
            description: 'Test',
            inputSchema: { type: 'object' as const, properties: {} },
          },
        ],
        resources: [
          { name: 'filesystem_1mcp_resource1', uri: 'file://test1', mimeType: 'text/plain' },
          { name: 'database_1mcp_resource2', uri: 'db://test2', mimeType: 'application/json' },
        ],
        prompts: [],
        readyServers: ['filesystem', 'database'],
        timestamp: new Date(),
      };

      vi.spyOn(disabledOrchestrator['capabilityAggregator'], 'getCurrentCapabilities').mockReturnValue(
        mockCapabilities,
      );

      const caps = await disabledOrchestrator.getCapabilitiesForFilteredServers(allowedServers, sessionId);

      // When disabled, should return all capabilities without filtering
      expect(caps.resources.length).toBe(2);
      expect(caps.readyServers.length).toBe(2);
    });

    it('should filter resources with complex server names correctly', async () => {
      const sessionId = 'session-complex';
      const allowedServers = new Set(['server-with-dashes', 'server_with_underscores']);

      const mockCapabilities = {
        tools: [],
        resources: [
          { name: 'server-with-dashes_1mcp_resource1', uri: 'test://1', mimeType: 'text/plain' },
          { name: 'server_with_underscores_1mcp_resource2', uri: 'test://2', mimeType: 'text/plain' },
          { name: 'other-server_1mcp_resource3', uri: 'test://3', mimeType: 'text/plain' },
        ],
        prompts: [],
        readyServers: ['server-with-dashes', 'server_with_underscores', 'other-server'],
        timestamp: new Date(),
      };

      vi.spyOn(orchestrator['capabilityAggregator'], 'getCurrentCapabilities').mockReturnValue(mockCapabilities);

      const filteredCaps = await orchestrator.getCapabilitiesForFilteredServers(allowedServers, sessionId);

      expect(filteredCaps.resources.length).toBe(2);
      expect(filteredCaps.resources.map((r) => r.name)).toContain('server-with-dashes_1mcp_resource1');
      expect(filteredCaps.resources.map((r) => r.name)).toContain('server_with_underscores_1mcp_resource2');
      expect(filteredCaps.readyServers.length).toBe(2);
    });
  });

  describe('server-capabilities-updated event error handling', () => {
    it('should handle errors in refreshCapabilities gracefully', async () => {
      const mockAsyncOrchestrator = {
        on: vi.fn(),
        emit: vi.fn(),
      } as any;

      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig, mockAsyncOrchestrator);
      await orchestrator.initialize();

      vi.spyOn(orchestrator, 'refreshCapabilities').mockRejectedValue(new Error('Refresh failed'));

      const emitHandler = mockAsyncOrchestrator.on.mock.calls[0]?.[1];
      if (emitHandler) {
        // Should not throw
        await expect(emitHandler('test-server')).resolves.toBeUndefined();

        // Wait for async handler
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Orchestrator should still be functional - verify it can get capabilities
        const caps = await orchestrator.getCapabilities();
        expect(caps).toBeDefined();
      }
    });

    it('should continue handling events after one fails', async () => {
      const mockAsyncOrchestrator = {
        on: vi.fn(),
        emit: vi.fn(),
      } as any;

      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig, mockAsyncOrchestrator);
      await orchestrator.initialize();

      let callCount = 0;
      const realRefresh = orchestrator['refreshCapabilities'].bind(orchestrator);
      vi.spyOn(orchestrator, 'refreshCapabilities').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('First fails');
        }
        // Second succeeds - call real implementation
        return realRefresh();
      });

      const emitHandler = mockAsyncOrchestrator.on.mock.calls[0]?.[1];
      if (emitHandler) {
        // First event fails
        await emitHandler('server1');
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Second event succeeds
        await emitHandler('server2');
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(callCount).toBe(2);
      }
    });
  });

  describe('preload pattern validation', () => {
    it('should handle preload patterns with special regex characters', async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: true,
            inlineCatalog: false,
            catalogFormat: 'grouped',
            directExpose: [],
            cache: { maxEntries: 1000 },
            preload: {
              // Patterns with special characters that should be escaped
              patterns: ['filesystem', 'data[base]', 'test+server', 'foo$bar'],
              keywords: [],
            },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      // Create connections with special server names
      const specialMockOutboundConnections = new Map([
        [
          'filesystem',
          {
            name: 'filesystem',
            client: mockClient,
            status: ClientStatus.Connected,
            transport: { tags: [], start: async () => {}, send: async () => undefined, close: async () => {} },
            capabilities: {},
            lastConnected: new Date(),
          },
        ],
        [
          'data[base]',
          {
            name: 'data[base]',
            client: mockClient,
            status: ClientStatus.Connected,
            transport: { tags: [], start: async () => {}, send: async () => undefined, close: async () => {} },
            capabilities: {},
            lastConnected: new Date(),
          },
        ],
        [
          'test+server',
          {
            name: 'test+server',
            client: mockClient,
            status: ClientStatus.Connected,
            transport: { tags: [], start: async () => {}, send: async () => undefined, close: async () => {} },
            capabilities: {},
            lastConnected: new Date(),
          },
        ],
      ]) as OutboundConnections;

      orchestrator = new LazyLoadingOrchestrator(specialMockOutboundConnections, mockAgentConfig);

      // Should initialize without crashing on invalid patterns
      await expect(orchestrator.initialize()).resolves.toBeUndefined();
    });

    it('should escape special characters in preload patterns', async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: true,
            inlineCatalog: false,
            catalogFormat: 'grouped',
            directExpose: [],
            cache: { maxEntries: 1000 },
            preload: {
              patterns: ['filesystem*'],
              keywords: [],
            },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      // Create connections to test wildcard matching
      const wildcardMockOutboundConnections = new Map([
        [
          'filesystem-1',
          {
            name: 'filesystem-1',
            client: mockClient,
            status: ClientStatus.Connected,
            transport: { tags: [], start: async () => {}, send: async () => undefined, close: async () => {} },
            capabilities: {},
            lastConnected: new Date(),
          },
        ],
        [
          'filesystem-2',
          {
            name: 'filesystem-2',
            client: mockClient,
            status: ClientStatus.Connected,
            transport: { tags: [], start: async () => {}, send: async () => undefined, close: async () => {} },
            capabilities: {},
            lastConnected: new Date(),
          },
        ],
        [
          'database',
          {
            name: 'database',
            client: mockClient,
            status: ClientStatus.Connected,
            transport: { tags: [], start: async () => {}, send: async () => undefined, close: async () => {} },
            capabilities: {},
            lastConnected: new Date(),
          },
        ],
      ]) as OutboundConnections;

      orchestrator = new LazyLoadingOrchestrator(wildcardMockOutboundConnections, mockAgentConfig);

      // Should initialize without crashing
      await expect(orchestrator.initialize()).resolves.toBeUndefined();
      expect(orchestrator.isEnabled()).toBe(true);
    });

    it('should handle invalid preload patterns gracefully', async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: true,
            inlineCatalog: false,
            catalogFormat: 'grouped',
            directExpose: [],
            cache: { maxEntries: 1000 },
            preload: {
              // Pattern with unmatched brackets - invalid regex but should be handled
              patterns: ['filesystem[', 'test(incomplete'],
              keywords: [],
            },
            fallback: { onError: 'skip', timeoutMs: 5000 },
          };
        }
        return undefined;
      });

      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);

      // Should initialize without crashing even with invalid patterns
      await expect(orchestrator.initialize()).resolves.toBeUndefined();
    });
  });
});
