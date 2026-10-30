import os from 'node:os';
import { join } from 'node:path';

import { SchemaBoundaryError } from '@src/core/validation/schemaBoundary.js';
import { SCHEMA_LIMITS } from '@src/core/validation/schemaPolicy.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getCliSessionCachePath, invokeTool } from './run.js';

// Session routing controls the asynchronous preflight boundary. Real worker validation
// remains covered by runUtils.schema.test.ts and schemaBoundary.test.ts.
const schemaSeam = vi.hoisted(() => ({ admit: vi.fn(), evaluate: vi.fn() }));
vi.mock('@src/core/validation/schemaBoundary.js', async () => {
  const actual = await vi.importActual<typeof import('@src/core/validation/schemaBoundary.js')>(
    '@src/core/validation/schemaBoundary.js',
  );
  return { ...actual, schemaBoundary: schemaSeam };
});

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
  callError: undefined as { code: number; message: string } | undefined,
  sessionIdOnInitialize: 'fresh-session',
  throw404OnMethod: undefined as string | undefined,
  ignoreMethod: undefined as string | undefined,
  toolName: 'runner_1mcp_echo_args',
  instances: [] as Array<{
    initialSessionId?: string;
    closed: boolean;
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

    closed = false;

    async close(): Promise<void> {
      this.closed = true;
    }

    setProtocolVersion(_version: string): void {}

    async send(message: { id?: number; method?: string; params?: Record<string, unknown> }): Promise<void> {
      this.sentMessages.push({ method: message.method, params: message.params });

      if (message.method && transportState.throw404OnMethod === message.method && this.sessionId) {
        throw new MockStreamableHTTPError(404, 'Session not found');
      }

      if (message.method === transportState.ignoreMethod) return;

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
            ...(transportState.callError ? { error: transportState.callError } : { result: transportState.callResult }),
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
    schemaSeam.admit.mockReset().mockImplementation(async (schema, binding) => ({ source: schema, ...binding }));
    schemaSeam.evaluate.mockReset().mockResolvedValue({ valid: true });
    transportState.callResult = {
      content: [{ type: 'text', text: 'ok' }],
    };
    transportState.callError = undefined;
    transportState.sessionIdOnInitialize = 'fresh-session';
    transportState.throw404OnMethod = undefined;
    transportState.ignoreMethod = undefined;
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
    it('delivers accepted large results through the MCP fallback', async () => {
      transportState.callResult = { content: [{ type: 'text', text: 'x'.repeat(1_000_001) }] };
      const response = await invokeTool({
        serverUrl: new URL('http://127.0.0.1:3050/mcp'),
        displayToolName: 'runner/echo_args',
        qualifiedToolName: 'runner_1mcp_echo_args',
        explicitArgs: '{}',
        resolveTool: false,
      });
      expect(response.rawResponse).toMatchObject({ result: transportState.callResult });
      expect(transportState.instances[0].closed).toBe(true);
    });

    it.each([-1, 0, 1])('enforces the serialized result byte budget at offset %s without replay', async (offset) => {
      const overhead = Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text: '' }] }));
      transportState.callResult = {
        content: [{ type: 'text', text: 'x'.repeat(SCHEMA_LIMITS.outputBytes - overhead + offset) }],
      };
      const response = await invokeTool({
        serverUrl: new URL('http://127.0.0.1:3050/mcp'),
        displayToolName: 'runner/echo_args',
        qualifiedToolName: 'runner_1mcp_echo_args',
        explicitArgs: '{}',
        resolveTool: false,
      });
      if (offset <= 0) expect(response.rawResponse).toHaveProperty('result', transportState.callResult);
      else
        expect('error' in response.rawResponse ? response.rawResponse.error : undefined).toMatchObject({
          code: -32000,
          message: 'schema_budget_exceeded',
          data: { 'app.1mcp/failure': { kind: 'protocol', code: 'schema_budget_exceeded' } },
        });
      expect(response.retryWithFreshSession).toBe(false);
      expect(transportState.instances).toHaveLength(1);
      expect(transportState.instances[0].sentMessages.filter(({ method }) => method === 'tools/call')).toHaveLength(1);
      expect(transportState.instances[0].closed).toBe(true);
    });

    it.each([
      ['界'.repeat(1_000_001), true],
      ['界'.repeat(1_400_000), false],
      ['\n'.repeat(2_100_000), false],
    ])('measures Unicode and escaping in serialized UTF-8 bytes (%#)', async (text, accepted) => {
      transportState.callResult = { content: [{ type: 'text', text }] };
      const response = await invokeTool({
        serverUrl: new URL('http://127.0.0.1:3050/mcp'),
        displayToolName: 'runner/echo_args',
        qualifiedToolName: 'runner_1mcp_echo_args',
        explicitArgs: '{}',
        resolveTool: false,
      });
      if (accepted) expect(response.rawResponse).toHaveProperty('result', transportState.callResult);
      else expect(response.rawResponse).toHaveProperty('error.message', 'schema_budget_exceeded');
      expect(response.retryWithFreshSession).toBe(false);
      expect(transportState.instances[0].sentMessages.filter(({ method }) => method === 'tools/call')).toHaveLength(1);
    });

    it('preserves protocol errors instead of applying the successful-result byte budget', async () => {
      transportState.callError = { code: -32005, message: 'x'.repeat(4 * 1024 * 1024 + 1) };
      const response = await invokeTool({
        serverUrl: new URL('http://127.0.0.1:3050/mcp'),
        displayToolName: 'runner/echo_args',
        qualifiedToolName: 'runner_1mcp_echo_args',
        explicitArgs: '{}',
        resolveTool: false,
      });
      expect(response.rawResponse).toHaveProperty('error', transportState.callError);
      expect(response.retryWithFreshSession).toBe(false);
    });

    it('does not convert malformed result errors into size failures', async () => {
      transportState.callResult = { content: [{ type: 'text', text: '\ud800' }] };
      await expect(
        invokeTool({
          serverUrl: new URL('http://127.0.0.1:3050/mcp'),
          displayToolName: 'runner/echo_args',
          qualifiedToolName: 'runner_1mcp_echo_args',
          explicitArgs: '{}',
          resolveTool: false,
        }),
      ).rejects.toMatchObject({ code: 'schema_invalid' });
      expect(transportState.instances[0].closed).toBe(true);
      expect(transportState.instances[0].sentMessages.filter(({ method }) => method === 'tools/call')).toHaveLength(1);
    });

    it('reports an uncertain execution deadline without replaying the MCP call', async () => {
      transportState.ignoreMethod = 'tools/call';
      const response = await invokeTool({
        serverUrl: new URL('http://127.0.0.1:3050/mcp'),
        displayToolName: 'runner/echo_args',
        qualifiedToolName: 'runner_1mcp_echo_args',
        explicitArgs: '{"message":"hello"}',
        resolveTool: false,
        timeoutMs: 20,
      });
      expect(response.retryWithFreshSession).toBe(false);
      expect(response.rawResponse).toMatchObject({
        error: {
          message: expect.stringContaining('The tool may still be running'),
          data: { 'app.1mcp/failure': { kind: 'deadline-exceeded', code: 'cli_tool_execution_timeout' } },
        },
      });
      expect(transportState.instances).toHaveLength(1);
      expect(
        transportState.instances[0].sentMessages.filter((message) => message.method === 'tools/call'),
      ).toHaveLength(1);
      expect(transportState.instances[0].closed).toBe(true);
    });

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
      let admissionEntered!: () => void;
      const admissionReady = new Promise<void>((resolve) => {
        admissionEntered = resolve;
      });
      let releaseAdmission!: () => void;
      const admissionVerdict = new Promise<void>((resolve) => {
        releaseAdmission = resolve;
      });
      schemaSeam.admit.mockImplementationOnce(async (schema, binding) => {
        admissionEntered();
        await admissionVerdict;
        return { source: schema, ...binding };
      });
      let entered!: () => void;
      const ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let release!: () => void;
      const verdict = new Promise<void>((resolve) => {
        release = resolve;
      });
      schemaSeam.evaluate.mockImplementationOnce(async () => {
        entered();
        await verdict;
        return { valid: true };
      });
      const pending = invokeTool({
        serverUrl: new URL('http://127.0.0.1:3050/mcp'),
        sessionId: 'cached-session',
        displayToolName: 'runner/echo_args',
        qualifiedToolName: 'runner_1mcp_echo_args',
        explicitArgs: '{"message":"hello"}',
        resolveTool: false,
      });
      const schema = { type: 'object', properties: { message: { type: 'string' } } };
      const binding = { routeKey: 'runner/echo_args', generation: 'cli-preflight', profile: 'tool-input' };
      await admissionReady;
      expect(transportState.instances[0].sentMessages.map((message) => message.method)).toEqual(['tools/list']);
      expect(schemaSeam.admit).toHaveBeenCalledWith(schema, binding);
      expect(schemaSeam.evaluate).not.toHaveBeenCalled();
      releaseAdmission();
      await ready;
      expect(transportState.instances[0].sentMessages.map((message) => message.method)).toEqual(['tools/list']);
      expect(schemaSeam.evaluate).toHaveBeenCalledWith({ source: schema, ...binding }, { message: 'hello' }, binding);
      release();
      const response = await pending;
      expect(response.rawResponse).toEqual({ jsonrpc: '2.0', id: 2, result: transportState.callResult });
      expect(response.retryWithFreshSession).toBe(false);
      expect(response.sessionId).toBe('cached-session');
      expect(transportState.instances[0].sentMessages.map((message) => message.method)).toEqual([
        'tools/list',
        'tools/call',
      ]);
    });

    it.each(['schema_input_invalid', 'schema_evaluation_timeout', 'schema_evaluation_unavailable'] as const)(
      'does not dispatch or retry when preflight returns %s',
      async (code) => {
        schemaSeam.evaluate.mockRejectedValueOnce(
          new SchemaBoundaryError(code, code !== 'schema_input_invalid', 'input'),
        );
        const response = await invokeTool({
          serverUrl: new URL('http://127.0.0.1:3050/mcp'),
          sessionId: 'cached-session',
          displayToolName: 'runner/echo_args',
          qualifiedToolName: 'runner_1mcp_echo_args',
          explicitArgs: '{"message":42}',
          resolveTool: false,
        });
        expect(response.retryWithFreshSession).toBe(false);
        expect(response.sessionId).toBe('cached-session');
        expect(transportState.instances[0].sentMessages.map((message) => message.method)).toEqual(['tools/list']);
        if (code === 'schema_input_invalid') {
          expect(response.rawResponse).toMatchObject({
            result: { isError: true, content: [{ type: 'text', text: 'schema_input_invalid' }] },
          });
        } else {
          expect(response.rawResponse).toMatchObject({ error: { code: -32000, message: code } });
        }
      },
    );
    it.each(['schema_compile_failed', 'schema_evaluation_timeout', 'schema_evaluation_unavailable'] as const)(
      'does not evaluate or dispatch when admission fails with %s',
      async (code) => {
        schemaSeam.admit.mockRejectedValueOnce(new SchemaBoundaryError(code));
        const response = await invokeTool({
          serverUrl: new URL('http://127.0.0.1:3050/mcp'),
          sessionId: 'cached-session',
          displayToolName: 'runner/echo_args',
          qualifiedToolName: 'runner_1mcp_echo_args',
          explicitArgs: '{"message":"hello"}',
          resolveTool: false,
        });
        expect(schemaSeam.evaluate).not.toHaveBeenCalled();
        expect(response.rawResponse).toMatchObject({ error: { code: -32000, message: code } });
        expect(response.retryWithFreshSession).toBe(false);
        expect(response.sessionId).toBe('cached-session');
        expect(transportState.instances[0].sentMessages.map((message) => message.method)).toEqual(['tools/list']);
      },
    );

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

    it('does not retry a cached-session 404 after Tool dispatch may have started', async () => {
      transportState.throw404OnMethod = 'tools/call';
      await expect(
        invokeTool({
          serverUrl: new URL('http://127.0.0.1:3050/mcp'),
          sessionId: 'stale-session',
          displayToolName: 'runner/echo_args',
          qualifiedToolName: 'runner_1mcp_echo_args',
          explicitArgs: '{"message":"hello"}',
          resolveTool: false,
        }),
      ).rejects.toThrow('Session not found');
    });
  });

  describe('cache path resolution', () => {
    it('uses the temp-based default with server pid', () => {
      expect(getCliSessionCachePath({ serverPid: 4242 })).toBe(join(os.tmpdir(), '1mcp', '.cli-session.4242.default'));
    });

    it('falls back to unknown when no pid is available', () => {
      expect(getCliSessionCachePath()).toBe(join(os.tmpdir(), '1mcp', '.cli-session.unknown.default'));
    });

    it('uses a stable server-url token when no pid is available in the default path', () => {
      const cachePath = getCliSessionCachePath({ serverUrl: 'http://127.0.0.1:3050/mcp' });
      expect(cachePath.startsWith(join(os.tmpdir(), '1mcp', '.cli-session.server-'))).toBe(true);
      expect(cachePath).toBe(getCliSessionCachePath({ serverUrl: 'http://127.0.0.1:3050/mcp' }));
    });

    it('scopes the default cache by target URL and context hash', () => {
      const grafanaPath = getCliSessionCachePath({
        serverPid: 4242,
        serverUrl: 'http://127.0.0.1:3050/mcp?tags=grafana',
        contextHash: 'context-a',
      });
      const presetPath = getCliSessionCachePath({
        serverPid: 4242,
        serverUrl: 'http://127.0.0.1:3050/mcp?preset=dev-backend',
        contextHash: 'context-a',
      });
      const otherContextPath = getCliSessionCachePath({
        serverPid: 4242,
        serverUrl: 'http://127.0.0.1:3050/mcp?tags=grafana',
        contextHash: 'context-b',
      });

      expect(grafanaPath).not.toBe(presetPath);
      expect(grafanaPath).not.toBe(otherContextPath);
      expect(grafanaPath).toBe(
        getCliSessionCachePath({
          serverPid: 4242,
          serverUrl: 'http://127.0.0.1:3050/mcp?tags=grafana',
          contextHash: 'context-a',
        }),
      );
    });

    it('expands {pid} in explicit cache templates', () => {
      expect(getCliSessionCachePath({ cachePathTemplate: '/tmp/custom/.cli-session.{pid}', serverPid: 99 })).toBe(
        '/tmp/custom/.cli-session.99',
      );
    });

    it('expands {scope} in explicit cache templates when requested', () => {
      const cachePath = getCliSessionCachePath({
        cachePathTemplate: '/tmp/custom/.cli-session.{pid}.{scope}',
        serverPid: 99,
        serverUrl: 'http://127.0.0.1:3050/mcp?tags=grafana',
        contextHash: 'context-a',
      });

      expect(cachePath).toMatch(/^\/tmp\/custom\/\.cli-session\.99\.[0-9a-f]{12}$/);
    });
  });
});
