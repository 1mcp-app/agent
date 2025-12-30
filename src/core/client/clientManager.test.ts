import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { CONNECTION_RETRY, MCP_SERVER_NAME } from '@src/constants.js';
import { AuthProviderTransport, ClientStatus } from '@src/core/types/index.js';

import { afterEach, beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';

import { ClientManager } from './clientManager.js';

// Mock dependencies
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn(),
}));

vi.mock('@src/logger/logger.js', () => ({
  __esModule: true,
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
  debugIf: vi.fn(),
}));

vi.mock('../server/agentConfig.js', () => ({
  AgentConfigManager: {
    getInstance: vi.fn().mockReturnValue({
      getUrl: vi.fn().mockReturnValue('http://localhost:3050'),
    }),
  },
}));

vi.mock('@src/utils/core/operationExecution.js', () => ({
  executeOperation: vi.fn().mockImplementation((operation) => operation()),
}));

vi.mock('@src/utils/core/timeoutUtils.js', () => ({
  getConnectionTimeout: vi.fn((transport) => transport?.connectionTimeout || transport?.timeout || undefined),
}));

describe('ClientManager (Integration)', () => {
  let clientManager: ClientManager;
  let mockTransport: Transport;
  let mockClient: Partial<Client>;
  let mockTransports: Record<string, Transport>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Reset singleton for each test
    ClientManager.resetInstance();
    clientManager = ClientManager.getOrCreateInstance();

    mockTransport = {
      name: 'test-transport',
      start: vi.fn(),
      send: vi.fn(),
      close: vi.fn(),
    } as Transport;

    mockClient = {
      connect: vi.fn(),
      getServerVersion: vi.fn(),
      close: vi.fn(),
      getInstructions: vi.fn().mockReturnValue('test instructions'),
    };

    mockTransports = {
      'test-client': mockTransport,
    };

    (Client as unknown as MockInstance).mockImplementation(() => mockClient);
  });

  afterEach(() => {
    vi.useRealTimers();
    ClientManager.resetInstance();
  });

  describe('singleton pattern', () => {
    it('should return the same instance', () => {
      const instance1 = ClientManager.getOrCreateInstance();
      const instance2 = ClientManager.getOrCreateInstance();
      expect(instance1).toBe(instance2);
    });

    it('should reset instance properly', () => {
      const instance1 = ClientManager.getOrCreateInstance();
      ClientManager.resetInstance();
      const instance2 = ClientManager.getOrCreateInstance();
      expect(instance1).not.toBe(instance2);
    });

    it('should provide current instance', () => {
      expect(ClientManager.current).toBeDefined();
      expect(ClientManager.current).toBe(clientManager);
    });
  });

  describe('createClients', () => {
    it('should create clients successfully for multiple transports', async () => {
      const multiTransports: Record<string, Transport> = {
        'client-1': {
          name: 'transport-1',
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
        } as Transport,
        'client-2': {
          name: 'transport-2',
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
        } as Transport,
      };

      (mockClient.connect as unknown as MockInstance).mockResolvedValue(undefined);
      (mockClient.getServerVersion as unknown as MockInstance).mockResolvedValue({
        name: 'test-server',
        version: '1.0.0',
      });

      const clientsPromise = clientManager.createClients(multiTransports as Record<string, AuthProviderTransport>);
      await vi.runAllTimersAsync();
      const clients = await clientsPromise;

      expect(clients.size).toBe(2);
      expect(clients.get('client-1')).toBeDefined();
      expect(clients.get('client-2')).toBeDefined();
      expect(clients.get('client-1')!.status).toBe(ClientStatus.Connected);
      expect(clients.get('client-2')!.status).toBe(ClientStatus.Connected);
    });

    it('should clear existing clients before creating new ones', async () => {
      // Create initial clients
      (mockClient.connect as unknown as MockInstance).mockResolvedValue(undefined);
      (mockClient.getServerVersion as unknown as MockInstance).mockResolvedValue({
        name: 'test-server',
        version: '1.0.0',
      });

      await clientManager.createClients(mockTransports as Record<string, AuthProviderTransport>);
      await vi.runAllTimersAsync();

      expect(clientManager.getClients().size).toBe(1);

      // Create new clients
      const newTransports: Record<string, Transport> = {
        'new-client': {
          name: 'new-transport',
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
        } as Transport,
      };

      await clientManager.createClients(newTransports as Record<string, AuthProviderTransport>);
      await vi.runAllTimersAsync();

      const clients = clientManager.getClients();
      expect(clients.size).toBe(1);
      expect(clients.has('test-client')).toBe(false);
      expect(clients.has('new-client')).toBe(true);
    });

    it('should handle connection failure with error status', async () => {
      const error = new Error('Connection failed');
      (mockClient.connect as unknown as MockInstance).mockRejectedValue(error);

      const clientsPromise = clientManager.createClients(mockTransports as Record<string, AuthProviderTransport>);

      // Run through all retry attempts
      for (let i = 0; i < CONNECTION_RETRY.MAX_ATTEMPTS; i++) {
        await vi.advanceTimersByTimeAsync(CONNECTION_RETRY.INITIAL_DELAY_MS * Math.pow(2, i));
      }

      const clients = await clientsPromise;

      expect(clients.get('test-client')!.status).toBe(ClientStatus.Error);
      expect(clients.get('test-client')!.lastError).toBeDefined();
    });

    it('should prevent circular dependency with MCP server', async () => {
      (mockClient.connect as unknown as MockInstance).mockResolvedValue(undefined);
      (mockClient.getServerVersion as unknown as MockInstance).mockResolvedValue({
        name: MCP_SERVER_NAME,
        version: '1.0.0',
      });

      const clientsPromise = clientManager.createClients(mockTransports as Record<string, AuthProviderTransport>);
      await vi.runAllTimersAsync();
      const clients = await clientsPromise;

      expect(clients.get('test-client')!.status).toBe(ClientStatus.Error);
      expect(clients.get('test-client')!.lastError?.message).toContain('circular dependency');
    });

    it('should cache and extract instructions from connected clients', async () => {
      (mockClient.connect as unknown as MockInstance).mockResolvedValue(undefined);
      (mockClient.getServerVersion as unknown as MockInstance).mockResolvedValue({
        name: 'test-server',
        version: '1.0.0',
      });
      (mockClient.getInstructions as unknown as MockInstance).mockReturnValue('Server instructions for testing');

      const clientsPromise = clientManager.createClients(mockTransports as Record<string, AuthProviderTransport>);
      await vi.runAllTimersAsync();
      await clientsPromise;

      const client = clientManager.getClient('test-client');
      expect(client.instructions).toBe('Server instructions for testing');
    });

    it('should use parallel execution with concurrency limit', async () => {
      const { DEFAULT_MAX_CONCURRENT_LOADS } = await import('@src/constants/mcp.js');

      // Create more transports than the concurrency limit
      const transports: Record<string, Transport> = {};
      for (let i = 0; i < DEFAULT_MAX_CONCURRENT_LOADS + 2; i++) {
        transports[`client-${i}`] = {
          name: `transport-${i}`,
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
        } as Transport;
      }

      (mockClient.connect as unknown as MockInstance).mockResolvedValue(undefined);
      (mockClient.getServerVersion as unknown as MockInstance).mockResolvedValue({
        name: 'test-server',
        version: '1.0.0',
      });

      const clientsPromise = clientManager.createClients(transports as Record<string, AuthProviderTransport>);
      await vi.runAllTimersAsync();
      await clientsPromise;

      const clients = clientManager.getClients();
      expect(clients.size).toBe(DEFAULT_MAX_CONCURRENT_LOADS + 2);
    });
  });

  describe('createSingleClient', () => {
    it('should create a single client successfully', async () => {
      (mockClient.connect as unknown as MockInstance).mockResolvedValue(undefined);
      (mockClient.getServerVersion as unknown as MockInstance).mockResolvedValue({
        name: 'test-server',
        version: '1.0.0',
      });

      await clientManager.createSingleClient('single-client', mockTransport as AuthProviderTransport);
      await vi.runAllTimersAsync();

      const clients = clientManager.getClients();
      expect(clients.has('single-client')).toBe(true);
      expect(clients.get('single-client')!.status).toBe(ClientStatus.Connected);
    });

    it('should handle abort signal', async () => {
      const abortController = new AbortController();

      (mockClient.connect as unknown as MockInstance).mockImplementation(() => {
        abortController.abort();
        return Promise.reject(new Error('Aborted'));
      });

      await expect(
        clientManager.createSingleClient(
          'abort-client',
          mockTransport as AuthProviderTransport,
          abortController.signal,
        ),
      ).rejects.toThrow();
    });

    it('should deduplicate concurrent connection attempts', async () => {
      (mockClient.connect as unknown as MockInstance).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100)),
      );
      (mockClient.getServerVersion as unknown as MockInstance).mockResolvedValue({
        name: 'test-server',
        version: '1.0.0',
      });

      // Start multiple concurrent connections for the same client
      const promise1 = clientManager.createSingleClient('concurrent-client', mockTransport as AuthProviderTransport);
      const promise2 = clientManager.createSingleClient('concurrent-client', mockTransport as AuthProviderTransport);
      const promise3 = clientManager.createSingleClient('concurrent-client', mockTransport as AuthProviderTransport);

      await vi.runAllTimersAsync();

      await Promise.all([promise1, promise2, promise3]);

      // Should only have one client created
      const clients = clientManager.getClients();
      expect(clients.size).toBe(1);
    });
  });

  describe('getClient and getClients', () => {
    beforeEach(async () => {
      (mockClient.connect as unknown as MockInstance).mockResolvedValue(undefined);
      (mockClient.getServerVersion as unknown as MockInstance).mockResolvedValue({
        name: 'test-server',
        version: '1.0.0',
      });

      await clientManager.createClients(mockTransports as Record<string, AuthProviderTransport>);
      await vi.runAllTimersAsync();
    });

    it('should return client info for existing client', () => {
      const clientInfo = clientManager.getClient('test-client');
      expect(clientInfo).toBeDefined();
      expect(clientInfo.name).toBe('test-client');
      expect(clientInfo.status).toBe(ClientStatus.Connected);
    });

    it('should throw ClientNotFoundError for non-existent client', () => {
      expect(() => clientManager.getClient('non-existent')).toThrow();
    });

    it('should return all clients', () => {
      const clients = clientManager.getClients();
      expect(clients.size).toBe(1);
      expect(clients.has('test-client')).toBe(true);
    });
  });

  describe('executeClientOperation', () => {
    beforeEach(async () => {
      (mockClient.connect as unknown as MockInstance).mockResolvedValue(undefined);
      (mockClient.getServerVersion as unknown as MockInstance).mockResolvedValue({
        name: 'test-server',
        version: '1.0.0',
      });

      // Ensure mockClient has transport property for connection check
      Object.defineProperty(mockClient, 'transport', {
        value: mockTransport,
        writable: true,
        configurable: true,
      });

      await clientManager.createClients(mockTransports as Record<string, AuthProviderTransport>);
      await vi.runAllTimersAsync();
    });

    it('should execute client operation successfully', async () => {
      const operation = vi.fn().mockResolvedValue('result');

      const result = await clientManager.executeClientOperation('test-client', operation);

      expect(result).toBe('result');
      expect(operation).toHaveBeenCalledWith(clientManager.getClient('test-client'));
    });

    it('should throw error for non-existent client', async () => {
      const operation = vi.fn();

      await expect(clientManager.executeClientOperation('non-existent', operation)).rejects.toThrow();
    });
  });

  describe('completeOAuthAndReconnect integration', () => {
    it('should complete OAuth flow and reconnect successfully', async () => {
      const mockHttpTransport = {
        _url: new URL('https://example.com/mcp'),
        oauthProvider: {
          token: 'test-token',
          getAuthorizationUrl: vi.fn().mockReturnValue('https://example.com/oauth'),
        },
        finishAuth: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      } as unknown as AuthProviderTransport;
      Object.setPrototypeOf(mockHttpTransport, StreamableHTTPClientTransport.prototype);

      const mockOldClient = {
        getInstructions: vi.fn().mockReturnValue('old instructions'),
      } as unknown as Client;

      const mockNewClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        getServerCapabilities: vi.fn().mockReturnValue({ tools: {} }),
        getInstructions: vi.fn().mockReturnValue('new instructions'),
      };

      (Client as unknown as MockInstance).mockImplementation(() => mockNewClient);

      const clients = clientManager.getClients();
      clients.set('oauth-server', {
        name: 'oauth-server',
        transport: mockHttpTransport,
        client: mockOldClient,
        status: ClientStatus.AwaitingOAuth,
      });

      await clientManager.completeOAuthAndReconnect('oauth-server', 'auth-code-123');

      const updatedClient = clients.get('oauth-server');
      expect(updatedClient?.status).toBe(ClientStatus.Connected);
      expect(updatedClient?.client).toBe(mockNewClient);
    });
  });

  describe('removeClient', () => {
    it('should remove client successfully', async () => {
      const mockTransportWithClose = {
        name: 'test-transport',
        start: vi.fn(),
        send: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      } as Transport;

      (mockClient.connect as unknown as MockInstance).mockResolvedValue(undefined);
      (mockClient.getServerVersion as unknown as MockInstance).mockResolvedValue({
        name: 'test-server',
        version: '1.0.0',
      });

      await clientManager.createClients({ 'test-client': mockTransportWithClose } as Record<
        string,
        AuthProviderTransport
      >);
      await vi.runAllTimersAsync();

      expect(clientManager.getClients().has('test-client')).toBe(true);

      await clientManager.removeClient('test-client');

      expect(clientManager.getClients().has('test-client')).toBe(false);
      expect(mockTransportWithClose.close).toHaveBeenCalled();
    });

    it('should handle removal of non-existent client gracefully', async () => {
      await expect(clientManager.removeClient('non-existent')).resolves.not.toThrow();
    });
  });

  describe('instruction aggregation integration', () => {
    it('should set instruction aggregator', () => {
      const mockAggregator = {
        setInstructions: vi.fn(),
        removeServer: vi.fn(),
      };

      expect(() => clientManager.setInstructionAggregator(mockAggregator as any)).not.toThrow();
    });

    it('should update instructions when aggregator is set', async () => {
      const mockAggregator = {
        setInstructions: vi.fn(),
        removeServer: vi.fn(),
      };

      clientManager.setInstructionAggregator(mockAggregator as any);

      (mockClient.connect as unknown as MockInstance).mockResolvedValue(undefined);
      (mockClient.getServerVersion as unknown as MockInstance).mockResolvedValue({
        name: 'test-server',
        version: '1.0.0',
      });
      (mockClient.getInstructions as unknown as MockInstance).mockReturnValue('test instructions');

      await clientManager.createClients(mockTransports as Record<string, AuthProviderTransport>);
      await vi.runAllTimersAsync();

      expect(mockAggregator.setInstructions).toHaveBeenCalledWith('test-client', 'test instructions');
    });
  });

  describe('getTransport and getTransportNames', () => {
    it('should return transport by name', async () => {
      (mockClient.connect as unknown as MockInstance).mockResolvedValue(undefined);
      (mockClient.getServerVersion as unknown as MockInstance).mockResolvedValue({
        name: 'test-server',
        version: '1.0.0',
      });

      await clientManager.createClients(mockTransports as Record<string, AuthProviderTransport>);
      await vi.runAllTimersAsync();

      expect(clientManager.getTransport('test-client')).toBe(mockTransport);
      expect(clientManager.getTransport('non-existent')).toBeUndefined();
    });

    it('should return all transport names', async () => {
      const multiTransports: Record<string, Transport> = {
        'client-1': { name: 'transport-1', start: vi.fn(), send: vi.fn(), close: vi.fn() } as Transport,
        'client-2': { name: 'transport-2', start: vi.fn(), send: vi.fn(), close: vi.fn() } as Transport,
      };

      (mockClient.connect as unknown as MockInstance).mockResolvedValue(undefined);
      (mockClient.getServerVersion as unknown as MockInstance).mockResolvedValue({
        name: 'test-server',
        version: '1.0.0',
      });

      await clientManager.createClients(multiTransports as Record<string, AuthProviderTransport>);
      await vi.runAllTimersAsync();

      const names = clientManager.getTransportNames();
      expect(names).toContain('client-1');
      expect(names).toContain('client-2');
    });
  });

  describe('initializeClientsAsync', () => {
    it('should initialize client storage without connecting', () => {
      const transports: Record<string, AuthProviderTransport> = {
        'async-client': mockTransport as AuthProviderTransport,
      };

      const clients = clientManager.initializeClientsAsync(transports);

      // initializeClientsAsync clears existing connections and returns empty map
      // The connections are created asynchronously via createClients/createSingleClient
      expect(clients.size).toBe(0);
    });

    it('should clear existing clients on initialization', async () => {
      (mockClient.connect as unknown as MockInstance).mockResolvedValue(undefined);
      (mockClient.getServerVersion as unknown as MockInstance).mockResolvedValue({
        name: 'test-server',
        version: '1.0.0',
      });

      // Create initial clients
      await clientManager.createClients(mockTransports as Record<string, AuthProviderTransport>);
      await vi.runAllTimersAsync();

      expect(clientManager.getClients().size).toBe(1);

      // Initialize with new transports
      const newTransports: Record<string, AuthProviderTransport> = {
        'new-client': mockTransport as AuthProviderTransport,
      };

      clientManager.initializeClientsAsync(newTransports);

      // Should have cleared existing clients
      expect(clientManager.getClients().size).toBe(0);
    });
  });

  describe('client instance creation', () => {
    it('should create client instance', () => {
      const client = clientManager.createClientInstance();
      expect(client).toBeDefined();
      expect(Client).toHaveBeenCalled();
    });

    it('should create pooled client instance', () => {
      const client = clientManager.createPooledClientInstance();
      expect(client).toBeDefined();
      expect(Client).toHaveBeenCalled();
    });
  });
});
