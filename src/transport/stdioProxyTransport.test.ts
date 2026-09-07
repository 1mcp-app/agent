import { PROTOCOL_VERSION_META_KEY, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

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

vi.mock('@modelcontextprotocol/client', () => ({
  PROTOCOL_VERSION_META_KEY: 'io.modelcontextprotocol/protocolVersion',
  StreamableHTTPClientTransport: vi.fn(function () {
    return {
      start: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue(undefined),
      setProtocolVersion: vi.fn(),
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

    it('should use provided context when passed in', () => {
      proxy = new StdioProxyTransport({
        serverUrl: 'http://localhost:3050/mcp',
        context: {
          project: { path: '/tmp/custom', name: 'custom' },
          user: { username: 'tester' },
          environment: { variables: { PWD: '/tmp/custom' } },
          sessionId: 'stream-custom',
          version: 'custom-version',
          transport: { type: 'stdio-proxy' },
        },
      });

      expect(proxy['context']).toMatchObject({
        project: { path: '/tmp/custom', name: 'custom' },
        sessionId: 'stream-custom',
        version: 'custom-version',
      });
    });

    it('rejects redirects before forwarding proof-bearing requests', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response());
      proxy = new StdioProxyTransport({
        serverUrl: 'https://runtime.example.com/mcp',
      });
      const [, options] = vi.mocked(StreamableHTTPClientTransport).mock.calls[0] as [URL, { fetch: typeof fetch }];

      await options.fetch('https://runtime.example.com/mcp', { redirect: 'follow' });

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://runtime.example.com/mcp',
        expect.objectContaining({ redirect: 'error' }),
      );
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

    it('closes a started HTTP hop when the stdio hop fails to start', async () => {
      proxy = new StdioProxyTransport({ serverUrl: 'http://localhost:3050/mcp' });
      vi.mocked(proxy['stdioTransport'].start).mockRejectedValueOnce(new Error('stdio unavailable'));

      await expect(proxy.start()).rejects.toThrow('stdio unavailable');
      await proxy.close();

      expect(proxy['httpTransport'].close).toHaveBeenCalledOnce();
      expect(proxy['stdioTransport'].close).toHaveBeenCalledOnce();
      expect(proxy['httpTransport'].onmessage).toBeUndefined();
      expect(proxy['stdioTransport'].onmessage).toBeUndefined();
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
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
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

    it('preserves modern discovery evidence while adding proxy context', async () => {
      proxy = new StdioProxyTransport({ serverUrl: 'http://localhost:3050/mcp' });
      await proxy.start();

      await proxy['stdioTransport'].onmessage!({
        jsonrpc: '2.0',
        method: 'server/discover',
        id: 7,
        params: {
          _meta: {
            [PROTOCOL_VERSION_META_KEY]: '2026-07-28',
            'io.modelcontextprotocol/client-info': { name: 'modern-client', version: '2.0.0' },
            'io.modelcontextprotocol/client-capabilities': {},
          },
        },
      } as never);

      expect(proxy['httpTransport'].send).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'server/discover',
          params: expect.objectContaining({
            _meta: expect.objectContaining({
              [PROTOCOL_VERSION_META_KEY]: '2026-07-28',
              context: expect.any(Object),
            }),
          }),
        }),
      );
      expect(proxy['downstreamPin']).toEqual({ era: 'modern', revision: '2026-07-28' });
    });

    it('pins legacy initialize and rejects a later modern frame', async () => {
      proxy = new StdioProxyTransport({ serverUrl: 'http://localhost:3050/mcp' });
      await proxy.start();
      await proxy['stdioTransport'].onmessage!({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 1,
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'legacy', version: '1' } },
      });
      await proxy['stdioTransport'].onmessage!({
        jsonrpc: '2.0',
        method: 'server/discover',
        id: 2,
        params: { _meta: { [PROTOCOL_VERSION_META_KEY]: '2026-07-28' } },
      } as never);

      expect(proxy['downstreamPin']).toEqual({ era: 'legacy', revision: '2025-11-25' });
      expect(proxy['httpTransport'].send).toHaveBeenCalledTimes(1);
      expect(proxy['stdioTransport'].send).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        id: 2,
        error: {
          code: -32_600,
          message: 'Proxy protocol negotiation failed',
          data: { code: 'proxy_protocol_era_conflict' },
        },
      });
      expect(proxy['httpTransport'].close).toHaveBeenCalledOnce();
      expect(proxy['stdioTransport'].close).toHaveBeenCalledOnce();
    });

    it('rejects malformed first-frame evidence without pinning or fallback', async () => {
      proxy = new StdioProxyTransport({ serverUrl: 'http://localhost:3050/mcp' });
      await proxy.start();

      await proxy['stdioTransport'].onmessage!({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 1,
        params: { protocolVersion: 'future', capabilities: {}, clientInfo: { name: 'bad', version: '1' } },
      });

      expect(proxy['downstreamPin']).toBeUndefined();
      expect(proxy['httpTransport'].send).not.toHaveBeenCalled();
      expect(proxy['stdioTransport'].send).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32_600,
          message: 'Proxy protocol negotiation failed',
          data: { code: 'legacy_protocol_invalid' },
        },
      });
      expect(proxy['httpTransport'].close).toHaveBeenCalledOnce();
      expect(proxy['stdioTransport'].close).toHaveBeenCalledOnce();
    });

    it.each([
      ['notification', {}, null],
      ['undefined ID', { id: undefined }, null],
      ['null ID', { id: null }, null],
      ['boolean ID', { id: false }, null],
      ['object ID', { id: {} }, null],
      ['zero ID', { id: 0 }, 0],
      ['empty string ID', { id: '' }, ''],
    ])('returns a usable error ID for a protocol-invalid %s', async (_label, fields, expectedId) => {
      proxy = new StdioProxyTransport({ serverUrl: 'http://localhost:3050/mcp' });
      await proxy.start();

      await proxy['stdioTransport'].onmessage!({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        ...fields,
      } as never);

      expect(proxy['httpTransport'].send).not.toHaveBeenCalled();
      expect(proxy['stdioTransport'].send).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        id: expectedId,
        error: {
          code: -32_600,
          message: 'Proxy protocol negotiation failed',
          data: { code: 'proxy_protocol_evidence_missing' },
        },
      });
      expect(proxy['httpTransport'].close).toHaveBeenCalledOnce();
      expect(proxy['stdioTransport'].close).toHaveBeenCalledOnce();
    });

    it.each([false, true])(
      'keeps authentication errors classification-neutral with a pinned session: %s',
      async (pinned) => {
        proxy = new StdioProxyTransport({ serverUrl: 'http://localhost:3050/mcp' });
        await proxy.start();
        if (pinned) {
          await proxy['stdioTransport'].onmessage!({
            jsonrpc: '2.0',
            method: 'initialize',
            id: 1,
            params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'legacy', version: '1' } },
          });
        }
        const response = { jsonrpc: '2.0', id: 1, error: { code: -32_000, message: 'Unauthorized' } } as const;

        await proxy['httpTransport'].onmessage!(response);

        expect(proxy['downstreamPin']).toEqual(pinned ? { era: 'legacy', revision: '2025-11-25' } : undefined);
        expect(proxy['httpTransport'].setProtocolVersion).not.toHaveBeenCalled();
        expect(proxy['stdioTransport'].send).toHaveBeenCalledWith(response);
      },
    );

    it('applies the negotiated legacy revision after initialize succeeds', async () => {
      proxy = new StdioProxyTransport({ serverUrl: 'http://localhost:3050/mcp' });
      await proxy.start();
      await proxy['stdioTransport'].onmessage!({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 11,
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'legacy', version: '1' } },
      });
      await proxy['httpTransport'].onmessage!({
        jsonrpc: '2.0',
        id: 11,
        result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'server', version: '1' } },
      });

      expect(proxy['httpTransport'].setProtocolVersion).toHaveBeenCalledWith('2025-06-18');
      expect(proxy['downstreamPin']).toEqual({ era: 'legacy', revision: '2025-06-18' });
    });

    it('should sign the context after adding downstream client identity', async () => {
      const createContextProof = vi.fn(async (context) => ({
        version: 1 as const,
        runtimeScopeId: 'scope-a',
        sessionId: context.sessionId!,
        contextHash: 'context-hash',
        issuedAt: '2026-08-05T00:00:00.000Z',
        signature: 'signature',
      }));
      proxy = new StdioProxyTransport({
        serverUrl: 'http://localhost:3050/mcp',
        context: {
          project: { path: '/tmp/custom', name: 'custom' },
          user: { username: 'tester' },
          environment: { variables: {} },
          sessionId: 'stream-custom',
          transport: { type: 'stdio-proxy' },
        },
        createContextProof,
      });

      await proxy.start();
      await proxy['stdioTransport'].onmessage!({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 1,
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'claude-code', version: '1.0.0', title: 'Claude Code' },
        },
      });

      expect(createContextProof).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'stream-custom',
          transport: expect.objectContaining({
            type: 'stdio-proxy',
            client: { name: 'claude-code', version: '1.0.0', title: 'Claude Code' },
          }),
        }),
      );
      expect(proxy['httpTransport'].send).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            _meta: expect.objectContaining({
              contextProof: expect.objectContaining({ signature: 'signature' }),
            }),
          }),
        }),
      );
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
