import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StdioProxyTransport } from './stdioProxyTransport.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

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
    it('should forward messages from STDIO to HTTP', async () => {
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

      // Verify forwarded to HTTP transport
      expect(proxy['httpTransport'].send).toHaveBeenCalledWith(message);
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
});
