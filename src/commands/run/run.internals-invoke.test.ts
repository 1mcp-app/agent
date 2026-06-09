import os from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getCliSessionCachePath, invokeTool } from './run.js';

const mockedResolveProjectContext = vi.hoisted(() => vi.fn());

vi.mock('@src/config/projectConfigLoader.js', async () => {
  const actual = await vi.importActual<typeof import('@src/config/projectConfigLoader.js')>(
    '@src/config/projectConfigLoader.js',
  );
  return {
    ...actual,
    resolveProjectContext: mockedResolveProjectContext,
  };
});

vi.mock('@src/commands/shared/authProfileStore.js', () => ({
  loadAuthProfile: vi.fn(async () => null),
  normalizeServerUrl: vi.fn((url: string) => url),
}));

const transportState = vi.hoisted(() => ({
  callResult: {
    content: [{ type: 'text', text: 'ok' }],
  },
  sessionIdOnInitialize: 'fresh-session',
  throw404OnMethod: undefined as string | undefined,
  toolName: 'runner_1mcp_echo_args',
  instances: [] as Array<{
    initialSessionId?: string;
    sentMessages: Array<{ method?: string; params?: Record<string, unknown> }>;
  }>,
}));

const mockedTransport = vi.hoisted(() => {
  class MockStreamableHTTPError extends Error {
    code: number;

    constructor(code: number, message: string) {
      super(message);
      this.code = code;
    }
  }

  class MockStreamableHTTPClientTransport {
    onmessage?: (message: unknown) => void;
    onerror?: (error: Error) => void;
    onclose?: () => void;
    sessionId?: string;
    initialSessionId?: string;
    sentMessages: Array<{ method?: string; params?: Record<string, unknown> }> = [];

    constructor(_url: URL, options?: { sessionId?: string }) {
      this.sessionId = options?.sessionId;
      this.initialSessionId = options?.sessionId;
      transportState.instances.push(this);
    }

    async start(): Promise<void> {}

    async close(): Promise<void> {}

    setProtocolVersion(_version: string): void {}

    async send(message: { id?: number; method?: string; params?: Record<string, unknown> }): Promise<void> {
      this.sentMessages.push({ method: message.method, params: message.params });

      if (message.method && transportState.throw404OnMethod === message.method && this.sessionId) {
        throw new MockStreamableHTTPError(404, 'Session not found');
      }

      if (message.id === undefined || !message.method) {
        return;
      }

      switch (message.method) {
        case 'initialize':
          this.sessionId = this.sessionId ?? transportState.sessionIdOnInitialize;
          this.onmessage?.({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              protocolVersion: '2025-06-18',
            },
          });
          break;
        case 'tools/list':
          this.onmessage?.({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              tools: [
                {
                  name: transportState.toolName,
                  description: 'mock tool',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      message: { type: 'string' },
                    },
                  },
                },
              ],
            },
          });
          break;
        case 'tools/call':
          this.onmessage?.({
            jsonrpc: '2.0',
            id: message.id,
            result: transportState.callResult,
          });
          break;
        default:
          this.onmessage?.({
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32601,
              message: `Unhandled mock method: ${message.method}`,
            },
          });
      }
    }
  }

  return {
    MockStreamableHTTPClientTransport,
    MockStreamableHTTPError,
  };
});

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: mockedTransport.MockStreamableHTTPClientTransport,
  StreamableHTTPError: mockedTransport.MockStreamableHTTPError,
}));

vi.mock('@src/utils/validation/urlDetection.js', () => ({
  discoverServerWithPidFile: vi.fn(async () => ({ url: 'http://127.0.0.1:3050/mcp', source: 'pidfile', pid: 4242 })),
  validateServer1mcpUrl: vi.fn(async () => ({ valid: true })),
}));

