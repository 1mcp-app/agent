import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDiscoveryAdapter, type DiscoveryAdapter } from './index.js';

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

vi.mock('@src/domains/registry/mcpRegistryClient.js', () => ({
  createRegistryClient: vi.fn(() => mockRegistryClient),
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
