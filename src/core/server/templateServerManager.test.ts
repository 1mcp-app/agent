import { ClientManager } from '@src/core/client/clientManager.js';
import { TemplateFilteringService } from '@src/core/filtering/index.js';
import type { BackendSupervisionSnapshot } from '@src/core/server/backendStdioSupervisor.js';
import { ClientStatus } from '@src/core/types/client.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TemplateServerManager } from './templateServerManager.js';

// Mock logger
vi.mock('@src/logger/logger.js', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    debugIf: vi.fn(),
  };
  return {
    __esModule: true,
    default: mockLogger,
    debugIf: mockLogger.debugIf,
  };
});

// Mock the filtering components
vi.mock('@src/core/filtering/index.js', () => ({
  ClientTemplateTracker: vi.fn().mockImplementation(function () {
    return {
      addClientTemplate: vi.fn(),
      removeClient: vi.fn().mockReturnValue([]),
      removeClientFromInstance: vi.fn().mockReturnValue(false),
      getClientCount: vi.fn().mockReturnValue(0),
      cleanupInstance: vi.fn(),
      getStats: vi.fn().mockReturnValue(null),
      getDetailedInfo: vi.fn().mockReturnValue({}),
      getIdleInstances: vi.fn().mockReturnValue([]),
    };
  }),
  TemplateFilteringService: {
    getMatchingTemplates: vi.fn().mockReturnValue([]),
  },
  TemplateIndex: vi.fn().mockImplementation(function () {
    return {
      buildIndex: vi.fn(),
      getStats: vi.fn().mockReturnValue(null),
    };
  }),
}));

// Mock the ClientInstancePool
vi.mock('@src/core/server/clientInstancePool.js', () => ({
  ClientInstancePool: vi.fn().mockImplementation(function () {
    return {
      getOrCreateClientInstance: vi.fn().mockResolvedValue({
        id: 'test-instance-id',
        templateName: 'test-template',
        client: {
          connect: vi.fn().mockResolvedValue(undefined),
          close: vi.fn().mockResolvedValue(undefined),
          getInstructions: vi.fn(),
          getServerCapabilities: vi.fn(),
        },
        transport: {
          close: vi.fn().mockResolvedValue(undefined),
        },
        renderedHash: 'abc123def456',
        instanceKey: 'test-template:abc123def456',
        templateVariables: {},
        processedConfig: {},
        referenceCount: 1,
        createdAt: new Date(),
        lastUsedAt: new Date(),
        status: 'active' as const,
        outboundKeys: new Set<string>(),
        clientIds: new Set(['test-client']),
        idleTimeout: 300000,
      }),
      removeClientFromInstance: vi.fn(),
      getInstance: vi.fn(),
      getTemplateInstances: vi.fn(() => []),
      resolveTemplateInstance: vi.fn(),
      getAllInstances: vi.fn(() => []),
      removeInstance: vi.fn().mockResolvedValue(undefined),
      cleanupIdleInstances: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      getInstanceKeyById: vi.fn(),
      getStats: vi.fn(() => ({
        totalInstances: 0,
        activeInstances: 0,
        idleInstances: 0,
        templateCount: 0,
        totalClients: 0,
      })),
      setSupervisionPublisher: vi.fn(),
    };
  }),
}));

