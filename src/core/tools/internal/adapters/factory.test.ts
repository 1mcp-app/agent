import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdapterFactory, createDiscoveryAdapter, createInstallationAdapter, createManagementAdapter } from './index.js';

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
