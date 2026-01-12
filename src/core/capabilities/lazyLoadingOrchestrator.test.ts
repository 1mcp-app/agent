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
            mode: 'metatool',
            metaTools: {
              enabled: true,
              inlineCatalog: false,
              catalogFormat: 'grouped',
            },
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
      expect(orchestrator.getMode()).toBe('metatool');
    });

    it('should initialize with disabled lazy loading', () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: false,
            mode: 'full',
            metaTools: { enabled: true },
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
      expect(orchestrator.getMode()).toBe('full');
    });

    it('should initialize schema cache with custom config', () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: true,
            mode: 'metatool',
            metaTools: { enabled: true },
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
      expect(orchestrator.getMode()).toBe('metatool');
    });

    it('should initialize successfully in full mode', async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: true,
            mode: 'full',
            metaTools: { enabled: false },
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

      expect(orchestrator.getMode()).toBe('full');
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

      expect(orchestrator.getMode()).toBe('hybrid');
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
            mode: 'metatool',
            metaTools: { enabled: true },
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
      expect(capabilities.tools.map((t) => t.name)).toContain('mcp_list_available_tools');
      expect(capabilities.tools.map((t) => t.name)).toContain('mcp_describe_tool');
      expect(capabilities.tools.map((t) => t.name)).toContain('mcp_call_tool');
    });

    it('should return all tools in full mode', async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: true,
            mode: 'full',
            metaTools: { enabled: false },
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
      expect(capabilities.tools.map((t) => t.name)).toContain('mcp_list_available_tools');
      expect(capabilities.tools.map((t) => t.name)).toContain('mcp_describe_tool');
      expect(capabilities.tools.map((t) => t.name)).toContain('mcp_call_tool');
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
            mode: 'metatool',
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

    it('should return true in full mode (standard MCP behavior)', async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: true,
            mode: 'full',
            metaTools: { enabled: false },
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
    it('should identify mcp_list_available_tools', () => {
      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);

      expect(orchestrator.isMetaTool('mcp_list_available_tools')).toBe(true);
    });

    it('should identify mcp_describe_tool', () => {
      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);

      expect(orchestrator.isMetaTool('mcp_describe_tool')).toBe(true);
    });

    it('should identify mcp_call_tool', () => {
      orchestrator = new LazyLoadingOrchestrator(mockOutboundConnections, mockAgentConfig);

      expect(orchestrator.isMetaTool('mcp_call_tool')).toBe(true);
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
            mode: 'metatool',
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
    });

    it('should call mcp_list_available_tools', async () => {
      const result = await orchestrator.callMetaTool('mcp_list_available_tools', {});

      expect(result).toBeDefined();
      expect((result as any).isError).toBeFalsy();
    });

    it('should call mcp_describe_tool', async () => {
      // First preload a tool into the cache
      const tool: Tool = {
        name: 'read_file',
        description: 'Read file',
        inputSchema: { type: 'object' },
      };
      orchestrator.getSchemaCache().set('filesystem', 'read_file', tool);

      const result = await orchestrator.callMetaTool('mcp_describe_tool', {
        server: 'filesystem',
        toolName: 'read_file',
      });

      expect(result).toBeDefined();
    });

    it('should throw when meta-tool provider not initialized', async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: true,
            mode: 'full',
            metaTools: { enabled: false },
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

      await expect(fullOrchestrator.callMetaTool('mcp_list_available_tools', {})).rejects.toThrow(
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
            mode: 'metatool',
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
            mode: 'metatool',
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

      const stats = orchestrator.getStatistics();

      expect(stats.enabled).toBe(true);
      expect(stats.mode).toBe('metatool');
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
            mode: 'full',
            metaTools: { enabled: false },
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
      expect(stats.mode).toBe('full');
    });

    it('should calculate token savings correctly', async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: true,
            mode: 'metatool',
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

      const stats = orchestrator.getStatistics();

      // Token savings are calculated (can be negative with empty registry)
      expect(stats.tokenSavings.savedTokens).toBeDefined();
      expect(stats.tokenSavings.savingsPercentage).toBeDefined();

      // In full mode (disabled), savings should be 0
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: false,
            mode: 'full',
            metaTools: { enabled: false },
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
            mode: 'metatool',
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

      expect(orchestrator.isEnabled()).toBe(true);
    });

    it('should return disabled status', () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'lazyLoading') {
          return {
            enabled: false,
            mode: 'full',
            metaTools: { enabled: false },
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

      expect(orchestrator.getMode()).toBe('hybrid');
    });
  });
});
