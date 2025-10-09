import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { CONNECTION_RETRY, MCP_SERVER_NAME } from '@src/constants.js';
import { AuthProviderTransport, ClientStatus } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';
import { ClientConnectionError, ClientNotFoundError } from '@src/utils/core/errorTypes.js';

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

describe('ClientManager', () => {
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
  });

  describe('createClients', () => {
    it('should create clients successfully', async () => {
      (mockClient.connect as unknown as MockInstance).mockResolvedValue(undefined);
      (mockClient.getServerVersion as unknown as MockInstance).mockResolvedValue({
        name: 'test-server',
        version: '1.0.0',
      });

      const clientsPromise = clientManager.createClients(mockTransports);
      await vi.runAllTimersAsync();
      const clients = await clientsPromise;

      expect(clients.get('test-client')).toBeDefined();
      expect(clients.get('test-client')!.status).toBe(ClientStatus.Connected);
      expect(clients.get('test-client')!.transport).toBe(mockTransport);
      expect(logger.info).toHaveBeenCalledWith('Client created for test-client');
    });

    it('should handle client connection failure after retries', async () => {
      const error = new Error('Connection failed');
      (mockClient.connect as unknown as MockInstance).mockRejectedValue(error);

      const clientsPromise = clientManager.createClients(mockTransports);

      // Run through all retry attempts
      for (let i = 0; i < CONNECTION_RETRY.MAX_ATTEMPTS; i++) {
        await vi.advanceTimersByTimeAsync(CONNECTION_RETRY.INITIAL_DELAY_MS * Math.pow(2, i));
      }

      const clients = await clientsPromise;

      expect(clients.get('test-client')!.status).toBe(ClientStatus.Error);
      expect(clients.get('test-client')!.lastError).toBeInstanceOf(ClientConnectionError);
      expect(clients.get('test-client')!.lastError?.message).toContain('Connection failed');
      expect(mockClient.connect).toHaveBeenCalledTimes(CONNECTION_RETRY.MAX_ATTEMPTS);
    });

    it('should prevent circular dependency with MCP server', async () => {
      (mockClient.connect as unknown as MockInstance).mockResolvedValue(undefined);
      (mockClient.getServerVersion as unknown as MockInstance).mockResolvedValue({
        name: MCP_SERVER_NAME,
        version: '1.0.0',
      });

      const clientsPromise = clientManager.createClients(mockTransports);
      await vi.runAllTimersAsync();
      const clients = await clientsPromise;

      expect(clients.get('test-client')!.status).toBe(ClientStatus.Error);
      expect(clients.get('test-client')!.lastError).toBeInstanceOf(ClientConnectionError);
      expect(clients.get('test-client')!.lastError?.message).toContain('circular dependency');
    });
  });

  describe('getClient', () => {
    beforeEach(async () => {
      (mockClient.connect as unknown as MockInstance).mockResolvedValue(undefined);
      (mockClient.getServerVersion as unknown as MockInstance).mockResolvedValue({
        name: 'test-server',
        version: '1.0.0',
      });

      // Ensure mockClient has transport property
      Object.defineProperty(mockClient, 'transport', {
        value: mockTransport,
        writable: true,
        configurable: true,
      });

      const clientsPromise = clientManager.createClients(mockTransports);
      await vi.runAllTimersAsync();
      await clientsPromise;
    });

    it('should return client info for existing client', () => {
      const clientInfo = clientManager.getClient('test-client');
      expect(clientInfo).toBeDefined();
      expect(clientInfo.name).toBe('test-client');
    });

    it('should throw ClientNotFoundError for non-existent client', () => {
      expect(() => clientManager.getClient('non-existent')).toThrow(ClientNotFoundError);
    });
  });

  describe('executeClientOperation', () => {
    beforeEach(async () => {
      // Set up mocks exactly like the successful test
      (mockClient.connect as unknown as MockInstance).mockResolvedValue(undefined);
      (mockClient.getServerVersion as unknown as MockInstance).mockResolvedValue({
        name: 'test-server',
        version: '1.0.0',
      });

      // Ensure mockClient has transport property
      Object.defineProperty(mockClient, 'transport', {
        value: mockTransport,
        writable: true,
        configurable: true,
      });

      const clientsPromise = clientManager.createClients(mockTransports);
      await vi.runAllTimersAsync();
      await clientsPromise;
    });

    it('should execute client operation successfully', async () => {
      const operation = vi.fn().mockResolvedValue('result');

      const result = await clientManager.executeClientOperation('test-client', operation);

      expect(result).toBe('result');
      expect(operation).toHaveBeenCalledWith(clientManager.getClient('test-client'));
    });

    it('should throw error for non-existent client', async () => {
      const operation = vi.fn();

      await expect(clientManager.executeClientOperation('non-existent', operation)).rejects.toThrow(
        ClientNotFoundError,
      );
    });
  });

  describe('retry logic with transport recreation', () => {
    it('should recreate HTTP transport on retry after "already started" error', async () => {
      // Create mock HTTP transport with URL
      const mockHttpTransport = {
        _url: new URL('https://example.com/mcp'),
        oauthProvider: { token: 'test-token' },
        timeout: 5000,
        tags: ['test'],
        close: vi.fn().mockResolvedValue(undefined),
      };
      Object.setPrototypeOf(mockHttpTransport, StreamableHTTPClientTransport.prototype);

      const transportsWithHttp = {
        'http-client': mockHttpTransport as unknown as AuthProviderTransport,
      };

      // Mock first connect to fail with typical error
      const connectMock = vi.fn();
      connectMock.mockRejectedValueOnce(new Error('fetch failed')); // First attempt fails
      connectMock.mockResolvedValueOnce(undefined); // Second attempt succeeds

      mockClient.connect = connectMock;
      (mockClient.getServerVersion as unknown as MockInstance).mockResolvedValue({
        name: 'test-server',
        version: '1.0.0',
      });

      const clientsPromise = clientManager.createClients(transportsWithHttp);

      // Advance timers to trigger retry
      await vi.advanceTimersByTimeAsync(CONNECTION_RETRY.INITIAL_DELAY_MS);
      await vi.runAllTimersAsync();

      const clients = await clientsPromise;

      expect(clients.get('http-client')!.status).toBe(ClientStatus.Connected);
      expect(connectMock).toHaveBeenCalledTimes(2); // Original + 1 retry
      expect(mockHttpTransport.close).toHaveBeenCalledTimes(1); // Transport closed before retry
    });

    it('should recreate SSE transport on retry after connection error', async () => {
      // Create mock SSE transport with URL
      const mockSseTransport = {
        _url: new URL('https://example.com/sse'),
        oauthProvider: { token: 'test-token' },
        timeout: 3000,
        tags: ['sse'],
        close: vi.fn().mockResolvedValue(undefined),
      };
      Object.setPrototypeOf(mockSseTransport, SSEClientTransport.prototype);

      const transportsWithSse = {
        'sse-client': mockSseTransport as unknown as AuthProviderTransport,
      };

      // Mock first connect to fail, second to succeed
      const connectMock = vi.fn();
      connectMock.mockRejectedValueOnce(new Error('Connection refused'));
      connectMock.mockResolvedValueOnce(undefined);

      mockClient.connect = connectMock;
      (mockClient.getServerVersion as unknown as MockInstance).mockResolvedValue({
        name: 'test-server',
        version: '1.0.0',
      });

      const clientsPromise = clientManager.createClients(transportsWithSse);

      // Advance timers to trigger retry
      await vi.advanceTimersByTimeAsync(CONNECTION_RETRY.INITIAL_DELAY_MS);
      await vi.runAllTimersAsync();

      const clients = await clientsPromise;

      expect(clients.get('sse-client')!.status).toBe(ClientStatus.Connected);
      expect(connectMock).toHaveBeenCalledTimes(2);
      expect(mockSseTransport.close).toHaveBeenCalledTimes(1);
    });

    it('should pass timeout from transport config to client.connect', async () => {
      const mockHttpTransport = {
        _url: new URL('https://example.com/mcp'),
        oauthProvider: { token: 'test-token' },
        timeout: 10000, // Custom timeout
        tags: ['test'],
        close: vi.fn().mockResolvedValue(undefined),
      };
      Object.setPrototypeOf(mockHttpTransport, StreamableHTTPClientTransport.prototype);

      const transportsWithTimeout = {
        'timeout-client': mockHttpTransport as unknown as AuthProviderTransport,
      };

      const connectMock = vi.fn().mockResolvedValue(undefined);
      mockClient.connect = connectMock;
      (mockClient.getServerVersion as unknown as MockInstance).mockResolvedValue({
        name: 'test-server',
        version: '1.0.0',
      });

      await clientManager.createClients(transportsWithTimeout);
      await vi.runAllTimersAsync();

      // Verify timeout was passed to connect
      expect(connectMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ timeout: 10000 }));
    });

    it('should use connectionTimeout for connect and fallback to timeout', async () => {
      const mockHttpTransport = {
        _url: new URL('https://example.com/mcp'),
        oauthProvider: { token: 'test-token' },
        connectionTimeout: 5000, // Specific connection timeout
        timeout: 30000, // Fallback timeout
        tags: ['test'],
        close: vi.fn().mockResolvedValue(undefined),
      };
      Object.setPrototypeOf(mockHttpTransport, StreamableHTTPClientTransport.prototype);

      const transportsWithConnectionTimeout = {
        'connection-timeout-client': mockHttpTransport as unknown as AuthProviderTransport,
      };

      const connectMock = vi.fn().mockResolvedValue(undefined);
      mockClient.connect = connectMock;
      (mockClient.getServerVersion as unknown as MockInstance).mockResolvedValue({
        name: 'test-server',
        version: '1.0.0',
      });

      await clientManager.createClients(transportsWithConnectionTimeout);
      await vi.runAllTimersAsync();

      // Verify connectionTimeout was used, not timeout
      expect(connectMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ timeout: 5000 }));
    });

    it('should fallback to timeout when connectionTimeout not specified', async () => {
      const mockHttpTransport = {
        _url: new URL('https://example.com/mcp'),
        oauthProvider: { token: 'test-token' },
        timeout: 15000, // Only timeout specified
        tags: ['test'],
        close: vi.fn().mockResolvedValue(undefined),
      };
      Object.setPrototypeOf(mockHttpTransport, StreamableHTTPClientTransport.prototype);

      const transportsWithOnlyTimeout = {
        'fallback-timeout-client': mockHttpTransport as unknown as AuthProviderTransport,
      };

      const connectMock = vi.fn().mockResolvedValue(undefined);
      mockClient.connect = connectMock;
      (mockClient.getServerVersion as unknown as MockInstance).mockResolvedValue({
        name: 'test-server',
        version: '1.0.0',
      });

      await clientManager.createClients(transportsWithOnlyTimeout);
      await vi.runAllTimersAsync();

      // Verify timeout was used as fallback
      expect(connectMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ timeout: 15000 }));
    });
  });

  describe('completeOAuthAndReconnect', () => {
    it('should throw ClientNotFoundError if server not found', async () => {
      await expect(clientManager.completeOAuthAndReconnect('non-existent', 'auth-code')).rejects.toThrow(
        ClientNotFoundError,
      );
    });

    it('should throw error if transport does not support OAuth', async () => {
      // Create a STDIO transport that doesn't support OAuth
      const stdioTransport = {
        name: 'stdio',
        start: vi.fn(),
        send: vi.fn(),
        close: vi.fn(),
      } as Transport;

      const mockClient = {
        connect: vi.fn(),
      } as unknown as Client;

      // Manually add client with STDIO transport
      const clients = clientManager.getClients();
      clients.set('stdio-server', {
        name: 'stdio-server',
        transport: stdioTransport as AuthProviderTransport,
        client: mockClient,
        status: ClientStatus.AwaitingOAuth,
      });

      await expect(clientManager.completeOAuthAndReconnect('stdio-server', 'auth-code')).rejects.toThrow(
        'does not support OAuth',
      );
    });

    it('should complete OAuth and reconnect with StreamableHTTPClientTransport', async () => {
      // Create mock HTTP transport
      const mockHttpTransport = {
        _url: new URL('https://example.com/mcp'),
        oauthProvider: { token: 'test-token' },
        finishAuth: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
      Object.setPrototypeOf(mockHttpTransport, StreamableHTTPClientTransport.prototype);

      const mockOldClient = {
        getInstructions: vi.fn().mockReturnValue(''),
      } as unknown as Client;

      const mockNewClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        getServerCapabilities: vi.fn().mockReturnValue({ tools: {} }),
        getInstructions: vi.fn().mockReturnValue('test instructions'),
      };

      // Mock Client constructor to return new client
      (Client as unknown as MockInstance).mockImplementation(() => mockNewClient);

      // Manually add client with HTTP transport
      const clients = clientManager.getClients();
      clients.set('http-server', {
        name: 'http-server',
        transport: mockHttpTransport as unknown as AuthProviderTransport,
        client: mockOldClient,
        status: ClientStatus.AwaitingOAuth,
      });

      await clientManager.completeOAuthAndReconnect('http-server', 'auth-code-123');

      // Verify finishAuth was called
      expect(mockHttpTransport.finishAuth).toHaveBeenCalledWith('auth-code-123');

      // Verify old transport was closed
      expect(mockHttpTransport.close).toHaveBeenCalled();

      // Verify new client was connected
      expect(mockNewClient.connect).toHaveBeenCalled();

      // Verify capabilities were discovered
      expect(mockNewClient.getServerCapabilities).toHaveBeenCalled();

      // Verify client info was updated
      const updatedClient = clients.get('http-server');
      expect(updatedClient?.status).toBe(ClientStatus.Connected);
      expect(updatedClient?.client).toBe(mockNewClient);
      expect(updatedClient?.capabilities).toEqual({ tools: {} });
    });

    it('should complete OAuth and reconnect with SSEClientTransport', async () => {
      // Create mock SSE transport
      const mockSseTransport = {
        _url: new URL('https://example.com/sse'),
        oauthProvider: { token: 'test-token' },
        finishAuth: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
      Object.setPrototypeOf(mockSseTransport, SSEClientTransport.prototype);

      const mockOldClient = {
        getInstructions: vi.fn().mockReturnValue(''),
      } as unknown as Client;

      const mockNewClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        getServerCapabilities: vi.fn().mockReturnValue({ resources: {} }),
        getInstructions: vi.fn().mockReturnValue(''),
      };

      // Mock Client constructor to return new client
      (Client as unknown as MockInstance).mockImplementation(() => mockNewClient);

      // Manually add client with SSE transport
      const clients = clientManager.getClients();
      clients.set('sse-server', {
        name: 'sse-server',
        transport: mockSseTransport as unknown as AuthProviderTransport,
        client: mockOldClient,
        status: ClientStatus.AwaitingOAuth,
      });

      await clientManager.completeOAuthAndReconnect('sse-server', 'auth-code-456');

      // Verify finishAuth was called
      expect(mockSseTransport.finishAuth).toHaveBeenCalledWith('auth-code-456');

      // Verify old transport was closed
      expect(mockSseTransport.close).toHaveBeenCalled();

      // Verify new client was connected
      expect(mockNewClient.connect).toHaveBeenCalled();

      // Verify client info was updated
      const updatedClient = clients.get('sse-server');
      expect(updatedClient?.status).toBe(ClientStatus.Connected);
      expect(updatedClient?.client).toBe(mockNewClient);
    });

    it('should handle reconnection errors', async () => {
      // Create mock HTTP transport
      const mockHttpTransport = {
        _url: new URL('https://example.com/mcp'),
        oauthProvider: { token: 'test-token' },
        finishAuth: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
      Object.setPrototypeOf(mockHttpTransport, StreamableHTTPClientTransport.prototype);

      const mockOldClient = {
        getInstructions: vi.fn().mockReturnValue(''),
      } as unknown as Client;

      const mockNewClient = {
        connect: vi.fn().mockRejectedValue(new Error('Connection failed')),
      };

      // Mock Client constructor to return new client
      (Client as unknown as MockInstance).mockImplementation(() => mockNewClient);

      // Manually add client
      const clients = clientManager.getClients();
      clients.set('failing-server', {
        name: 'failing-server',
        transport: mockHttpTransport as unknown as AuthProviderTransport,
        client: mockOldClient,
        status: ClientStatus.AwaitingOAuth,
      });

      await expect(clientManager.completeOAuthAndReconnect('failing-server', 'auth-code')).rejects.toThrow(
        'Connection failed',
      );
    });
  });
});
