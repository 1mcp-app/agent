/**
 * Unit tests for discovery handlers
 *
 * This module tests the MCP discovery and information tool handlers
 * to ensure they return properly structured data matching their output schemas.
 */
import { FlagManager } from '@src/core/flags/flagManager.js';
import { AdapterFactory } from '@src/core/tools/internal/adapters/index.js';
import type { RegistryServer } from '@src/domains/registry/types.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cleanupDiscoveryHandlers,
  handleMcpInfo,
  handleMcpRegistryInfo,
  handleMcpRegistryList,
  handleMcpRegistryStatus,
  handleMcpSearch,
} from './discoveryHandlers.js';
import {
  McpInfoOutputSchema,
  McpRegistryInfoOutputSchema,
  McpRegistryListOutputSchema,
  McpRegistryStatusOutputSchema,
  McpSearchOutputSchema,
} from './schemas/discovery.js';

// Mock dependencies
vi.mock('@src/core/flags/flagManager.js');
vi.mock('@src/logger/logger.js', () => ({
  default: {
    error: vi.fn(),
  },
  debugIf: vi.fn(),
  infoIf: vi.fn(),
  warnIf: vi.fn(),
  errorIf: vi.fn(),
  logger: {
    error: vi.fn(),
  },
}));

// Mock adapters
vi.mock('@src/core/tools/internal/adapters/index.js', () => ({
  AdapterFactory: {
    getDiscoveryAdapter: vi.fn(),
    cleanup: vi.fn(),
    reset: vi.fn(),
  },
}));

