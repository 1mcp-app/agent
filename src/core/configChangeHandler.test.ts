import { ConfigChangeType, ConfigManager } from '@src/config/configManager.js';
import { ConfigChangeHandler } from '@src/core/configChangeHandler.js';
import logger from '@src/logger/logger.js';

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

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      expect(configChangeHandler).toBeDefined();
    });

    it('should register listener for config changes', () => {
      expect(mockConfigManager.on).toHaveBeenCalledWith('configChanged', expect.any(Function));
    });
  });

  describe('handling added servers', () => {
    it('should start new servers', async () => {
      const changes = [
        {
          serverName: 'new-server',
          type: ConfigChangeType.ADDED,
        },
      ];

      const newConfig = {
        'new-server': {
          command: 'node',
          args: ['server.js'],
        },
      };

      mockConfigManager.getTransportConfig = vi.fn(() => newConfig);

      // Simulate config change event
      const changeHandler = (mockConfigManager.on as any).mock.calls[0][1];
      await changeHandler(changes);

      const { ServerManager } = await import('@src/core/server/serverManager.js');
      expect(ServerManager.current.startServer).toHaveBeenCalledWith('new-server', newConfig['new-server']);
    });

    it('should skip added servers missing from latest config without logging a processing error', async () => {
      const changes = [
        {
          serverName: 'missing-added-server',
          type: ConfigChangeType.ADDED,
        },
      ];

      mockConfigManager.getTransportConfig = vi.fn(() => ({}));
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger);

      const changeHandler = (mockConfigManager.on as any).mock.calls[0][1];
      await changeHandler(changes);

      const { ServerManager } = await import('@src/core/server/serverManager.js');
      expect(ServerManager.current.startServer).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Failed to process change for server missing-added-server'),
      );

      errorSpy.mockRestore();
    });
  });

  describe('handling removed servers', () => {
    it('should stop removed servers', async () => {
      const changes = [
        {
          serverName: 'removed-server',
          type: ConfigChangeType.REMOVED,
        },
      ];

      // Simulate config change event
      const changeHandler = (mockConfigManager.on as any).mock.calls[0][1];
      await changeHandler(changes);

      const { ServerManager } = await import('@src/core/server/serverManager.js');
      expect(ServerManager.current.stopServer).toHaveBeenCalledWith('removed-server');
    });
  });

  describe('handling modified servers', () => {
    it('should restart servers with functional changes', async () => {
      const changes = [
        {
          serverName: 'modified-server',
          type: ConfigChangeType.MODIFIED,
          fieldsChanged: ['command', 'args'],
        },
      ];

      const newConfig = {
        'modified-server': {
          command: 'python',
          args: ['server.py'],
        },
      };

      mockConfigManager.getTransportConfig = vi.fn(() => newConfig);

      // Simulate config change event
      const changeHandler = (mockConfigManager.on as any).mock.calls[0][1];
      await changeHandler(changes);

      const { ServerManager } = await import('@src/core/server/serverManager.js');
      expect(ServerManager.current.restartServer).toHaveBeenCalledWith('modified-server', newConfig['modified-server']);
    });

    it('should skip modified servers missing from latest config without logging a processing error', async () => {
      const changes = [
        {
          serverName: 'logfire',
          type: ConfigChangeType.MODIFIED,
          fieldsChanged: ['disabled'],
        },
      ];

      mockConfigManager.getTransportConfig = vi.fn(() => ({}));
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger);

      const changeHandler = (mockConfigManager.on as any).mock.calls[0][1];
      await changeHandler(changes);

      const { ServerManager } = await import('@src/core/server/serverManager.js');
      expect(ServerManager.current.stopServer).not.toHaveBeenCalledWith('logfire');
      expect(ServerManager.current.startServer).not.toHaveBeenCalledWith('logfire', expect.anything());
      expect(ServerManager.current.restartServer).not.toHaveBeenCalledWith('logfire', expect.anything());
      expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('Failed to process change for server logfire'));

      errorSpy.mockRestore();
    });

    it('should NOT restart servers for tag-only changes', async () => {
      const changes = [
        {
          serverName: 'tag-only-server',
          type: ConfigChangeType.MODIFIED,
          fieldsChanged: ['tags'],
        },
      ];

      const newConfig = {
        'tag-only-server': {
          command: 'node',
          args: ['server.js'],
          tags: ['updated', 'tags'],
        },
      };

      mockConfigManager.getTransportConfig = vi.fn(() => newConfig);

      // Simulate config change event
      const changeHandler = (mockConfigManager.on as any).mock.calls[0][1];
      await changeHandler(changes);

      const { ServerManager } = await import('@src/core/server/serverManager.js');
      expect(ServerManager.current.restartServer).not.toHaveBeenCalled();
      expect(mockConfigManager.emit).toHaveBeenCalledWith('metadataUpdated', {
        serverName: 'tag-only-server',
        config: newConfig['tag-only-server'],
      });
    });

    it('should restart servers when fieldsChanged is undefined (conservative approach)', async () => {
      const changes = [
        {
          serverName: 'unknown-change-server',
          type: ConfigChangeType.MODIFIED,
          fieldsChanged: undefined,
        },
      ];

      const newConfig = {
        'unknown-change-server': {
          command: 'node',
          args: ['server.js'],
        },
      };

      mockConfigManager.getTransportConfig = vi.fn(() => newConfig);

      // Simulate config change event
      const changeHandler = (mockConfigManager.on as any).mock.calls[0][1];
      await changeHandler(changes);

      const { ServerManager } = await import('@src/core/server/serverManager.js');
      expect(ServerManager.current.restartServer).toHaveBeenCalledWith(
        'unknown-change-server',
        newConfig['unknown-change-server'],
      );
    });

    it('should restart servers when no fields changed (empty array)', async () => {
      const changes = [
        {
          serverName: 'empty-changes-server',
          type: ConfigChangeType.MODIFIED,
          fieldsChanged: [],
        },
      ];

      const newConfig = {
        'empty-changes-server': {
          command: 'node',
          args: ['server.js'],
        },
      };

      mockConfigManager.getTransportConfig = vi.fn(() => newConfig);

      // Simulate config change event
      const changeHandler = (mockConfigManager.on as any).mock.calls[0][1];
      await changeHandler(changes);

      const { ServerManager } = await import('@src/core/server/serverManager.js');
      expect(ServerManager.current.restartServer).toHaveBeenCalledWith(
        'empty-changes-server',
        newConfig['empty-changes-server'],
      );
    });
  });

  describe('mixed changes', () => {
    it('should handle multiple changes of different types', async () => {
      const changes = [
        {
          serverName: 'added-server',
          type: ConfigChangeType.ADDED,
        },
        {
          serverName: 'removed-server',
          type: ConfigChangeType.REMOVED,
        },
        {
          serverName: 'restarted-server',
          type: ConfigChangeType.MODIFIED,
          fieldsChanged: ['command'],
        },
        {
          serverName: 'metadata-server',
          type: ConfigChangeType.MODIFIED,
          fieldsChanged: ['tags'],
        },
      ];

      const newConfig = {
        'added-server': {
          command: 'python',
          args: ['added.py'],
        },
        'restarted-server': {
          command: 'node',
          args: ['restarted.js'],
        },
        'metadata-server': {
          command: 'node',
          args: ['metadata.js'],
          tags: ['new', 'tags'],
        },
      };

      mockConfigManager.getTransportConfig = vi.fn(() => newConfig);

      // Mock the notification methods to avoid async complexity
      const mockNotificationManager = {
        handleCapabilityChanges: vi.fn(),
      };

      vi.mock('@src/core/notifications/notificationManager.js', () => ({
        NotificationManager: vi.fn(() => mockNotificationManager),
      }));

      vi.mock('@src/core/capabilities/capabilityAggregator.js', () => ({
        CapabilityAggregator: vi.fn().mockImplementation(() => ({
          updateCapabilities: vi.fn().mockResolvedValue({
            hasChanges: true,
            current: { tools: [], resources: [], prompts: [] },
            addedServers: [],
            removedServers: [],
          }),
        })),
      }));

      vi.mock('@src/core/server/agentConfig.js', () => ({
        AgentConfigManager: {
          getInstance: () => ({
            get: () => ({ clientNotifications: true }),
          }),
        },
      }));

      // Simulate config change event
      const changeHandler = (mockConfigManager.on as any).mock.calls[0][1];
      await changeHandler(changes);

      const { ServerManager } = await import('@src/core/server/serverManager.js');
      expect(ServerManager.current.startServer).toHaveBeenCalledWith('added-server', newConfig['added-server']);
      expect(ServerManager.current.stopServer).toHaveBeenCalledWith('removed-server');
      expect(ServerManager.current.restartServer).toHaveBeenCalledWith(
        'restarted-server',
        newConfig['restarted-server'],
      );
      expect(ServerManager.current.restartServer).not.toHaveBeenCalledWith('metadata-server', expect.any(Object));
    });
  });

  describe('error handling', () => {
    it('should continue processing other changes if one fails', async () => {
      const changes = [
        {
          serverName: 'failing-server',
          type: ConfigChangeType.ADDED,
        },
        {
          serverName: 'success-server',
          type: ConfigChangeType.ADDED,
        },
      ];

      const newConfig = {
        'failing-server': {
          command: 'node',
          args: ['failing.js'],
        },
        'success-server': {
          command: 'python',
          args: ['success.py'],
        },
      };

      mockConfigManager.getTransportConfig = vi.fn(() => newConfig);

      // Make startServer fail for the first server
      const { ServerManager } = await import('@src/core/server/serverManager.js');
      (ServerManager.current.startServer as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('Server start failed'))
        .mockResolvedValueOnce(undefined);

      // Mock console.error to capture error logs
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Simulate config change event
      const changeHandler = (mockConfigManager.on as any).mock.calls[0][1];
      await changeHandler(changes);

      // Should still attempt to start the second server
      expect(ServerManager.current.startServer).toHaveBeenCalledTimes(2);
      expect(ServerManager.current.startServer).toHaveBeenCalledWith('success-server', newConfig['success-server']);

      consoleSpy.mockRestore();
    });
  });
});
