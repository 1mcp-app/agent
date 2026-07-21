import { McpLoadingEvent } from '@src/core/loading/mcpLoadingManager.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { InboundConnection, ServerStatus } from '@src/core/types/index.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AsyncLoadingOrchestrator } from './asyncLoadingOrchestrator.js';
import { AsyncLoadingOrchestratorEvent } from './asyncLoadingOrchestratorEvent.js';

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
      recordMcpServerReady: vi.fn(),
    };

    mockLoadingManager = {
      on: vi.fn(),
      off: vi.fn(),
      removeAllListeners: vi.fn(),
    };

    mockAgentConfig = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'asyncLoading')
          return {
            enabled: true,
            notifyOnServerReady: true,
            batchNotifications: true,
            batchDelayMs: 1000,
          };
        return undefined;
      }),
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
    // Don't clear mocks here - we need them to track the initialize() calls
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
    it('should initialize when async loading is enabled', async () => {
      await orchestrator.initialize();

      expect(mockLoadingManager.on).toHaveBeenCalledWith(McpLoadingEvent.ServerLoaded, expect.any(Function));
      expect(mockLoadingManager.on).toHaveBeenCalledWith(McpLoadingEvent.LoadingComplete, expect.any(Function));
      expect(orchestrator.isReady()).toBe(true);
    });

    it('should skip initialization when async loading is disabled', async () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'asyncLoading')
          return {
            enabled: false,
            notifyOnServerReady: true,
            batchNotifications: true,
            batchDelayMs: 1000,
          };
        return undefined;
      });

      await orchestrator.initialize();

      expect(mockLoadingManager.on).not.toHaveBeenCalled();
      expect(orchestrator.isReady()).toBe(false);
    });

    it('should not initialize twice', async () => {
      await orchestrator.initialize();
      await orchestrator.initialize();

      // Should only set up events once
      expect(mockLoadingManager.on).toHaveBeenCalledTimes(2);
    });
  });

  describe('initializeNotifications', () => {
    beforeEach(async () => {
      await orchestrator.initialize();
    });

    it('should create notification manager when connection is provided', () => {
      orchestrator.initializeNotifications(mockInboundConnection);

      const notificationManager = orchestrator.getNotificationManager();
      expect(notificationManager).not.toBeNull();
    });

    it('should not initialize notifications when async loading is disabled', () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'asyncLoading')
          return {
            enabled: false,
            notifyOnServerReady: true,
            batchNotifications: true,
            batchDelayMs: 1000,
          };
        return undefined;
      });

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
    beforeEach(async () => {
      await orchestrator.initialize();
      orchestrator.initializeNotifications(mockInboundConnection);
    });

    it('should publish capabilities only after the loading cycle completes', async () => {
      const serverLoadedHandler = mockLoadingManager.on.mock.calls.find(
        (call: any) => call[0] === McpLoadingEvent.ServerLoaded,
      )[1];
      const loadingCompleteHandler = mockLoadingManager.on.mock.calls.find(
        (call: any) => call[0] === McpLoadingEvent.LoadingComplete,
      )[1];

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
      const capabilitiesUpdated = vi.fn();
      orchestrator.on(AsyncLoadingOrchestratorEvent.CapabilitySnapshotPublished, capabilitiesUpdated);

      await serverLoadedHandler('test-server', { success: true });

      expect(mockServerManager.recordMcpServerReady).toHaveBeenCalledWith('test-server');
      expect(mockAggregator.updateCapabilities).not.toHaveBeenCalled();

      loadingCompleteHandler();

      await vi.waitFor(() => expect(mockAggregator.updateCapabilities).toHaveBeenCalledOnce());
      expect(capabilitiesUpdated).toHaveBeenCalledOnce();
    });

    it('should register a loading-complete publication handler', () => {
      const loadingCompleteHandler = mockLoadingManager.on.mock.calls.find(
        (call: any) => call[0] === McpLoadingEvent.LoadingComplete,
      )[1];

      expect(loadingCompleteHandler).toBeDefined();
    });
  });

  describe('refreshCapabilities', () => {
    beforeEach(async () => {
      await orchestrator.initialize();
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

    it('should return refresh facts for catalog notification decisions', async () => {
      const mockAggregator = orchestrator.getCapabilityAggregator();
      vi.spyOn(mockAggregator, 'updateCapabilities').mockResolvedValue({
        hasChanges: true,
        toolsChanged: true,
        resourcesChanged: false,
        promptsChanged: false,
        addedServers: ['filesystem'],
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
              name: 'read_file',
              description: 'Read file',
              inputSchema: { type: 'object', properties: {}, required: [] },
            },
          ],
          resources: [],
          prompts: [],
          readyServers: ['filesystem'],
          timestamp: new Date(),
        },
      });

      const facts = await orchestrator.refreshCapabilities();

      expect(facts).toEqual({
        changed: true,
        shouldNotifyListChanged: true,
      });
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
    beforeEach(async () => {
      await orchestrator.initialize();
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

    it('should return detailed status when initialized', async () => {
      await orchestrator.initialize();

      const summary = orchestrator.getStatusSummary();
      expect(summary).toContain('capabilities:');
      expect(summary).toContain('notifications:');
    });
  });

  describe('shutdown', () => {
    beforeEach(async () => {
      await orchestrator.initialize();
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
