import type { ContextData } from '@src/types/context.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StdioProxyTransport } from './stdioProxyTransport.js';

// Mock the MCP SDK modules
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    onmessage: null,
    onclose: null,
    onerror: null,
  })),
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    onmessage: null,
    onclose: null,
    onerror: null,
  })),
}));

describe('StdioProxyTransport - Context Support', () => {
  const mockServerUrl = 'http://localhost:3051/mcp';
  let mockContext: ContextData;

  beforeEach(() => {
    vi.clearAllMocks();
    mockContext = {
      project: {
        path: '/Users/test/project',
        name: 'test-project',
        environment: 'development',
        git: {
          branch: 'main',
          commit: 'abc12345',
          repository: 'test/repo',
          isRepo: true,
        },
        custom: {
          team: 'platform',
          version: '1.0.0',
        },
      },
      user: {
        username: 'testuser',
        name: 'Test User',
        email: 'test@example.com',
        home: '/Users/testuser',
      },
      environment: {
        variables: {
          NODE_ENV: 'test',
        },
      },
      timestamp: '2024-01-01T00:00:00.000Z',
      sessionId: 'ctx_test123',
      version: 'v1',
    };
  });

  describe('constructor', () => {
    it('should create transport without context', () => {
      const transport = new StdioProxyTransport({
        serverUrl: mockServerUrl,
      });
      expect(transport).toBeDefined();
    });

    it('should create transport with context', () => {
      const transport = new StdioProxyTransport({
        serverUrl: mockServerUrl,
        context: mockContext,
      });
      expect(transport).toBeDefined();
    });

    it('should accept context along with other options', () => {
      const transport = new StdioProxyTransport({
        serverUrl: mockServerUrl,
        preset: 'test-preset',
        filter: 'web',
        tags: ['tag1', 'tag2'],
        context: mockContext,
        timeout: 5000,
      });
      expect(transport).toBeDefined();
    });
  });

  describe('context header creation', () => {
    // We can't directly test private method, but we can test the constructor
    // which calls createContextHeaders
    it('should handle context with all fields', async () => {
      const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
      const mockCreate = vi.mocked(StreamableHTTPClientTransport);

      new StdioProxyTransport({
        serverUrl: mockServerUrl,
        context: mockContext,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({
          requestInit: expect.objectContaining({
            headers: expect.objectContaining({
              'X-1MCP-Context': expect.any(String),
              'X-1MCP-Context-Version': 'v1',
              'X-1MCP-Context-Session': 'ctx_test123',
              'X-1MCP-Context-Timestamp': '2024-01-01T00:00:00.000Z',
            }),
          }),
        }),
      );
    });

    it('should handle minimal context', async () => {
      const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
      const mockCreate = vi.mocked(StreamableHTTPClientTransport);

      const minimalContext: ContextData = {
        project: {},
        user: {},
        environment: {},
        version: 'v1',
      };

      new StdioProxyTransport({
        serverUrl: mockServerUrl,
        context: minimalContext,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({
          requestInit: expect.objectContaining({
            headers: expect.objectContaining({
              'X-1MCP-Context': expect.any(String),
              'X-1MCP-Context-Version': 'v1',
            }),
          }),
        }),
      );
    });

    it('should not add context headers when no context provided', async () => {
      const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
      const mockCreate = vi.mocked(StreamableHTTPClientTransport);

      new StdioProxyTransport({
        serverUrl: mockServerUrl,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({
          requestInit: expect.objectContaining({
            headers: expect.objectContaining({
              'User-Agent': expect.any(String),
            }),
          }),
        }),
      );

      const callArgs = mockCreate.mock.calls[0];
      const headers = (callArgs[1] as any).requestInit.headers;
      expect(headers).not.toHaveProperty('X-1MCP-Context');
    });
  });

  describe('context encoding', () => {
    it('should properly encode context as base64', async () => {
      const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
      const mockCreate = vi.mocked(StreamableHTTPClientTransport);

      new StdioProxyTransport({
        serverUrl: mockServerUrl,
        context: mockContext,
      });

      const callArgs = mockCreate.mock.calls[0];
      const headers = (callArgs[1] as any).requestInit.headers;
      const contextHeader = headers['X-1MCP-Context'];

      // Verify it's a valid base64 string
      expect(contextHeader).toMatch(/^[A-Za-z0-9+/]+=*$/);

      // Verify it can be decoded back
      const decoded = Buffer.from(contextHeader, 'base64').toString('utf-8');
      const parsed = JSON.parse(decoded);
      expect(parsed).toEqual(mockContext);
    });
  });

  describe('priority with other options', () => {
    it('should still respect preset priority', async () => {
      const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
      const mockCreate = vi.mocked(StreamableHTTPClientTransport);

      new StdioProxyTransport({
        serverUrl: mockServerUrl,
        preset: 'my-preset',
        context: mockContext,
      });

      const url = mockCreate.mock.calls[0][0] as URL;
      expect(url.searchParams.get('preset')).toBe('my-preset');
    });

    it('should still respect filter priority', async () => {
      const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
      const mockCreate = vi.mocked(StreamableHTTPClientTransport);

      new StdioProxyTransport({
        serverUrl: mockServerUrl,
        filter: 'web AND api',
        context: mockContext,
      });

      const url = mockCreate.mock.calls[0][0] as URL;
      expect(url.searchParams.get('filter')).toBe('web AND api');
    });

    it('should still respect tags priority', async () => {
      const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
      const mockCreate = vi.mocked(StreamableHTTPClientTransport);

      new StdioProxyTransport({
        serverUrl: mockServerUrl,
        tags: ['web', 'api'],
        context: mockContext,
      });

      const url = mockCreate.mock.calls[0][0] as URL;
      expect(url.searchParams.get('tags')).toBe('web,api');
    });
  });
});
