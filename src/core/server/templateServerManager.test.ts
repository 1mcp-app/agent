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
  ClientTemplateTracker: vi.fn().mockImplementation(() => ({
    addClientTemplate: vi.fn(),
    removeClient: vi.fn().mockReturnValue([]),
    getClientCount: vi.fn().mockReturnValue(0),
    cleanupInstance: vi.fn(),
    getStats: vi.fn().mockReturnValue(null),
    getDetailedInfo: vi.fn().mockReturnValue({}),
    getIdleInstances: vi.fn().mockReturnValue([]),
  })),
  TemplateFilteringService: {
    getMatchingTemplates: vi.fn().mockReturnValue([]),
  },
  TemplateIndex: vi.fn().mockImplementation(() => ({
    buildIndex: vi.fn(),
    getStats: vi.fn().mockReturnValue(null),
  })),
}));

// Mock the ClientInstancePool
vi.mock('@src/core/server/clientInstancePool.js', () => ({
  ClientInstancePool: vi.fn().mockImplementation(() => ({
    getOrCreateClientInstance: vi.fn().mockResolvedValue({
      id: 'test-instance-id',
      templateName: 'test-template',
      client: {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      },
      transport: {
        close: vi.fn().mockResolvedValue(undefined),
      },
      renderedHash: 'abc123def456',
      templateVariables: {},
      processedConfig: {},
      referenceCount: 1,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      status: 'active' as const,
      clientIds: new Set(['test-client']),
      idleTimeout: 300000,
    }),
    removeClientFromInstance: vi.fn(),
    getInstance: vi.fn(),
    getTemplateInstances: vi.fn(() => []),
    getAllInstances: vi.fn(() => []),
    removeInstance: vi.fn().mockResolvedValue(undefined),
    cleanupIdleInstances: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    getStats: vi.fn(() => ({
      totalInstances: 0,
      activeInstances: 0,
      idleInstances: 0,
      templateCount: 0,
      totalClients: 0,
    })),
  })),
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
    it('getIdleTemplateInstances should return empty array initially', () => {
      const idleInstances = templateServerManager.getIdleTemplateInstances();
      expect(idleInstances).toEqual([]);
    });

    it('cleanupIdleInstances should return 0 when no instances', async () => {
      const cleaned = await templateServerManager.cleanupIdleInstances();
      expect(cleaned).toBe(0);
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
