/**
 * Integration tests for discovery handlers
 *
 * These tests validate the complete flow from handlers through adapters
 * to domain services with minimal mocking, ensuring the restructuring
 * works end-to-end for discovery operations.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  handleMcpInfo,
  handleMcpRegistryInfo,
  handleMcpRegistryList,
  handleMcpRegistryStatus,
  handleMcpSearch,
} from './discoveryHandlers.js';

// Mock adapters directly for integration testing (must be before imports)
vi.mock('@src/core/flags/flagManager.js', () => ({
  FlagManager: {
    getInstance: () => ({
      isToolEnabled: vi.fn().mockReturnValue(true),
    }),
  },
}));

vi.mock('@src/logger/logger.js', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
  debugIf: vi.fn(),
  infoIf: vi.fn(),
  warnIf: vi.fn(),
  errorIf: vi.fn(),
}));

vi.mock('./adapters/discoveryAdapter.js', () => ({
  createDiscoveryAdapter: () => ({
    searchServers: vi.fn().mockResolvedValue([
      {
        name: 'test-server',
        version: '1.0.0',
        description: 'Test server',
        status: 'active' as const,
        repository: {
          source: 'github',
          url: 'https://github.com/example/mcp-server.git',
        },
        websiteUrl: 'https://github.com/example/mcp-server',
        _meta: {
          'io.modelcontextprotocol.registry/official': {
            isLatest: true,
            publishedAt: '2023-01-01T00:00:00Z',
            status: 'active' as const,
            updatedAt: '2023-01-01T00:00:00Z',
          },
          // Additional metadata for testing
          author: 'Test Author',
          license: 'MIT',
          tags: ['test', 'server'],
          transport: { stdio: true, sse: false, http: true },
          capabilities: {
            tools: { count: 15, listChanged: true },
            resources: { count: 8, subscribe: true, listChanged: true },
            prompts: { count: 5, listChanged: false },
          },
          requirements: { node: '>=16.0.0', platform: ['linux', 'darwin', 'win32'] },
        },
      },
    ]),
    getServerById: vi.fn().mockResolvedValue({
      name: 'test-server',
      version: '1.0.0',
      description: 'Test server',
      status: 'active' as const,
      repository: {
        source: 'github',
        url: 'https://github.com/example/mcp-server.git',
      },
      websiteUrl: 'https://github.com/example/mcp-server',
      _meta: {
        'io.modelcontextprotocol.registry/official': {
          isLatest: true,
          publishedAt: '2023-01-01T00:00:00Z',
          status: 'active' as const,
          updatedAt: '2023-01-01T00:00:00Z',
        },
        // Additional metadata for testing
        author: 'Test Author',
        license: 'MIT',
        tags: ['test', 'server'],
        transport: { stdio: true, sse: false, http: true },
        capabilities: {
          tools: { count: 15, listChanged: true },
          resources: { count: 8, subscribe: true, listChanged: true },
          prompts: { count: 5, listChanged: false },
        },
        requirements: { node: '>=16.0.0', platform: ['linux', 'darwin', 'win32'] },
      },
    }),
    getRegistryStatus: vi.fn().mockResolvedValue({
      available: true,
      url: 'https://registry.example.com',
      response_time_ms: 100,
      last_updated: '2023-01-01T00:00:00Z',
      stats: {
        total_servers: 150,
        active_servers: 140,
        deprecated_servers: 10,
        by_registry_type: { npm: 100, pypi: 30, docker: 20 },
        by_transport: { stdio: 90, sse: 40, http: 20 },
      },
    }),
    getRegistryList: vi.fn().mockResolvedValue({
      registries: [
        {
          name: 'Official MCP Registry',
          type: 'npm',
          url: 'https://registry.modelcontextprotocol.io',
          priority: 1,
          enabled: true,
          stats: {
            total_servers: 150,
            active_servers: 140,
            deprecated_servers: 10,
            last_updated: '2023-01-01T00:00:00Z',
          },
        },
        {
          name: 'Community Registry',
          type: 'npm',
          url: 'https://registry.npmjs.org',
          priority: 2,
          enabled: true,
          stats: {
            total_servers: 75,
            active_servers: 70,
            deprecated_servers: 5,
            last_updated: '2023-01-01T00:00:00Z',
          },
        },
        {
          name: 'Experimental Registry',
          type: 'npm',
          url: 'https://experimental-registry.example.com',
          priority: 3,
          enabled: false,
          stats: {
            total_servers: 25,
            active_servers: 20,
            deprecated_servers: 5,
            last_updated: '2023-01-01T00:00:00Z',
          },
        },
      ],
    }),
    getRegistryInfo: vi.fn().mockResolvedValue({
      name: 'official',
      type: 'npm',
      url: 'https://registry.modelcontextprotocol.io',
      description: 'The official Model Context Protocol server registry',
      version: '1.0.0',
      supportedFormats: ['json', 'yaml'],
      features: ['search', 'versioning', 'statistics'],
      statistics: {
        total_servers: 150,
        active_servers: 140,
        deprecated_servers: 10,
        last_updated: '2023-01-01T00:00:00Z',
      },
    }),
    destroy: vi.fn(),
  }),
}));

describe('Discovery Handlers Integration Tests', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Discovery Handlers', () => {
    it('should handle mcp_search end-to-end', async () => {
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

      // Expect structured object instead of array
      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('query');
      expect(result).toHaveProperty('registry');

      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({
        name: 'test-server',
        version: '1.0.0',
        registry: 'official',
      });
      expect(result.total).toBe(1);
      expect(result.query).toBe('test');
      expect(result.registry).toBe('official');
    });

    it('should handle mcp_info end-to-end', async () => {
      const args = {
        name: 'test-server',
        includeCapabilities: true,
        includeConfig: true,
        format: 'table' as const,
      };

      const result = await handleMcpInfo(args);

      // Expect structured object instead of array
      expect(result).toHaveProperty('server');
      expect(result).toHaveProperty('configuration');
      expect(result).toHaveProperty('capabilities');
      expect(result).toHaveProperty('health');

      expect(result.server.name).toBe('test-server');
      expect(result.server.status).toBe('unknown');
      expect(result.server.transport).toBe('stdio');
      // Configuration is optional in schema, so we check for existence
      if (result.configuration) {
        if (result.configuration.command) {
          expect(result.configuration.command).toBe('test-server');
        }
        expect(result.configuration.tags).toEqual(['test', 'server']);
      }
    });

    it('should handle mcp_registry_status end-to-end', async () => {
      const args = {
        registry: 'official',
        includeStats: false,
      };

      const result = await handleMcpRegistryStatus(args);

      // Expect structured object instead of array
      expect(result).toHaveProperty('registry');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('responseTime');
      expect(result).toHaveProperty('lastCheck');
      expect(result).toHaveProperty('metadata');

      expect(result.registry).toBe('official');
      expect(result.status).toBe('online');
      expect(result.responseTime).toBe(100);
      expect(result.lastCheck).toBe('2023-01-01T00:00:00Z');
    });

    it('should handle mcp_registry_info end-to-end', async () => {
      const args = {
        registry: 'official',
      };

      const result = await handleMcpRegistryInfo(args);

      // Expect structured object instead of array
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('url');
      expect(result).toHaveProperty('description');
      expect(result).toHaveProperty('version');
      expect(result).toHaveProperty('supportedFormats');
      expect(result).toHaveProperty('features');
      expect(result).toHaveProperty('statistics');

      expect(result.name).toBe('official');
      expect(result.url).toBe('https://registry.modelcontextprotocol.io');
      expect(result.description).toBe('The official Model Context Protocol server registry');
      expect(result.version).toBe('1.0.0');
    });

    it('should handle mcp_registry_list end-to-end', async () => {
      const args = {
        includeStats: false,
      };

      const result = await handleMcpRegistryList(args);

      // Expect structured object instead of array
      expect(result).toHaveProperty('registries');
      expect(result).toHaveProperty('total');

      expect(result.registries).toHaveLength(3);
      expect(result.total).toBe(3);

      const registryNames = result.registries.map((r: any) => r.name);
      expect(registryNames).toContain('Official MCP Registry');
      expect(registryNames).toContain('Community Registry');
      expect(registryNames).toContain('Experimental Registry');
    });
  });
});
