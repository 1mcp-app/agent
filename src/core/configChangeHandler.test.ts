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
      loadMcpServer: vi.fn().mockResolvedValue(undefined),
      unloadMcpServer: vi.fn().mockResolvedValue(undefined),
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
      expect(ServerManager.current.loadMcpServer).toHaveBeenCalledWith('new-server', newConfig['new-server']);
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
      expect(ServerManager.current.loadMcpServer).not.toHaveBeenCalled();
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
      expect(ServerManager.current.unloadMcpServer).toHaveBeenCalledWith('removed-server');
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
      expect(ServerManager.current.loadMcpServer).toHaveBeenCalledWith('modified-server', newConfig['modified-server']);
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
      expect(ServerManager.current.unloadMcpServer).not.toHaveBeenCalledWith('logfire');
      expect(ServerManager.current.loadMcpServer).not.toHaveBeenCalledWith('logfire', expect.anything());
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
      expect(ServerManager.current.loadMcpServer).not.toHaveBeenCalled();
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
      expect(ServerManager.current.loadMcpServer).toHaveBeenCalledWith(
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
      expect(ServerManager.current.loadMcpServer).toHaveBeenCalledWith(
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
      expect(ServerManager.current.loadMcpServer).toHaveBeenCalledWith('added-server', newConfig['added-server']);
      expect(ServerManager.current.unloadMcpServer).toHaveBeenCalledWith('removed-server');
      expect(ServerManager.current.loadMcpServer).toHaveBeenCalledWith(
        'restarted-server',
        newConfig['restarted-server'],
      );
      expect(ServerManager.current.loadMcpServer).not.toHaveBeenCalledWith('metadata-server', expect.any(Object));
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

      // Make the ServerManager hot-reload facade fail for the first server
      const { ServerManager } = await import('@src/core/server/serverManager.js');
      (ServerManager.current.loadMcpServer as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('Server start failed'))
        .mockResolvedValueOnce(undefined);

      // Mock console.error to capture error logs
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Simulate config change event
      const changeHandler = (mockConfigManager.on as any).mock.calls[0][1];
      await changeHandler(changes);

      // Should still attempt to start the second server
      expect(ServerManager.current.loadMcpServer).toHaveBeenCalledTimes(2);
      expect(ServerManager.current.loadMcpServer).toHaveBeenCalledWith('success-server', newConfig['success-server']);

      consoleSpy.mockRestore();
    });
  });

  describe('handling disabled servers', () => {
    it('should stop servers when disabled field changes to true', async () => {
      const changes = [
        {
          serverName: 'disabled-server',
          type: ConfigChangeType.MODIFIED,
          fieldsChanged: ['disabled'],
        },
      ];

      const newConfig = {
        'disabled-server': {
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
      expect(ServerManager.current.unloadMcpServer).toHaveBeenCalledWith('disabled-server');
      expect(ServerManager.current.loadMcpServer).not.toHaveBeenCalled();
      expect(ServerManager.current.loadMcpServer).not.toHaveBeenCalled();
    });

    it('should start servers when disabled field changes to false', async () => {
      const changes = [
        {
          serverName: 're-enabled-server',
          type: ConfigChangeType.MODIFIED,
          fieldsChanged: ['disabled'],
        },
      ];

      const newConfig = {
        're-enabled-server': {
          command: 'python',
          args: ['server.py'],
          disabled: false,
        },
      };

      mockConfigManager.getTransportConfig = vi.fn(() => newConfig);

      // Simulate config change event
      const changeHandler = (mockConfigManager.on as any).mock.calls[0][1];
      await changeHandler(changes);

      const { ServerManager } = await import('@src/core/server/serverManager.js');
      expect(ServerManager.current.loadMcpServer).toHaveBeenCalledWith(
        're-enabled-server',
        newConfig['re-enabled-server'],
      );
      // Re-enable loads the server; it must not unload it.
      expect(ServerManager.current.unloadMcpServer).not.toHaveBeenCalled();
    });

    it('should stop servers when disabled is true regardless of other field changes', async () => {
      const changes = [
        {
          serverName: 'disabled-with-other-changes',
          type: ConfigChangeType.MODIFIED,
          fieldsChanged: ['disabled', 'command', 'args'],
        },
      ];

      const newConfig = {
        'disabled-with-other-changes': {
          command: 'python',
          args: ['new.py'],
          disabled: true,
        },
      };

      mockConfigManager.getTransportConfig = vi.fn(() => newConfig);

      // Simulate config change event
      const changeHandler = (mockConfigManager.on as any).mock.calls[0][1];
      await changeHandler(changes);

      const { ServerManager } = await import('@src/core/server/serverManager.js');
      expect(ServerManager.current.unloadMcpServer).toHaveBeenCalledWith('disabled-with-other-changes');
      expect(ServerManager.current.loadMcpServer).not.toHaveBeenCalled();
      expect(ServerManager.current.loadMcpServer).not.toHaveBeenCalled();
    });

    it('should restart servers for non-disabled field changes when disabled is false', async () => {
      const changes = [
        {
          serverName: 'non-disabled-changes',
          type: ConfigChangeType.MODIFIED,
          fieldsChanged: ['command', 'args'],
        },
      ];

      const newConfig = {
        'non-disabled-changes': {
          command: 'python',
          args: ['modified.py'],
          disabled: false,
        },
      };

      mockConfigManager.getTransportConfig = vi.fn(() => newConfig);

      // Simulate config change event
      const changeHandler = (mockConfigManager.on as any).mock.calls[0][1];
      await changeHandler(changes);

      const { ServerManager } = await import('@src/core/server/serverManager.js');
      expect(ServerManager.current.loadMcpServer).toHaveBeenCalledWith(
        'non-disabled-changes',
        newConfig['non-disabled-changes'],
      );
      // Functional modify reloads via loadMcpServer; ConfigChangeHandler does not
      // call unloadMcpServer directly (ServerManager handles the internal reload).
      expect(ServerManager.current.unloadMcpServer).not.toHaveBeenCalled();
    });

    it('should update metadata when only tags change on a disabled server', async () => {
      const changes = [
        {
          serverName: 'disabled-metadata-update',
          type: ConfigChangeType.MODIFIED,
          fieldsChanged: ['tags'],
        },
      ];

      const newConfig = {
        'disabled-metadata-update': {
          command: 'node',
          args: ['server.js'],
          tags: ['updated', 'tags'],
          disabled: true,
        },
      };

      mockConfigManager.getTransportConfig = vi.fn(() => newConfig);

      // Simulate config change event
      const changeHandler = (mockConfigManager.on as any).mock.calls[0][1];
      await changeHandler(changes);

      const { ServerManager } = await import('@src/core/server/serverManager.js');
      expect(ServerManager.current.unloadMcpServer).toHaveBeenCalledWith('disabled-metadata-update');
      expect(ServerManager.current.loadMcpServer).not.toHaveBeenCalled();
    });

    it('should handle mixed disable/enable changes with other servers', async () => {
      const changes = [
        {
          serverName: 'disabled-server',
          type: ConfigChangeType.MODIFIED,
          fieldsChanged: ['disabled'],
        },
        {
          serverName: 're-enabled-server',
          type: ConfigChangeType.MODIFIED,
          fieldsChanged: ['disabled'],
        },
        {
          serverName: 'normal-modified-server',
          type: ConfigChangeType.MODIFIED,
          fieldsChanged: ['command'],
        },
        {
          serverName: 'tag-only-server',
          type: ConfigChangeType.MODIFIED,
          fieldsChanged: ['tags'],
        },
      ];

      const newConfig = {
        'disabled-server': {
          command: 'node',
          args: ['disabled.js'],
          disabled: true,
        },
        're-enabled-server': {
          command: 'python',
          args: ['re-enabled.py'],
          disabled: false,
        },
        'normal-modified-server': {
          command: 'node',
          args: ['modified.js'],
          disabled: false,
        },
        'tag-only-server': {
          command: 'node',
          args: ['tags.js'],
          tags: ['new', 'tags'],
          disabled: false,
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

      // Verify disabled server is stopped
      expect(ServerManager.current.unloadMcpServer).toHaveBeenCalledWith('disabled-server');

      // Verify re-enabled server is started
      expect(ServerManager.current.loadMcpServer).toHaveBeenCalledWith(
        're-enabled-server',
        newConfig['re-enabled-server'],
      );

      // Verify normal modified server is restarted
      expect(ServerManager.current.loadMcpServer).toHaveBeenCalledWith(
        'normal-modified-server',
        newConfig['normal-modified-server'],
      );

      // Verify tag-only server does not get restarted
      expect(ServerManager.current.loadMcpServer).not.toHaveBeenCalledWith('tag-only-server', expect.any(Object));
    });
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
      expect(ServerManager.current.loadMcpServer).toHaveBeenCalledWith(
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
      expect(ServerManager.current.unloadMcpServer).toHaveBeenCalledWith('rapid-change-server');

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

      expect(ServerManager.current.loadMcpServer).toHaveBeenCalledWith(
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
      expect(ServerManager.current.loadMcpServer).toHaveBeenCalledWith(
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

      // Make the ServerManager hot-reload facade fail while unloading
      const { ServerManager } = await import('@src/core/server/serverManager.js');
      (ServerManager.current.unloadMcpServer as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Stop failed'),
      );

      // Mock console.error to capture error logs
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Simulate config change event
      const changeHandler = (mockConfigManager.on as any).mock.calls[0][1];

      // Should not throw error even if unload fails
      await expect(changeHandler(changes)).resolves.toBeUndefined();

      expect(ServerManager.current.unloadMcpServer).toHaveBeenCalledWith('stop-error-server');

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

      // Make the ServerManager hot-reload facade fail while loading
      const { ServerManager } = await import('@src/core/server/serverManager.js');
      (ServerManager.current.loadMcpServer as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Start failed'),
      );

      // Mock console.error to capture error logs
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Simulate config change event
      const changeHandler = (mockConfigManager.on as any).mock.calls[0][1];

      // Should not throw error even if load fails
      await expect(changeHandler(changes)).resolves.toBeUndefined();

      expect(ServerManager.current.loadMcpServer).toHaveBeenCalledWith(
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

  describe('requiresServerRestart logic', () => {
    it('should return true for non-tag field changes', async () => {
      const changes = [
        {
          serverName: 'test-server',
          type: ConfigChangeType.MODIFIED,
          fieldsChanged: ['command'],
        },
      ];

      const newConfig = {
        'test-server': {
          command: 'python',
          args: ['server.py'],
        },
      };

      mockConfigManager.getTransportConfig = vi.fn(() => newConfig);

      // Simulate config change event
      const changeHandler = (mockConfigManager.on as any).mock.calls[0][1];
      await changeHandler(changes);

      const { ServerManager } = await import('@src/core/server/serverManager.js');
      expect(ServerManager.current.loadMcpServer).toHaveBeenCalled();
    });

    it('should return false for tag-only field changes', async () => {
      const changes = [
        {
          serverName: 'test-server',
          type: ConfigChangeType.MODIFIED,
          fieldsChanged: ['tags'],
        },
      ];

      const newConfig = {
        'test-server': {
          command: 'node',
          args: ['server.js'],
          tags: ['new', 'tags'],
        },
      };

      mockConfigManager.getTransportConfig = vi.fn(() => newConfig);

      // Simulate config change event
      const changeHandler = (mockConfigManager.on as any).mock.calls[0][1];
      await changeHandler(changes);

      const { ServerManager } = await import('@src/core/server/serverManager.js');
      expect(ServerManager.current.loadMcpServer).not.toHaveBeenCalled();
    });

    it('should return true for mixed field changes (including tags)', async () => {
      const changes = [
        {
          serverName: 'test-server',
          type: ConfigChangeType.MODIFIED,
          fieldsChanged: ['command', 'tags'],
        },
      ];

      const newConfig = {
        'test-server': {
          command: 'python',
          args: ['server.py'],
          tags: ['new', 'tags'],
        },
      };

      mockConfigManager.getTransportConfig = vi.fn(() => newConfig);

      // Simulate config change event
      const changeHandler = (mockConfigManager.on as any).mock.calls[0][1];
      await changeHandler(changes);

      const { ServerManager } = await import('@src/core/server/serverManager.js');
      expect(ServerManager.current.loadMcpServer).toHaveBeenCalled();
    });
  });
});
