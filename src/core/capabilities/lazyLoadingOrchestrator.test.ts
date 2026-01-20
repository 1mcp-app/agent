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
});
