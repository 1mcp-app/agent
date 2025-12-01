/**
 * Tests for discovery handlers
 */
import { FlagManager } from '@src/core/flags/flagManager.js';
import { AdapterFactory } from '@src/core/tools/internal/adapters/index.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cleanupDiscoveryHandlers,
  handleMcpInfo,
  handleMcpRegistryInfo,
  handleMcpRegistryList,
  handleMcpRegistryStatus,
  handleMcpSearch,
} from './discoveryHandlers.js';

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
    it('should execute search successfully', async () => {
      const mockServers = [{ name: 'test-server', version: '1.0.0' }];
      mockDiscoveryAdapter.searchServers.mockResolvedValue(mockServers);

      const args = {
        status: 'all' as const,
        format: 'json' as const,
        query: 'test',
        limit: 10,
        offset: 0,
        transport: undefined,
        tags: undefined,
      };

      const result = await handleMcpSearch(args);

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.servers).toHaveLength(1);
      expect(resultData.servers[0]).toMatchObject({
        name: 'test-server',
        version: '1.0.0',
        registryId: 'official',
      });
      expect(resultData.servers[0].lastUpdated).toBeTypeOf('string');
      expect(resultData.count).toBe(1);
      expect(mockDiscoveryAdapter.searchServers).toHaveBeenCalledWith('test', {
        limit: 10,
        cursor: undefined,
        transport: undefined,
        status: 'all',
        registry_type: undefined,
      });
    });

    it('should handle search errors', async () => {
      mockDiscoveryAdapter.searchServers.mockRejectedValue(new Error('Search failed'));

      const args = {
        query: 'test',
        status: 'active' as const,
        format: 'table' as const,
        limit: 20,
        offset: 0,
        transport: undefined,
        tags: undefined,
        category: undefined,
      };

      const result = await handleMcpSearch(args);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'Search failed',
              message: 'Search failed: Search failed',
            }),
          },
        ],
        isError: true,
      });
    });
  });

  describe('handleMcpRegistryStatus', () => {
    it('should return registry status', async () => {
      const mockStatus = {
        available: true,
        url: 'https://registry.modelcontextprotocol.io',
        response_time_ms: 125,
        last_updated: '2023-01-01T00:00:00Z',
        stats: {
          total_servers: 150,
          active_servers: 120,
          deprecated_servers: 5,
          by_registry_type: { official: 150 },
          by_transport: { stdio: 100, sse: 50 },
        },
      };
      mockDiscoveryAdapter.getRegistryStatus.mockResolvedValue(mockStatus);

      const args = {
        registry: 'official',
        includeStats: true,
      };

      const result = await handleMcpRegistryStatus(args);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const statusData = JSON.parse(result.content[0].text);
      expect(statusData.registry).toBe('official');
      expect(statusData.status).toBe('online');
      expect(statusData.responseTime).toBe(125);
      expect(statusData.metadata).toBeDefined();
      expect(statusData.lastCheck).toBeDefined();
      expect(mockDiscoveryAdapter.getRegistryStatus).toHaveBeenCalledWith(true);
    });

    it('should use default registry when none provided', async () => {
      const mockStatus = {
        available: true,
        url: 'https://registry.modelcontextprotocol.io',
        response_time_ms: 100,
        last_updated: '2023-01-01T00:00:00Z',
      };
      mockDiscoveryAdapter.getRegistryStatus.mockResolvedValue(mockStatus);

      const args = {
        registry: 'official',
        includeStats: false,
      };

      const result = await handleMcpRegistryStatus(args);

      const statusData = JSON.parse(result.content[0].text);
      expect(statusData.registry).toBe('official');
      expect(mockDiscoveryAdapter.getRegistryStatus).toHaveBeenCalledWith(false);
    });

    it('should handle errors', async () => {
      mockDiscoveryAdapter.getRegistryStatus.mockRejectedValue(new Error('Registry error'));

      const args = { registry: 'invalid', includeStats: false };

      const result = await handleMcpRegistryStatus(args);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Registry error');
    });
  });

  describe('handleMcpRegistryInfo', () => {
    it('should return registry information', async () => {
      const args = {
        registry: 'official',
      };

      const result = await handleMcpRegistryInfo(args);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const infoData = JSON.parse(result.content[0].text);
      expect(infoData.registry).toBe('official');
      expect(infoData.name).toBe('Official MCP Registry');
      expect(infoData.baseUrl).toBe('https://registry.modelcontextprotocol.io');
      expect(infoData.version).toBe('1.0.0');
      expect(infoData.api).toBeDefined();
      expect(infoData.statistics).toBeDefined();
    });

    it('should use default registry when none provided', async () => {
      const args = {
        registry: 'official',
      };

      const result = await handleMcpRegistryInfo(args);

      const infoData = JSON.parse(result.content[0].text);
      expect(infoData.registry).toBe('official');
    });
  });

  describe('handleMcpRegistryList', () => {
    it('should return list of registries without stats', async () => {
      const mockStatus = {
        available: true,
        url: 'https://registry.modelcontextprotocol.io',
        response_time_ms: 100,
        last_updated: '2023-01-01T00:00:00Z',
      };
      mockDiscoveryAdapter.getRegistryStatus.mockResolvedValue(mockStatus);

      const args = {
        includeStats: false,
      };

      const result = await handleMcpRegistryList(args);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const listData = JSON.parse(result.content[0].text);
      expect(listData.registries).toHaveLength(3);
      expect(listData.total).toBe(3);
      expect(listData.includeStats).toBe(false);

      const registry = listData.registries[0];
      expect(registry.id).toBe('official');
      expect(registry.name).toBe('Official MCP Registry');
      expect(registry.status).toBe('online');
      expect(registry.serverCount).toBeUndefined();
      expect(registry.lastUpdated).toBeUndefined();
    });

    it('should return list of registries with stats', async () => {
      const mockStatus = {
        available: true,
        url: 'https://registry.modelcontextprotocol.io',
        response_time_ms: 100,
        last_updated: '2023-01-01T00:00:00Z',
        stats: {
          total_servers: 150,
          active_servers: 120,
          deprecated_servers: 5,
        },
      };
      mockDiscoveryAdapter.getRegistryStatus.mockResolvedValue(mockStatus);

      const args = {
        includeStats: true,
      };

      const result = await handleMcpRegistryList(args);

      const listData = JSON.parse(result.content[0].text);
      expect(listData.includeStats).toBe(true);

      const registry = listData.registries[0];
      expect(registry.serverCount).toBe(150);
      expect(registry.lastUpdated).toBeDefined();
    });

    it('should include all expected registries', async () => {
      const mockStatus = {
        available: true,
        url: 'https://registry.modelcontextprotocol.io',
        response_time_ms: 100,
        last_updated: '2023-01-01T00:00:00Z',
      };
      mockDiscoveryAdapter.getRegistryStatus.mockResolvedValue(mockStatus);

      const args = {
        includeStats: false,
      };

      const result = await handleMcpRegistryList(args);

      const listData = JSON.parse(result.content[0].text);
      const registryIds = listData.registries.map((r: any) => r.id);
      expect(registryIds).toContain('official');
      expect(registryIds).toContain('community');
      expect(registryIds).toContain('experimental');
    });
  });

  describe('handleMcpInfo', () => {
    it('should return server information', async () => {
      const mockServer = {
        name: 'test-server',
        description: 'MCP server for various operations',
        version: '1.0.0',
        author: 'Server Author',
        license: 'MIT',
        capabilities: { tools: true },
        transport: 'stdio',
        requirements: { node: '>=16' },
      };
      mockDiscoveryAdapter.getServerById.mockResolvedValue(mockServer);

      const args = {
        name: 'test-server',
        includeCapabilities: true,
        includeConfig: true,
        format: 'table' as const,
      };

      const result = await handleMcpInfo(args);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const infoData = JSON.parse(result.content[0].text);
      expect(infoData.server).toBe('test-server');
      expect(infoData.found).toBe(true);
      expect(infoData.info).toBeDefined();

      const serverInfo = infoData.info;
      expect(serverInfo.name).toBe('test-server');
      expect(serverInfo.description).toBe('MCP server for various operations');
      expect(serverInfo.version).toBe('1.0.0');
      expect(serverInfo.author).toBe('Server Author');
      expect(serverInfo.license).toBe('MIT');
      expect(serverInfo.capabilities).toBeDefined();
      expect(serverInfo.transport).toBeDefined();
      expect(serverInfo.requirements).toBeDefined();
      expect(mockDiscoveryAdapter.getServerById).toHaveBeenCalledWith('test-server', undefined);
    });

    it('should use default name when none provided', async () => {
      mockDiscoveryAdapter.getServerById.mockResolvedValue(null);

      const args = {
        name: 'unknown',
        includeCapabilities: true,
        includeConfig: true,
        format: 'table' as const,
      };

      const result = await handleMcpInfo(args);

      const infoData = JSON.parse(result.content[0].text);
      expect(infoData.server).toBe('unknown');
      expect(infoData.found).toBe(false);
      expect(infoData.message).toBe("Server 'unknown' not found in registry");
      expect(mockDiscoveryAdapter.getServerById).toHaveBeenCalledWith('unknown', undefined);
    });

    it('should handle server not found', async () => {
      mockDiscoveryAdapter.getServerById.mockResolvedValue(null);

      const args = {
        name: 'nonexistent-server',
        includeCapabilities: false,
        includeConfig: false,
        format: 'table' as const,
      };

      const result = await handleMcpInfo(args);

      const infoData = JSON.parse(result.content[0].text);
      expect(infoData.server).toBe('nonexistent-server');
      expect(infoData.found).toBe(false);
      expect(infoData.message).toBe("Server 'nonexistent-server' not found in registry");
    });

    it('should handle errors', async () => {
      mockDiscoveryAdapter.getServerById.mockRejectedValue(new Error('Server lookup failed'));

      const args = {
        name: 'test-server',
        includeCapabilities: false,
        includeConfig: false,
        format: 'table' as const,
      };

      const result = await handleMcpInfo(args);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Server lookup failed');
    });
  });

  describe('cleanupDiscoveryHandlers', () => {
    it('should cleanup without errors', () => {
      expect(() => cleanupDiscoveryHandlers()).not.toThrow();
    });
  });
});