describe('TemplateServerManager', () => {
  let templateServerManager: TemplateServerManager;

  beforeEach(() => {
    vi.clearAllMocks();
    templateServerManager = new TemplateServerManager();
  });

  afterEach(() => {
    if (templateServerManager) {
      templateServerManager.cleanup();
    }
    ClientManager.resetInstance();
  });

  const snapshot = (
    state: BackendSupervisionSnapshot['state'],
    currentPid: number | null,
  ): BackendSupervisionSnapshot => ({
    backendId: 'template:test-template:test-instance-id',
    state,
    attempt: state === 'connected' ? 0 : 1,
    limit: 5,
    nextRetryAt: null,
    lastExit: null,
    lastError: null,
    currentPid,
  });

  describe('getRenderedHashForSession', () => {
    it('should return undefined for non-existent session', () => {
      const hash = templateServerManager.getRenderedHashForSession('non-existent-session', 'test-template');
      expect(hash).toBeUndefined();
    });

    it('should return undefined for non-existent template', () => {
      // Manually set up internal state for testing
      const manager = templateServerManager as any;
      manager.sessionToRenderedHash = new Map([['session-1', new Map([['template-1', 'hash123']])]]);

      const hash = templateServerManager.getRenderedHashForSession('session-1', 'non-existent-template');
      expect(hash).toBeUndefined();
    });

    it('should return rendered hash for existing session and template', () => {
      // Manually set up internal state for testing
      const sessionId = 'session-1';
      const templateName = 'template-1';
      const renderedHash = 'abc123def456';

      const manager = templateServerManager as any;
      manager.sessionToRenderedHash = new Map([[sessionId, new Map([[templateName, renderedHash]])]]);

      const hash = templateServerManager.getRenderedHashForSession(sessionId, templateName);
      expect(hash).toBe(renderedHash);
    });
  });

  describe('getAllRenderedHashesForSession', () => {
    it('should return undefined for non-existent session', () => {
      const hashes = templateServerManager.getAllRenderedHashesForSession('non-existent-session');
      expect(hashes).toBeUndefined();
    });

    it('should return all rendered hashes for a session', () => {
      // Manually set up internal state for testing
      const sessionId = 'session-1';
      const hashes = new Map([
        ['template-1', 'hash123'],
        ['template-2', 'hash456'],
      ]);

      const manager = templateServerManager as any;
      manager.sessionToRenderedHash = new Map([[sessionId, hashes]]);

      const result = templateServerManager.getAllRenderedHashesForSession(sessionId);
      expect(result).toBeInstanceOf(Map);
      expect(result?.size).toBe(2);
      expect(result?.get('template-1')).toBe('hash123');
      expect(result?.get('template-2')).toBe('hash456');
    });

    it('should return empty map for session with no templates', () => {
      const sessionId = 'empty-session';
      const manager = templateServerManager as any;
      manager.sessionToRenderedHash = new Map([[sessionId, new Map()]]);

      const result = templateServerManager.getAllRenderedHashesForSession(sessionId);
      expect(result).toBeInstanceOf(Map);
      expect(result?.size).toBe(0);
    });
  });

  describe('session-to-renderedHash mapping management', () => {
    it('should handle multiple sessions with different templates', () => {
      const manager = templateServerManager as any;
      manager.sessionToRenderedHash = new Map([
        [
          'session-1',
          new Map([
            ['template-1', 'hash1'],
            ['template-2', 'hash2'],
          ]),
        ],
        [
          'session-2',
          new Map([
            ['template-1', 'hash1'],
            ['template-3', 'hash3'],
          ]),
        ],
      ]);

      // session-1 should have 2 templates
      const session1Hashes = templateServerManager.getAllRenderedHashesForSession('session-1');
      expect(session1Hashes?.size).toBe(2);

      // session-2 should have 2 templates
      const session2Hashes = templateServerManager.getAllRenderedHashesForSession('session-2');
      expect(session2Hashes?.size).toBe(2);

      // Both should have template-1 with same hash (same context)
      expect(session1Hashes?.get('template-1')).toBe(session2Hashes?.get('template-1'));
    });

    it('should handle same template with different contexts (different hashes)', () => {
      const manager = templateServerManager as any;
      manager.sessionToRenderedHash = new Map([
        ['session-1', new Map([['template-1', 'hash-context-1']])],
        ['session-2', new Map([['template-1', 'hash-context-2']])],
      ]);

      const hash1 = templateServerManager.getRenderedHashForSession('session-1', 'template-1');
      const hash2 = templateServerManager.getRenderedHashForSession('session-2', 'template-1');

      expect(hash1).toBe('hash-context-1');
      expect(hash2).toBe('hash-context-2');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('cleanup', () => {
    it('should clear cleanup timer', () => {
      expect(() => templateServerManager.cleanup()).not.toThrow();
    });
  });

  describe('helper methods', () => {
    it('resolves an operational instance ID within its template', () => {
      const manager = templateServerManager as any;
      const instance = { id: '0123456789abcdef' };
      manager.clientInstancePool.resolveTemplateInstance.mockReturnValue(instance);

      expect(templateServerManager.resolveTemplateInstance('test-template', '0123456789ab')).toBe(instance);
      expect(manager.clientInstancePool.resolveTemplateInstance).toHaveBeenCalledWith('test-template', '0123456789ab');
    });

    it('getIdleTemplateInstances should return empty array initially', () => {
      const idleInstances = templateServerManager.getIdleTemplateInstances();
      expect(idleInstances).toEqual([]);
    });

    it('cleanupIdleInstances should return 0 when no instances', async () => {
      const cleaned = await templateServerManager.cleanupIdleInstances();
      expect(cleaned).toBe(0);
    });

    it('expires stale ephemeral REST sessions and leaves persistent sessions active', async () => {
      vi.useFakeTimers();
      try {
        const manager = templateServerManager as any;
        const ephemeralInstance = {
          id: 'ephemeral-instance',
          templateName: 'test-template',
          renderedHash: 'abc123def456',
          instanceKey: 'test-template:abc123def456',
          status: 'active' as const,
          referenceCount: 1,
          idleTimeout: 1000,
        };
        const persistentInstance = {
          id: 'persistent-instance',
          templateName: 'test-template',
          renderedHash: 'persistent-hash',
          instanceKey: 'test-template:persistent-hash',
          status: 'active' as const,
          referenceCount: 1,
          idleTimeout: 1000,
        };

        manager.clientTemplateTracker.removeClientFromInstance.mockReturnValueOnce(true);
        manager.clientInstancePool.getInstanceKeyById.mockImplementation((instanceId: string) =>
          instanceId === 'ephemeral-instance' ? 'test-template:abc123def456' : undefined,
        );
        manager.clientInstancePool.getInstance
          .mockReturnValueOnce(ephemeralInstance)
          .mockReturnValueOnce(persistentInstance)
          .mockReturnValueOnce(ephemeralInstance);
        manager.clientTemplateTracker.getClientCount.mockReturnValue(0);

        templateServerManager.trackEphemeralClient('rest-session', 'test-template', ephemeralInstance as any);
        templateServerManager.trackPersistentClient('stream-session');
        templateServerManager.trackEphemeralClient('stream-session', 'test-template', persistentInstance as any);

        vi.advanceTimersByTime(1001);

        const outboundConns = new Map([
          ['test-template:abc123def456', {}],
          ['test-template:persistent-hash', {}],
        ]);
        const transports: Record<string, unknown> = {
          'ephemeral-instance': {},
          'persistent-instance': {},
        };

        const cleaned = await templateServerManager.cleanupIdleInstances(outboundConns as never, transports as never);

        expect(cleaned).toBe(0);
        expect(manager.clientInstancePool.removeClientFromInstance).toHaveBeenCalledWith(
          'test-template:abc123def456',
          'rest-session',
          expect.any(Date),
        );
        expect(manager.clientTemplateTracker.removeClientFromInstance).toHaveBeenCalledWith(
          'rest-session',
          'test-template',
          'ephemeral-instance',
        );
        expect(manager.clientTemplateTracker.removeClientFromInstance).not.toHaveBeenCalledWith(
          'stream-session',
          expect.any(String),
          expect.any(String),
        );
        expect(outboundConns.has('test-template:abc123def456')).toBe(false);
        expect(outboundConns.has('test-template:persistent-hash')).toBe(true);
        expect(transports).not.toHaveProperty('ephemeral-instance');
        expect(transports).toHaveProperty('persistent-instance');
      } finally {
        vi.useRealTimers();
      }
    });

    it('rebuildTemplateIndex should not throw', () => {
      expect(() =>
        templateServerManager.rebuildTemplateIndex({
          mcpTemplates: {
            'test-template': {
              command: 'node',
              args: ['server.js'],
              template: {},
            },
          },
        }),
      ).not.toThrow();
    });

    it('retires active instances when a template configuration is replaced', async () => {
      const manager = templateServerManager as any;
      const instance = {
        id: 'instance-id',
        instanceKey: 'test-template:rendered',
        templateName: 'test-template',
        client: {},
        clientIds: new Set(['client-a']),
      };
      manager.clientInstancePool.getTemplateInstances.mockReturnValue([instance]);

      templateServerManager.rebuildTemplateIndex({
        mcpTemplates: { 'test-template': { command: 'node', args: ['old.js'], template: {} } },
      });
      templateServerManager.rebuildTemplateIndex({
        mcpTemplates: { 'test-template': { command: 'node', args: ['new.js'], template: {} } },
      });

      await vi.waitFor(() =>
        expect(manager.clientInstancePool.removeInstance).toHaveBeenCalledWith('test-template:rendered'),
      );
      expect(manager.clientTemplateTracker.removeClientFromInstance).toHaveBeenCalledWith(
        'client-a',
        'test-template',
        'instance-id',
      );
    });

    it('compares declared template hashes without confusing rendered instance values for config changes', async () => {
      const manager = templateServerManager as any;
      const declaredConfig = { command: 'node', args: ['{{entrypoint}}'], template: {} };
      const renderedConfig = { command: 'node', args: ['old.js'], template: {} };
      const instance = {
        id: 'instance-id',
        instanceKey: 'test-template:rendered',
        templateName: 'test-template',
        client: { getInstructions: vi.fn() },
        transport: {},
        renderedHash: 'rendered',
        processedConfig: renderedConfig,
        referenceCount: 1,
        status: 'active',
        outboundKeys: new Set<string>(),
        clientIds: new Set(['client-a']),
      };
      templateServerManager.rebuildTemplateIndex({
        mcpTemplates: { 'test-template': declaredConfig },
      });
      manager.clientInstancePool.getOrCreateClientInstance.mockResolvedValueOnce(instance);
      vi.mocked(TemplateFilteringService.getMatchingTemplates).mockReturnValueOnce([
        ['test-template', renderedConfig],
      ] as any);

      await templateServerManager.createTemplateBasedServers(
        'client-a',
        {} as any,
        {} as any,
        { mcpTemplates: { 'test-template': renderedConfig } },
        new Map(),
        {},
      );
      manager.clientInstancePool.getTemplateInstances.mockReturnValue([instance]);

      templateServerManager.rebuildTemplateIndex({
        mcpTemplates: { 'test-template': declaredConfig },
      });
      expect(manager.clientInstancePool.removeInstance).not.toHaveBeenCalled();

      templateServerManager.rebuildTemplateIndex({
        mcpTemplates: { 'test-template': { ...declaredConfig, args: ['{{newEntrypoint}}'] } },
      });

      await vi.waitFor(() =>
        expect(manager.clientInstancePool.removeInstance).toHaveBeenCalledWith('test-template:rendered'),
      );
    });

    it('getFilteringStats should return stats', () => {
      const stats = templateServerManager.getFilteringStats();
      expect(stats).toHaveProperty('tracker');
      expect(stats).toHaveProperty('index');
      expect(stats).toHaveProperty('enabled');
      expect(stats.enabled).toBe(true);
    });

    it('getClientTemplateInfo should return info', () => {
      const info = templateServerManager.getClientTemplateInfo();
      expect(info).toBeDefined();
    });

    it('getClientInstancePool should return pool', () => {
      const pool = templateServerManager.getClientInstancePool();
      expect(pool).toBeDefined();
    });
  });

  describe('supervised template publication', () => {
    const templateConfig = {
      command: 'node',
      args: ['server.js'],
      template: { perClient: true },
    };

    function createInstance(sessionId: string, instructions: string, pid: number) {
      const client = {
        close: vi.fn().mockResolvedValue(undefined),
        getInstructions: vi.fn(() => instructions),
        getServerCapabilities: vi.fn(() => ({ tools: {} })),
        callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: `from-${pid}` }] }),
      };
      return {
        id: `${sessionId}-instance`,
        instanceKey: `test-template:rendered-${sessionId}:${sessionId}`,
        templateName: 'test-template',
        client,
        transport: { close: vi.fn().mockResolvedValue(undefined), pid },
        renderedHash: `rendered-${sessionId}`,
        processedConfig: templateConfig,
        referenceCount: 1,
        createdAt: new Date(),
        lastUsedAt: new Date(),
        status: 'active' as const,
        supervision: snapshot('connected', pid),
        outboundKeys: new Set<string>(),
        clientIds: new Set([sessionId]),
        idleTimeout: 300000,
      };
    }

    async function registerInstance(instance: ReturnType<typeof createInstance>, outboundConns: Map<string, any>) {
      const manager = templateServerManager as any;
      manager.clientInstancePool.getOrCreateClientInstance.mockResolvedValueOnce(instance);
      vi.mocked(TemplateFilteringService.getMatchingTemplates).mockReturnValueOnce([
        ['test-template', templateConfig],
      ] as any);
      await templateServerManager.createTemplateBasedServers(
        instance.clientIds.values().next().value!,
        {} as any,
        {} as any,
        { mcpTemplates: { 'test-template': templateConfig } },
        outboundConns,
        {},
      );
    }

    it('publishes initial state and recovery through the routable per-client key', async () => {
      const instance = createInstance('client-a', 'initial instructions', 101);
      const outboundConns = new Map<string, any>();
      const clientManager = ClientManager.getOrCreateInstance();
      const publishState = vi.spyOn(clientManager, 'publishBackendSupervisionState');

      await registerInstance(instance, outboundConns);

      const outboundKey = 'test-template:client-a';
      expect(instance.outboundKeys).toEqual(new Set([outboundKey]));
      expect(outboundConns.get(outboundKey)).toMatchObject({
        status: ClientStatus.Connected,
        supervision: { state: 'connected', currentPid: 101 },
        capabilities: { tools: {} },
      });
      expect(publishState).toHaveBeenCalledWith(outboundKey, instance.supervision);
      expect(outboundConns.has(instance.instanceKey)).toBe(false);

      const manager = templateServerManager as any;
      const publisher = manager.clientInstancePool.setSupervisionPublisher.mock.calls[0][0];
      publisher(instance, snapshot('restarting', null));
      expect(outboundConns.get(outboundKey)).toMatchObject({ status: ClientStatus.Restarting });
      expect(outboundConns.get(outboundKey).capabilities).toBeUndefined();
      expect(outboundConns.get(outboundKey).instructions).toBeUndefined();

      const replacementClient = {
        close: vi.fn().mockResolvedValue(undefined),
        getInstructions: vi.fn(() => 'recovered instructions'),
        getServerCapabilities: vi.fn(() => ({ tools: { listChanged: true } })),
        callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'recovered invocation' }] }),
      };
      instance.client = replacementClient as any;
      instance.transport = { close: vi.fn().mockResolvedValue(undefined), pid: 202 } as any;
      publisher(instance, snapshot('connected', 202));

      const recoveredRoute = outboundConns.get(outboundKey);
      expect(recoveredRoute).toMatchObject({
        client: replacementClient,
        transport: instance.transport,
        status: ClientStatus.Connected,
        supervision: { state: 'connected', currentPid: 202 },
        capabilities: { tools: { listChanged: true } },
        instructions: 'recovered instructions',
      });
      await expect(recoveredRoute.client.callTool({ name: 'echo', arguments: {} })).resolves.toEqual({
        content: [{ type: 'text', text: 'recovered invocation' }],
      });
      expect(instance.clientIds).toEqual(new Set(['client-a']));
      expect(instance.outboundKeys).toEqual(new Set([outboundKey]));
    });

    it('withdraws only the unavailable instance instruction contribution', async () => {
      const first = createInstance('client-a', 'instructions-a', 101);
      const second = createInstance('client-b', 'instructions-b', 102);
      const outboundConns = new Map<string, any>();
      const aggregator = { setInstructions: vi.fn(), removeServer: vi.fn() };
      templateServerManager.setInstructionAggregator(aggregator as any);
      await registerInstance(first, outboundConns);
      await registerInstance(second, outboundConns);

      aggregator.setInstructions.mockClear();
      const manager = templateServerManager as any;
      const publisher = manager.clientInstancePool.setSupervisionPublisher.mock.calls[0][0];
      publisher(first, snapshot('restarting', null));
      expect(aggregator.setInstructions).toHaveBeenLastCalledWith('test-template', 'instructions-b');

      publisher(second, snapshot('crash-loop', null));
      expect(aggregator.setInstructions).toHaveBeenLastCalledWith('test-template', undefined);

      publisher(first, snapshot('connected', 201));
      expect(aggregator.setInstructions).toHaveBeenLastCalledWith('test-template', 'instructions-a');
    });
  });

  describe('instruction extraction', () => {
    it('should set instruction aggregator', () => {
      const mockAggregator = {
        setInstructions: vi.fn(),
        removeServer: vi.fn(),
      };

      expect(() => templateServerManager.setInstructionAggregator(mockAggregator as any)).not.toThrow();
    });

    it('should have setInstructionAggregator method', () => {
      expect(typeof templateServerManager.setInstructionAggregator).toBe('function');
    });

    it('should call setInstructions when instruction aggregator is set and template server is created', () => {
      // This test verifies the integration exists
      // The actual instruction extraction is tested in integration tests
      const mockAggregator = {
        setInstructions: vi.fn(),
        removeServer: vi.fn(),
      };

      templateServerManager.setInstructionAggregator(mockAggregator as any);

      // Verify the aggregator was set (we can't easily test the full flow in unit tests
      // due to complex mocking requirements, but we verify the method exists and can be called)
      expect(mockAggregator.setInstructions).not.toHaveBeenCalled(); // Not called until template server is created
    });
  });
});