describe('discoveryHandlers', () => {
  let flagManager: any;
  let mockDiscoveryAdapter: any;

  beforeEach(() => {
    vi.clearAllMocks();
    flagManager = {
      isToolEnabled: vi.fn().mockReturnValue(true),
    } as any;
    (FlagManager.getInstance as any).mockReturnValue(flagManager);

    // Mock discovery adapter
    mockDiscoveryAdapter = {
      searchServers: vi.fn(),
      getServerById: vi.fn(),
      getRegistryStatus: vi.fn(),
      discoverInstalledApps: vi.fn(),
      discoverAppConfigs: vi.fn(),
      checkAppConsolidationStatus: vi.fn(),
      destroy: vi.fn(),
    };
    (AdapterFactory.getDiscoveryAdapter as any).mockReturnValue(mockDiscoveryAdapter);
  });

  afterEach(() => {
    cleanupDiscoveryHandlers();
    vi.restoreAllMocks();
  });

  describe('handleMcpSearch', () => {
    it('should return structured data matching output schema', async () => {
      const mockServers: RegistryServer[] = [
        {
          name: 'test-server',
          description: 'Test MCP server',
          version: '1.0.0',
          status: 'active',
          repository: {
            source: 'github',
            url: 'https://github.com/test/test-server',
          },
          packages: [
            {
              identifier: 'test-server',
              registryType: 'npm',
              transport: {
                type: 'stdio',
              },
            },
          ],
          _meta: {
            'io.modelcontextprotocol.registry/official': {
              isLatest: true,
              publishedAt: '2023-01-01T00:00:00Z',
              status: 'active',
              updatedAt: '2023-01-01T00:00:00Z',
            },
            tags: ['test'],
            author: 'Test Author',
            downloads: 1000,
          },
        },
      ];
      mockDiscoveryAdapter.searchServers.mockResolvedValue(mockServers);

      const args = {
        query: 'test',
        status: 'active' as const,
        limit: 10,
        cursor: undefined,
        transport: undefined,
        tags: undefined,
        category: undefined,
        format: 'json' as const,
        offset: undefined,
        type: undefined,
      };

      const result = await handleMcpSearch(args);

      expect(result).toEqual({
        results: expect.arrayContaining([
          expect.objectContaining({
            name: 'test-server',
            version: '1.0.0',
            description: 'Test MCP server',
            author: 'Test Author',
            tags: ['test'],
            transport: ['stdio'],
            registry: 'official',
            downloads: 1000,
            installationMethod: 'package',
            installationHint: 'Installable via npm packages',
            prerequisiteHint: '',
            hasEnvironmentVariables: false,
            hasPackageArguments: false,
            hasRuntimeArguments: false,
            installable: true,
          }),
        ]),
        total: 1,
        query: 'test',
        registry: 'official',
      });

      // Verify schema validation
      const validated = McpSearchOutputSchema.parse(result);
      expect(validated).toBeDefined();

      expect(mockDiscoveryAdapter.searchServers).toHaveBeenCalledWith('test', {
        limit: 10,
        cursor: undefined,
        transport: undefined,
        status: 'active',
        registry_type: undefined,
      });
    });

    it('should handle empty results', async () => {
      mockDiscoveryAdapter.searchServers.mockResolvedValue([]);

      const args = {
        query: 'nonexistent',
        status: 'active' as const,
        format: 'table' as const,
        limit: 20,
        offset: undefined,
        transport: undefined,
        tags: undefined,
        category: undefined,
        cursor: undefined,
        type: undefined,
      };

      const result = await handleMcpSearch(args);

      expect(result).toEqual({
        results: [],
        total: 0,
        query: 'nonexistent',
        registry: 'official',
      });

      // Verify schema validation
      const validated = McpSearchOutputSchema.parse(result);
      expect(validated).toBeDefined();
    });

    it('should handle servers without packages', async () => {
      const mockServers: RegistryServer[] = [
        {
          name: 'no-packages-server',
          description: 'Server without packages',
          version: '1.0.0',
          status: 'active',
          repository: {
            source: 'github',
            url: 'https://github.com/test/no-packages-server',
          },
          _meta: {
            'io.modelcontextprotocol.registry/official': {
              isLatest: true,
              publishedAt: '2023-01-01T00:00:00Z',
              status: 'active',
              updatedAt: '2023-01-01T00:00:00Z',
            },
          },
        },
      ];
      mockDiscoveryAdapter.searchServers.mockResolvedValue(mockServers);

      const args = {
        query: 'no-packages',
        status: 'active' as const,
        format: 'table' as const,
        limit: 20,
        offset: undefined,
        transport: undefined,
        tags: undefined,
        category: undefined,
        cursor: undefined,
        type: undefined,
      };

      const result = await handleMcpSearch(args);

      expect(result.results[0].transport).toEqual([]);
    });

    it('should throw error on adapter failure', async () => {
      mockDiscoveryAdapter.searchServers.mockRejectedValue(new Error('Search failed'));

      const args = {
        query: 'test',
        status: 'active' as const,
        format: 'table' as const,
        limit: 20,
        offset: undefined,
        transport: undefined,
        tags: undefined,
        category: undefined,
        cursor: undefined,
        type: undefined,
      };

      await expect(handleMcpSearch(args)).rejects.toThrow('Search failed: Search failed');
    });
  });

  describe('handleMcpRegistryStatus', () => {
    it('should return structured data for online registry', async () => {
      const mockStatus = {
        available: true,
        url: 'https://registry.modelcontextprotocol.io',
        response_time_ms: 150,
        last_updated: '2023-01-01T00:00:00Z',
        stats: {
          total_servers: 100,
          active_servers: 80,
        },
      };
      mockDiscoveryAdapter.getRegistryStatus.mockResolvedValue(mockStatus);

      const args = {
        registry: 'official',
        includeStats: true,
      };

      const result = await handleMcpRegistryStatus(args);

      expect(result).toEqual({
        registry: 'official',
        status: 'online',
        responseTime: 150,
        lastCheck: '2023-01-01T00:00:00Z',
        error: undefined,
        metadata: {
          version: '1.0.0',
          supportedFormats: ['json', 'table'],
          totalServers: 100,
          active_servers: 80,
        },
      });

      // Verify schema validation
      const validated = McpRegistryStatusOutputSchema.parse(result);
      expect(validated).toBeDefined();

      expect(mockDiscoveryAdapter.getRegistryStatus).toHaveBeenCalledWith(true);
    });

    it('should return offline status for unavailable registry', async () => {
      const mockStatus = {
        available: false,
        url: 'https://registry.modelcontextprotocol.io',
        response_time_ms: 5000,
        last_updated: '2023-01-01T00:00:00Z',
      };
      mockDiscoveryAdapter.getRegistryStatus.mockResolvedValue(mockStatus);

      const args = {
        registry: 'official',
        includeStats: false,
      };

      const result = await handleMcpRegistryStatus(args);

      expect(result.status).toBe('offline');
      expect(result.error).toBe('Registry unavailable');
    });

    it('should throw error on adapter failure', async () => {
      mockDiscoveryAdapter.getRegistryStatus.mockRejectedValue(new Error('Registry error'));

      const args = { registry: 'official', includeStats: false };

      await expect(handleMcpRegistryStatus(args)).rejects.toThrow('Registry status check failed: Registry error');
    });
  });

  describe('handleMcpRegistryInfo', () => {
    it('should return structured data with default registry', async () => {
      const args = {
        registry: 'official',
      };

      const result = await handleMcpRegistryInfo(args);

      expect(result).toEqual({
        name: 'official',
        url: 'https://registry.modelcontextprotocol.io',
        description: 'The official Model Context Protocol server registry',
        version: '1.0.0',
        supportedFormats: ['json', 'table'],
        features: ['search', 'get', 'list'],
        statistics: {
          totalPackages: 150,
          lastUpdated: expect.any(String),
        },
      });

      // Verify schema validation
      const validated = McpRegistryInfoOutputSchema.parse(result);
      expect(validated).toBeDefined();
    });

    it('should return structured data with custom registry', async () => {
      const args = {
        registry: 'custom',
      };

      const result = await handleMcpRegistryInfo(args);

      expect(result.name).toBe('custom');
    });
  });

  describe('handleMcpRegistryList', () => {
    it('should return structured data without stats', async () => {
      const args = {
        includeStats: false,
      };

      const result = await handleMcpRegistryList(args);

      expect(result).toEqual({
        registries: expect.arrayContaining([
          {
            name: 'Official MCP Registry',
            url: 'https://registry.modelcontextprotocol.io',
            status: 'online',
            description: 'The official Model Context Protocol server registry',
            packageCount: undefined,
          },
          {
            name: 'Community Registry',
            url: 'https://community-registry.modelcontextprotocol.io',
            status: 'online',
            description: 'Community-contributed MCP servers',
            packageCount: undefined,
          },
          {
            name: 'Experimental Registry',
            url: 'https://experimental-registry.modelcontextprotocol.io',
            status: 'unknown',
            description: 'Experimental and cutting-edge MCP servers',
            packageCount: undefined,
          },
        ]),
        total: 3,
      });

      // Verify schema validation
      const validated = McpRegistryListOutputSchema.parse(result);
      expect(validated).toBeDefined();
    });

    it('should return structured data with stats', async () => {
      const args = {
        includeStats: true,
      };

      const result = await handleMcpRegistryList(args);

      expect(result.registries[0].packageCount).toBe(150);
      expect(result.registries[1].packageCount).toBe(75);
      expect(result.registries[2].packageCount).toBe(25);
    });

    it('should include all expected registries', async () => {
      const args = {
        includeStats: false,
      };

      const result = await handleMcpRegistryList(args);

      const registryNames = result.registries.map((r) => r.name);
      expect(registryNames).toContain('Official MCP Registry');
      expect(registryNames).toContain('Community Registry');
      expect(registryNames).toContain('Experimental Registry');
    });
  });

  describe('handleMcpInfo', () => {
    it('should return structured data for found server', async () => {
      const mockServer: RegistryServer = {
        name: 'test-server',
        description: 'Test MCP server',
        version: '1.0.0',
        status: 'active',
        repository: {
          source: 'github',
          url: 'https://github.com/test/test-server',
        },
        packages: [
          {
            identifier: 'test-server',
            registryType: 'npm',
            transport: {
              type: 'stdio',
            },
          },
        ],
        _meta: {
          'io.modelcontextprotocol.registry/official': {
            isLatest: true,
            publishedAt: '2023-01-01T00:00:00Z',
            status: 'active',
            updatedAt: '2023-01-01T00:00:00Z',
          },
          tags: ['test', 'mcp'],
          capabilities: {
            tools: {
              count: 5,
              list: true,
            },
            resources: {
              count: 3,
              subscribe: true,
              list: true,
            },
            prompts: {
              count: 2,
              list: false,
            },
          },
        },
      };
      mockDiscoveryAdapter.getServerById.mockResolvedValue(mockServer);

      const args = {
        name: 'test-server',
        includeCapabilities: true,
        includeConfig: true,
        format: 'table' as const,
      };

      const result = await handleMcpInfo(args);

      expect(result).toEqual({
        server: {
          name: 'test-server',
          status: 'unknown',
          transport: 'stdio',
        },
        configuration: {
          command: 'test-server',
          tags: ['test', 'mcp'],
          autoRestart: false,
          enabled: true,
        },
        capabilities: {
          tools: expect.arrayContaining([
            { name: 'tool_0', description: 'Tool 0' },
            { name: 'tool_1', description: 'Tool 1' },
            { name: 'tool_2', description: 'Tool 2' },
            { name: 'tool_3', description: 'Tool 3' },
            { name: 'tool_4', description: 'Tool 4' },
          ]),
          resources: expect.arrayContaining([
            { uri: 'resource://0', name: 'Resource 0' },
            { uri: 'resource://1', name: 'Resource 1' },
            { uri: 'resource://2', name: 'Resource 2' },
          ]),
          prompts: expect.arrayContaining([
            { name: 'prompt_0', description: 'Prompt 0' },
            { name: 'prompt_1', description: 'Prompt 1' },
          ]),
        },
        health: {
          status: 'unknown',
          lastCheck: expect.any(String),
        },
      });

      // Verify schema validation
      const validated = McpInfoOutputSchema.parse(result);
      expect(validated).toBeDefined();

      expect(mockDiscoveryAdapter.getServerById).toHaveBeenCalledWith('test-server', undefined);
    });

    it('should return structured data for server not found', async () => {
      mockDiscoveryAdapter.getServerById.mockResolvedValue(null);

      const args = {
        name: 'nonexistent-server',
        includeCapabilities: true,
        includeConfig: true,
        format: 'table' as const,
      };

      const result = await handleMcpInfo(args);

      expect(result).toEqual({
        server: {
          name: 'nonexistent-server',
          status: 'unknown',
          transport: 'stdio',
        },
      });

      expect(mockDiscoveryAdapter.getServerById).toHaveBeenCalledWith('nonexistent-server', undefined);
    });

    it('should handle server without capabilities', async () => {
      const mockServer: RegistryServer = {
        name: 'basic-server',
        description: 'Basic MCP server',
        version: '1.0.0',
        status: 'active',
        repository: {
          source: 'github',
          url: 'https://github.com/test/basic-server',
        },
        _meta: {
          'io.modelcontextprotocol.registry/official': {
            isLatest: true,
            publishedAt: '2023-01-01T00:00:00Z',
            status: 'active',
            updatedAt: '2023-01-01T00:00:00Z',
          },
        },
      };
      mockDiscoveryAdapter.getServerById.mockResolvedValue(mockServer);

      const args = {
        name: 'basic-server',
        includeCapabilities: false,
        includeConfig: false,
        format: 'table' as const,
      };

      const result = await handleMcpInfo(args);

      expect(result.capabilities?.tools).toEqual([]);
      expect(result.capabilities?.resources).toEqual([]);
      expect(result.capabilities?.prompts).toEqual([]);
    });

    it('should throw error on adapter failure', async () => {
      mockDiscoveryAdapter.getServerById.mockRejectedValue(new Error('Server lookup failed'));

      const args = {
        name: 'test-server',
        includeCapabilities: false,
        includeConfig: false,
        format: 'table' as const,
      };

      await expect(handleMcpInfo(args)).rejects.toThrow('Server info check failed: Server lookup failed');
    });
  });

  describe('Schema Validation', () => {
    it('should validate all handlers return data matching their schemas', async () => {
      // Mock all adapter calls for comprehensive validation
      const mockServer: RegistryServer = {
        name: 'test-server',
        description: 'Test MCP server',
        version: '1.0.0',
        status: 'active',
        repository: {
          source: 'github',
          url: 'https://github.com/test/test-server',
        },
        packages: [
          {
            identifier: 'test-server',
            registryType: 'npm',
            transport: {
              type: 'stdio',
            },
          },
        ],
        _meta: {
          'io.modelcontextprotocol.registry/official': {
            isLatest: true,
            publishedAt: '2023-01-01T00:00:00Z',
            status: 'active',
            updatedAt: '2023-01-01T00:00:00Z',
          },
        },
      };

      const mockStatus = {
        available: true,
        url: 'https://registry.modelcontextprotocol.io',
        response_time_ms: 150,
        last_updated: '2023-01-01T00:00:00Z',
      };

      mockDiscoveryAdapter.searchServers.mockResolvedValue([mockServer]);
      mockDiscoveryAdapter.getRegistryStatus.mockResolvedValue(mockStatus);
      mockDiscoveryAdapter.getServerById.mockResolvedValue(mockServer);

      // Test all handlers and validate schemas
      const searchResult = await handleMcpSearch({ query: 'test', status: 'all', limit: 10, format: 'table' });
      const statusResult = await handleMcpRegistryStatus({ registry: 'official', includeStats: true });
      const infoResult = await handleMcpRegistryInfo({ registry: 'official' });
      const listResult = await handleMcpRegistryList({ includeStats: true });
      const serverInfoResult = await handleMcpInfo({
        name: 'test-server',
        includeCapabilities: true,
        includeConfig: true,
        format: 'table',
      });

      // All these should not throw if schemas match
      expect(McpSearchOutputSchema.parse(searchResult)).toBeDefined();
      expect(McpRegistryStatusOutputSchema.parse(statusResult)).toBeDefined();
      expect(McpRegistryInfoOutputSchema.parse(infoResult)).toBeDefined();
      expect(McpRegistryListOutputSchema.parse(listResult)).toBeDefined();
      expect(McpInfoOutputSchema.parse(serverInfoResult)).toBeDefined();
    });
  });

  describe('cleanupDiscoveryHandlers', () => {
    it('should cleanup without errors', () => {
      expect(() => cleanupDiscoveryHandlers()).not.toThrow();
    });
  });
});
