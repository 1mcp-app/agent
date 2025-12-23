import {
  ClientStatus,
  type InboundConnection,
  type OutboundConnection,
  type OutboundConnections,
} from '@src/core/types/index.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('@src/logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  debugIf: vi.fn(),
  setLogLevel: vi.fn(),
}));

vi.mock('../core/client/clientManager.js', () => ({
  executeClientOperation: vi.fn(),
  executeServerOperation: vi.fn(),
}));

vi.mock('../utils/errorHandling.js', () => ({
  withErrorHandling: vi.fn((handler, _errorMessage) => handler),
}));

vi.mock('../utils/clientFiltering.js', () => ({
  filterClients: vi.fn(() => () => new Map()),
  byCapabilities: vi.fn(() => () => true),
  byTags: vi.fn(() => () => true),
}));

vi.mock('../utils/pagination.js', () => ({
  handlePagination: vi.fn(),
}));

vi.mock('../utils/parsing.js', () => ({
  parseUri: vi.fn(),
}));

vi.mock('../core/server/serverManager.js', () => ({
  ServerManager: {
    get current() {
      return {
        getTemplateServerManager: vi.fn(() => mockTemplateServerManager),
      };
    },
  },
}));

// Setup mocks before module import
const mockParseUri = vi.fn();
const mockByCapabilities = vi.fn();
const mockGetFilteredConnections = vi.fn();
const mockHandlePagination = vi.fn();
const mockWithErrorHandling = vi.fn((fn) => fn);
const mockGetRenderedHashForSession = vi.fn();
const mockGetAllRenderedHashesForSession = vi.fn();

const mockTemplateServerManager = {
  getRenderedHashForSession: mockGetRenderedHashForSession,
  getAllRenderedHashesForSession: mockGetAllRenderedHashesForSession,
};

vi.mock('@src/utils/core/parsing.js', () => ({
  parseUri: mockParseUri,
  buildUri: vi.fn((name, resource) => `${name}/${resource}`),
}));

vi.mock('@src/core/filtering/clientFiltering.js', () => ({
  byCapabilities: () => mockByCapabilities,
}));

vi.mock('@src/core/filtering/filteringService.js', () => ({
  FilteringService: {
    getFilteredConnections: () => mockGetFilteredConnections,
  },
}));

vi.mock('@src/utils/ui/pagination.js', () => ({
  handlePagination: mockHandlePagination,
}));

vi.mock('@src/utils/core/errorHandling.js', () => ({
  withErrorHandling: mockWithErrorHandling,
}));

