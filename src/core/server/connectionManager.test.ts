import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { OutboundConnections } from '@src/core/types/client.js';
import { ServerStatus } from '@src/core/types/server.js';
import logger from '@src/logger/logger.js';
import type { ContextData } from '@src/types/context.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionManager } from './connectionManager.js';

// Mock dependencies
let _mockServerTransport: any = undefined;
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockImplementation(async (transport: any) => {
      // Store the transport so we can verify it later
      _mockServerTransport = transport;
    }),
    transport: undefined,
  })),
}));

vi.mock('@src/core/capabilities/capabilityManager.js', () => ({
  setupCapabilities: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@src/logger/mcpLoggingEnhancer.js', () => ({
  enhanceServerWithLogging: vi.fn(),
}));

vi.mock('@src/domains/preset/services/presetNotificationService.js', () => ({
  PresetNotificationService: {
    getInstance: vi.fn(() => ({
      trackClient: vi.fn(),
      untrackClient: vi.fn(),
    })),
  },
}));

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

describe('ConnectionManager', () => {
  let connectionManager: ConnectionManager;
  let mockTransport: Transport;
  let mockOutboundConns: OutboundConnections;

  const mockServerConfig = { name: 'test-server', version: '1.0.0' };
  const mockServerCapabilities = { capabilities: { tools: {} } };

  beforeEach(() => {
    vi.clearAllMocks();
    mockOutboundConns = new Map();
    mockTransport = {
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Transport;
    connectionManager = new ConnectionManager(mockServerConfig, mockServerCapabilities, mockOutboundConns);
  });

  afterEach(async () => {
    await connectionManager.cleanup();
  });

  describe('connectTransport - context merging', () => {
    it('should merge context parameter into InboundConnection.context when opts.context is undefined', async () => {
      const sessionId = 'test-session-123';
      const context: ContextData = {
        project: {
          path: '/test/project',
          name: 'test-project',
          environment: 'development',
        },
        user: {
          username: 'test-user',
          home: '/home/test',
        },
        environment: {
          variables: {
            NODE_ENV: 'test',
          },
        },
        timestamp: '2025-01-01T00:00:00.000Z',
        version: '1.0.0',
        sessionId: 'context-session-id',
      };

      const opts = {
        tags: ['test-tag'],
        enablePagination: false,
        // No context property
      };

      await connectionManager.connectTransport(mockTransport, sessionId, opts, context);

      const server = connectionManager.getServer(sessionId);
      expect(server).toBeDefined();
      expect(server?.context).toEqual(context);
      expect(server?.context?.sessionId).toBe('context-session-id');
    });

    it('should merge context parameter with existing opts.context', async () => {
      const sessionId = 'test-session-456';
      const context: ContextData = {
        project: {
          path: '/test/project',
          name: 'test-project',
          environment: 'development',
        },
        user: {
          username: 'test-user',
          home: '/home/test',
        },
        environment: {
          variables: {
            NODE_ENV: 'test',
          },
        },
        timestamp: '2025-01-01T00:00:00.000Z',
        version: '1.0.0',
        sessionId: 'context-session-id',
      };

      const opts = {
        tags: ['test-tag'],
        enablePagination: false,
        context: {
          project: {
            path: '/opts/project',
            name: 'opts-project',
            environment: 'production',
          },
          timestamp: '2024-01-01T00:00:00.000Z',
        },
      };

      await connectionManager.connectTransport(mockTransport, sessionId, opts, context);

      const server = connectionManager.getServer(sessionId);
      expect(server).toBeDefined();
      // opts.context should override context parameter (later spread wins)
      expect(server?.context?.sessionId).toBe('context-session-id');
      expect(server?.context?.project?.path).toBe('/opts/project'); // From opts.context
      expect(server?.context?.timestamp).toBe('2024-01-01T00:00:00.000Z'); // From opts.context
    });

    it('should use opts.context when context parameter is undefined', async () => {
      const sessionId = 'test-session-789';

      const opts = {
        tags: ['test-tag'],
        enablePagination: false,
        context: {
          project: {
            path: '/opts/project',
            name: 'opts-project',
            environment: 'production',
          },
          sessionId: 'opts-session-id',
        },
      };

      await connectionManager.connectTransport(mockTransport, sessionId, opts, undefined);

      const server = connectionManager.getServer(sessionId);
      expect(server).toBeDefined();
      expect(server?.context).toEqual(opts.context);
      expect(server?.context?.sessionId).toBe('opts-session-id');
    });

    it('should handle undefined context parameter and undefined opts.context', async () => {
      const sessionId = 'test-session-000';

      const opts = {
        tags: ['test-tag'],
        enablePagination: false,
        // No context property
      };

      await connectionManager.connectTransport(mockTransport, sessionId, opts, undefined);

      const server = connectionManager.getServer(sessionId);
      expect(server).toBeDefined();
      expect(server?.context).toBeUndefined();
    });

    it('should preserve all other opts properties when merging context', async () => {
      const sessionId = 'test-session-preserve';
      const context: ContextData = {
        project: {
          path: '/test/project',
          name: 'test-project',
          environment: 'development',
        },
        user: {
          username: 'test-user',
          home: '/home/test',
        },
        environment: {
          variables: {},
        },
        sessionId: 'context-session-id',
      };

      const opts = {
        tags: ['tag1', 'tag2'],
        enablePagination: true,
        presetName: 'test-preset',
        tagFilterMode: 'preset' as const,
      };

      await connectionManager.connectTransport(mockTransport, sessionId, opts, context);

      const server = connectionManager.getServer(sessionId);
      expect(server).toBeDefined();
      expect(server?.tags).toEqual(['tag1', 'tag2']);
      expect(server?.enablePagination).toBe(true);
      expect(server?.presetName).toBe('test-preset');
      expect(server?.tagFilterMode).toBe('preset');
      expect(server?.context?.sessionId).toBe('context-session-id');
    });
  });

  describe('connectTransport - connection lifecycle', () => {
    it('should create inbound connection with Connected status after successful connection', async () => {
      const sessionId = 'test-session-status';

      const opts = {
        tags: ['test-tag'],
        enablePagination: false,
      };

      await connectionManager.connectTransport(mockTransport, sessionId, opts);

      const server = connectionManager.getServer(sessionId);
      expect(server).toBeDefined();
      expect(server?.status).toBe(ServerStatus.Connected);
      expect(server?.connectedAt).toBeInstanceOf(Date);
    });

    it('should set lastConnected timestamp after successful connection', async () => {
      const sessionId = 'test-session-connected';

      const opts = {
        tags: ['test-tag'],
        enablePagination: false,
      };

      const beforeConnect = new Date();
      await connectionManager.connectTransport(mockTransport, sessionId, opts);
      const afterConnect = new Date();

      const server = connectionManager.getServer(sessionId);
      expect(server?.lastConnected).toBeInstanceOf(Date);
      expect(server!.lastConnected!.getTime()).toBeGreaterThanOrEqual(beforeConnect.getTime());
      expect(server!.lastConnected!.getTime()).toBeLessThanOrEqual(afterConnect.getTime());
    });

    it('should prevent duplicate connections for the same session', async () => {
      const sessionId = 'test-session-duplicate';

      const opts = {
        tags: ['test-tag'],
        enablePagination: false,
      };

      const connectPromise1 = connectionManager.connectTransport(mockTransport, sessionId, opts);
      const connectPromise2 = connectionManager.connectTransport(mockTransport, sessionId, opts);

      await Promise.all([connectPromise1, connectPromise2]);

      // Check that logger.warn was called
      const warnCalls = vi.mocked(logger.warn).mock.calls as unknown[][];
      const duplicateWarn = warnCalls.find((call: unknown[] | undefined) => {
        const message = call?.[0] as string | undefined;
        return message?.includes('already in progress') || message?.includes('already connected');
      });

      expect(duplicateWarn).toBeDefined();
    });

    it('should update status to Error on connection failure', async () => {
      const sessionId = 'test-session-error';
      const errorTransport = {
        close: vi.fn().mockResolvedValue(undefined),
      } as unknown as Transport;

      // Mock Server.connect to reject
      vi.mocked(Server).mockImplementationOnce(
        () =>
          ({
            connect: vi.fn().mockRejectedValue(new Error('Connection failed')),
            transport: undefined,
          }) as unknown as Server,
      );

      const opts = {
        tags: ['test-tag'],
        enablePagination: false,
      };

      await expect(connectionManager.connectTransport(errorTransport, sessionId, opts)).rejects.toThrow(
        'Connection failed',
      );

      const server = connectionManager.getServer(sessionId);
      expect(server?.status).toBe(ServerStatus.Error);
      expect(server?.lastError).toBeInstanceOf(Error);
    });
  });

  describe('disconnectTransport', () => {
    it('should remove inbound connection and update status to Disconnected', async () => {
      const sessionId = 'test-session-disconnect';

      const opts = {
        tags: ['test-tag'],
        enablePagination: false,
      };

      await connectionManager.connectTransport(mockTransport, sessionId, opts);

      expect(connectionManager.getServer(sessionId)).toBeDefined();

      await connectionManager.disconnectTransport(sessionId, false);

      expect(connectionManager.getServer(sessionId)).toBeUndefined();
    });

    it('should handle disconnect for non-existent session gracefully', async () => {
      await expect(connectionManager.disconnectTransport('non-existent-session', false)).resolves.toBeUndefined();
    });
  });

  describe('getTransport', () => {
    it('should return undefined when server has no transport', async () => {
      const sessionId = 'test-session-transport';

      const opts = {
        tags: ['test-tag'],
        enablePagination: false,
      };

      await connectionManager.connectTransport(mockTransport, sessionId, opts);

      const transport = connectionManager.getTransport(sessionId);
      // Server mock sets transport to undefined
      expect(transport).toBeUndefined();
    });

    it('should return undefined for non-existent session', () => {
      const transport = connectionManager.getTransport('non-existent-session');
      expect(transport).toBeUndefined();
    });
  });

  describe('getTransports', () => {
    it('should return empty map when servers have no transports', async () => {
      const sessionIds = ['session-1', 'session-2', 'session-3'];

      for (const sessionId of sessionIds) {
        await connectionManager.connectTransport(mockTransport, sessionId, {
          tags: ['test-tag'],
          enablePagination: false,
        });
      }

      const transports = connectionManager.getTransports();
      // Server mock sets transport to undefined, so no transports are returned
      expect(transports.size).toBe(0);
    });

    it('should return empty map when no transports are active', () => {
      const transports = connectionManager.getTransports();
      expect(transports.size).toBe(0);
    });
  });

  describe('getInboundConnections', () => {
    it('should return map of all inbound connections', async () => {
      const sessionIds = ['session-1', 'session-2'];

      for (const sessionId of sessionIds) {
        await connectionManager.connectTransport(mockTransport, sessionId, {
          tags: ['test-tag'],
          enablePagination: false,
        });
      }

      const connections = connectionManager.getInboundConnections();
      expect(connections.size).toBe(2);
      for (const sessionId of sessionIds) {
        expect(connections.has(sessionId)).toBe(true);
        expect(connections.get(sessionId)?.status).toBe(ServerStatus.Connected);
      }
    });
  });

  describe('getActiveTransportsCount', () => {
    it('should return count of active transports', async () => {
      expect(connectionManager.getActiveTransportsCount()).toBe(0);

      await connectionManager.connectTransport(mockTransport, 'session-1', {
        tags: ['test-tag'],
        enablePagination: false,
      });

      expect(connectionManager.getActiveTransportsCount()).toBe(1);

      await connectionManager.connectTransport(mockTransport, 'session-2', {
        tags: ['test-tag'],
        enablePagination: false,
      });

      expect(connectionManager.getActiveTransportsCount()).toBe(2);
    });
  });

  describe('cleanup', () => {
    it('should clean up all connections', async () => {
      const sessionIds = ['session-1', 'session-2', 'session-3'];

      for (const sessionId of sessionIds) {
        await connectionManager.connectTransport(mockTransport, sessionId, {
          tags: ['test-tag'],
          enablePagination: false,
        });
      }

      expect(connectionManager.getActiveTransportsCount()).toBe(3);

      await connectionManager.cleanup();

      expect(connectionManager.getActiveTransportsCount()).toBe(0);
    });
  });
});
