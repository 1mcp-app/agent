import { vi, describe, it, expect, beforeEach, MockInstance, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { ClientManager } from './clientManager.js';
import logger from '../../logger/logger.js';
import { ClientStatus } from '../types/index.js';
import { ClientConnectionError, ClientNotFoundError } from '../../utils/errorTypes.js';
import { MCP_SERVER_NAME, CONNECTION_RETRY } from '../../constants.js';

// Mock dependencies
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn(),
}));

vi.mock('../../logger/logger.js', () => ({
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

vi.mock('../../utils/operationExecution.js', () => ({
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
});
