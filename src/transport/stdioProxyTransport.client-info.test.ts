import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StdioProxyTransport } from './stdioProxyTransport.js';

// Mock the SDK transports
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(function () {
    return {
      start: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue(undefined),
      onmessage: undefined,
      onerror: undefined,
      onclose: undefined,
    };
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn(function () {
    return {
      start: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue(undefined),
      onmessage: undefined,
      onerror: undefined,
      onclose: undefined,
    };
  }),
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

    it('should inject bearer token when proxy attachment supplies auth', async () => {
      proxy = new StdioProxyTransport({
        serverUrl: 'http://localhost:3050/mcp',
        bearerToken: 'secret-token',
      });

      const customFetch = proxy['createDynamicHeaderFetch']();
      const mockResponse = new Response(null, { status: 200 });
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      await customFetch('http://test.com', { headers: { Authorization: 'Bearer stale' } });

      const fetchCall = (global.fetch as any).mock.calls[0];
      const headers = new Headers(fetchCall[1].headers);
      expect(headers.get('Authorization')).toBe('Bearer secret-token');

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
