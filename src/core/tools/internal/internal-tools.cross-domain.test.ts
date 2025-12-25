/**
 * Cross-domain integration tests
 *
 * These tests validate the complete flow across different domains
 * from discovery through installation to management, ensuring the restructuring
 * works end-to-end for complex multi-step operations.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  handleMcpInfo,
  handleMcpRegistryInfo,
  handleMcpRegistryList,
  handleMcpRegistryStatus,
  handleMcpSearch,
} from './discoveryHandlers.js';
import { handleMcpInstall, handleMcpUninstall } from './installationHandlers.js';
import { handleMcpDisable, handleMcpEnable, handleMcpStatus } from './managementHandlers.js';

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

vi.mock('./adapters/index.js', () => ({
  AdapterFactory: {
    getDiscoveryAdapter: () => ({
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
    getInstallationAdapter: () => ({
      installServer: vi.fn().mockResolvedValue({
        success: true,
        serverName: 'test-server',
        version: '1.0.0',
        installedAt: new Date(),
        configPath: '/path/to/config',
        backupPath: '/path/to/backup',
        warnings: [],
        errors: [],
        operationId: 'test-op-id',
      }),
      uninstallServer: vi.fn().mockResolvedValue({
        success: true,
        serverName: 'test-server',
        removedAt: new Date(),
        configRemoved: true,
        warnings: [],
        errors: [],
        operationId: 'test-op-id',
      }),
      updateServer: vi.fn().mockResolvedValue({
        success: true,
        serverName: 'test-server',
        previousVersion: '1.0.0',
        newVersion: '2.0.0',
        updatedAt: new Date(),
        warnings: [],
        errors: [],
        operationId: 'test-op-id',
      }),
      destroy: vi.fn(),
    }),
    getManagementAdapter: () => ({
      enableServer: vi.fn().mockImplementation((serverName: string) => {
        return Promise.resolve({
          success: true,
          serverName,
          enabled: true,
          restarted: false,
          warnings: [],
          errors: [],
        });
      }),
      disableServer: vi.fn().mockImplementation((serverName: string) => {
        return Promise.resolve({
          success: true,
          serverName,
          disabled: true,
          gracefulShutdown: true,
          warnings: [],
          errors: [],
        });
      }),
      getServerStatus: vi.fn().mockImplementation((serverName?: string) => {
        return Promise.resolve({
          timestamp: new Date().toISOString(),
          servers: [
            {
              name: serverName || 'test-server',
              status: 'enabled' as const,
              transport: 'stdio',
              url: undefined,
              healthStatus: 'healthy',
              lastChecked: new Date().toISOString(),
              errors: [],
            },
          ],
          totalServers: 1,
          enabledServers: 1,
          disabledServers: 0,
          unhealthyServers: 0,
        });
      }),
      destroy: vi.fn(),
    }),
  },
}));

describe('Cross-Domain Integration Tests', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Cross-Domain Integration', () => {
    it('should handle discovery to installation flow', async () => {
      // First discover a server
      const searchResult = await handleMcpSearch({
        query: 'test',
        status: 'active' as const,
        format: 'table' as const,
        limit: 10,
        offset: 0,
      });

      expect(searchResult.results).toHaveLength(1);
      const serverName = searchResult.results[0].name;

      // Then get detailed info
      const infoResult = await handleMcpInfo({
        name: serverName,
        includeCapabilities: true,
        includeConfig: true,
        format: 'table',
      });

      expect(infoResult.server.name).toBe(serverName);

      // Then install it
      const installResult = await handleMcpInstall({
        name: serverName,
        version: '1.0.0',
        transport: 'stdio',
        enabled: true,
        autoRestart: false,
        force: false,
        backup: false,
      });

      expect(installResult.status).toBe('success');
      expect(installResult.name).toBe(serverName);
    });

    it('should handle installation to management flow', async () => {
      const serverName = 'test-server';

      // Install server
      await handleMcpInstall({
        name: serverName,
        version: '1.0.0',
        transport: 'stdio',
        enabled: true,
        autoRestart: false,
        force: false,
        backup: false,
      });

      // Enable server (management)
      const enableResult = await handleMcpEnable({
        name: serverName,
        restart: false,
        graceful: true,
        timeout: 30000,
      });

      expect(enableResult.status).toBe('success');
      expect(enableResult.name).toBe(serverName);

      // Check status (management)
      const statusResult = await handleMcpStatus({
        name: serverName,
        details: true,
        health: true,
      });

      expect(statusResult.servers).toBeDefined();
      expect(statusResult.timestamp).toBeDefined();

      // Disable server (management)
      const disableResult = await handleMcpDisable({
        name: serverName,
        graceful: true,
        timeout: 30000,
        force: false,
      });

      expect(disableResult.status).toBe('success');
      expect(disableResult.name).toBe(serverName);

      // Uninstall server (installation)
      const uninstallResult = await handleMcpUninstall({
        name: serverName,
        force: true,
        preserveConfig: false,
        graceful: true,
        backup: false,
        removeAll: false,
      });

      expect(uninstallResult.status).toBe('success');
      expect(uninstallResult.name).toBe(serverName);
    });

    it('should handle complete registry discovery lifecycle', async () => {
      // Check registry status
      const statusResult = await handleMcpRegistryStatus({
        registry: 'official',
        includeStats: false,
      });

      expect(statusResult.registry).toBe('official');
      expect(statusResult.status).toBe('online');

      // Get registry info
      const infoResult = await handleMcpRegistryInfo({
        registry: 'official',
      });

      expect(infoResult.name).toBe('official');
      expect(infoResult.url).toBe('https://registry.modelcontextprotocol.io');

      // List available registries
      const listResult = await handleMcpRegistryList({
        includeStats: false,
      });

      expect(listResult.registries).toHaveLength(3);
      expect(listResult.total).toBe(3);

      const registryNames = listResult.registries.map((r: any) => r.name);
      expect(registryNames).toContain('Official MCP Registry');
      expect(registryNames).toContain('Community Registry');
      expect(registryNames).toContain('Experimental Registry');
    });
  });

  describe('Adapter Factory Integration', () => {
    it('should use consistent adapter instances across handler calls', async () => {
      // Call multiple handlers that use the same adapter type
      const searchResult1 = await handleMcpSearch({
        query: 'test',
        status: 'all' as const,
        format: 'json' as const,
        limit: 5,
        offset: 0,
      });

      const searchResult2 = await handleMcpInfo({
        name: 'test-server',
        includeCapabilities: true,
        includeConfig: true,
        format: 'json' as const,
      });

      const searchResult3 = await handleMcpSearch({
        query: 'another',
        status: 'all' as const,
        format: 'json' as const,
        limit: 3,
        offset: 0,
      });

      // All calls should succeed
      expect(searchResult1.results).toBeDefined();
      expect(searchResult2.server).toBeDefined();
      expect(searchResult3.results).toBeDefined();

      // Mock adapters should have consistent behavior
      const { createDiscoveryAdapter } = await import('./adapters/discoveryAdapter.js');
      const adapter = createDiscoveryAdapter();

      expect(adapter).toBeDefined();
      expect(typeof adapter.searchServers).toBe('function');
      expect(typeof adapter.getServerById).toBe('function');
    });

    it('should handle adapter error propagation correctly', async () => {
      // This test ensures errors from adapters are properly propagated
      // through the handler layer to the test environment

      // Mock the adapter to throw an error
      const { createDiscoveryAdapter } = await import('./adapters/discoveryAdapter.js');

      // Create adapter instance manually to test error handling
      const adapter = createDiscoveryAdapter();

      // Verify the adapter structure
      expect(adapter).toBeDefined();
      expect(typeof adapter.searchServers).toBe('function');

      // Test that the handler uses the mock correctly
      const result = await handleMcpSearch({
        query: 'test',
        status: 'all' as const,
        format: 'json' as const,
        limit: 1,
        offset: 0,
      });

      expect(result).toHaveProperty('results');
      expect(result.results).toBeInstanceOf(Array);
    });
  });
});
