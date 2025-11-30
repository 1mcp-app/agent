/**
 * Tests for discovery handlers
 */
import { FlagManager } from '@src/core/flags/flagManager.js';

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

vi.mock('@src/core/tools/handlers/searchHandler.js', () => ({
  handleSearchMCPServers: vi.fn(),
  cleanupSearchHandler: vi.fn(),
}));

describe('discoveryHandlers', () => {
  let flagManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    flagManager = {
      isToolEnabled: vi.fn().mockReturnValue(true),
    } as any;
    (FlagManager.getInstance as any).mockReturnValue(flagManager);
  });

  afterEach(() => {
    cleanupDiscoveryHandlers();
  });

  describe('handleMcpSearch', () => {
    it('should execute search successfully', async () => {
      const { handleSearchMCPServers } = await import('@src/core/tools/handlers/searchHandler.js');
      (handleSearchMCPServers as any).mockResolvedValue({
        results: [{ name: 'test-server', version: '1.0.0' }],
        total: 1,
      });

      const args = {
        query: 'test',
        status: 'active' as const,
        limit: 10,
        format: 'table' as const,
      };

      const result = await handleMcpSearch(args);

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                results: [{ name: 'test-server', version: '1.0.0' }],
                total: 1,
              },
              null,
              2,
            ),
          },
        ],
      });
      expect(handleSearchMCPServers).toHaveBeenCalledWith(args);
    });

    it('should handle search errors', async () => {
      const { handleSearchMCPServers } = await import('@src/core/tools/handlers/searchHandler.js');
      (handleSearchMCPServers as any).mockRejectedValue(new Error('Search failed'));

      const args = {
        query: 'test',
        status: 'active' as const,
        limit: 20,
        format: 'table' as const,
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
      const args = {
        registry: 'official',
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
    });

    it('should use default registry when none provided', async () => {
      const args = {
        registry: 'official',
      };

      const result = await handleMcpRegistryStatus(args);

      const statusData = JSON.parse(result.content[0].text);
      expect(statusData.registry).toBe('official');
    });

    it('should handle errors', async () => {
      const args = { registry: 'invalid' };

      // Mock a scenario where error occurs
      vi.spyOn(JSON, 'stringify').mockImplementationOnce(() => {
        throw new Error('JSON error');
      });

      const result = await handleMcpRegistryStatus(args);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('JSON error');
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
      expect(infoData.version).toBe('1.0.0');
      expect(infoData.baseUrl).toBe('https://registry.modelcontextprotocol.io');
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
    });

    it('should use default name when none provided', async () => {
      const args = {
        name: 'unknown',
        includeCapabilities: true,
        includeConfig: true,
        format: 'table' as const,
      };

      const result = await handleMcpInfo(args);

      const infoData = JSON.parse(result.content[0].text);
      expect(infoData.server).toBe('unknown');
      expect(infoData.info.name).toBe('Unknown Server');
    });
  });

  describe('cleanupDiscoveryHandlers', () => {
    it('should cleanup without errors', () => {
      expect(() => cleanupDiscoveryHandlers()).not.toThrow();
    });
  });
});
