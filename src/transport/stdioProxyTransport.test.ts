import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StdioProxyTransport } from './stdioProxyTransport.js';

// Mock the SDK transports
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
    onmessage: undefined,
    onerror: undefined,
    onclose: undefined,
  })),
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
    onmessage: undefined,
    onerror: undefined,
    onclose: undefined,
  })),
}));

describe('StdioProxyTransport', () => {
  let proxy: StdioProxyTransport;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (proxy) {
      await proxy.close();
    }
  });

  describe('constructor', () => {
    it('should create proxy with server URL', () => {
      proxy = new StdioProxyTransport({
        serverUrl: 'http://localhost:3050/mcp',
      });

      expect(proxy).toBeDefined();
    });

    it('should create proxy with tags', () => {
      proxy = new StdioProxyTransport({
        serverUrl: 'http://localhost:3050/mcp',
        tags: ['web', 'api'],
      });

      expect(proxy).toBeDefined();
    });

    it('should create proxy with timeout', () => {
      proxy = new StdioProxyTransport({
        serverUrl: 'http://localhost:3050/mcp',
        timeout: 5000,
      });

      expect(proxy).toBeDefined();
    });
  });

  describe('start', () => {
    it('should start both transports in correct order', async () => {
      proxy = new StdioProxyTransport({
        serverUrl: 'http://localhost:3050/mcp',
      });

      await proxy.start();

      // Verify both transports were started
      expect(proxy['httpTransport'].start).toHaveBeenCalled();
      expect(proxy['stdioTransport'].start).toHaveBeenCalled();
    });

    it('should set up message forwarding before starting transports', async () => {
      proxy = new StdioProxyTransport({
        serverUrl: 'http://localhost:3050/mcp',
      });

      await proxy.start();

      // Verify message handlers are set
      expect(proxy['stdioTransport'].onmessage).toBeDefined();
      expect(proxy['httpTransport'].onmessage).toBeDefined();
      expect(proxy['stdioTransport'].onerror).toBeDefined();
      expect(proxy['httpTransport'].onerror).toBeDefined();
      expect(proxy['stdioTransport'].onclose).toBeDefined();
      expect(proxy['httpTransport'].onclose).toBeDefined();
    });
  });

  describe('message forwarding', () => {
    it('should forward messages from STDIO to HTTP with _meta field', async () => {
      proxy = new StdioProxyTransport({
        serverUrl: 'http://localhost:3050/mcp',
      });

      await proxy.start();

      const message: JSONRPCMessage = {
        jsonrpc: '2.0',
        method: 'initialize',
        id: 1,
        params: {},
      };

      // Simulate STDIO message
      await proxy['stdioTransport'].onmessage!(message);

      // Verify forwarded message has _meta field with context
      const expectedMessage = expect.objectContaining({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 1,
        params: expect.objectContaining({
          _meta: expect.objectContaining({
            context: expect.objectContaining({
              project: expect.objectContaining({
                path: expect.any(String),
                name: expect.any(String),
              }),
              user: expect.objectContaining({
                username: expect.any(String),
              }),
              environment: expect.objectContaining({
                variables: expect.any(Object),
              }),
              sessionId: expect.any(String),
            }),
          }),
        }),
      });

      expect(proxy['httpTransport'].send).toHaveBeenCalledWith(expectedMessage);
    });

    it('should forward messages from HTTP to STDIO', async () => {
      proxy = new StdioProxyTransport({
        serverUrl: 'http://localhost:3050/mcp',
      });

      await proxy.start();

      const message: JSONRPCMessage = {
        jsonrpc: '2.0',
        result: { capabilities: {} },
        id: 1,
      };

      // Simulate HTTP message
      await proxy['httpTransport'].onmessage!(message);

      // Verify forwarded to STDIO transport
      expect(proxy['stdioTransport'].send).toHaveBeenCalledWith(message);
    });

    it('should handle errors during STDIO to HTTP forwarding', async () => {
      proxy = new StdioProxyTransport({
        serverUrl: 'http://localhost:3050/mcp',
      });

      await proxy.start();

      // Make send throw error
      proxy['httpTransport'].send = vi.fn().mockRejectedValue(new Error('Send failed'));

      const message: JSONRPCMessage = {
        jsonrpc: '2.0',
        method: 'test',
        id: 1,
        params: {},
      };

      // Should not throw, error should be logged
      await expect(proxy['stdioTransport'].onmessage!(message)).resolves.not.toThrow();
    });

    it('should handle errors during HTTP to STDIO forwarding', async () => {
      proxy = new StdioProxyTransport({
        serverUrl: 'http://localhost:3050/mcp',
      });

      await proxy.start();

      // Make send throw error
      proxy['stdioTransport'].send = vi.fn().mockRejectedValue(new Error('Send failed'));

      const message: JSONRPCMessage = {
        jsonrpc: '2.0',
        result: {},
        id: 1,
      };

      // Should not throw, error should be logged
      await expect(proxy['httpTransport'].onmessage!(message)).resolves.not.toThrow();
    });
  });

  describe('close', () => {
    it('should close both transports', async () => {
      proxy = new StdioProxyTransport({
        serverUrl: 'http://localhost:3050/mcp',
      });

      await proxy.start();
      await proxy.close();

      expect(proxy['httpTransport'].close).toHaveBeenCalled();
      expect(proxy['stdioTransport'].close).toHaveBeenCalled();
    });

    it('should handle close when not connected', async () => {
      proxy = new StdioProxyTransport({
        serverUrl: 'http://localhost:3050/mcp',
      });

      // Should not throw when closing without starting
      await expect(proxy.close()).resolves.not.toThrow();
    });

    it('should handle close errors gracefully', async () => {
      proxy = new StdioProxyTransport({
        serverUrl: 'http://localhost:3050/mcp',
      });

      await proxy.start();

      // Make close throw error
      proxy['httpTransport'].close = vi.fn().mockRejectedValue(new Error('Close failed'));

      // Should not throw, error should be logged
      await expect(proxy.close()).resolves.not.toThrow();
    });

    it('should not cause infinite recursion when onclose handlers trigger', async () => {
      proxy = new StdioProxyTransport({
        serverUrl: 'http://localhost:3050/mcp',
      });

      await proxy.start();

      // Track how many times the actual cleanup logic runs
      let cleanupExecutions = 0;

      // Make transports trigger their onclose handlers when close() is called
      const httpCloseMock = vi.fn(async () => {
        cleanupExecutions++;
        // Simulate real transport behavior: trigger onclose when closed
        if (proxy['httpTransport'].onclose) {
          await proxy['httpTransport'].onclose();
        }
      });

      const stdioCloseMock = vi.fn(async () => {
        cleanupExecutions++;
        // Simulate real transport behavior: trigger onclose when closed
        if (proxy['stdioTransport'].onclose) {
          await proxy['stdioTransport'].onclose();
        }
      });

      proxy['httpTransport'].close = httpCloseMock;
      proxy['stdioTransport'].close = stdioCloseMock;

      // This should not cause stack overflow or throw error
      await expect(proxy.close()).resolves.not.toThrow();

      // Cleanup should execute exactly once (both transports closed once)
      expect(httpCloseMock).toHaveBeenCalledTimes(1);
      expect(stdioCloseMock).toHaveBeenCalledTimes(1);
      expect(cleanupExecutions).toBe(2); // One for http, one for stdio
    });
  });

  describe('transport lifecycle handlers', () => {
    it('should handle STDIO transport close', async () => {
      proxy = new StdioProxyTransport({
        serverUrl: 'http://localhost:3050/mcp',
      });

      await proxy.start();

      const closeSpy = vi.spyOn(proxy, 'close');

      // Trigger STDIO close
      await proxy['stdioTransport'].onclose!();

      expect(closeSpy).toHaveBeenCalled();
    });

    it('should handle HTTP transport close', async () => {
      proxy = new StdioProxyTransport({
        serverUrl: 'http://localhost:3050/mcp',
      });

      await proxy.start();

      const closeSpy = vi.spyOn(proxy, 'close');

      // Trigger HTTP close
      await proxy['httpTransport'].onclose!();

      expect(closeSpy).toHaveBeenCalled();
    });

    it('should handle STDIO transport errors', async () => {
      proxy = new StdioProxyTransport({
        serverUrl: 'http://localhost:3050/mcp',
      });

      await proxy.start();

      const error = new Error('STDIO error');

      // Should not throw
      expect(() => proxy['stdioTransport'].onerror!(error)).not.toThrow();
    });

    it('should handle HTTP transport errors', async () => {
      proxy = new StdioProxyTransport({
        serverUrl: 'http://localhost:3050/mcp',
      });

      await proxy.start();

      const error = new Error('HTTP error');

      // Should not throw
      expect(() => proxy['httpTransport'].onerror!(error)).not.toThrow();
    });
  });

  describe('client information extraction and headers', () => {
    it('should extract client info from initialize request and update context', async () => {
      proxy = new StdioProxyTransport({
        serverUrl: 'http://localhost:3050/mcp',
      });

      await proxy.start();

      const initializeMessage: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: { roots: { listChanged: true } },
          clientInfo: {
            name: 'claude-code',
            version: '1.0.0',
            title: 'Claude Code',
          },
        },
      };

      // Simulate initialize request processing
      if (proxy['stdioTransport'].onmessage) {
        await proxy['stdioTransport'].onmessage!(initializeMessage);
      }

      // Verify client info was extracted
      expect(proxy['clientInfo']).toEqual({
        name: 'claude-code',
        version: '1.0.0',
        title: 'Claude Code',
      });
      expect(proxy['initializeIntercepted']).toBe(true);

      // Verify the message was forwarded with client info in _meta
      const expectedEnhancedMessage = expect.objectContaining({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: expect.objectContaining({
          protocolVersion: '2025-06-18',
          capabilities: { roots: { listChanged: true } },
          clientInfo: {
            name: 'claude-code',
            version: '1.0.0',
            title: 'Claude Code',
          },
          _meta: expect.objectContaining({
            context: expect.objectContaining({
              project: expect.objectContaining({
                path: expect.any(String),
                name: expect.any(String),
              }),
              user: expect.objectContaining({
                username: expect.any(String),
              }),
              environment: expect.objectContaining({
                variables: expect.any(Object),
              }),
              sessionId: expect.any(String),
              transport: expect.objectContaining({
                type: 'stdio-proxy',
                client: {
                  name: 'claude-code',
                  version: '1.0.0',
                  title: 'Claude Code',
                },
                connectionTimestamp: expect.any(String),
              }),
            }),
          }),
        }),
      });

      expect(proxy['httpTransport'].send).toHaveBeenCalledWith(expectedEnhancedMessage);
    });

    it('should handle client info without title gracefully', async () => {
      proxy = new StdioProxyTransport({
        serverUrl: 'http://localhost:3050/mcp',
      });

      await proxy.start();

      const initializeMessage: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: {
            name: 'cursor',
            version: '0.28.3',
            // No title field
          },
        },
      };

      // Simulate initialize request processing
      if (proxy['stdioTransport'].onmessage) {
        await proxy['stdioTransport'].onmessage!(initializeMessage);
      }

      // Verify client info was extracted without title
      expect(proxy['clientInfo']).toEqual({
        name: 'cursor',
        version: '0.28.3',
        title: undefined,
      });
      expect(proxy['initializeIntercepted']).toBe(true);
    });

    it('should not extract client info from non-initialize requests', async () => {
      proxy = new StdioProxyTransport({
        serverUrl: 'http://localhost:3050/mcp',
      });

      await proxy.start();

      const nonInitializeMessage: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      };

      // Simulate non-initialize request processing
      if (proxy['stdioTransport'].onmessage) {
        await proxy['stdioTransport'].onmessage!(nonInitializeMessage);
      }

      // Verify no client info was extracted
      const context = proxy['context'];
      expect(context.transport?.client).toBeUndefined();
    });

    it('should build base User-Agent without client info', () => {
      proxy = new StdioProxyTransport({
        serverUrl: 'http://localhost:3050/mcp',
      });

      // Before client info extraction, User-Agent should be base only
      const userAgent = proxy['buildUserAgent']();
      expect(userAgent).toMatch(/^1MCP-Proxy\/[\d.]+(?:-[a-zA-Z0-9.]+)?$/);
    });

    it('should build User-Agent with client info including title', async () => {
      proxy = new StdioProxyTransport({
        serverUrl: 'http://localhost:3050/mcp',
      });

      await proxy.start();

      const initializeMessage: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: {
            name: 'claude-code',
            version: '1.0.0',
            title: 'Claude Code',
          },
        },
      };

      // Simulate initialize request processing
      if (proxy['stdioTransport'].onmessage) {
        await proxy['stdioTransport'].onmessage!(initializeMessage);
      }

      // User-Agent should include client info with title
      const userAgent = proxy['buildUserAgent']();
      expect(userAgent).toMatch(/^1MCP-Proxy\/[\d.]+(?:-[a-zA-Z0-9.]+)? claude-code\/1\.0\.0 \(Claude Code\)$/);
    });

    it('should build User-Agent with client info without title', async () => {
      proxy = new StdioProxyTransport({
        serverUrl: 'http://localhost:3050/mcp',
      });

      await proxy.start();

      const initializeMessage: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: {
            name: 'cursor',
            version: '0.28.3',
          },
        },
      };

      // Simulate initialize request processing
      if (proxy['stdioTransport'].onmessage) {
        await proxy['stdioTransport'].onmessage!(initializeMessage);
      }

      // User-Agent should include client info without title
      const userAgent = proxy['buildUserAgent']();
      expect(userAgent).toMatch(/^1MCP-Proxy\/[\d.]+(?:-[a-zA-Z0-9.]+)? cursor\/0\.28\.3$/);
    });

    it('should extract client info without recreating transport', async () => {
      proxy = new StdioProxyTransport({
        serverUrl: 'http://localhost:3050/mcp',
      });

      await proxy.start();

      // Get the initial HTTP transport
      const initialTransport = proxy['httpTransport'];

      const initializeMessage: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: {
            name: 'claude-code',
            version: '1.0.0',
            title: 'Claude Code',
          },
        },
      };

      // Simulate initialize request processing
      if (proxy['stdioTransport'].onmessage) {
        await proxy['stdioTransport'].onmessage!(initializeMessage);
      }

      // Verify transport was NOT recreated (same instance)
      expect(proxy['httpTransport']).toBe(initialTransport);

      // Verify old transport was NOT closed
      expect(initialTransport.close).not.toHaveBeenCalled();
    });

    it('should use custom fetch that dynamically injects User-Agent', async () => {
      proxy = new StdioProxyTransport({
        serverUrl: 'http://localhost:3050/mcp',
      });

      await proxy.start();

      const initializeMessage: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: {
            name: 'vscode-mcp',
            version: '2.1.0',
            title: 'VSCode MCP',
          },
        },
      };

      // Simulate initialize request processing
      if (proxy['stdioTransport'].onmessage) {
        await proxy['stdioTransport'].onmessage!(initializeMessage);
      }

      // Verify client info was extracted
      expect(proxy['clientInfo']).toEqual({
        name: 'vscode-mcp',
        version: '2.1.0',
        title: 'VSCode MCP',
      });

      // Verify buildUserAgent returns updated User-Agent
      const userAgent = proxy['buildUserAgent']();
      expect(userAgent).toContain('vscode-mcp/2.1.0 (VSCode MCP)');
    });

    it('should inject updated User-Agent for all HTTP requests after client info extraction', async () => {
      proxy = new StdioProxyTransport({
        serverUrl: 'http://localhost:3050/mcp',
      });

      // Verify the custom fetch function is created and used
      const customFetch = proxy['createDynamicHeaderFetch']();
      expect(customFetch).toBeDefined();
      expect(typeof customFetch).toBe('function');

      // Test the custom fetch function directly
      const mockResponse = new Response(null, { status: 200 });
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      // Before client info extraction
      await customFetch('http://test.com', { headers: { 'X-Test': 'value' } });
      let fetchCall = (global.fetch as any).mock.calls[0];
      let headers = new Headers(fetchCall[1].headers);
      expect(headers.get('User-Agent')).toMatch(/^1MCP-Proxy\/[\d.]+(?:-[a-zA-Z0-9.]+)?$/);
      expect(headers.get('X-Test')).toBe('value');

      // Extract client info
      proxy['clientInfo'] = {
        name: 'claude-code',
        version: '1.0.0',
        title: 'Claude Code',
      };

      // After client info extraction
      await customFetch('http://test.com', { headers: { 'X-Test': 'value2' } });
      fetchCall = (global.fetch as any).mock.calls[1];
      headers = new Headers(fetchCall[1].headers);
      expect(headers.get('User-Agent')).toMatch(
        /^1MCP-Proxy\/[\d.]+(?:-[a-zA-Z0-9.]+)? claude-code\/1\.0\.0 \(Claude Code\)$/,
      );
      expect(headers.get('X-Test')).toBe('value2');

      // Restore original fetch
      global.fetch = originalFetch;
    });

    it('should handle initialize followed by tools/list without transport closed error', async () => {
      proxy = new StdioProxyTransport({
        serverUrl: 'http://localhost:3050/mcp',
      });

      await proxy.start();

      // Send initialize request
      const initializeMessage: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: {
            name: 'claude-code',
            version: '1.0.0',
            title: 'Claude Code',
          },
        },
      };

      if (proxy['stdioTransport'].onmessage) {
        await proxy['stdioTransport'].onmessage!(initializeMessage);
      }

      // Immediately send tools/list request
      const toolsListMessage: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      };

      // This should not throw "Transport closed" error
      if (proxy['stdioTransport'].onmessage) {
        await expect(proxy['stdioTransport'].onmessage!(toolsListMessage)).resolves.not.toThrow();
      }

      // Verify both messages were sent through HTTP transport
      expect(proxy['httpTransport'].send).toHaveBeenCalledTimes(2);
    });
  });
});
