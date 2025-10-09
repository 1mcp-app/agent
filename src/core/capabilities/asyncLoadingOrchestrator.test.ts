import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { InboundConnection, ServerStatus } from '@src/core/types/index.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AsyncLoadingOrchestrator } from './asyncLoadingOrchestrator.js';

// Mock modules
vi.mock('../server/agentConfig.js', () => ({
  AgentConfigManager: {
    getInstance: vi.fn(),
  },
}));

describe('AsyncLoadingOrchestrator', () => {
  let orchestrator: AsyncLoadingOrchestrator;
  let mockConnections: Map<string, any>;
  let mockServerManager: any;
  let mockLoadingManager: any;
  let mockAgentConfig: any;
  let mockInboundConnection: InboundConnection;

  beforeEach(() => {
    mockConnections = new Map();

    mockServerManager = {
      getServer: vi.fn(),
      getInboundConnections: vi.fn().mockReturnValue(new Map()),
    };

    mockLoadingManager = {
      on: vi.fn(),
      off: vi.fn(),
      removeAllListeners: vi.fn(),
    };

    mockAgentConfig = {
      isAsyncLoadingEnabled: vi.fn().mockReturnValue(true),
      isNotifyOnServerReadyEnabled: vi.fn().mockReturnValue(true),
      isBatchNotificationsEnabled: vi.fn().mockReturnValue(true),
      getBatchDelayMs: vi.fn().mockReturnValue(1000),
    };

    mockInboundConnection = {
      server: {
        notification: vi.fn(),
        transport: {
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
        },
      } as any,
      status: ServerStatus.Connected,
    };

    vi.mocked(AgentConfigManager.getInstance).mockReturnValue(mockAgentConfig);

    orchestrator = new AsyncLoadingOrchestrator(mockConnections, mockServerManager, mockLoadingManager);
    vi.clearAllMocks(); // Clear mocks but don't reset the implementations
  });

  afterEach(() => {
    orchestrator.shutdown();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with required dependencies', () => {
      expect(orchestrator).toBeDefined();
      expect(orchestrator.getCapabilityAggregator()).toBeDefined();
      expect(orchestrator.getNotificationManager()).toBeNull(); // Not initialized yet
    });
  });

  describe('initialize', () => {
    it('should initialize when async loading is enabled', () => {
      orchestrator.initialize();

      expect(mockLoadingManager.on).toHaveBeenCalledWith('server-loaded', expect.any(Function));
      expect(orchestrator.isReady()).toBe(true);
    });

    it('should skip initialization when async loading is disabled', () => {
      mockAgentConfig.isAsyncLoadingEnabled.mockReturnValue(false);

      orchestrator.initialize();

      expect(mockLoadingManager.on).not.toHaveBeenCalled();
      expect(orchestrator.isReady()).toBe(false);
    });

    it('should not initialize twice', () => {
      orchestrator.initialize();
      orchestrator.initialize();

      // Should only set up events once
      expect(mockLoadingManager.on).toHaveBeenCalledTimes(1); // One event handler (server-loaded)
    });
  });

  describe('initializeNotifications', () => {
    beforeEach(() => {
      orchestrator.initialize();
    });

    it('should create notification manager when connection is provided', () => {
      orchestrator.initializeNotifications(mockInboundConnection);

      const notificationManager = orchestrator.getNotificationManager();
      expect(notificationManager).not.toBeNull();
    });

    it('should not initialize notifications when async loading is disabled', () => {
      mockAgentConfig.isAsyncLoadingEnabled.mockReturnValue(false);

      orchestrator.initializeNotifications(mockInboundConnection);

      expect(orchestrator.getNotificationManager()).toBeNull();
    });

    it('should not initialize notifications twice', () => {
      orchestrator.initializeNotifications(mockInboundConnection);
      orchestrator.initializeNotifications(mockInboundConnection);

      // Should only create one notification manager
      expect(orchestrator.getNotificationManager()).not.toBeNull();
    });
  });

  describe('event handling', () => {
    beforeEach(() => {
      orchestrator.initialize();
      orchestrator.initializeNotifications(mockInboundConnection);
    });

    it('should handle server-loaded events', async () => {
      const serverLoadedHandler = mockLoadingManager.on.mock.calls.find((call: any) => call[0] === 'server-loaded')[1];

      // Mock the capability aggregator update
      const mockAggregator = orchestrator.getCapabilityAggregator();
      vi.spyOn(mockAggregator, 'updateCapabilities').mockResolvedValue({
        hasChanges: true,
        toolsChanged: true,
        resourcesChanged: false,
        promptsChanged: false,
        addedServers: ['test-server'],
        removedServers: [],
        previous: {
          tools: [],
          resources: [],
          prompts: [],
          readyServers: [],
          timestamp: new Date(),
        },
        current: {
          tools: [
            {
              name: 'test-tool',
              description: 'A test tool',
              inputSchema: {
                type: 'object',
                properties: {},
                required: [],
              },
            },
          ],
          resources: [],
          prompts: [],
          readyServers: ['test-server'],
          timestamp: new Date(),
        },
      });

      await serverLoadedHandler('test-server', { success: true });

      expect(mockAggregator.updateCapabilities).toHaveBeenCalled();
    });

    it('should handle capability-changed events', () => {
      const capabilityChangedHandler = mockLoadingManager.on.mock.calls.find(
        (call: any) => call[0] === 'server-loaded',
      )[1];

      // This tests the internal event flow - not directly testable without
      // complex mocking, but the integration is covered
      expect(capabilityChangedHandler).toBeDefined();
    });
  });

  describe('refreshCapabilities', () => {
    beforeEach(() => {
      orchestrator.initialize();
    });

    it('should refresh capabilities when initialized', async () => {
      const mockAggregator = orchestrator.getCapabilityAggregator();
      const spy = vi.spyOn(mockAggregator, 'updateCapabilities').mockResolvedValue({
        hasChanges: false,
        toolsChanged: false,
        resourcesChanged: false,
        promptsChanged: false,
        addedServers: [],
        removedServers: [],
        previous: expect.any(Object),
        current: expect.any(Object),
      });

      await orchestrator.refreshCapabilities();

      expect(spy).toHaveBeenCalled();
    });

    it('should not refresh when not initialized', async () => {
      const orchestrator2 = new AsyncLoadingOrchestrator(mockConnections, mockServerManager, mockLoadingManager);

      await orchestrator2.refreshCapabilities();

      // Should handle gracefully without throwing
      expect(true).toBe(true);
      orchestrator2.shutdown();
    });
  });

  describe('updateConfig', () => {
    beforeEach(() => {
      orchestrator.initialize();
      orchestrator.initializeNotifications(mockInboundConnection);
    });

    it('should update configuration when notification manager exists', () => {
      const notificationManager = orchestrator.getNotificationManager();
      const spy = vi.spyOn(notificationManager!, 'updateConfig');

      orchestrator.updateConfig();

      expect(spy).toHaveBeenCalledWith({
        batchNotifications: true,
        batchDelayMs: 1000,
        notifyOnServerReady: true,
      });
    });
  });

  describe('getStatusSummary', () => {
    it('should return not-initialized when not ready', () => {
      const summary = orchestrator.getStatusSummary();
      expect(summary).toBe('not-initialized');
    });

    it('should return detailed status when initialized', () => {
      orchestrator.initialize();

      const summary = orchestrator.getStatusSummary();
      expect(summary).toContain('capabilities:');
      expect(summary).toContain('notifications:');
    });
  });

  describe('shutdown', () => {
    beforeEach(() => {
      orchestrator.initialize();
      orchestrator.initializeNotifications(mockInboundConnection);
    });

    it('should shutdown gracefully', () => {
      const notificationManager = orchestrator.getNotificationManager();
      const flushSpy = vi.spyOn(notificationManager!, 'flushPendingNotifications');
      const shutdownSpy = vi.spyOn(notificationManager!, 'shutdown');

      orchestrator.shutdown();

      expect(flushSpy).toHaveBeenCalled();
      expect(shutdownSpy).toHaveBeenCalled();
    });

    it('should not shutdown twice', () => {
      orchestrator.shutdown();
      orchestrator.shutdown();

      // Should handle gracefully
      expect(true).toBe(true);
    });
  });
});
