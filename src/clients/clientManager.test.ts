import { vi, describe, it, expect, beforeEach, MockInstance } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  createClients,
  getClient,
  executeOperation,
  executeClientOperation,
  executeServerOperation,
} from './clientManager.js';
import createClientFn from '../client.js';
import logger from '../logger/logger.js';
import { ClientStatus, ClientInfo, ServerInfo } from '../types.js';
import { ClientConnectionError, ClientNotFoundError, MCPError } from '../utils/errorTypes.js';
import { MCP_SERVER_NAME, CONNECTION_RETRY } from '../constants.js';

// Mock dependencies
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn(),
}));

vi.mock('../client.js', () => ({
  __esModule: true,
  default: vi.fn(),
}));

vi.mock('../logger/logger.js', () => ({
  __esModule: true,
  default: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('clientManager', () => {
  let mockTransport: Transport;
  let mockClient: Partial<Client>;
  let mockTransports: Record<string, Transport>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

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

    (createClientFn as unknown as MockInstance).mockResolvedValue(mockClient);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('createClients', () => {
    it('should create clients successfully', async () => {
      (mockClient.connect as unknown as MockInstance).mockResolvedValue(undefined);
      (mockClient.getServerVersion as unknown as MockInstance).mockResolvedValue({
        name: 'test-server',
        version: '1.0.0',
      });

      const clientsPromise = createClients(mockTransports);
      await vi.runAllTimersAsync();
      const clients = await clientsPromise;

      expect(clients['test-client']).toBeDefined();
      expect(clients['test-client'].status).toBe(ClientStatus.Connected);
      expect(clients['test-client'].transport).toBe(mockTransport);
      expect(logger.info).toHaveBeenCalledWith('Client created for test-client');
    });

    it('should handle client connection failure after retries', async () => {
      const error = new Error('Connection failed');
      (mockClient.connect as unknown as MockInstance).mockRejectedValue(error);

      const clientsPromise = createClients(mockTransports);

      // Run through all retry attempts
      for (let i = 0; i < CONNECTION_RETRY.MAX_ATTEMPTS; i++) {
        await vi.advanceTimersByTimeAsync(CONNECTION_RETRY.INITIAL_DELAY_MS * Math.pow(2, i));
      }

      const clients = await clientsPromise;

      expect(clients['test-client'].status).toBe(ClientStatus.Error);
      expect(clients['test-client'].lastError).toBeInstanceOf(ClientConnectionError);
      expect(clients['test-client'].lastError?.message).toContain('Connection failed');
      expect(mockClient.connect).toHaveBeenCalledTimes(CONNECTION_RETRY.MAX_ATTEMPTS);
    });

    it('should prevent circular dependency with MCP server', async () => {
      (mockClient.connect as unknown as MockInstance).mockResolvedValue(undefined);
      (mockClient.getServerVersion as unknown as MockInstance).mockResolvedValue({
        name: MCP_SERVER_NAME,
        version: '1.0.0',
      });

      const clientsPromise = createClients(mockTransports);
      await vi.runAllTimersAsync();
      const clients = await clientsPromise;

      expect(clients['test-client'].status).toBe(ClientStatus.Error);
      expect(clients['test-client'].lastError).toBeInstanceOf(ClientConnectionError);
      expect(clients['test-client'].lastError?.message).toContain('circular dependency');
    });
  });

  describe('getClient', () => {
    let clients: Record<string, ClientInfo>;

    beforeEach(async () => {
      clients = await createClients(mockTransports);
    });

    it('should return client info for existing client', () => {
      const clientInfo = getClient(clients, 'test-client');
      expect(clientInfo).toBeDefined();
      expect(clientInfo.name).toBe('test-client');
    });

    it('should throw ClientNotFoundError for non-existent client', () => {
      expect(() => getClient(clients, 'non-existent')).toThrow(ClientNotFoundError);
    });
  });

  describe('executeOperation', () => {
    it('should execute operation successfully', async () => {
      const operation = vi.fn().mockResolvedValue('result');

      const result = await executeOperation(operation, 'test-context');

      expect(result).toBe('result');
      expect(operation).toHaveBeenCalled();
    });

    it('should retry failed operations', async () => {
      const error = new Error('Operation failed');
      const operation = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce('result');

      const operationPromise = executeOperation(operation, 'test-context', { retryCount: 1, retryDelay: 1000 });

      // Advance timer by retry delay
      await vi.advanceTimersByTimeAsync(1000);

      const result = await operationPromise;

      expect(result).toBe('result');
      expect(operation).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Retrying operation'));
    });

    it('should throw error after max retries', async () => {
      const error = new Error('Operation failed');
      const operation = vi.fn().mockRejectedValue(error);

      const operationPromise = executeOperation(operation, 'test-context', { retryCount: 2, retryDelay: 1000 });

      // Create rejection assertion before advancing timers
      const rejection = expect(operationPromise).rejects.toMatchObject({
        message: 'Error executing operation on test-context',
        data: { originalError: error },
      });

      // Advance timer for each retry
      for (let i = 0; i < 2; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }

      // Wait for the rejection assertion
      await rejection;

      expect(operation).toHaveBeenCalledTimes(3); // Initial try + 2 retries
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('executeClientOperation', () => {
    let clients: Record<string, ClientInfo>;

    beforeEach(async () => {
      clients = await createClients(mockTransports);
    });

    it('should execute client operation successfully', async () => {
      const operation = vi.fn().mockResolvedValue('result');

      const result = await executeClientOperation(clients, 'test-client', operation);

      expect(result).toBe('result');
      expect(operation).toHaveBeenCalledWith(clients['test-client']);
    });

    it('should throw error for non-existent client', async () => {
      const operation = vi.fn();

      await expect(executeClientOperation(clients, 'non-existent', operation)).rejects.toThrow(ClientNotFoundError);
    });
  });

  describe('executeServerOperation', () => {
    let mockServer: ServerInfo;

    beforeEach(() => {
      mockServer = {
        server: {
          request: vi.fn().mockResolvedValue('result'),
        },
      } as unknown as ServerInfo;
    });

    it('should execute server operation successfully', async () => {
      const operation = vi.fn().mockResolvedValue('result');

      const result = await executeServerOperation(mockServer, operation);

      expect(result).toBe('result');
      expect(operation).toHaveBeenCalledWith(mockServer);
    });

    it('should handle server operation failure', async () => {
      const error = new Error('Server operation failed');
      const operation = vi.fn().mockRejectedValue(error);

      await expect(executeServerOperation(mockServer, operation)).rejects.toThrow(MCPError);
    });
  });
});
