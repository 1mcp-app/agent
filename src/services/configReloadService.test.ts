import { vi, describe, it, expect, beforeEach, MockInstance } from 'vitest';
import { ConfigReloadService } from './configReloadService.js';
import { McpConfigManager, ConfigChangeEvent } from '../config/mcpConfigManager.js';
import { ClientManager } from '../core/client/clientManager.js';
import { createTransports } from '../transport/transportFactory.js';
import { setupCapabilities } from '../core/capabilities/capabilityManager.js';
import { ServerManager } from '../core/server/serverManager.js';
import logger from '../logger/logger.js';

// Mock dependencies
vi.mock('../config/mcpConfigManager.js', () => ({
  McpConfigManager: {
    getInstance: vi.fn(),
  },
  ConfigChangeEvent: {
    TRANSPORT_CONFIG_CHANGED: 'transportConfigChanged',
  },
}));

vi.mock('../core/client/clientManager.js', () => ({
  ClientManager: {
    getOrCreateInstance: vi.fn().mockReturnValue({
      createClients: vi.fn(),
    }),
  },
}));

vi.mock('../transport/transportFactory.js', () => ({
  createTransports: vi.fn(),
}));

vi.mock('../capabilities/capabilityManager.js', () => ({
  setupCapabilities: vi.fn(),
}));

vi.mock('../core/server/serverManager.js', () => ({
  ServerManager: {
    current: {
      updateClientsAndTransports: vi.fn(),
    },
  },
}));

vi.mock('../logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('ConfigReloadService', () => {
  let configReloadService: ConfigReloadService;
  let mockConfigManager: any;
  let mockTransports: Record<string, any>;
  let mockClients: Record<string, any>;
  let mockServerInfo: any;
  let mockClientManager: any;

  beforeEach(() => {
    // Reset singleton state for test isolation
    (ConfigReloadService as any).instance = undefined;

    // Setup mocks
    mockConfigManager = {
      removeAllListeners: vi.fn(),
      setMaxListeners: vi.fn(),
      on: vi.fn(),
      startWatching: vi.fn(),
      stopWatching: vi.fn(),
    };

    mockTransports = {
      transport1: { close: vi.fn() },
      transport2: { close: vi.fn() },
    };

    mockClients = {
      client1: { name: 'client1' },
      client2: { name: 'client2' },
    };

    mockServerInfo = {
      server: { name: 'test-server' },
      tags: ['test'],
    };

    mockClientManager = {
      createClients: vi.fn().mockResolvedValue(mockClients),
    };

    (McpConfigManager.getInstance as unknown as MockInstance).mockReturnValue(mockConfigManager);
    (createTransports as unknown as MockInstance).mockReturnValue(mockTransports);
    (ClientManager.getOrCreateInstance as unknown as MockInstance).mockReturnValue(mockClientManager);
    (setupCapabilities as unknown as MockInstance).mockResolvedValue(undefined);

    configReloadService = ConfigReloadService.getInstance();
  });

  describe('getInstance', () => {
    it('should create a singleton instance', () => {
      const instance1 = ConfigReloadService.getInstance();
      const instance2 = ConfigReloadService.getInstance();

      expect(instance1).toBe(instance2);
    });
  });

  describe('initialize', () => {
    it('should initialize with transports for server startup', () => {
      configReloadService.initialize(mockTransports);

      expect(mockConfigManager.removeAllListeners).toHaveBeenCalledWith(ConfigChangeEvent.TRANSPORT_CONFIG_CHANGED);
      expect(mockConfigManager.setMaxListeners).toHaveBeenCalledWith(20);
      expect(mockConfigManager.on).toHaveBeenCalledWith(
        ConfigChangeEvent.TRANSPORT_CONFIG_CHANGED,
        expect.any(Function),
      );
      expect(mockConfigManager.startWatching).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('Config reload service initialized');
    });
  });

  describe('updateServerInfo', () => {
    it('should update server info when called', () => {
      const sessionId = 'test-session';
      configReloadService.updateServerInfo(sessionId, mockServerInfo);

      expect(logger.debug).toHaveBeenCalledWith(
        `Updated server info for session ${sessionId} in config reload service`,
      );
    });
  });

  describe('removeServerInfo', () => {
    it('should remove server info when called', () => {
      const sessionId = 'test-session';
      configReloadService.updateServerInfo(sessionId, mockServerInfo);
      vi.clearAllMocks();

      configReloadService.removeServerInfo(sessionId);

      expect(logger.debug).toHaveBeenCalledWith(
        `Removed server info for session ${sessionId} from config reload service`,
      );
    });
  });

  describe('handleConfigChange', () => {
    beforeEach(() => {
      configReloadService.initialize(mockTransports);
    });

    it('should handle config change without serverInfo', async () => {
      const newConfig = { server1: { name: 'new-server' } };
      const handleConfigChange = mockConfigManager.on.mock.calls[0][1]; // Get the callback function

      await handleConfigChange(newConfig);

      expect(createTransports).toHaveBeenCalledWith(newConfig);
      expect(mockClientManager.createClients).toHaveBeenCalledWith(mockTransports);
      expect(ServerManager.current.updateClientsAndTransports).toHaveBeenCalledWith(mockClients, mockTransports);
      expect(setupCapabilities).not.toHaveBeenCalled(); // Should not be called when no server instances are available
    });

    it('should handle config change with serverInfo', async () => {
      const sessionId = 'test-session';
      configReloadService.updateServerInfo(sessionId, mockServerInfo);
      const newConfig = { server1: { name: 'new-server' } };
      const handleConfigChange = mockConfigManager.on.mock.calls[0][1]; // Get the callback function

      await handleConfigChange(newConfig);

      expect(createTransports).toHaveBeenCalledWith(newConfig);
      expect(mockClientManager.createClients).toHaveBeenCalledWith(mockTransports);
      expect(ServerManager.current.updateClientsAndTransports).toHaveBeenCalledWith(mockClients, mockTransports);
      expect(setupCapabilities).toHaveBeenCalledWith(mockClients, mockServerInfo);
    });

    it('should handle transport close errors gracefully', async () => {
      const error = new Error('Close failed');
      mockTransports.transport1.close.mockRejectedValue(error);

      const newConfig = { server1: { name: 'new-server' } };
      const handleConfigChange = mockConfigManager.on.mock.calls[0][1];

      await handleConfigChange(newConfig);

      expect(logger.error).toHaveBeenCalledWith('Error closing transport transport1: Error: Close failed');
      expect(createTransports).toHaveBeenCalledWith(newConfig);
    });

    it('should handle reload errors gracefully', async () => {
      const error = new Error('Reload failed');
      (createTransports as unknown as MockInstance).mockImplementation(() => {
        throw error;
      });

      const newConfig = { server1: { name: 'new-server' } };
      const handleConfigChange = mockConfigManager.on.mock.calls[0][1];

      await handleConfigChange(newConfig);

      expect(logger.error).toHaveBeenCalledWith('Failed to reload configuration: Error: Reload failed');
    });
  });

  describe('stop', () => {
    it('should stop watching and clean up listeners', () => {
      configReloadService.stop();

      expect(mockConfigManager.stopWatching).toHaveBeenCalled();
      expect(mockConfigManager.removeAllListeners).toHaveBeenCalledWith(ConfigChangeEvent.TRANSPORT_CONFIG_CHANGED);
      expect(logger.info).toHaveBeenCalledWith('Config reload service stopped');
    });
  });
});
