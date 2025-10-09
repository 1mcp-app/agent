import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotificationManager, DEFAULT_NOTIFICATION_CONFIG } from './notificationManager.js';
import { InboundConnection, ServerStatus } from '@src/core/types/index.js';
import { CapabilityChanges, AggregatedCapabilities } from '@src/core/capabilities/capabilityAggregator.js';

describe('NotificationManager', () => {
  let notificationManager: NotificationManager;
  let mockInboundConnection: InboundConnection;
  let mockServer: any;

  const createMockCapabilities = (
    tools: number = 0,
    resources: number = 0,
    prompts: number = 0,
  ): AggregatedCapabilities => ({
    tools: Array(tools)
      .fill(null)
      .map((_, i) => ({
        name: `tool${i}`,
        description: `Tool ${i}`,
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      })),
    resources: Array(resources)
      .fill(null)
      .map((_, i) => ({ uri: `resource${i}`, name: `Resource ${i}` })),
    prompts: Array(prompts)
      .fill(null)
      .map((_, i) => ({ name: `prompt${i}`, description: `Prompt ${i}` })),
    readyServers: ['test-server'],
    timestamp: new Date(),
  });

  beforeEach(() => {
    mockServer = {
      notification: vi.fn(),
      transport: { connected: true },
    };

    mockInboundConnection = {
      server: mockServer,
      status: ServerStatus.Connected,
    };

    notificationManager = new NotificationManager(mockInboundConnection);
    vi.resetAllMocks();
  });

  afterEach(() => {
    notificationManager.shutdown();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      const config = notificationManager.getConfig();
      expect(config).toEqual(DEFAULT_NOTIFICATION_CONFIG);
    });

    it('should accept custom config', () => {
      const customConfig = {
        batchNotifications: false,
        batchDelayMs: 2000,
        notifyOnServerReady: false,
      };

      const manager = new NotificationManager(mockInboundConnection, customConfig);
      const config = manager.getConfig();

      expect(config.batchNotifications).toBe(false);
      expect(config.batchDelayMs).toBe(2000);
      expect(config.notifyOnServerReady).toBe(false);

      manager.shutdown();
    });
  });

  describe('handleCapabilityChanges', () => {
    it('should not send notifications when disabled', () => {
      const manager = new NotificationManager(mockInboundConnection, { notifyOnServerReady: false });

      const changes: CapabilityChanges = {
        hasChanges: true,
        toolsChanged: true,
        resourcesChanged: false,
        promptsChanged: false,
        addedServers: [],
        removedServers: [],
        previous: createMockCapabilities(0, 0, 0),
        current: createMockCapabilities(1, 0, 0),
      };

      manager.handleCapabilityChanges(changes);

      expect(mockServer.notification).not.toHaveBeenCalled();
      manager.shutdown();
    });

    it('should send immediate notifications when batching is disabled', () => {
      const manager = new NotificationManager(mockInboundConnection, { batchNotifications: false });

      const changes: CapabilityChanges = {
        hasChanges: true,
        toolsChanged: true,
        resourcesChanged: true,
        promptsChanged: false,
        addedServers: [],
        removedServers: [],
        previous: createMockCapabilities(0, 0, 0),
        current: createMockCapabilities(1, 1, 0),
      };

      manager.handleCapabilityChanges(changes);

      expect(mockServer.notification).toHaveBeenCalledTimes(2);
      expect(mockServer.notification).toHaveBeenCalledWith({
        method: 'notifications/tools/list_changed',
        params: {},
      });
      expect(mockServer.notification).toHaveBeenCalledWith({
        method: 'notifications/resources/list_changed',
        params: {},
      });

      manager.shutdown();
    });

    it('should batch notifications when batching is enabled', async () => {
      const manager = new NotificationManager(mockInboundConnection, {
        batchNotifications: true,
        batchDelayMs: 100,
      });

      const changes: CapabilityChanges = {
        hasChanges: true,
        toolsChanged: true,
        resourcesChanged: true,
        promptsChanged: true,
        addedServers: [],
        removedServers: [],
        previous: createMockCapabilities(0, 0, 0),
        current: createMockCapabilities(1, 1, 1),
      };

      manager.handleCapabilityChanges(changes);

      // No immediate notifications
      expect(mockServer.notification).not.toHaveBeenCalled();

      // Wait for batch to be sent
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(mockServer.notification).toHaveBeenCalledTimes(3);
      expect(mockServer.notification).toHaveBeenCalledWith({
        method: 'notifications/tools/list_changed',
        params: {},
      });
      expect(mockServer.notification).toHaveBeenCalledWith({
        method: 'notifications/resources/list_changed',
        params: {},
      });
      expect(mockServer.notification).toHaveBeenCalledWith({
        method: 'notifications/prompts/list_changed',
        params: {},
      });

      manager.shutdown();
    });

    it('should handle server connection failures gracefully', () => {
      mockInboundConnection.status = ServerStatus.Disconnected;

      const changes: CapabilityChanges = {
        hasChanges: true,
        toolsChanged: true,
        resourcesChanged: false,
        promptsChanged: false,
        addedServers: [],
        removedServers: [],
        previous: createMockCapabilities(0, 0, 0),
        current: createMockCapabilities(1, 0, 0),
      };

      // Should not throw
      expect(() => notificationManager.handleCapabilityChanges(changes)).not.toThrow();
      expect(mockServer.notification).not.toHaveBeenCalled();
    });
  });

  describe('updateConfig', () => {
    it('should update configuration at runtime', () => {
      const newConfig = {
        batchNotifications: false,
        notifyOnServerReady: false,
      };

      notificationManager.updateConfig(newConfig);
      const config = notificationManager.getConfig();

      expect(config.batchNotifications).toBe(false);
      expect(config.notifyOnServerReady).toBe(false);
      // Other properties should remain from default
      expect(config.batchDelayMs).toBe(DEFAULT_NOTIFICATION_CONFIG.batchDelayMs);
    });
  });

  describe('isEnabled', () => {
    it('should return correct enablement status', () => {
      expect(notificationManager.isEnabled()).toBe(true);

      const disabled = new NotificationManager(mockInboundConnection, { notifyOnServerReady: false });
      expect(disabled.isEnabled()).toBe(false);
      disabled.shutdown();
    });
  });

  describe('flushPendingNotifications', () => {
    it('should immediately send pending batched notifications', async () => {
      const manager = new NotificationManager(mockInboundConnection, {
        batchNotifications: true,
        batchDelayMs: 5000, // Long delay
      });

      const changes: CapabilityChanges = {
        hasChanges: true,
        toolsChanged: true,
        resourcesChanged: false,
        promptsChanged: false,
        addedServers: [],
        removedServers: [],
        previous: createMockCapabilities(0, 0, 0),
        current: createMockCapabilities(1, 0, 0),
      };

      manager.handleCapabilityChanges(changes);
      expect(mockServer.notification).not.toHaveBeenCalled();

      // Flush immediately
      manager.flushPendingNotifications();
      expect(mockServer.notification).toHaveBeenCalledTimes(1);

      manager.shutdown();
    });
  });

  describe('getStatusSummary', () => {
    it('should return status summary', () => {
      const summary = notificationManager.getStatusSummary();
      expect(summary).toContain('enabled');
      expect(summary).toContain('batched');
      expect(summary).toContain('no-pending');
    });
  });
});
