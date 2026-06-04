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
      expect(ServerManager.current.restartServer).toHaveBeenCalled();
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
      expect(ServerManager.current.restartServer).not.toHaveBeenCalled();
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
      expect(ServerManager.current.restartServer).toHaveBeenCalled();
    });
  });
});
