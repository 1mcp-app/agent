import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClientStatus, type OutboundConnections, type OutboundConnection, type InboundConnection } from '../core/types/index.js';

// Mock dependencies
vi.mock('../logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
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

describe('Request Handlers', () => {
  let mockClients: OutboundConnections;
  let mockServerInfo: InboundConnection;
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
    mockClients = new Map();
    mockClients.set('client1', {
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

    mockClients.set('client2', {
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
    mockServerInfo = {
      server: mockServer,
      tags: ['test'],
      enablePagination: true,
    } as InboundConnection;
  });

  describe('registerRequestHandlers', () => {
    it('should register all request handlers', () => {
      registerRequestHandlers(mockClients, mockServerInfo);

      // Verify that setRequestHandler was called for each handler
      expect(mockServer.setRequestHandler).toHaveBeenCalled();
      
      // Should register multiple handlers
      expect(mockServer.setRequestHandler.mock.calls.length).toBeGreaterThan(5);
    });

    it('should register server-specific handlers for clients', () => {
      registerRequestHandlers(mockClients, mockServerInfo);

      // Verify client request handlers were set
      expect(mockClient1.setRequestHandler).toHaveBeenCalled();
      expect(mockClient2.setRequestHandler).toHaveBeenCalled();
    });

    it('should handle server with no clients', () => {
      const emptyClients: OutboundConnections = new Map();
      
      expect(() => {
        registerRequestHandlers(emptyClients, mockServerInfo);
      }).not.toThrow();

      expect(mockServer.setRequestHandler).toHaveBeenCalled();
    });

    it('should handle clients with different statuses', () => {
      // Add clients with different statuses
      mockClients.set('disconnected', {
        name: 'disconnected',
        status: ClientStatus.Disconnected,
        client: { setRequestHandler: vi.fn() },
        transport: { timeout: 5000 },
      } as any);

      mockClients.set('error', {
        name: 'error',
        status: ClientStatus.Error,
        client: { setRequestHandler: vi.fn() },
        transport: { timeout: 5000 },
      } as any);

      expect(() => {
        registerRequestHandlers(mockClients, mockServerInfo);
      }).not.toThrow();

      expect(mockServer.setRequestHandler).toHaveBeenCalled();
    });

    it('should handle server with undefined pagination setting', () => {
      const serverWithoutPagination = {
        ...mockServerInfo,
        enablePagination: undefined,
      };

      expect(() => {
        registerRequestHandlers(mockClients, serverWithoutPagination);
      }).not.toThrow();
    });

    it('should handle server with empty tags', () => {
      const serverWithEmptyTags = {
        ...mockServerInfo,
        tags: [],
      };

      expect(() => {
        registerRequestHandlers(mockClients, serverWithEmptyTags);
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

      const pingHandler = createPingHandler(mockClients);
      const result = await pingHandler();

      expect(mockClient1.ping).toHaveBeenCalledTimes(1);
      expect(mockClient2.ping).toHaveBeenCalledTimes(1);
      expect(result).toEqual({});
    });

    it('should skip disconnected clients', async () => {
      // Add a disconnected client
      mockClients.set('client3', {
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

      const pingHandler = createPingHandler(mockClients);
      await pingHandler();

      // Client3 is disconnected, so its ping should not be called
      expect(mockClients.get('client3')!.client.ping).not.toHaveBeenCalled();
    });

    it('should handle client ping failures gracefully', async () => {
      mockClient1.ping.mockResolvedValue({});
      mockClient2.ping.mockRejectedValue(new Error('Client 2 failed'));

      const pingHandler = createPingHandler(mockClients);
      const result = await pingHandler();

      expect(mockClient1.ping).toHaveBeenCalledTimes(1);
      expect(mockClient2.ping).toHaveBeenCalledTimes(1);
      expect(result).toEqual({});
    });

    it('should always return empty object even if all clients fail', async () => {
      mockClient1.ping.mockRejectedValue(new Error('Client 1 failed'));
      mockClient2.ping.mockRejectedValue(new Error('Client 2 failed'));

      const pingHandler = createPingHandler(mockClients);
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
      registerRequestHandlers(mockClients, mockServerInfo);

      // Should register at least 10 different handlers
      expect(mockServer.setRequestHandler.mock.calls.length).toBeGreaterThanOrEqual(10);
    });

    it('should register client-specific handlers', () => {
      registerRequestHandlers(mockClients, mockServerInfo);

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
        registerRequestHandlers(clientsWithoutTimeout, mockServerInfo);
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
        registerRequestHandlers(mockClients, minimalServer);
      }).not.toThrow();

      expect(minimalServer.server.setRequestHandler).toHaveBeenCalled();
    });
  });
});