describe('run command internals', () => {
  beforeEach(() => {
    transportState.callResult = {
      content: [{ type: 'text', text: 'ok' }],
    };
    transportState.sessionIdOnInitialize = 'fresh-session';
    transportState.throw404OnMethod = undefined;
    transportState.toolName = 'runner_1mcp_echo_args';
    transportState.instances = [];
    mockedResolveProjectContext.mockReset();
    mockedResolveProjectContext.mockResolvedValue({
      cwd: '/tmp/project',
      projectRoot: '/tmp/project',
      projectName: 'project',
      projectConfig: null,
      source: 'cwd',
    });
  });

  describe('invokeTool', () => {
    it('initializes a fresh session before calling the tool', async () => {
      const initializeContext = {
        project: { name: 'agent', path: '/tmp/agent' },
        user: { username: 'tester' },
        environment: { variables: { FOO: 'bar' } },
        transport: { type: 'run' },
      };
      const response = await invokeTool({
        serverUrl: new URL('http://127.0.0.1:3050/mcp'),
        displayToolName: 'runner/echo_args',
        qualifiedToolName: 'runner_1mcp_echo_args',
        explicitArgs: '{"message":"hello"}',
        resolveTool: false,
        initializeContext,
      });

      expect(response.retryWithFreshSession).toBe(false);
      expect(response.sessionId).toBe('fresh-session');
      expect(transportState.instances).toHaveLength(1);
      expect(transportState.instances[0].sentMessages.map((message) => message.method)).toEqual([
        'initialize',
        'notifications/initialized',
        'tools/call',
      ]);
      expect(transportState.instances[0].sentMessages[0].params?._meta).toEqual({
        context: initializeContext,
      });
    });

    it('validates the requested tool before using a cached session', async () => {
      const response = await invokeTool({
        serverUrl: new URL('http://127.0.0.1:3050/mcp'),
        sessionId: 'cached-session',
        displayToolName: 'runner/echo_args',
        qualifiedToolName: 'runner_1mcp_echo_args',
        explicitArgs: '{"message":"hello"}',
        resolveTool: false,
      });

      expect(response.retryWithFreshSession).toBe(false);
      expect(response.sessionId).toBe('cached-session');
      expect(transportState.instances[0].sentMessages.map((message) => message.method)).toEqual([
        'tools/list',
        'tools/call',
      ]);
    });

    it('retries with a fresh session when a cached session does not expose the requested tool', async () => {
      transportState.toolName = 'runner_1mcp_different_tool';

      const response = await invokeTool({
        serverUrl: new URL('http://127.0.0.1:3050/mcp'),
        sessionId: 'cached-session',
        displayToolName: 'serena/list_memories',
        qualifiedToolName: 'serena_1mcp_list_memories',
        explicitArgs: '{}',
        resolveTool: false,
      });

      expect(response.retryWithFreshSession).toBe(true);
      expect(response.sessionId).toBeUndefined();
      expect('error' in response.rawResponse && response.rawResponse.error.message).toBe(
        'Cached session missing requested tool.',
      );
    });

    it('requests a retry with a fresh session when a cached session 404s', async () => {
      transportState.throw404OnMethod = 'tools/call';

      const response = await invokeTool({
        serverUrl: new URL('http://127.0.0.1:3050/mcp'),
        sessionId: 'stale-session',
        displayToolName: 'runner/echo_args',
        qualifiedToolName: 'runner_1mcp_echo_args',
        explicitArgs: '{"message":"hello"}',
        resolveTool: false,
      });

      expect(response.retryWithFreshSession).toBe(true);
      expect(response.sessionId).toBeUndefined();
      expect('error' in response.rawResponse && response.rawResponse.error.message).toBe('Cached session expired.');
    });
  });

  describe('cache path resolution', () => {
    it('uses the temp-based default with server pid', () => {
      expect(getCliSessionCachePath({ serverPid: 4242 })).toBe(join(os.tmpdir(), '1mcp', '.cli-session.4242'));
    });

    it('falls back to unknown when no pid is available', () => {
      expect(getCliSessionCachePath()).toBe(join(os.tmpdir(), '1mcp', '.cli-session.unknown'));
    });

    it('uses a stable server-url token when no pid is available in the default path', () => {
      const cachePath = getCliSessionCachePath({ serverUrl: 'http://127.0.0.1:3050/mcp' });
      expect(cachePath.startsWith(join(os.tmpdir(), '1mcp', '.cli-session.server-'))).toBe(true);
      expect(cachePath).toBe(getCliSessionCachePath({ serverUrl: 'http://127.0.0.1:3050/mcp' }));
    });

    it('expands {pid} in explicit cache templates', () => {
      expect(getCliSessionCachePath({ cachePathTemplate: '/tmp/custom/.cli-session.{pid}', serverPid: 99 })).toBe(
        '/tmp/custom/.cli-session.99',
      );
    });
  });
});
