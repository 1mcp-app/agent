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
});
