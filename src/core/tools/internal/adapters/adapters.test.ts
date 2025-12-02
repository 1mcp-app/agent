/**
 * Tests for internal tool adapters
 *
 * This test file validates the adapter layer that bridges internal tools
 * with domain services, ensuring proper data transformation and error handling.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AdapterFactory,
  createDiscoveryAdapter,
  createInstallationAdapter,
  createManagementAdapter,
  type DiscoveryAdapter,
  type InstallationAdapter,
  type ManagementAdapter,
} from './index.js';

// Mock domain services
vi.mock('@src/domains/discovery/appDiscovery.js', () => ({
  checkConsolidationStatus: vi.fn(),
  discoverAppConfigs: vi.fn(),
  discoverInstalledApps: vi.fn(),
  extractAndFilterServers: vi.fn(),
}));

const mockRegistryClient = {
  searchServers: vi.fn(),
  getServerById: vi.fn(),
  getRegistryStatus: vi.fn(),
  destroy: vi.fn(),
};

const mockInstallationService = {
  installServer: vi.fn(),
  uninstallServer: vi.fn(),
  updateServer: vi.fn(),
  validateServerConfig: vi.fn(),
  checkServerConflicts: vi.fn(),
  checkForUpdates: vi.fn(),
  listInstalledServers: vi.fn(),
};

const _mockAppDiscovery = {
  discoverInstalledApps: vi.fn(),
  checkConsolidationStatus: vi.fn(),
  extractAndFilterServers: vi.fn(),
  discoverAppConfigs: vi.fn(),
};

const _mockConfigUtils = {
  addServerToConfig: vi.fn(),
  removeServerFromConfig: vi.fn(),
  updateServerInConfig: vi.fn(),
  loadMcpConfig: vi.fn(),
  saveMcpConfig: vi.fn(),
};

const _mockManagementUtils = {
  enableServer: vi.fn(),
  disableServer: vi.fn(),
  reloadConfiguration: vi.fn(),
  listServers: vi.fn(),
  getServerStatus: vi.fn(),
  getServerUrl: vi.fn(),
  validateServerConfig: vi.fn(),
  updateServerConfig: vi.fn(),
};

vi.mock('@src/domains/registry/mcpRegistryClient.js', () => ({
  createRegistryClient: vi.fn(() => mockRegistryClient),
}));

vi.mock('@src/domains/server-management/serverInstallationService.js', () => ({
  createServerInstallationService: vi.fn(() => mockInstallationService),
}));

vi.mock('@src/commands/mcp/utils/configUtils.js', () => ({
  getAllServers: vi.fn(),
  getServer: vi.fn(),
  setServer: vi.fn(),
  removeServer: vi.fn(),
  reloadMcpConfig: vi.fn(),
  getInstallationMetadata: vi.fn(),
}));

vi.mock('@src/utils/validation/urlDetection.js', () => ({
  getServer1mcpUrl: vi.fn(() => 'http://localhost:3051/mcp'),
  validateServer1mcpUrl: vi.fn(() => ({ isValid: true, error: null })),
}));

vi.mock('@src/domains/installation/configurators/tagsConfigurator.js', () => ({
  parseTags: vi.fn(() => ['tag1', 'tag2']),
  validateTags: vi.fn(() => ({ valid: true, errors: [] })),
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

describe('Adapter Factory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    AdapterFactory.reset();
  });

  describe('AdapterFactory', () => {
    it('should create discovery adapter', () => {
      const adapter = AdapterFactory.getDiscoveryAdapter();
      expect(adapter).toBeDefined();
      expect(adapter.searchServers).toBeDefined();
      expect(adapter.getServerById).toBeDefined();
      expect(adapter.getRegistryStatus).toBeDefined();
    });

    it('should create installation adapter', () => {
      const adapter = AdapterFactory.getInstallationAdapter();
      expect(adapter).toBeDefined();
      expect(adapter.installServer).toBeDefined();
      expect(adapter.uninstallServer).toBeDefined();
      expect(adapter.updateServer).toBeDefined();
      expect(adapter.listInstalledServers).toBeDefined();
    });

    it('should create management adapter', () => {
      const adapter = AdapterFactory.getManagementAdapter();
      expect(adapter).toBeDefined();
      expect(adapter.listServers).toBeDefined();
      expect(adapter.getServerStatus).toBeDefined();
      expect(adapter.enableServer).toBeDefined();
      expect(adapter.disableServer).toBeDefined();
      expect(adapter.reloadConfiguration).toBeDefined();
    });

    it('should return same adapter instance on multiple calls', () => {
      const adapter1 = AdapterFactory.getDiscoveryAdapter();
      const adapter2 = AdapterFactory.getDiscoveryAdapter();
      expect(adapter1).toBe(adapter2);
    });

    it('should get all adapters', () => {
      const adapters = AdapterFactory.getAllAdapters();
      expect(adapters.discovery).toBeDefined();
      expect(adapters.installation).toBeDefined();
      expect(adapters.management).toBeDefined();
    });

    it('should reset adapters', () => {
      const adapter1 = AdapterFactory.getDiscoveryAdapter();
      AdapterFactory.reset();
      const adapter2 = AdapterFactory.getDiscoveryAdapter();
      expect(adapter1).not.toBe(adapter2);
    });

    it('should cleanup adapters', () => {
      const mockAdapter = { destroy: vi.fn() };
      AdapterFactory['discoveryAdapter'] = mockAdapter as any;

      AdapterFactory.cleanup();
      expect(mockAdapter.destroy).toHaveBeenCalled();
    });
  });

  describe('Factory functions', () => {
    it('should create discovery adapter', () => {
      const adapter = createDiscoveryAdapter();
      expect(adapter).toBeDefined();
      expect(typeof adapter.searchServers).toBe('function');
    });

    it('should create installation adapter', () => {
      const adapter = createInstallationAdapter();
      expect(adapter).toBeDefined();
      expect(typeof adapter.installServer).toBe('function');
    });

    it('should create management adapter', () => {
      const adapter = createManagementAdapter();
      expect(adapter).toBeDefined();
      expect(typeof adapter.listServers).toBe('function');
    });
  });
});

describe('Discovery Adapter', () => {
  let adapter: DiscoveryAdapter;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    adapter = createDiscoveryAdapter();
  });

  describe('searchServers', () => {
    it('should search servers successfully', async () => {
      const mockServers = [
        { name: 'test-server', version: '1.0.0' },
        { name: 'another-server', version: '2.0.0' },
      ];

      mockRegistryClient.searchServers.mockResolvedValue(mockServers);

      const result = await adapter.searchServers('test', { limit: 10 });

      expect(result).toEqual(mockServers);
      expect(mockRegistryClient.searchServers).toHaveBeenCalledWith({
        search: 'test',
        limit: 10,
      });
    });

    it('should handle search errors', async () => {
      mockRegistryClient.searchServers.mockRejectedValue(new Error('Search failed'));

      await expect(adapter.searchServers('test')).rejects.toThrow('Registry search failed: Search failed');
    });
  });

  describe('getServerById', () => {
    it('should get server by ID successfully', async () => {
      const mockServer = { name: 'test-server', version: '1.0.0' };

      mockRegistryClient.getServerById.mockResolvedValue(mockServer);

      const result = await adapter.getServerById('test-server');

      expect(result).toEqual(mockServer);
      expect(mockRegistryClient.getServerById).toHaveBeenCalledWith('test-server', undefined);
    });

    it('should return null for not found errors', async () => {
      mockRegistryClient.getServerById.mockRejectedValue(new Error('Server not found'));

      const result = await adapter.getServerById('nonexistent');

      expect(result).toBeNull();
    });

    it('should handle other errors', async () => {
      mockRegistryClient.getServerById.mockRejectedValue(new Error('Network error'));

      await expect(adapter.getServerById('test-server')).rejects.toThrow('Registry get server failed: Network error');
    });
  });

  describe('getRegistryStatus', () => {
    it('should get registry status successfully', async () => {
      const mockStatus = {
        available: true,
        url: 'https://registry.example.com',
        response_time_ms: 100,
      };

      mockRegistryClient.getRegistryStatus.mockResolvedValue(mockStatus);

      const result = await adapter.getRegistryStatus();

      expect(result).toEqual(mockStatus);
      expect(mockRegistryClient.getRegistryStatus).toHaveBeenCalledWith(false);
    });

    it('should handle registry status errors', async () => {
      mockRegistryClient.getRegistryStatus.mockRejectedValue(new Error('Status check failed'));

      await expect(adapter.getRegistryStatus()).rejects.toThrow('Registry status check failed: Status check failed');
    });
  });

  describe('discoverInstalledApps', () => {
    it('should discover installed apps successfully', async () => {
      const mockApps = {
        configurable: [
          {
            name: 'vscode',
            displayName: 'Visual Studio Code',
            hasConfig: true,
            configCount: 2,
            serverCount: 1,
            paths: ['/path/to/config'],
          },
        ],
        manualOnly: ['sublime'],
      };

      const { discoverInstalledApps } = await import('@src/domains/discovery/appDiscovery.js');
      (discoverInstalledApps as any).mockResolvedValue(mockApps);

      const result = await adapter.discoverInstalledApps();

      expect(result).toEqual(mockApps);
      expect(discoverInstalledApps).toHaveBeenCalled();
    });

    it('should handle app discovery errors', async () => {
      const { discoverInstalledApps } = await import('@src/domains/discovery/appDiscovery.js');
      (discoverInstalledApps as any).mockRejectedValue(new Error('Discovery failed'));

      await expect(adapter.discoverInstalledApps()).rejects.toThrow('App discovery failed: Discovery failed');
    });
  });
});

describe('Installation Adapter', () => {
  let adapter: InstallationAdapter;

  beforeEach(() => {
    adapter = createInstallationAdapter();
  });

  describe('installServer', () => {
    it('should install server successfully', async () => {
      const mockResult = {
        success: true,
        serverName: 'test-server',
        version: '1.0.0',
        installedAt: new Date(),
        warnings: [],
        errors: [],
        operationId: 'test-op-id',
        config: { type: 'stdio', command: 'node', args: ['server.js'] },
      };

      const { createServerInstallationService } = await import(
        '@src/domains/server-management/serverInstallationService.js'
      );
      const mockService = (createServerInstallationService as any)();
      mockService.installServer.mockResolvedValue(mockResult);

      const { getServer, setServer } = await import('@src/commands/mcp/utils/configUtils.js');
      (getServer as any).mockReturnValue({ command: 'node', args: ['server.js'] });

      const result = await adapter.installServer('test-server', '1.0.0', {
        force: false,
        backup: true,
        tags: ['test'],
        env: { NODE_ENV: 'test' },
      });

      expect(result).toEqual(mockResult);
      expect(mockService.installServer).toHaveBeenCalledWith('test-server', '1.0.0', {
        force: false,
      });

      const { reloadMcpConfig } = await import('@src/commands/mcp/utils/configUtils.js');
      expect(setServer).toHaveBeenCalled();
      expect(reloadMcpConfig).toHaveBeenCalled();
    });

    it('should validate tags before installation', async () => {
      const { validateTags } = await import('@src/domains/installation/configurators/tagsConfigurator.js');
      (validateTags as any).mockReturnValue({ valid: false, errors: ['Invalid tag format'] });

      await expect(
        adapter.installServer('test-server', undefined, {
          tags: ['invalid-tag!'],
        }),
      ).rejects.toThrow('Invalid tags: Invalid tag format');
    });

    it('should handle installation errors', async () => {
      const { createServerInstallationService } = await import(
        '@src/domains/server-management/serverInstallationService.js'
      );
      const mockService = (createServerInstallationService as any)();
      mockService.installServer.mockRejectedValue(new Error('Installation failed'));

      await expect(adapter.installServer('test-server')).rejects.toThrow(
        'Server installation failed: Installation failed',
      );
    });
  });

  describe('uninstallServer', () => {
    it('should uninstall server successfully', async () => {
      const mockResult = {
        success: true,
        serverName: 'test-server',
        removedAt: new Date(),
        configRemoved: false,
        warnings: [],
        errors: [],
        operationId: 'test-op-id',
      };

      const { createServerInstallationService } = await import(
        '@src/domains/server-management/serverInstallationService.js'
      );
      const mockService = (createServerInstallationService as any)();
      mockService.uninstallServer.mockResolvedValue(mockResult);

      const { getAllServers, removeServer } = await import('@src/commands/mcp/utils/configUtils.js');
      (getAllServers as any).mockReturnValue({});
      (removeServer as any).mockReturnValue(true);

      const result = await adapter.uninstallServer('test-server', {
        force: true,
        removeAll: true,
      });

      expect(result).toEqual(mockResult);
      expect(mockService.uninstallServer).toHaveBeenCalledWith('test-server', {
        force: true,
        backup: false,
      });

      const { reloadMcpConfig } = await import('@src/commands/mcp/utils/configUtils.js');
      expect(removeServer).toHaveBeenCalledWith('test-server');
      expect(reloadMcpConfig).toHaveBeenCalled();
    });

    it('should handle uninstallation errors', async () => {
      const { createServerInstallationService } = await import(
        '@src/domains/server-management/serverInstallationService.js'
      );
      const mockService = (createServerInstallationService as any)();
      mockService.uninstallServer.mockRejectedValue(new Error('Uninstall failed'));

      await expect(adapter.uninstallServer('test-server')).rejects.toThrow(
        'Server uninstallation failed: Uninstall failed',
      );
    });
  });

  describe('updateServer', () => {
    it('should update server successfully', async () => {
      const mockResult = {
        success: true,
        serverName: 'test-server',
        previousVersion: '1.0.0',
        newVersion: '2.0.0',
        updatedAt: new Date(),
        warnings: [],
        errors: [],
        operationId: 'test-op-id',
      };

      const { createServerInstallationService } = await import(
        '@src/domains/server-management/serverInstallationService.js'
      );
      const mockService = (createServerInstallationService as any)();
      mockService.updateServer.mockResolvedValue(mockResult);

      const result = await adapter.updateServer('test-server', '2.0.0', {
        force: false,
        backup: true,
      });

      expect(result).toEqual(mockResult);
      expect(mockService.updateServer).toHaveBeenCalledWith('test-server', '2.0.0', {
        backup: true,
      });
    });

    it('should handle dry run updates', async () => {
      const mockUpdateCheck = {
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
      };

      mockInstallationService.checkForUpdates.mockResolvedValue([mockUpdateCheck]);

      const result = await adapter.updateServer('test-server', undefined, {
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.previousVersion).toBe('1.0.0');
      expect(result.newVersion).toBe('2.0.0');
      expect(result.warnings).toContain('Dry run: Update available from 1.0.0 to 2.0.0');
    });

    it('should handle update errors', async () => {
      const { createServerInstallationService } = await import(
        '@src/domains/server-management/serverInstallationService.js'
      );
      const mockService = (createServerInstallationService as any)();
      mockService.updateServer.mockRejectedValue(new Error('Update failed'));

      await expect(adapter.updateServer('test-server')).rejects.toThrow('Server update failed: Update failed');
    });
  });

  describe('validateTags', () => {
    it('should validate tags successfully', async () => {
      const { validateTags } = await import('@src/domains/installation/configurators/tagsConfigurator.js');
      (validateTags as any).mockReturnValue({ valid: true, errors: [] });

      const result = adapter.validateTags(['tag1', 'tag2']);

      expect(result).toEqual({ valid: true, errors: [] });
      expect(validateTags).toHaveBeenCalledWith(['tag1', 'tag2']);
    });

    it('should handle tag validation errors', async () => {
      const { validateTags } = await import('@src/domains/installation/configurators/tagsConfigurator.js');
      (validateTags as any).mockImplementation(() => {
        throw new Error('Validation error');
      });

      const result = adapter.validateTags(['invalid']);

      expect(result).toEqual({ valid: false, errors: ['Validation error'] });
    });
  });

  describe('parseTags', () => {
    it('should parse tags successfully', async () => {
      const { parseTags } = await import('@src/domains/installation/configurators/tagsConfigurator.js');
      (parseTags as any).mockReturnValue(['tag1', 'tag2']);

      const result = adapter.parseTags('tag1, tag2');

      expect(result).toEqual(['tag1', 'tag2']);
      expect(parseTags).toHaveBeenCalledWith('tag1, tag2');
    });

    it('should handle tag parsing errors', async () => {
      // Use vi.doMock to override the mock for this specific test
      vi.doMock('@src/domains/installation/configurators/tagsConfigurator.js', () => ({
        parseTags: vi.fn(() => {
          throw new Error('Parse error');
        }),
        validateTags: vi.fn(() => ({ valid: true, errors: [] })),
      }));

      // Clear module registry to ensure fresh import
      vi.resetModules();

      // Import the adapter after mocking
      const { AdapterFactory } = await import('./index.js');
      const testAdapter = AdapterFactory.getInstallationAdapter();

      // parseTags is synchronous, so no await needed
      expect(() => testAdapter.parseTags('invalid')).toThrow('Tag parsing failed: Parse error');
    });
  });
});

describe('Management Adapter', () => {
  let adapter: ManagementAdapter;

  beforeEach(() => {
    adapter = createManagementAdapter();
  });

  describe('listServers', () => {
    it('should list servers successfully', async () => {
      const mockServers = {
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
      };

      const { getAllServers } = await import('@src/commands/mcp/utils/configUtils.js');
      (getAllServers as any).mockReturnValue(mockServers);

      const result = await adapter.listServers({ status: 'enabled' });

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('test-server');
      expect(result[0].status).toBe('enabled');
      expect(result[0].transport).toBe('stdio');
    });

    it('should filter by transport type', async () => {
      const mockServers = {
        'http-server': {
          name: 'http-server',
          url: 'http://localhost:3000/mcp',
          disabled: false,
        },
        'sse-server': {
          name: 'sse-server',
          url: 'http://localhost:3001/sse',
          disabled: false,
        },
        'stdio-server': {
          name: 'stdio-server',
          command: 'node',
          args: ['server.js'],
          disabled: false,
        },
      };

      const { getAllServers } = await import('@src/commands/mcp/utils/configUtils.js');
      (getAllServers as any).mockReturnValue(mockServers);

      const result = await adapter.listServers({ transport: 'sse' });

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('sse-server');
      expect(result[0].transport).toBe('sse');
    });

    it('should handle list errors', async () => {
      const { getAllServers } = await import('@src/commands/mcp/utils/configUtils.js');
      (getAllServers as any).mockImplementation(() => {
        throw new Error('List failed');
      });

      await expect(adapter.listServers()).rejects.toThrow('Server listing failed: List failed');
    });
  });

  describe('getServerStatus', () => {
    it('should get server status successfully', async () => {
      const mockServers = {
        'test-server': {
          name: 'test-server',
          command: 'node',
          args: ['server.js'],
          disabled: false,
        },
      };

      const { getAllServers } = await import('@src/commands/mcp/utils/configUtils.js');
      (getAllServers as any).mockReturnValue(mockServers);

      const result = await adapter.getServerStatus('test-server');

      expect(result.servers).toHaveLength(1);
      expect(result.servers[0].name).toBe('test-server');
      expect(result.servers[0].status).toBe('enabled');
      expect(result.totalServers).toBe(1);
      expect(result.enabledServers).toBe(1);
      expect(result.disabledServers).toBe(0);
    });

    it('should get all servers status when no name provided', async () => {
      const mockServers = {
        server1: { name: 'server1', disabled: false },
        server2: { name: 'server2', disabled: true },
      };

      const { getAllServers } = await import('@src/commands/mcp/utils/configUtils.js');
      (getAllServers as any).mockReturnValue(mockServers);

      const result = await adapter.getServerStatus();

      expect(result.servers).toHaveLength(2);
      expect(result.totalServers).toBe(2);
      expect(result.enabledServers).toBe(1);
      expect(result.disabledServers).toBe(1);
    });

    it('should handle status errors', async () => {
      const { getAllServers } = await import('@src/commands/mcp/utils/configUtils.js');
      (getAllServers as any).mockImplementation(() => {
        throw new Error('Status check failed');
      });

      await expect(adapter.getServerStatus()).rejects.toThrow('Server status check failed: Status check failed');
    });
  });

  describe('enableServer', () => {
    it('should enable server successfully', async () => {
      const mockConfig = { name: 'test-server', disabled: true };

      const { getServer, setServer } = await import('@src/commands/mcp/utils/configUtils.js');
      (getServer as any).mockReturnValue(mockConfig);
      (setServer as any).mockReturnValue(undefined);

      const result = await adapter.enableServer('test-server', { restart: true });

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('test-server');
      expect(result.enabled).toBe(true);
      expect(result.restarted).toBe(true);
      expect(setServer).toHaveBeenCalledWith('test-server', { ...mockConfig, disabled: false });
    });

    it('should handle server not found', async () => {
      const { getServer } = await import('@src/commands/mcp/utils/configUtils.js');
      (getServer as any).mockReturnValue(null);

      await expect(adapter.enableServer('nonexistent')).rejects.toThrow(
        "Server enable failed: Server 'nonexistent' not found",
      );
    });

    it('should handle already enabled server', async () => {
      const mockConfig = { name: 'test-server', disabled: false };

      const { getServer } = await import('@src/commands/mcp/utils/configUtils.js');
      (getServer as any).mockReturnValue(mockConfig);

      const result = await adapter.enableServer('test-server');

      expect(result.success).toBe(true);
      expect(result.warnings).toContain('Server was already enabled');
    });

    it('should handle enable errors', async () => {
      const { getServer } = await import('@src/commands/mcp/utils/configUtils.js');
      (getServer as any).mockImplementation(() => {
        throw new Error('Enable failed');
      });

      await expect(adapter.enableServer('test-server')).rejects.toThrow('Server enable failed: Enable failed');
    });
  });

  describe('disableServer', () => {
    it('should disable server successfully', async () => {
      const mockConfig = { name: 'test-server', disabled: false };

      const { getServer, setServer } = await import('@src/commands/mcp/utils/configUtils.js');
      (getServer as any).mockReturnValue(mockConfig);
      (setServer as any).mockReturnValue(undefined);

      const result = await adapter.disableServer('test-server', { graceful: true });

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('test-server');
      expect(result.disabled).toBe(true);
      expect(result.gracefulShutdown).toBe(true);
      expect(setServer).toHaveBeenCalledWith('test-server', { ...mockConfig, disabled: true });
    });

    it('should handle server not found', async () => {
      const { getServer } = await import('@src/commands/mcp/utils/configUtils.js');
      (getServer as any).mockReturnValue(null);

      await expect(adapter.disableServer('nonexistent')).rejects.toThrow(
        "Server disable failed: Server 'nonexistent' not found",
      );
    });

    it('should handle already disabled server', async () => {
      const mockConfig = { name: 'test-server', disabled: true };

      const { getServer } = await import('@src/commands/mcp/utils/configUtils.js');
      (getServer as any).mockReturnValue(mockConfig);

      const result = await adapter.disableServer('test-server');

      expect(result.success).toBe(true);
      expect(result.warnings).toContain('Server was already disabled');
    });
  });

  describe('reloadConfiguration', () => {
    it('should reload configuration successfully', async () => {
      const { getAllServers } = await import('@src/commands/mcp/utils/configUtils.js');
      (getAllServers as any).mockReturnValue({
        server1: { name: 'server1' },
        server2: { name: 'server2' },
      });

      const result = await adapter.reloadConfiguration();

      expect(result.success).toBe(true);
      expect(result.target).toBe('all-servers');
      expect(result.success).toBe(true);
      expect(result.target).toBe('all-servers');
      expect(result.action).toBe('full-reload');
      expect(result.reloadedServers).toEqual(['server1', 'server2']);

      const { reloadMcpConfig } = await import('@src/commands/mcp/utils/configUtils.js');
      expect(reloadMcpConfig).toHaveBeenCalled();
    });

    it('should reload specific server', async () => {
      const result = await adapter.reloadConfiguration({ server: 'test-server' });

      expect(result.success).toBe(true);
      expect(result.target).toBe('test-server');
      expect(result.action).toBe('full-reload');
      expect(result.reloadedServers).toEqual(['test-server']);

      const { reloadMcpConfig } = await import('@src/commands/mcp/utils/configUtils.js');
      expect(reloadMcpConfig).toHaveBeenCalled();
    });

    it('should handle config-only reload', async () => {
      const result = await adapter.reloadConfiguration({ configOnly: true });

      expect(result.action).toBe('config-reload');

      const { reloadMcpConfig } = await import('@src/commands/mcp/utils/configUtils.js');
      expect(reloadMcpConfig).toHaveBeenCalled();
    });

    it('should handle reload errors', async () => {
      const { getAllServers } = await import('@src/commands/mcp/utils/configUtils.js');
      (getAllServers as any).mockImplementation(() => {
        throw new Error('Reload failed');
      });

      await expect(adapter.reloadConfiguration()).rejects.toThrow('Configuration reload failed: Reload failed');
    });
  });

  describe('updateServerConfig', () => {
    it('should update server config successfully', async () => {
      const mockConfig = { name: 'test-server', command: 'node', args: ['old.js'] };
      const configUpdate = { args: ['new.js'] };

      const { getServer, setServer } = await import('@src/commands/mcp/utils/configUtils.js');
      (getServer as any).mockReturnValue(mockConfig);
      (setServer as any).mockReturnValue(undefined);

      const result = await adapter.updateServerConfig('test-server', configUpdate);

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('test-server');
      expect(result.previousConfig).toEqual(mockConfig);
      expect(result.newConfig).toEqual({ ...mockConfig, ...configUpdate });
      expect(result.updated).toBe(true);
      expect(setServer).toHaveBeenCalledWith('test-server', { ...mockConfig, ...configUpdate });
    });

    it('should handle server not found', async () => {
      const { getServer } = await import('@src/commands/mcp/utils/configUtils.js');
      (getServer as any).mockReturnValue(null);

      await expect(adapter.updateServerConfig('nonexistent', {})).rejects.toThrow(
        "Server config update failed: Server 'nonexistent' not found",
      );
    });

    it('should handle config update errors', async () => {
      const { getServer } = await import('@src/commands/mcp/utils/configUtils.js');
      (getServer as any).mockImplementation(() => {
        throw new Error('Update failed');
      });

      await expect(adapter.updateServerConfig('test-server', {})).rejects.toThrow(
        'Server config update failed: Update failed',
      );
    });
  });

  describe('validateServerConfig', () => {
    it('should validate server config successfully', async () => {
      const config = { command: 'node', args: ['server.js'] };

      const { validateServer1mcpUrl } = await import('@src/utils/validation/urlDetection.js');
      (validateServer1mcpUrl as any).mockReturnValue({ isValid: true, error: null });

      const result = await adapter.validateServerConfig('test-server', config);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing command and URL', async () => {
      const config = {};

      const result = await adapter.validateServerConfig('test-server', config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Server must have either a command or URL');
    });

    it('should validate URLs', async () => {
      const config = { url: 'invalid-url' };

      const { validateServer1mcpUrl } = await import('@src/utils/validation/urlDetection.js');
      (validateServer1mcpUrl as any).mockReturnValue({ isValid: false, error: 'Invalid URL format' });

      const result = await adapter.validateServerConfig('test-server', config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid URL: Invalid URL format');
    });

    it('should validate tags', async () => {
      const config = { command: 'node', tags: ['invalid-tag!'] };

      const { validateServer1mcpUrl } = await import('@src/utils/validation/urlDetection.js');
      (validateServer1mcpUrl as any).mockReturnValue({ isValid: true, error: null });

      const result = await adapter.validateServerConfig('test-server', config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.includes('Invalid tags'))).toBe(true);
    });

    it('should provide warnings for both command and URL', async () => {
      const config = { command: 'node', url: 'http://localhost:3000/mcp' };

      const { validateServer1mcpUrl } = await import('@src/utils/validation/urlDetection.js');
      (validateServer1mcpUrl as any).mockReturnValue({ isValid: true, error: null });

      const result = await adapter.validateServerConfig('test-server', config);

      expect(result.warnings).toContain('Both command and URL specified - URL will take precedence');
    });

    it('should provide suggestions for stdio transport', async () => {
      const config = { command: 'node', args: ['server.js'] };

      const { validateServer1mcpUrl } = await import('@src/utils/validation/urlDetection.js');
      (validateServer1mcpUrl as any).mockReturnValue({ isValid: true, error: null });

      const result = await adapter.validateServerConfig('test-server', config);

      expect(result.suggestions).toContain('Consider using URL-based transport for better compatibility');
    });

    it('should handle validation errors', async () => {
      const { validateServer1mcpUrl } = await import('@src/utils/validation/urlDetection.js');
      (validateServer1mcpUrl as any).mockImplementation(() => {
        throw new Error('Validation error');
      });

      // Provide a config with URL to trigger URL validation
      const result = await adapter.validateServerConfig('test-server', {
        command: 'node',
        url: 'http://invalid-url',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Validation error');
    });
  });

  describe('getServerUrl', () => {
    it('should get server URL successfully', async () => {
      const { getServer1mcpUrl } = await import('@src/utils/validation/urlDetection.js');
      (getServer1mcpUrl as any).mockReturnValue('http://localhost:3051/mcp');

      const result = await adapter.getServerUrl();

      expect(result).toBe('http://localhost:3051/mcp');
    });

    it('should handle URL errors', async () => {
      const { getServer1mcpUrl } = await import('@src/utils/validation/urlDetection.js');
      (getServer1mcpUrl as any).mockImplementation(() => {
        throw new Error('URL error');
      });

      await expect(adapter.getServerUrl()).rejects.toThrow('Failed to get server URL: URL error');
    });
  });
});
