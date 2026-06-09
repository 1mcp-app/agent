import { vi } from 'vitest';

import './integration.domainMocks.testSetup.js';

// Mock only external dependencies
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

// Mock adapters directly for integration testing
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
    destroy: vi.fn(),
  }),
}));

vi.mock('./adapters/installationAdapter.js', () => ({
  createInstallationAdapter: () => ({
    installServer: vi.fn().mockResolvedValue({
      success: true,
      status: 'applied',
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
    listInstalledServers: vi.fn().mockResolvedValue(['server1', 'server2']),
    validateTags: vi.fn().mockReturnValue({ valid: true, errors: [] }),
    parseTags: vi.fn().mockImplementation((tagsString: string) => tagsString.split(',').map((t) => t.trim())),
    destroy: vi.fn(),
  }),
}));

vi.mock('./adapters/management/index.js', () => ({
  createManagementAdapter: () => ({
    listServers: vi.fn().mockResolvedValue([
      {
        name: 'test-server',
        config: {
          name: 'test-server',
          command: 'node',
          args: ['server.js'],
          disabled: false,
          tags: ['test'],
        },
        status: 'enabled' as const,
        transport: 'stdio' as const,
        url: undefined,
        healthStatus: 'healthy' as const,
        lastChecked: new Date(),
        metadata: {
          tags: ['test'],
          installedAt: '2023-01-01T00:00:00Z',
          version: '1.0.0',
          source: 'registry',
        },
      },
      {
        name: 'disabled-server',
        config: {
          name: 'disabled-server',
          command: 'node',
          args: ['server.js'],
          disabled: true,
          tags: ['test'],
        },
        status: 'disabled' as const,
        transport: 'sse' as const,
        url: 'http://localhost:3000/sse',
        healthStatus: 'unknown' as const,
        lastChecked: new Date(),
        metadata: {
          tags: ['test'],
          installedAt: '2023-01-01T00:00:00Z',
          version: '1.0.0',
          source: 'registry',
        },
      },
    ]),
    getServerStatus: vi.fn().mockImplementation((serverName?: string) => {
      if (serverName === 'test-server') {
        return Promise.resolve({
          timestamp: new Date().toISOString(),
          servers: [
            {
              name: 'test-server',
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
      }
      if (serverName === 'non-existent-server') {
        // Simulate server not found - should return empty status
        return Promise.resolve({
          timestamp: new Date().toISOString(),
          servers: [],
          totalServers: 0,
          enabledServers: 0,
          disabledServers: 0,
          unhealthyServers: 0,
        });
      }
      // Default for test-server when called without name
      return Promise.resolve({
        timestamp: new Date().toISOString(),
        servers: [
          {
            name: 'test-server',
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
    enableServer: vi.fn().mockImplementation((serverName: string) => {
      if (serverName === 'test-server') {
        return Promise.resolve({
          success: true,
          serverName: 'test-server',
          enabled: true,
          restarted: false,
          warnings: [],
          errors: [],
        });
      }
      if (serverName === 'non-existent-server') {
        // Return structured error response instead of throwing
        return Promise.resolve({
          success: false,
          serverName: 'non-existent-server',
          enabled: false,
          restarted: false,
          warnings: [],
          errors: [`Server '${serverName}' not found`],
        });
      }
      // Default case
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
      if (serverName === 'disabled-server') {
        return Promise.resolve({
          success: true,
          serverName: 'disabled-server',
          disabled: true,
          gracefulShutdown: true,
          warnings: [],
          errors: [],
        });
      }
      if (serverName === 'non-existent-server') {
        // Return structured error response instead of throwing
        return Promise.resolve({
          success: false,
          serverName: 'non-existent-server',
          disabled: false,
          gracefulShutdown: false,
          warnings: [],
          errors: [`Server '${serverName}' not found`],
        });
      }
      // Default case
      return Promise.resolve({
        success: true,
        serverName,
        disabled: true,
        gracefulShutdown: true,
        warnings: [],
        errors: [],
      });
    }),
    reloadConfiguration: vi.fn().mockResolvedValue({
      success: true,
      target: 'config',
      action: 'reloaded',
      timestamp: new Date().toISOString(),
      reloadedServers: ['test-server', 'disabled-server'],
      warnings: [],
      errors: [],
    }),
    updateServerConfig: vi.fn().mockResolvedValue({
      success: true,
      serverName: 'test-server',
      updated: true,
    }),
    validateServerConfig: vi.fn().mockResolvedValue({
      valid: true,
      errors: [],
      warnings: [],
    }),
    getServerUrl: vi.fn().mockResolvedValue('http://localhost:3051/mcp'),
    destroy: vi.fn(),
  }),
}));

vi.mock('@src/commands/mcp/utils/mcpServerConfig.js', () => ({
  getAllServers: () => ({
    'test-server': {
      name: 'test-server',
      command: 'node',
      args: ['server.js'],
      disabled: false,
      tags: ['test'],
    },
    'disabled-server': {
      name: 'disabled-server',
      command: 'node',
      args: ['server.js'],
      disabled: true,
    },
  }),
  getServer: (name: string) =>
    ({
      'test-server': {
        name: 'test-server',
        command: 'node',
        args: ['server.js'],
        disabled: name === 'disabled-server',
      },
      'disabled-server': {
        name: 'disabled-server',
        command: 'node',
        args: ['server.js'],
        disabled: true,
      },
    })[name],
  setServer: vi.fn(),
  getInstallationMetadata: () => null,
  reloadMcpConfig: vi.fn(),
}));

vi.mock('@src/utils/validation/urlDetection.js', () => ({
  getServer1mcpUrl: () => 'http://localhost:3051/mcp',
  validateServer1mcpUrl: () => ({ valid: true, error: null }),
}));

vi.mock('@src/domains/installation/configurators/tagsConfigurator.js', () => ({
  parseTags: (tagsString: string) => tagsString.split(',').map((t) => t.trim()),
  validateTags: vi.fn().mockImplementation((tags: string[]) => {
    if (tags.some((tag) => tag.includes('!'))) {
      return { valid: false, errors: ['Invalid tag characters'] };
    }
    return { valid: true, errors: [] };
  }),
}));

vi.mock('@src/domains/registry/mcpRegistryClient.js', () => ({
  createRegistryClient: () => {
    const mockClient = {
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
        packages: [
          {
            identifier: 'test-server',
            transport: {
              type: 'stdio',
              config: {},
            },
          },
        ],
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
      destroy: vi.fn(),
    };

    // Add mockRejectedValue method to searchServers for error testing
    mockClient.searchServers.mockRejectedValue = vi.fn().mockRejectedValue(new Error('Registry connection failed'));

    return mockClient;
  },
}));
