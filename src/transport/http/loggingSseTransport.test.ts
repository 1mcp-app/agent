import { ServerResponse } from 'node:http';

import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

import { type AgentConfig, AgentConfigManager } from '@src/core/server/agentConfig.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LoggingSSEServerTransport } from './loggingSseTransport.js';

// Mock the logger to check if logging happens
vi.mock('@src/transport/http/utils/unifiedLogger.js', () => ({
  logJsonRpc: vi.fn(),
}));

describe('LoggingSSEServerTransport', () => {
  let mockResponse: ServerResponse;
  let originalConfigManager: AgentConfigManager;
  let transport: LoggingSSEServerTransport;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create a mock ServerResponse
    mockResponse = {
      writeHead: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
      statusCode: 200,
      writableEnded: false,
      finished: false,
      headersSent: false,
    } as unknown as ServerResponse;

    // Get the config manager instance and set error logging enabled
    originalConfigManager = AgentConfigManager.getInstance();
    originalConfigManager.updateConfig({
      features: {
        jsonRpcErrorLogging: true,
      },
    } as Partial<AgentConfig>);

    // Create transport instance
    transport = new LoggingSSEServerTransport('/test', mockResponse);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Reset to default
    originalConfigManager.updateConfig({
      features: {
        jsonRpcErrorLogging: true,
      },
    } as Partial<AgentConfig>);
  });

  describe('send with JSON-RPC error responses', () => {
    it('should log JSON-RPC errors when enabled', async () => {
      const { logJsonRpc } = await import('@src/transport/http/utils/unifiedLogger.js');
      const errorMessage: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 'test-id',
        error: {
          code: -32700,
          message: 'Parse error',
        },
      };

      // Mock the parent's send to avoid connection errors
      vi.spyOn(Object.getPrototypeOf(Object.getPrototypeOf(transport)), 'send').mockResolvedValue(undefined);

      await transport.send(errorMessage);

      expect(logJsonRpc).toHaveBeenCalledWith(
        'warn',
        'JSON-RPC error response',
        expect.objectContaining({
          jsonrpcVersion: '2.0',
          requestId: 'test-id',
          errorCode: -32700,
          errorMessage: 'Parse error',
        }),
      );
    });

    it('should not log when error logging is disabled', async () => {
      const { logJsonRpc } = await import('@src/transport/http/utils/unifiedLogger.js');
      // Disable error logging
      AgentConfigManager.getInstance().updateConfig({
        features: {
          jsonRpcErrorLogging: false,
        },
      } as Partial<AgentConfig>);

      const errorMessage: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 'test-id',
        error: {
          code: -32700,
          message: 'Parse error',
        },
      };

      // Mock the parent's send to avoid connection errors
      vi.spyOn(Object.getPrototypeOf(Object.getPrototypeOf(transport)), 'send').mockResolvedValue(undefined);

      await transport.send(errorMessage);

      expect(logJsonRpc).not.toHaveBeenCalled();
    });

    it('should not log non-error responses', async () => {
      const { logJsonRpc } = await import('@src/transport/http/utils/unifiedLogger.js');
      const successMessage: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 'test-id',
        result: {
          capabilities: {},
        },
      };

      // Mock the parent's send to avoid connection errors
      vi.spyOn(Object.getPrototypeOf(Object.getPrototypeOf(transport)), 'send').mockResolvedValue(undefined);

      await transport.send(successMessage);

      expect(logJsonRpc).not.toHaveBeenCalled();
    });

    it('should log responses with error code', async () => {
      const { logJsonRpc } = await import('@src/transport/http/utils/unifiedLogger.js');
      const messageWithErrorCode: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 'test-id',
        error: {
          code: -32603,
          message: 'Internal error',
          data: 'Additional data',
        },
      };

      // Mock the parent's send to avoid connection errors
      vi.spyOn(Object.getPrototypeOf(Object.getPrototypeOf(transport)), 'send').mockResolvedValue(undefined);

      await transport.send(messageWithErrorCode);

      expect(logJsonRpc).toHaveBeenCalledWith(
        'warn',
        'JSON-RPC error response',
        expect.objectContaining({
          errorCode: -32603,
          errorData: 'Additional data',
        }),
      );
    });
  });

  describe('config access', () => {
    it('should use AgentConfigManager not process.env', async () => {
      const { logJsonRpc } = await import('@src/transport/http/utils/unifiedLogger.js');
      // Ensure config is enabled
      const configManager = AgentConfigManager.getInstance();
      expect(configManager.isJsonRpcErrorLoggingEnabled()).toBe(true);

      const errorMessage: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 'test-id',
        error: {
          code: -32600,
          message: 'Invalid Request',
        },
      };

      // Mock the parent's send to avoid connection errors
      vi.spyOn(Object.getPrototypeOf(Object.getPrototypeOf(transport)), 'send').mockResolvedValue(undefined);

      await transport.send(errorMessage);

      expect(logJsonRpc).toHaveBeenCalled();
    });
  });
});
