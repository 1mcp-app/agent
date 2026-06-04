import { ConfigChangeType, ConfigManager } from '@src/config/configManager.js';
import { ConfigChangeHandler } from '@src/core/configChangeHandler.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock modules at top level to avoid hoisting issues
vi.mock('@src/core/server/serverManager.js', () => ({
  ServerManager: {
    current: {
      startServer: vi.fn().mockResolvedValue(undefined),
      stopServer: vi.fn().mockResolvedValue(undefined),
      restartServer: vi.fn().mockResolvedValue(undefined),
      updateServerMetadata: vi.fn().mockResolvedValue(undefined),
      isMcpServerRunning: vi.fn().mockReturnValue(true), // Assume server is running for metadata update tests
      getInboundConnections: vi.fn().mockReturnValue(new Map()),
      getClients: vi.fn().mockReturnValue(new Map()),
    },
  },
}));

vi.mock('@src/config/configManager.js', () => ({
  CONFIG_EVENTS: {
    CONFIG_CHANGED: 'configChanged',
    METADATA_UPDATED: 'metadataUpdated',
  },
  ConfigChangeType: {
    ADDED: 'added',
    REMOVED: 'removed',
    MODIFIED: 'modified',
  },
  ConfigManager: {
    getInstance: vi.fn(),
  },
}));

describe('ConfigChangeHandler', () => {
  let configChangeHandler: ConfigChangeHandler;
  let mockConfigManager: any;

  beforeEach(async () => {
    // Reset singleton
    (ConfigChangeHandler as any).instance = null;
    (ConfigManager as any).instance = null;

    // Mock ConfigManager
    mockConfigManager = {
      getInstance: vi.fn(() => mockConfigManager),
      on: vi.fn(),
      getTransportConfig: vi.fn(() => ({})),
      emit: vi.fn(),
      removeAllListeners: vi.fn(),
    } as any;

    // Setup mock return value
    vi.mocked(ConfigManager.getInstance).mockReturnValue(mockConfigManager);

    configChangeHandler = ConfigChangeHandler.getInstance();

    await configChangeHandler.initialize();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('edge cases for disabled servers', () => {
    it('should handle servers that are disabled from the start', async () => {
      const changes = [
        {
          serverName: 'initially-disabled-server',
          type: ConfigChangeType.ADDED,
        },
      ];

      const newConfig = {
        'initially-disabled-server': {
          command: 'node',
          args: ['server.js'],
          disabled: true,
        },
      };

      mockConfigManager.getTransportConfig = vi.fn(() => newConfig);

      // Simulate config change event
      const changeHandler = (mockConfigManager.on as any).mock.calls[0][1];
      await changeHandler(changes);

      const { ServerManager } = await import('@src/core/server/serverManager.js');
      // Even though it's an ADD event, it should still start the server initially
      // The transport factory will handle skipping disabled servers
      expect(ServerManager.current.startServer).toHaveBeenCalledWith(
        'initially-disabled-server',
        newConfig['initially-disabled-server'],
      );
    });

    it('should handle rapid disable/enable changes', async () => {
      // Test multiple rapid changes to the same server
      const changes = [
        {
          serverName: 'rapid-change-server',
          type: ConfigChangeType.MODIFIED,
          fieldsChanged: ['disabled'],
        },
      ];

      // First disable
      let newConfig = {
        'rapid-change-server': {
          command: 'node',
          args: ['server.js'],
          disabled: true,
        },
      };

      mockConfigManager.getTransportConfig = vi.fn(() => newConfig);

      // Simulate config change event
      const changeHandler = (mockConfigManager.on as any).mock.calls[0][1];
      await changeHandler(changes);

      const { ServerManager } = await import('@src/core/server/serverManager.js');
      expect(ServerManager.current.stopServer).toHaveBeenCalledWith('rapid-change-server');

      // Reset mocks for next change
      vi.clearAllMocks();

      // Then re-enable
      newConfig = {
        'rapid-change-server': {
          command: 'node',
          args: ['server.js'],
          disabled: false,
        },
      };

      mockConfigManager.getTransportConfig = vi.fn(() => newConfig);

      await changeHandler(changes);

      expect(ServerManager.current.startServer).toHaveBeenCalledWith(
        'rapid-change-server',
        newConfig['rapid-change-server'],
      );
    });

    it('should handle undefined disabled field (treat as enabled)', async () => {
      const changes = [
        {
          serverName: 'undefined-disabled-server',
          type: ConfigChangeType.MODIFIED,
          fieldsChanged: ['command'],
        },
      ];

      const newConfig = {
        'undefined-disabled-server': {
          command: 'python',
          args: ['server.py'],
          // disabled field is undefined, should be treated as enabled
        },
      };

      mockConfigManager.getTransportConfig = vi.fn(() => newConfig);

      // Simulate config change event
      const changeHandler = (mockConfigManager.on as any).mock.calls[0][1];
      await changeHandler(changes);

      const { ServerManager } = await import('@src/core/server/serverManager.js');
      expect(ServerManager.current.restartServer).toHaveBeenCalledWith(
        'undefined-disabled-server',
        newConfig['undefined-disabled-server'],
      );
    });

    it('should handle errors during server stop gracefully', async () => {
      const changes = [
        {
          serverName: 'stop-error-server',
          type: ConfigChangeType.MODIFIED,
          fieldsChanged: ['disabled'],
        },
      ];

      const newConfig = {
        'stop-error-server': {
          command: 'node',
          args: ['server.js'],
          disabled: true,
        },
      };

      mockConfigManager.getTransportConfig = vi.fn(() => newConfig);

      // Make stopServer fail
      const { ServerManager } = await import('@src/core/server/serverManager.js');
      (ServerManager.current.stopServer as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Stop failed'));

      // Mock console.error to capture error logs
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Simulate config change event
      const changeHandler = (mockConfigManager.on as any).mock.calls[0][1];

      // Should not throw error even if stopServer fails
      await expect(changeHandler(changes)).resolves.toBeUndefined();

      expect(ServerManager.current.stopServer).toHaveBeenCalledWith('stop-error-server');

      consoleSpy.mockRestore();
    });

    it('should handle errors during server start gracefully', async () => {
      const changes = [
        {
          serverName: 'start-error-server',
          type: ConfigChangeType.MODIFIED,
          fieldsChanged: ['disabled'],
        },
      ];

      const newConfig = {
        'start-error-server': {
          command: 'python',
          args: ['server.py'],
          disabled: false,
        },
      };

      mockConfigManager.getTransportConfig = vi.fn(() => newConfig);

      // Make startServer fail
      const { ServerManager } = await import('@src/core/server/serverManager.js');
      (ServerManager.current.startServer as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Start failed'));

      // Mock console.error to capture error logs
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Simulate config change event
      const changeHandler = (mockConfigManager.on as any).mock.calls[0][1];

      // Should not throw error even if startServer fails
      await expect(changeHandler(changes)).resolves.toBeUndefined();

      expect(ServerManager.current.startServer).toHaveBeenCalledWith(
        'start-error-server',
        newConfig['start-error-server'],
      );

      consoleSpy.mockRestore();
    });
  });

  describe('cleanup', () => {
    it('should remove event listeners on stop', async () => {
      await configChangeHandler.stop();

      expect(mockConfigManager.removeAllListeners).toHaveBeenCalledWith('configChanged');
    });
  });
});