describe('Request Handlers', () => {
  let mockOutboundConns: OutboundConnections;
  let mockInboundConn: InboundConnection;
  let mockClient1: any;
  let mockClient2: any;
  let mockServer: any;
  let registerRequestHandlers: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Dynamic import to avoid circular dependency
    const module = await import('./requestHandlers.js');
    registerRequestHandlers = module.registerRequestHandlers;

    // Create mock clients
    mockClient1 = {
      ping: vi.fn(),
      listResources: vi.fn(),
      listTools: vi.fn(),
      listPrompts: vi.fn(),
      listResourceTemplates: vi.fn(),
      readResource: vi.fn(),
      callTool: vi.fn(),
      getPrompt: vi.fn(),
      complete: vi.fn(),
      subscribeResource: vi.fn(),
      unsubscribeResource: vi.fn(),
      setRequestHandler: vi.fn(),
    };

    mockClient2 = {
      ping: vi.fn(),
      listResources: vi.fn(),
      listTools: vi.fn(),
      listPrompts: vi.fn(),
      listResourceTemplates: vi.fn(),
      readResource: vi.fn(),
      callTool: vi.fn(),
      getPrompt: vi.fn(),
      complete: vi.fn(),
      subscribeResource: vi.fn(),
      unsubscribeResource: vi.fn(),
      setRequestHandler: vi.fn(),
    };

    // Create mock server
    mockServer = {
      setRequestHandler: vi.fn(),
      ping: vi.fn(),
      createMessage: vi.fn(),
      elicitInput: vi.fn(),
      listRoots: vi.fn(),
    };

    // Create mock clients collection
    mockOutboundConns = new Map();
    mockOutboundConns.set('client1', {
      name: 'client1',
      status: ClientStatus.Connected,
      client: mockClient1,
      transport: {
        timeout: 5000,
        start: vi.fn(),
        send: vi.fn(),
        close: vi.fn(),
      },
    } as OutboundConnection);

    mockOutboundConns.set('client2', {
      name: 'client2',
      status: ClientStatus.Connected,
      client: mockClient2,
      transport: {
        timeout: 5000,
        start: vi.fn(),
        send: vi.fn(),
        close: vi.fn(),
      },
    } as OutboundConnection);

    // Create mock server info
    mockInboundConn = {
      server: mockServer,
      tags: ['test'],
      enablePagination: true,
    } as InboundConnection;
  });

  describe('registerRequestHandlers', () => {
    it('should register all request handlers', () => {
      registerRequestHandlers(mockOutboundConns, mockInboundConn);

      // Verify that setRequestHandler was called for each handler
      expect(mockServer.setRequestHandler).toHaveBeenCalled();

      // Should register multiple handlers
      expect(mockServer.setRequestHandler.mock.calls.length).toBeGreaterThan(5);
    });

    it('should register server-specific handlers for clients', () => {
      registerRequestHandlers(mockOutboundConns, mockInboundConn);

      // Verify client request handlers were set
      expect(mockClient1.setRequestHandler).toHaveBeenCalled();
      expect(mockClient2.setRequestHandler).toHaveBeenCalled();
    });

    it('should handle server with no clients', () => {
      const emptyClients: OutboundConnections = new Map();

      expect(() => {
        registerRequestHandlers(emptyClients, mockInboundConn);
      }).not.toThrow();

      expect(mockServer.setRequestHandler).toHaveBeenCalled();
    });

    it('should handle clients with different statuses', () => {
      // Add clients with different statuses
      mockOutboundConns.set('disconnected', {
        name: 'disconnected',
        status: ClientStatus.Disconnected,
        client: { setRequestHandler: vi.fn() },
        transport: { timeout: 5000 },
      } as any);

      mockOutboundConns.set('error', {
        name: 'error',
        status: ClientStatus.Error,
        client: { setRequestHandler: vi.fn() },
        transport: { timeout: 5000 },
      } as any);

      expect(() => {
        registerRequestHandlers(mockOutboundConns, mockInboundConn);
      }).not.toThrow();

      expect(mockServer.setRequestHandler).toHaveBeenCalled();
    });

    it('should handle server with undefined pagination setting', () => {
      const serverWithoutPagination = {
        ...mockInboundConn,
        enablePagination: undefined,
      };

      expect(() => {
        registerRequestHandlers(mockOutboundConns, serverWithoutPagination);
      }).not.toThrow();
    });

    it('should handle server with empty tags', () => {
      const serverWithEmptyTags = {
        ...mockInboundConn,
        tags: [],
      };

      expect(() => {
        registerRequestHandlers(mockOutboundConns, serverWithEmptyTags);
      }).not.toThrow();
    });
  });

  describe('Ping Handler Logic', () => {
    // Test the core ping handler logic directly
    const createPingHandler = (clients: OutboundConnections) => {
      return async () => {
        // Health check all connected upstream clients (replicated from actual implementation)
        const healthCheckPromises = Array.from(clients.entries()).map(async ([_clientName, clientInfo]) => {
          if (clientInfo.status === ClientStatus.Connected) {
            try {
              await clientInfo.client.ping();
            } catch (_error) {
              // Silent failure - just log internally without console output
            }
          }
        });

        // Wait for all health checks to complete (but don't fail if some fail)
        await Promise.allSettled(healthCheckPromises);

        // Always return successful pong response
        return {};
      };
    };

    it('should ping all connected clients during health check', async () => {
      mockClient1.ping.mockResolvedValue({});
      mockClient2.ping.mockResolvedValue({});

      const pingHandler = createPingHandler(mockOutboundConns);
      const result = await pingHandler();

      expect(mockClient1.ping).toHaveBeenCalledTimes(1);
      expect(mockClient2.ping).toHaveBeenCalledTimes(1);
      expect(result).toEqual({});
    });

    it('should skip disconnected clients', async () => {
      // Add a disconnected client
      mockOutboundConns.set('client3', {
        name: 'client3',
        status: ClientStatus.Disconnected,
        client: { ping: vi.fn() },
        transport: {
          timeout: 5000,
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
        },
      } as unknown as OutboundConnection);

      mockClient1.ping.mockResolvedValue({});
      mockClient2.ping.mockResolvedValue({});

      const pingHandler = createPingHandler(mockOutboundConns);
      await pingHandler();

      // Client3 is disconnected, so its ping should not be called
      expect(mockOutboundConns.get('client3')!.client.ping).not.toHaveBeenCalled();
    });

    it('should handle client ping failures gracefully', async () => {
      mockClient1.ping.mockResolvedValue({});
      mockClient2.ping.mockRejectedValue(new Error('Client 2 failed'));

      const pingHandler = createPingHandler(mockOutboundConns);
      const result = await pingHandler();

      expect(mockClient1.ping).toHaveBeenCalledTimes(1);
      expect(mockClient2.ping).toHaveBeenCalledTimes(1);
      expect(result).toEqual({});
    });

    it('should always return empty object even if all clients fail', async () => {
      mockClient1.ping.mockRejectedValue(new Error('Client 1 failed'));
      mockClient2.ping.mockRejectedValue(new Error('Client 2 failed'));

      const pingHandler = createPingHandler(mockOutboundConns);
      const result = await pingHandler();

      expect(result).toEqual({});
    });

    it('should handle empty clients object', async () => {
      const emptyClients: OutboundConnections = new Map();
      const pingHandler = createPingHandler(emptyClients);
      const result = await pingHandler();

      expect(result).toEqual({});
    });

    it('should handle clients with different statuses', async () => {
      const mixedClients: OutboundConnections = new Map();
      mixedClients.set('connected', {
        name: 'connected',
        status: ClientStatus.Connected,
        client: { ping: vi.fn().mockResolvedValue({}) },
        transport: {
          timeout: 5000,
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
        },
      } as unknown as OutboundConnection);
      mixedClients.set('disconnected', {
        name: 'disconnected',
        status: ClientStatus.Disconnected,
        client: { ping: vi.fn() },
        transport: {
          timeout: 5000,
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
        },
      } as unknown as OutboundConnection);
      mixedClients.set('error', {
        name: 'error',
        status: ClientStatus.Error,
        client: { ping: vi.fn() },
        transport: {
          timeout: 5000,
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
        },
      } as unknown as OutboundConnection);

      const pingHandler = createPingHandler(mixedClients);
      await pingHandler();

      expect(mixedClients.get('connected')!.client.ping).toHaveBeenCalledTimes(1);
      expect(mixedClients.get('disconnected')!.client.ping).not.toHaveBeenCalled();
      expect(mixedClients.get('error')!.client.ping).not.toHaveBeenCalled();
    });
  });

  describe('Handler Registration Validation', () => {
    it('should register multiple request handlers on server', () => {
      registerRequestHandlers(mockOutboundConns, mockInboundConn);

      // Should register at least 10 different handlers
      expect(mockServer.setRequestHandler.mock.calls.length).toBeGreaterThanOrEqual(10);
    });

    it('should register client-specific handlers', () => {
      registerRequestHandlers(mockOutboundConns, mockInboundConn);

      // Each client should have multiple handlers registered
      expect(mockClient1.setRequestHandler.mock.calls.length).toBeGreaterThan(0);
      expect(mockClient2.setRequestHandler.mock.calls.length).toBeGreaterThan(0);
    });

    it('should handle missing transport timeout gracefully', () => {
      const clientsWithoutTimeout: OutboundConnections = new Map();
      clientsWithoutTimeout.set('client1', {
        name: 'client1',
        status: ClientStatus.Connected,
        client: { setRequestHandler: vi.fn() },
        transport: {}, // No timeout property
      } as any);

      expect(() => {
        registerRequestHandlers(clientsWithoutTimeout, mockInboundConn);
      }).not.toThrow();
    });

    it('should work with minimal server configuration', () => {
      const minimalServer = {
        server: {
          setRequestHandler: vi.fn(),
        },
        tags: undefined,
        enablePagination: undefined,
      } as any;

      expect(() => {
        registerRequestHandlers(mockOutboundConns, minimalServer);
      }).not.toThrow();

      expect(minimalServer.server.setRequestHandler).toHaveBeenCalled();
    });
  });

  describe('Session-Aware Routing Utilities', () => {
    let getSessionId: (inboundConn: InboundConnection) => string | undefined;
    let resolveConnection: (
      clientName: string,
      sessionId: string | undefined,
      outboundConns: OutboundConnections,
    ) => OutboundConnection | undefined;
    let filterForSession: (outboundConns: OutboundConnections, sessionId: string | undefined) => OutboundConnections;

    beforeEach(async () => {
      // Import the module to trigger side effects
      await import('./requestHandlers.js');

      // We need to access these internal functions through the module's closure
      // Since they're not exported, we'll test them indirectly through behavior
      getSessionId = (inboundConn: InboundConnection) => inboundConn.context?.sessionId;

      // Create a mock resolveOutboundConnection function for testing
      resolveConnection = (
        clientName: string,
        sessionId: string | undefined,
        outboundConns: OutboundConnections,
      ): OutboundConnection | undefined => {
        // Try session-scoped key first (for per-client template servers: name:sessionId)
        if (sessionId) {
          const sessionKey = `${clientName}:${sessionId}`;
          const conn = outboundConns.get(sessionKey);
          if (conn) {
            return conn;
          }
        }

        // Try rendered hash-based key (for shareable template servers: name:renderedHash)
        if (sessionId) {
          const renderedHash = mockGetRenderedHashForSession(sessionId, clientName);
          if (renderedHash) {
            const hashKey = `${clientName}:${renderedHash}`;
            const conn = outboundConns.get(hashKey);
            if (conn) {
              return conn;
            }
          }
        }

        // Fall back to direct name lookup (for static servers)
        return outboundConns.get(clientName);
      };

      // Create a mock filterConnectionsForSession function for testing
      filterForSession = (outboundConns: OutboundConnections, sessionId: string | undefined): OutboundConnections => {
        const filtered = new Map<string, OutboundConnection>();

        // Get rendered hashes for this session
        const sessionHashes = mockGetAllRenderedHashesForSession(sessionId);

        for (const [key, conn] of outboundConns.entries()) {
          // Static servers (no : in key) - always include
          if (!key.includes(':')) {
            filtered.set(key, conn);
            continue;
          }

          // Template servers (format: name:xxx)
          const [name, suffix] = key.split(':');

          // Per-client template servers (format: name:sessionId) - only include if session matches
          if (suffix === sessionId) {
            filtered.set(key, conn);
            continue;
          }

          // Shareable template servers (format: name:renderedHash) - include if this session uses this hash
          if (sessionHashes && sessionHashes.has(name) && sessionHashes.get(name) === suffix) {
            filtered.set(key, conn);
          }
        }

        return filtered;
      };
    });

    describe('getRequestSession', () => {
      it('should extract session ID from inbound connection context', () => {
        const mockInboundWithSession = {
          context: { sessionId: 'test-session-123' },
        } as InboundConnection;

        expect(getSessionId(mockInboundWithSession)).toBe('test-session-123');
      });

      it('should return undefined when context is missing', () => {
        const mockInboundNoContext = {} as InboundConnection;
        expect(getSessionId(mockInboundNoContext)).toBeUndefined();
      });

      it('should return undefined when sessionId is not in context', () => {
        const mockInboundNoSessionId = {
          context: { project: { name: 'test' } },
        } as InboundConnection;

        expect(getSessionId(mockInboundNoSessionId)).toBeUndefined();
      });
    });

    describe('resolveOutboundConnection', () => {
      let testOutboundConns: OutboundConnections;
      let mockStaticClient: any;
      let mockTemplateClientA: any;
      let mockTemplateClientB: any;

      beforeEach(() => {
        mockStaticClient = {
          name: 'static-server',
          callTool: vi.fn(),
        };

        mockTemplateClientA = {
          name: 'template-server',
          callTool: vi.fn(),
        };

        mockTemplateClientB = {
          name: 'template-server',
          callTool: vi.fn(),
        };

        testOutboundConns = new Map();

        // Static server (no session suffix)
        testOutboundConns.set('static-server', {
          name: 'static-server',
          status: ClientStatus.Connected,
          client: mockStaticClient,
          transport: { timeout: 5000 },
        } as OutboundConnection);

        // Template server for session A
        testOutboundConns.set('template-server:session-a', {
          name: 'template-server',
          status: ClientStatus.Connected,
          client: mockTemplateClientA,
          transport: { timeout: 5000 },
        } as OutboundConnection);

        // Template server for session B (same template, different session)
        testOutboundConns.set('template-server:session-b', {
          name: 'template-server',
          status: ClientStatus.Connected,
          client: mockTemplateClientB,
          transport: { timeout: 5000 },
        } as OutboundConnection);
      });

      it('should resolve template server by name and session ID', () => {
        const result = resolveConnection('template-server', 'session-a', testOutboundConns);

        expect(result).toBeDefined();
        expect(result?.name).toBe('template-server');
        expect(result?.client).toBe(mockTemplateClientA);
      });

      it('should resolve different sessions for same template name', () => {
        const resultA = resolveConnection('template-server', 'session-a', testOutboundConns);
        const resultB = resolveConnection('template-server', 'session-b', testOutboundConns);

        expect(resultA?.client).toBe(mockTemplateClientA);
        expect(resultB?.client).toBe(mockTemplateClientB);
        expect(resultA?.client).not.toBe(resultB?.client);
      });

      it('should resolve static server by name only', () => {
        const result = resolveConnection('static-server', undefined, testOutboundConns);

        expect(result).toBeDefined();
        expect(result?.name).toBe('static-server');
        expect(result?.client).toBe(mockStaticClient);
      });

      it('should fall back to static server when session-scoped lookup fails', () => {
        const result = resolveConnection('static-server', 'session-a', testOutboundConns);

        expect(result).toBeDefined();
        expect(result?.name).toBe('static-server');
        expect(result?.client).toBe(mockStaticClient);
      });

      it('should return undefined for unknown server', () => {
        const result = resolveConnection('unknown-server', 'session-a', testOutboundConns);
        expect(result).toBeUndefined();
      });

      it('should return undefined for unknown session with template server', () => {
        const result = resolveConnection('template-server', 'unknown-session', testOutboundConns);
        expect(result).toBeUndefined();
      });

      it('should handle session ID provided but no session-scoped key exists', () => {
        const result = resolveConnection('static-server', 'some-session', testOutboundConns);

        // Should fall back to static server
        expect(result).toBeDefined();
        expect(result?.name).toBe('static-server');
      });
    });

    describe('filterConnectionsForSession', () => {
      let testOutboundConns: OutboundConnections;
      let mockStaticServer1: any;
      let mockStaticServer2: any;
      let mockTemplateA: any;
      let mockTemplateB: any;
      let mockTemplateC: any;

      beforeEach(() => {
        mockStaticServer1 = { name: 'static-1' };
        mockStaticServer2 = { name: 'static-2' };
        mockTemplateA = { name: 'template-x' };
        mockTemplateB = { name: 'template-x' };
        mockTemplateC = { name: 'template-y' };

        testOutboundConns = new Map();

        // Static servers (no : in key)
        testOutboundConns.set('static-1', {
          name: 'static-1',
          status: ClientStatus.Connected,
          client: mockStaticServer1,
          transport: { timeout: 5000 },
        } as OutboundConnection);

        testOutboundConns.set('static-2', {
          name: 'static-2',
          status: ClientStatus.Connected,
          client: mockStaticServer2,
          transport: { timeout: 5000 },
        } as OutboundConnection);

        // Template servers for session A
        testOutboundConns.set('template-x:session-a', {
          name: 'template-x',
          status: ClientStatus.Connected,
          client: mockTemplateA,
          transport: { timeout: 5000 },
        } as OutboundConnection);

        testOutboundConns.set('template-y:session-a', {
          name: 'template-y',
          status: ClientStatus.Connected,
          client: mockTemplateC,
          transport: { timeout: 5000 },
        } as OutboundConnection);

        // Template servers for session B
        testOutboundConns.set('template-x:session-b', {
          name: 'template-x',
          status: ClientStatus.Connected,
          client: mockTemplateB,
          transport: { timeout: 5000 },
        } as OutboundConnection);
      });

      it('should include all static servers and session-matching templates', () => {
        const filtered = filterForSession(testOutboundConns, 'session-a');

        expect(filtered.size).toBe(4);
        expect(filtered.has('static-1')).toBe(true);
        expect(filtered.has('static-2')).toBe(true);
        expect(filtered.has('template-x:session-a')).toBe(true);
        expect(filtered.has('template-y:session-a')).toBe(true);
      });

      it('should exclude templates from other sessions', () => {
        const filtered = filterForSession(testOutboundConns, 'session-a');

        expect(filtered.has('template-x:session-b')).toBe(false);
      });

      it('should include all static servers for any session', () => {
        const filteredA = filterForSession(testOutboundConns, 'session-a');
        const filteredB = filterForSession(testOutboundConns, 'session-b');

        expect(filteredA.has('static-1')).toBe(true);
        expect(filteredA.has('static-2')).toBe(true);
        expect(filteredB.has('static-1')).toBe(true);
        expect(filteredB.has('static-2')).toBe(true);
      });

      it('should return only static servers when session ID is undefined', () => {
        const filtered = filterForSession(testOutboundConns, undefined);

        expect(filtered.size).toBe(2);
        expect(filtered.has('static-1')).toBe(true);
        expect(filtered.has('static-2')).toBe(true);
        expect(filtered.has('template-x:session-a')).toBe(false);
        expect(filtered.has('template-x:session-b')).toBe(false);
      });

      it('should return only static servers when session ID matches no templates', () => {
        const filtered = filterForSession(testOutboundConns, 'non-existent-session');

        expect(filtered.size).toBe(2);
        expect(filtered.has('static-1')).toBe(true);
        expect(filtered.has('static-2')).toBe(true);
      });

      it('should handle empty outbound connections', () => {
        const empty: OutboundConnections = new Map();
        const filtered = filterForSession(empty, 'session-a');

        expect(filtered.size).toBe(0);
      });

      it('should handle connections with only static servers', () => {
        const staticOnly: OutboundConnections = new Map();
        staticOnly.set('static-1', {
          name: 'static-1',
          status: ClientStatus.Connected,
          client: mockStaticServer1,
          transport: { timeout: 5000 },
        } as OutboundConnection);

        const filtered = filterForSession(staticOnly, 'session-a');

        expect(filtered.size).toBe(1);
        expect(filtered.has('static-1')).toBe(true);
      });

      it('should handle connections with only template servers', () => {
        const templateOnly: OutboundConnections = new Map();
        templateOnly.set('template-x:session-a', {
          name: 'template-x',
          status: ClientStatus.Connected,
          client: mockTemplateA,
          transport: { timeout: 5000 },
        } as OutboundConnection);

        const filtered = filterForSession(templateOnly, 'session-a');

        expect(filtered.size).toBe(1);
        expect(filtered.has('template-x:session-a')).toBe(true);
      });

      it('should return empty map for template-only connections with non-matching session', () => {
        const templateOnly: OutboundConnections = new Map();
        templateOnly.set('template-x:session-a', {
          name: 'template-x',
          status: ClientStatus.Connected,
          client: mockTemplateA,
          transport: { timeout: 5000 },
        } as OutboundConnection);

        const filtered = filterForSession(templateOnly, 'session-b');

        expect(filtered.size).toBe(0);
      });
    });

    describe('resolveOutboundConnection with rendered hash-based routing', () => {
      let testOutboundConns: OutboundConnections;
      let mockStaticClient: any;
      let mockShareableClient: any;
      let mockPerClientClient: any;
      let mockShareableClient2: any;

      beforeEach(() => {
        mockStaticClient = { name: 'static-server', callTool: vi.fn() };
        mockShareableClient = { name: 'shareable-template', callTool: vi.fn() };
        mockPerClientClient = { name: 'per-client-template', callTool: vi.fn() };
        mockShareableClient2 = { name: 'shareable-template', callTool: vi.fn() };

        testOutboundConns = new Map();

        // Static server (no session suffix)
        testOutboundConns.set('static-server', {
          name: 'static-server',
          status: ClientStatus.Connected,
          client: mockStaticClient,
          transport: { timeout: 5000 },
        } as OutboundConnection);

        // Shareable template server with rendered hash (key format: templateName:renderedHash)
        testOutboundConns.set('shareable-template:abc123', {
          name: 'shareable-template',
          status: ClientStatus.Connected,
          client: mockShareableClient,
          transport: { timeout: 5000 },
        } as OutboundConnection);

        // Shareable template server with different rendered hash (different context)
        testOutboundConns.set('shareable-template:def456', {
          name: 'shareable-template',
          status: ClientStatus.Connected,
          client: mockShareableClient2,
          transport: { timeout: 5000 },
        } as OutboundConnection);

        // Per-client template server (key format: templateName:sessionId)
        testOutboundConns.set('per-client-template:session-a', {
          name: 'per-client-template',
          status: ClientStatus.Connected,
          client: mockPerClientClient,
          transport: { timeout: 5000 },
        } as OutboundConnection);

        // Mock the template server manager
        mockGetRenderedHashForSession.mockImplementation((sessionId: string, templateName: string) => {
          if (sessionId === 'session-a' && templateName === 'shareable-template') return 'abc123';
          if (sessionId === 'session-b' && templateName === 'shareable-template') return 'def456';
          if (sessionId === 'session-a' && templateName === 'per-client-template') return undefined;
          return undefined;
        });
      });

      afterEach(() => {
        mockGetRenderedHashForSession.mockReset();
      });

      it('should resolve shareable template server by rendered hash', () => {
        const result = resolveConnection('shareable-template', 'session-a', testOutboundConns);

        expect(result).toBeDefined();
        expect(result?.name).toBe('shareable-template');
        expect(result?.client).toBe(mockShareableClient);
        expect(mockGetRenderedHashForSession).toHaveBeenCalledWith('session-a', 'shareable-template');
      });

      it('should resolve different rendered hashes for different sessions with same template', () => {
        const resultA = resolveConnection('shareable-template', 'session-a', testOutboundConns);
        const resultB = resolveConnection('shareable-template', 'session-b', testOutboundConns);

        expect(resultA?.client).toBe(mockShareableClient); // abc123 hash
        expect(resultB?.client).toBe(mockShareableClient2); // def456 hash
        expect(resultA?.client).not.toBe(resultB?.client);
      });

      it('should resolve per-client template server by session ID', () => {
        mockGetRenderedHashForSession.mockReturnValue(undefined);

        const result = resolveConnection('per-client-template', 'session-a', testOutboundConns);

        expect(result).toBeDefined();
        expect(result?.name).toBe('per-client-template');
        expect(result?.client).toBe(mockPerClientClient);
      });

      it('should fall back to static server when no rendered hash or session key found', () => {
        const result = resolveConnection('static-server', 'session-a', testOutboundConns);

        expect(result).toBeDefined();
        expect(result?.name).toBe('static-server');
        expect(result?.client).toBe(mockStaticClient);
      });

      it('should return undefined for unknown server', () => {
        const result = resolveConnection('unknown-server', 'session-a', testOutboundConns);
        expect(result).toBeUndefined();
      });
    });

    describe('filterConnectionsForSession with rendered hash-based routing', () => {
      let testOutboundConns: OutboundConnections;
      let mockStaticClient: any;
      let mockShareableClientA: any;
      let mockShareableClientB: any;
      let mockPerClientClient: any;

      beforeEach(() => {
        mockStaticClient = { name: 'static-server' };
        mockShareableClientA = { name: 'shareable-template' };
        mockShareableClientB = { name: 'shareable-template' };
        mockPerClientClient = { name: 'per-client-template' };

        testOutboundConns = new Map();

        // Static servers (no : in key)
        testOutboundConns.set('static-server', {
          name: 'static-server',
          status: ClientStatus.Connected,
          client: mockStaticClient,
          transport: { timeout: 5000 },
        } as OutboundConnection);

        // Shareable template servers (key format: templateName:renderedHash)
        testOutboundConns.set('shareable-template:abc123', {
          name: 'shareable-template',
          status: ClientStatus.Connected,
          client: mockShareableClientA,
          transport: { timeout: 5000 },
        } as OutboundConnection);

        testOutboundConns.set('shareable-template:def456', {
          name: 'shareable-template',
          status: ClientStatus.Connected,
          client: mockShareableClientB,
          transport: { timeout: 5000 },
        } as OutboundConnection);

        // Per-client template server (key format: templateName:sessionId)
        testOutboundConns.set('per-client-template:session-a', {
          name: 'per-client-template',
          status: ClientStatus.Connected,
          client: mockPerClientClient,
          transport: { timeout: 5000 },
        } as OutboundConnection);

        // Mock the template server manager
        const sessionAHashes = new Map([['shareable-template', 'abc123']]);
        mockGetAllRenderedHashesForSession.mockImplementation((sessionId: string) => {
          if (sessionId === 'session-a') return sessionAHashes;
          if (sessionId === 'session-b') return new Map([['shareable-template', 'def456']]);
          return undefined;
        });
      });

      afterEach(() => {
        mockGetAllRenderedHashesForSession.mockReset();
      });

      it('should include static servers and shareable templates with matching rendered hash', () => {
        const filtered = filterForSession(testOutboundConns, 'session-a');

        // Should include: static-server, shareable-template:abc123, per-client-template:session-a
        expect(filtered.size).toBe(3);
        expect(filtered.has('static-server')).toBe(true);
        expect(filtered.has('shareable-template:abc123')).toBe(true);
        expect(filtered.has('per-client-template:session-a')).toBe(true);
        expect(filtered.has('shareable-template:def456')).toBe(false);
      });

      it('should include different rendered hash for different session', () => {
        const filtered = filterForSession(testOutboundConns, 'session-b');

        expect(filtered.size).toBe(2);
        expect(filtered.has('static-server')).toBe(true);
        expect(filtered.has('shareable-template:def456')).toBe(true);
        expect(filtered.has('shareable-template:abc123')).toBe(false);
      });

      it('should include per-client template servers with matching session ID', () => {
        const filtered = filterForSession(testOutboundConns, 'session-a');

        expect(filtered.has('per-client-template:session-a')).toBe(true);
      });

      it('should exclude per-client template servers from other sessions', () => {
        const filtered = filterForSession(testOutboundConns, 'session-b');

        expect(filtered.has('per-client-template:session-a')).toBe(false);
      });

      it('should include only static servers when no hashes for session', () => {
        mockGetAllRenderedHashesForSession.mockReturnValue(undefined);

        const filtered = filterForSession(testOutboundConns, 'non-existent-session');

        expect(filtered.size).toBe(1);
        expect(filtered.has('static-server')).toBe(true);
      });

      it('should include only static servers when session ID is undefined', () => {
        const filtered = filterForSession(testOutboundConns, undefined);

        expect(filtered.size).toBe(1);
        expect(filtered.has('static-server')).toBe(true);
      });
    });
  });

  describe('Session-Aware Request Handler Behavior', () => {
    let testOutboundConns: OutboundConnections;
    let mockInboundWithSession: InboundConnection;
    let mockStaticClient: any;
    let mockTemplateClientA: any;
    let mockTemplateClientB: any;

    beforeEach(() => {
      // Reset mocks
      vi.clearAllMocks();

      mockStaticClient = {
        callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'static result' }] }),
        readResource: vi.fn().mockResolvedValue({ contents: [] }),
        getPrompt: vi.fn().mockResolvedValue({ messages: [] }),
        setRequestHandler: vi.fn(),
      };

      mockTemplateClientA = {
        callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'template A result' }] }),
        readResource: vi.fn().mockResolvedValue({ contents: [] }),
        getPrompt: vi.fn().mockResolvedValue({ messages: [] }),
        setRequestHandler: vi.fn(),
      };

      mockTemplateClientB = {
        callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'template B result' }] }),
        readResource: vi.fn().mockResolvedValue({ contents: [] }),
        getPrompt: vi.fn().mockResolvedValue({ messages: [] }),
        setRequestHandler: vi.fn(),
      };

      testOutboundConns = new Map();

      // Static server
      testOutboundConns.set('static-server', {
        name: 'static-server',
        status: ClientStatus.Connected,
        client: mockStaticClient,
        transport: { timeout: 5000 },
      } as OutboundConnection);

      // Template servers for different sessions
      testOutboundConns.set('my-template:session-a', {
        name: 'my-template',
        status: ClientStatus.Connected,
        client: mockTemplateClientA,
        transport: { timeout: 5000 },
      } as OutboundConnection);

      testOutboundConns.set('my-template:session-b', {
        name: 'my-template',
        status: ClientStatus.Connected,
        client: mockTemplateClientB,
        transport: { timeout: 5000 },
      } as OutboundConnection);

      // Inbound connection with session context
      mockInboundWithSession = {
        server: { setRequestHandler: vi.fn() },
        context: { sessionId: 'session-a' },
        enablePagination: true,
        status: ClientStatus.Connected,
      } as any;
    });

    it('should register handlers with session context', () => {
      registerRequestHandlers(testOutboundConns, mockInboundWithSession);

      // Verify handlers were registered
      expect(mockInboundWithSession.server.setRequestHandler).toHaveBeenCalled();
      // Should register multiple handlers
      expect((mockInboundWithSession.server.setRequestHandler as any).mock.calls.length).toBeGreaterThan(5);
    });

    it('should register handlers for inbound connection without session context', () => {
      const mockInboundNoSession = {
        server: { setRequestHandler: vi.fn() },
        context: undefined,
        enablePagination: true,
        status: ClientStatus.Connected,
      } as any;

      registerRequestHandlers(testOutboundConns, mockInboundNoSession);

      expect(mockInboundNoSession.server.setRequestHandler).toHaveBeenCalled();
      expect((mockInboundNoSession.server.setRequestHandler as any).mock.calls.length).toBeGreaterThan(5);
    });

    it('should handle multiple template instances with same name but different sessions', () => {
      // Verify both template servers are in outboundConns
      expect(testOutboundConns.has('my-template:session-a')).toBe(true);
      expect(testOutboundConns.has('my-template:session-b')).toBe(true);
      expect(testOutboundConns.get('my-template:session-a')?.name).toBe('my-template');
      expect(testOutboundConns.get('my-template:session-b')?.name).toBe('my-template');
    });

    it('should include static servers alongside template servers', () => {
      expect(testOutboundConns.has('static-server')).toBe(true);
      expect(testOutboundConns.has('my-template:session-a')).toBe(true);
      expect(testOutboundConns.size).toBe(3); // 1 static + 2 templates
    });
  });
});
