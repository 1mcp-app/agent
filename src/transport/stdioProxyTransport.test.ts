import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StdioProxyTransport, StdioProxyTransportOptions } from './stdioProxyTransport.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { MCP_CLIENT_CAPABILITIES, MCP_SERVER_NAME, MCP_SERVER_VERSION } from '../constants.js';

// Mock the SDK modules
vi.mock('@modelcontextprotocol/sdk/server/stdio.js');
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js');
vi.mock('@modelcontextprotocol/sdk/client/index.js');

describe('StdioProxyTransport', () => {
  let mockStdioTransport: any;
  let mockHTTPTransport: any;
  let mockClient: any;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Create mock instances
    mockStdioTransport = {
      start: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      onmessage: null,
      onerror: null,
      onclose: null,
    };

    mockHTTPTransport = {
      send: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      onmessage: null,
      onerror: null,
      onclose: null,
    };

    mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    // Mock constructors
    vi.mocked(StdioServerTransport).mockImplementation(() => mockStdioTransport);
    vi.mocked(StreamableHTTPClientTransport).mockImplementation(() => mockHTTPTransport);
    vi.mocked(Client).mockImplementation(() => mockClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create STDIO server transport', () => {
      const options: StdioProxyTransportOptions = {
        serverUrl: 'http://localhost:3050/mcp',
      };

      new StdioProxyTransport(options);

      expect(StdioServerTransport).toHaveBeenCalledTimes(1);
    });

    it('should create StreamableHTTP client transport with correct URL', () => {
      const options: StdioProxyTransportOptions = {
        serverUrl: 'http://localhost:3050/mcp',
      };

      new StdioProxyTransport(options);

      expect(StreamableHTTPClientTransport).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(StreamableHTTPClientTransport).mock.calls[0];
      expect(callArgs[0]).toBeInstanceOf(URL);
      expect(callArgs[0].toString()).toBe('http://localhost:3050/mcp');
    });

    it('should add tags to URL query params', () => {
      const options: StdioProxyTransportOptions = {
        serverUrl: 'http://localhost:3050/mcp',
        tags: ['web', 'api'],
      };

      new StdioProxyTransport(options);

      const callArgs = vi.mocked(StreamableHTTPClientTransport).mock.calls[0];
      const url = callArgs[0] as URL;
      expect(url.searchParams.get('tags')).toBe('web,api');
    });

    it('should create MCP client', () => {
      const options: StdioProxyTransportOptions = {
        serverUrl: 'http://localhost:3050/mcp',
      };

      new StdioProxyTransport(options);

      expect(Client).toHaveBeenCalledWith(
        {
          name: `${MCP_SERVER_NAME}-proxy`,
          version: MCP_SERVER_VERSION,
        },
        {
          capabilities: MCP_CLIENT_CAPABILITIES,
        },
      );
    });
  });

  describe('start', () => {
    it('should connect client to HTTP transport', async () => {
      const options: StdioProxyTransportOptions = {
        serverUrl: 'http://localhost:3050/mcp',
      };

      const proxy = new StdioProxyTransport(options);
      await proxy.start();

      expect(mockClient.connect).toHaveBeenCalledWith(mockHTTPTransport, {
        timeout: undefined,
      });
    });

    it('should start STDIO transport', async () => {
      const options: StdioProxyTransportOptions = {
        serverUrl: 'http://localhost:3050/mcp',
      };

      const proxy = new StdioProxyTransport(options);
      await proxy.start();

      expect(mockStdioTransport.start).toHaveBeenCalled();
    });

    it('should set up message forwarding handlers', async () => {
      const options: StdioProxyTransportOptions = {
        serverUrl: 'http://localhost:3050/mcp',
      };

      const proxy = new StdioProxyTransport(options);
      await proxy.start();

      expect(mockStdioTransport.onmessage).toBeTypeOf('function');
      expect(mockHTTPTransport.onmessage).toBeTypeOf('function');
      expect(mockStdioTransport.onerror).toBeTypeOf('function');
      expect(mockHTTPTransport.onerror).toBeTypeOf('function');
      expect(mockStdioTransport.onclose).toBeTypeOf('function');
      expect(mockHTTPTransport.onclose).toBeTypeOf('function');
    });

    it('should throw error if client connection fails', async () => {
      const options: StdioProxyTransportOptions = {
        serverUrl: 'http://localhost:3050/mcp',
      };

      mockClient.connect.mockRejectedValueOnce(new Error('Connection failed'));

      const proxy = new StdioProxyTransport(options);

      await expect(proxy.start()).rejects.toThrow('Connection failed');
    });
  });

  describe('message forwarding', () => {
    it('should forward messages from STDIO to HTTP', async () => {
      const options: StdioProxyTransportOptions = {
        serverUrl: 'http://localhost:3050/mcp',
      };

      const proxy = new StdioProxyTransport(options);
      await proxy.start();

      const message: JSONRPCMessage = {
        jsonrpc: '2.0',
        method: 'test',
        id: 1,
        params: {},
      };

      // Simulate STDIO message
      await mockStdioTransport.onmessage(message);

      expect(mockHTTPTransport.send).toHaveBeenCalledWith(message);
    });

    it('should forward messages from HTTP to STDIO', async () => {
      const options: StdioProxyTransportOptions = {
        serverUrl: 'http://localhost:3050/mcp',
      };

      const proxy = new StdioProxyTransport(options);
      await proxy.start();

      const message: JSONRPCMessage = {
        jsonrpc: '2.0',
        result: { value: 'test result' },
        id: 1,
      };

      // Simulate HTTP message
      await mockHTTPTransport.onmessage(message);

      expect(mockStdioTransport.send).toHaveBeenCalledWith(message);
    });

    it('should handle STDIO message forwarding errors gracefully', async () => {
      const options: StdioProxyTransportOptions = {
        serverUrl: 'http://localhost:3050/mcp',
      };

      mockHTTPTransport.send.mockRejectedValueOnce(new Error('HTTP send failed'));

      const proxy = new StdioProxyTransport(options);
      await proxy.start();

      const message: JSONRPCMessage = {
        jsonrpc: '2.0',
        method: 'test',
        id: 1,
        params: {},
      };

      // Should not throw
      await expect(mockStdioTransport.onmessage(message)).resolves.toBeUndefined();
    });

    it('should handle HTTP message forwarding errors gracefully', async () => {
      const options: StdioProxyTransportOptions = {
        serverUrl: 'http://localhost:3050/mcp',
      };

      mockStdioTransport.send.mockRejectedValueOnce(new Error('STDIO send failed'));

      const proxy = new StdioProxyTransport(options);
      await proxy.start();

      const message: JSONRPCMessage = {
        jsonrpc: '2.0',
        result: { value: 'test result' },
        id: 1,
      };

      // Should not throw
      await expect(mockHTTPTransport.onmessage(message)).resolves.toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('should handle STDIO transport errors', async () => {
      const options: StdioProxyTransportOptions = {
        serverUrl: 'http://localhost:3050/mcp',
      };

      const proxy = new StdioProxyTransport(options);
      await proxy.start();

      const error = new Error('STDIO error');

      // Should not throw
      expect(() => mockStdioTransport.onerror(error)).not.toThrow();
    });

    it('should handle HTTP transport errors', async () => {
      const options: StdioProxyTransportOptions = {
        serverUrl: 'http://localhost:3050/mcp',
      };

      const proxy = new StdioProxyTransport(options);
      await proxy.start();

      const error = new Error('HTTP error');

      // Should not throw
      expect(() => mockHTTPTransport.onerror(error)).not.toThrow();
    });
  });

  describe('connection lifecycle', () => {
    it('should close all transports when STDIO closes', async () => {
      const options: StdioProxyTransportOptions = {
        serverUrl: 'http://localhost:3050/mcp',
      };

      const proxy = new StdioProxyTransport(options);
      await proxy.start();

      // Simulate STDIO close
      await mockStdioTransport.onclose();

      expect(mockClient.close).toHaveBeenCalled();
      expect(mockStdioTransport.close).toHaveBeenCalled();
    });

    it('should close all transports when HTTP closes', async () => {
      const options: StdioProxyTransportOptions = {
        serverUrl: 'http://localhost:3050/mcp',
      };

      const proxy = new StdioProxyTransport(options);
      await proxy.start();

      // Simulate HTTP close
      await mockHTTPTransport.onclose();

      expect(mockClient.close).toHaveBeenCalled();
      expect(mockStdioTransport.close).toHaveBeenCalled();
    });

    it('should handle close gracefully', async () => {
      const options: StdioProxyTransportOptions = {
        serverUrl: 'http://localhost:3050/mcp',
      };

      const proxy = new StdioProxyTransport(options);
      await proxy.start();

      await proxy.close();

      expect(mockClient.close).toHaveBeenCalled();
      expect(mockStdioTransport.close).toHaveBeenCalled();
    });

    it('should not throw when closing unopened transport', async () => {
      const options: StdioProxyTransportOptions = {
        serverUrl: 'http://localhost:3050/mcp',
      };

      const proxy = new StdioProxyTransport(options);

      await expect(proxy.close()).resolves.toBeUndefined();
    });

    it('should prevent double close', async () => {
      const options: StdioProxyTransportOptions = {
        serverUrl: 'http://localhost:3050/mcp',
      };

      const proxy = new StdioProxyTransport(options);
      await proxy.start();

      await proxy.close();
      await proxy.close();

      // Should only close once
      expect(mockClient.close).toHaveBeenCalledTimes(1);
      expect(mockStdioTransport.close).toHaveBeenCalledTimes(1);
    });
  });
});
