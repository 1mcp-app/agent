import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { CONNECTION_RETRY, MCP_SERVER_NAME } from '@src/constants.js';
import { AuthProviderTransport } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';

import { afterEach, beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';

import { ConnectionHandler } from './connectionHandler.js';
import { OAuthRequiredError } from './types.js';

// Mock dependencies
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn(),
  UnauthorizedError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'UnauthorizedError';
    }
  },
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

vi.mock('@src/core/server/agentConfig.js', () => ({
  AgentConfigManager: {
    getInstance: vi.fn().mockReturnValue({
      getUrl: vi.fn().mockReturnValue('http://localhost:3050'),
    }),
  },
}));

vi.mock('@src/utils/core/timeoutUtils.js', () => ({
  getConnectionTimeout: vi.fn((transport) => transport?.connectionTimeout || transport?.timeout || undefined),
}));

describe('ConnectionHandler', () => {
  let connectionHandler: ConnectionHandler;
  let mockClient: Partial<Client>;
  let mockTransport: Transport;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    connectionHandler = new ConnectionHandler();

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
    };

    (Client as unknown as MockInstance).mockImplementation(() => mockClient);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('connectWithRetry', () => {
    it('should connect successfully on first attempt', async () => {
      (mockClient.connect as unknown as MockInstance).mockResolvedValue(undefined);
      (mockClient.getServerVersion as unknown as MockInstance).mockResolvedValue({
        name: 'test-server',
        version: '1.0.0',
      });

      const result = await connectionHandler.connectWithRetry(mockClient as Client, mockTransport, 'test-client');

      expect(result).toBe(mockClient);
      expect(mockClient.connect).toHaveBeenCalledTimes(1);
    });

    it('should retry on connection failure', async () => {
      (mockClient.connect as unknown as MockInstance)
        .mockRejectedValueOnce(new Error('Connection failed'))
        .mockResolvedValueOnce(undefined);
      (mockClient.getServerVersion as unknown as MockInstance).mockResolvedValue({
        name: 'test-server',
        version: '1.0.0',
      });

      const connectPromise = connectionHandler.connectWithRetry(mockClient as Client, mockTransport, 'test-client');

      // Advance timers for retry delay
      await vi.advanceTimersByTimeAsync(CONNECTION_RETRY.INITIAL_DELAY_MS);
      await vi.runAllTimersAsync();

      const result = await connectPromise;

      expect(result).toBeDefined();
      expect(mockClient.connect).toHaveBeenCalledTimes(2);
    });

    it('should throw error after max retries', async () => {
      const error = new Error('Connection failed');
      (mockClient.connect as unknown as MockInstance).mockRejectedValue(error);

      const connectPromise = connectionHandler.connectWithRetry(mockClient as Client, mockTransport, 'test-client');

      // Add empty catch to suppress unhandled rejection warning
      connectPromise.catch(() => {});

      // Run all timers which will trigger all retries and the final rejection
      await vi.runAllTimersAsync();

      await expect(connectPromise).rejects.toThrow();
      expect(mockClient.connect).toHaveBeenCalledTimes(CONNECTION_RETRY.MAX_ATTEMPTS);
    });

    it('should prevent circular dependency with MCP server', async () => {
      (mockClient.connect as unknown as MockInstance).mockResolvedValue(undefined);
      (mockClient.getServerVersion as unknown as MockInstance).mockResolvedValue({
        name: MCP_SERVER_NAME,
        version: '1.0.0',
      });

      // Use real timers for this test since there's no actual timeout to wait for
      vi.useRealTimers();

      await expect(
        connectionHandler.connectWithRetry(mockClient as Client, mockTransport, 'test-client'),
      ).rejects.toThrow('circular dependency');

      vi.useFakeTimers();
    });

    it('should handle OAuth required error', async () => {
      const unauthorizedError = new UnauthorizedError('Unauthorized');
      (mockClient.connect as unknown as MockInstance).mockRejectedValue(unauthorizedError);

      await expect(
        connectionHandler.connectWithRetry(mockClient as Client, mockTransport, 'test-client'),
      ).rejects.toThrow(OAuthRequiredError);

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('OAuth authorization required'));
    });

    it('should close transport between retries', async () => {
      const mockTransportWithClose = {
        ...mockTransport,
        close: vi.fn().mockResolvedValue(undefined),
      };

      (mockClient.connect as unknown as MockInstance)
        .mockRejectedValueOnce(new Error('Connection failed'))
        .mockResolvedValueOnce(undefined);
      (mockClient.getServerVersion as unknown as MockInstance).mockResolvedValue({
        name: 'test-server',
        version: '1.0.0',
      });

      const connectPromise = connectionHandler.connectWithRetry(
        mockClient as Client,
        mockTransportWithClose,
        'test-client',
      );

      await vi.advanceTimersByTimeAsync(CONNECTION_RETRY.INITIAL_DELAY_MS);
      await vi.runAllTimersAsync();

      await connectPromise;

      expect(mockTransportWithClose.close).toHaveBeenCalled();
    });

    it('should recreate HTTP transport on retry', async () => {
      const mockHttpTransport = {
        _url: new URL('https://example.com/mcp'),
        oauthProvider: { token: 'test-token' },
        timeout: 5000,
        tags: ['test'],
        close: vi.fn().mockResolvedValue(undefined),
      };
      Object.setPrototypeOf(mockHttpTransport, StreamableHTTPClientTransport.prototype);

      (mockClient.connect as unknown as MockInstance)
        .mockRejectedValueOnce(new Error('Connection failed'))
        .mockResolvedValueOnce(undefined);
      (mockClient.getServerVersion as unknown as MockInstance).mockResolvedValue({
        name: 'test-server',
        version: '1.0.0',
      });

      const recreateTransport = vi.fn().mockReturnValue(mockHttpTransport);

      const connectPromise = connectionHandler.connectWithRetry(
        mockClient as Client,
        mockHttpTransport as unknown as AuthProviderTransport,
        'test-client',
        undefined,
        recreateTransport,
      );

      await vi.advanceTimersByTimeAsync(CONNECTION_RETRY.INITIAL_DELAY_MS);
      await vi.runAllTimersAsync();

      await connectPromise;

      expect(recreateTransport).toHaveBeenCalled();
    });

    it('should recreate SSE transport on retry', async () => {
      const mockSseTransport = {
        _url: new URL('https://example.com/sse'),
        oauthProvider: { token: 'test-token' },
        timeout: 3000,
        tags: ['sse'],
        close: vi.fn().mockResolvedValue(undefined),
      };
      Object.setPrototypeOf(mockSseTransport, SSEClientTransport.prototype);

      (mockClient.connect as unknown as MockInstance)
        .mockRejectedValueOnce(new Error('Connection failed'))
        .mockResolvedValueOnce(undefined);
      (mockClient.getServerVersion as unknown as MockInstance).mockResolvedValue({
        name: 'test-server',
        version: '1.0.0',
      });

      const recreateTransport = vi.fn().mockReturnValue(mockSseTransport);

      const connectPromise = connectionHandler.connectWithRetry(
        mockClient as Client,
        mockSseTransport as unknown as AuthProviderTransport,
        'test-client',
        undefined,
        recreateTransport,
      );

      await vi.advanceTimersByTimeAsync(CONNECTION_RETRY.INITIAL_DELAY_MS);
      await vi.runAllTimersAsync();

      await connectPromise;

      expect(recreateTransport).toHaveBeenCalled();
    });
  });

  describe('abort handling', () => {
    it('should abort connection when signal is set', async () => {
      const abortController = new AbortController();
      abortController.abort();

      await expect(
        connectionHandler.connectWithRetry(mockClient as Client, mockTransport, 'test-client', abortController.signal),
      ).rejects.toThrow('aborted');
    });

    it('should respect abort signal during retry delay', async () => {
      const abortController = new AbortController();

      (mockClient.connect as unknown as MockInstance).mockRejectedValue(new Error('Connection failed'));

      const connectPromise = connectionHandler.connectWithRetry(
        mockClient as Client,
        mockTransport,
        'test-client',
        abortController.signal,
      );

      // Abort during retry delay
      await vi.advanceTimersByTimeAsync(CONNECTION_RETRY.INITIAL_DELAY_MS / 2);
      abortController.abort();

      await expect(connectPromise).rejects.toThrow('aborted');
    });
  });

  describe('exponential backoff', () => {
    it('should use exponential backoff for retries', async () => {
      const delays: number[] = [];
      const originalSetTimeout = global.setTimeout;

      global.setTimeout = vi.fn((fn, delay) => {
        delays.push(delay as number);
        return originalSetTimeout(fn, delay);
      }) as unknown as typeof setTimeout;

      (mockClient.connect as unknown as MockInstance)
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValueOnce(undefined);
      (mockClient.getServerVersion as unknown as MockInstance).mockResolvedValue({
        name: 'test-server',
        version: '1.0.0',
      });

      const connectPromise = connectionHandler.connectWithRetry(mockClient as Client, mockTransport, 'test-client');

      for (let i = 0; i < 2; i++) {
        await vi.advanceTimersByTimeAsync(CONNECTION_RETRY.INITIAL_DELAY_MS * Math.pow(2, i));
      }

      await connectPromise;

      expect(delays[0]).toBe(CONNECTION_RETRY.INITIAL_DELAY_MS);
      expect(delays[1]).toBe(CONNECTION_RETRY.INITIAL_DELAY_MS * 2);

      global.setTimeout = originalSetTimeout;
    });
  });
});
