import { ConfigChangeEvent, McpConfigManager } from '@src/config/mcpConfigManager.js';
import { setupCapabilities } from '@src/core/capabilities/capabilityManager.js';
import { ClientManager } from '@src/core/client/clientManager.js';
import logger from '@src/logger/logger.js';
import { createTransports } from '@src/transport/transportFactory.js';

import { beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';

import { ConfigReloadService } from './configReloadService.js';

// Mock dependencies
vi.mock('@src/config/mcpConfigManager.js', () => ({
  McpConfigManager: {
    getInstance: vi.fn(),
  },
  ConfigChangeEvent: {
    TRANSPORT_CONFIG_CHANGED: 'transportConfigChanged',
  },
}));

vi.mock('@src/core/client/clientManager.js', () => ({
  ClientManager: {
    getOrCreateInstance: vi.fn().mockReturnValue({
      createClients: vi.fn(),
    }),
  },
}));

vi.mock('@src/transport/transportFactory.js', () => ({
  createTransports: vi.fn(),
}));

vi.mock('@src/core/capabilities/capabilityManager.js', () => ({
  setupCapabilities: vi.fn(),
}));

vi.mock('@src/core/reload/selectiveReloadManager.js', () => ({
  SelectiveReloadManager: {
    getInstance: vi.fn().mockReturnValue({
      executeReload: vi.fn().mockResolvedValue({
        status: 'completed',
        changes: {
          toolsChanged: false,
          resourcesChanged: false,
          promptsChanged: false,
          hasChanges: false,
          addedServers: [],
          removedServers: [],
          current: { tools: [], resources: [], prompts: [] },
          previous: { tools: [], resources: [], prompts: [] },
        },
      }),
    }),
  },
}));

vi.mock('@src/core/server/serverManager.js', () => ({
  ServerManager: {
    current: {
      updateClientsAndTransports: vi.fn(),
      getInboundConnections: vi.fn().mockReturnValue(new Map()),
      getClients: vi.fn().mockReturnValue(new Map()),
    },
  },
}));

vi.mock('@src/core/server/agentConfig.js', () => ({
  AgentConfigManager: {
    getInstance: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue({ clientNotifications: true }),
    }),
  },
}));

vi.mock('@src/core/capabilities/capabilityAggregator.js', () => ({
  CapabilityAggregator: vi.fn().mockImplementation(() => ({
    updateCapabilities: vi.fn().mockResolvedValue({
      hasChanges: false,
      current: { tools: [], resources: [], prompts: [] },
      previous: { tools: [], resources: [], prompts: [] },
      addedServers: [],
      removedServers: [],
    }),
  })),
}));

vi.mock('@src/core/notifications/notificationManager.js', () => ({
  NotificationManager: vi.fn().mockImplementation(() => ({
    handleCapabilityChanges: vi.fn(),
  })),
}));

vi.mock('@src/logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  debugIf: vi.fn(),
}));

vi.mock('@src/transport/transportFactory.js', () => ({
  createTransports: vi.fn(),
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
      getTransportConfig: vi.fn().mockReturnValue({}),
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
      configReloadService.initialize();

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
      configReloadService.initialize();
    });

    it('should handle config change without serverInfo', async () => {
      const newConfig = { server1: { name: 'new-server' } };
      const handleConfigChange = mockConfigManager.on.mock.calls[0][1]; // Get the callback function

      await handleConfigChange(newConfig);

      // The new implementation uses SelectiveReloadManager instead of direct calls
      const { SelectiveReloadManager } = await import('@src/core/reload/selectiveReloadManager.js');
      expect(SelectiveReloadManager.getInstance).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('Configuration reload completed successfully');
      expect(logger.info).toHaveBeenCalledWith('Handling configuration change...');
    });

    it('should handle config change with serverInfo', async () => {
      const sessionId = 'test-session';
      configReloadService.updateServerInfo(sessionId, mockServerInfo);
      const newConfig = { server1: { name: 'new-server' } };
      const handleConfigChange = mockConfigManager.on.mock.calls[0][1]; // Get the callback function

      await handleConfigChange(newConfig);

      // The new implementation uses SelectiveReloadManager instead of direct calls
      const { SelectiveReloadManager } = await import('@src/core/reload/selectiveReloadManager.js');
      expect(SelectiveReloadManager.getInstance).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('Configuration reload completed successfully');
      expect(logger.info).toHaveBeenCalledWith('Handling configuration change...');
    });

    it('should handle transport close errors gracefully', async () => {
      const error = new Error('Reload failed');
      const mockSelectiveReloadManager = {
        executeReload: vi.fn().mockRejectedValue(error),
      };

      // Override the SelectiveReloadManager mock for this test
      const { SelectiveReloadManager } = await import('@src/core/reload/selectiveReloadManager.js');
      (SelectiveReloadManager.getInstance as any).mockReturnValue(mockSelectiveReloadManager);

      const newConfig = { server1: { name: 'new-server' } };
      const handleConfigChange = mockConfigManager.on.mock.calls[0][1];

      await handleConfigChange(newConfig);

      expect(logger.error).toHaveBeenCalledWith('Failed to reload configuration: Error: Reload failed');
    });

    it('should handle reload errors gracefully', async () => {
      const error = new Error('Reload failed');
      const mockSelectiveReloadManager = {
        executeReload: vi.fn().mockRejectedValue(error),
      };

      // Override the SelectiveReloadManager mock for this test
      const { SelectiveReloadManager } = await import('@src/core/reload/selectiveReloadManager.js');
      (SelectiveReloadManager.getInstance as any).mockReturnValue(mockSelectiveReloadManager);

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
