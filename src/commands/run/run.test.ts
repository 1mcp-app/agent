import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildServerUrl,
  getCliSessionCachePath,
  invokeTool,
  readCliSessionCache,
  SESSION_CACHE_TTL_MS,
  writeCliSessionCache,
} from './run.js';

const mockedLoadProjectConfig = vi.hoisted(() => vi.fn());

vi.mock('@src/config/projectConfigLoader.js', async () => {
  const actual = await vi.importActual<typeof import('@src/config/projectConfigLoader.js')>(
    '@src/config/projectConfigLoader.js',
  );
  return {
    ...actual,
    loadProjectConfig: mockedLoadProjectConfig,
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
  instances: [] as Array<{ sentMessages: Array<{ method?: string; params?: Record<string, unknown> }> }>,
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
    sentMessages: Array<{ method?: string; params?: Record<string, unknown> }> = [];

    constructor(_url: URL, options?: { sessionId?: string }) {
      this.sessionId = options?.sessionId;
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
          this.sessionId = transportState.sessionIdOnInitialize;
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
    mockedLoadProjectConfig.mockReset();
    mockedLoadProjectConfig.mockResolvedValue(null);
  });

  describe('buildServerUrl', () => {
    it('prefers preset over all other query selectors', () => {
      const url = buildServerUrl('http://127.0.0.1:3050/mcp', {
        preset: 'dev',
        filter: 'a && b',
        tags: ['x', 'y'],
        'tag-filter': 'foo',
      });

      expect(url.searchParams.get('preset')).toBe('dev');
      expect(url.searchParams.has('filter')).toBe(false);
      expect(url.searchParams.has('tags')).toBe(false);
      expect(url.searchParams.has('tag-filter')).toBe(false);
    });

    it('applies tags when no higher-priority selector is present', () => {
      const url = buildServerUrl('http://127.0.0.1:3050/mcp', {
        tags: ['alpha', 'beta'],
      });

      expect(url.searchParams.get('tags')).toBe('alpha,beta');
    });
  });

  describe('session cache', () => {
    let cacheDir: string;
    let cachePath: string;

    beforeEach(async () => {
      const baseDir = join(process.cwd(), '.tmp-test', 'run-command-unit');
      await mkdir(baseDir, { recursive: true });
      cacheDir = await mkdtemp(join(baseDir, 'cache-'));
      cachePath = join(cacheDir, '.cli-session.4242');
    });

    afterEach(async () => {
      await rm(cacheDir, { recursive: true, force: true });
    });

    it('writes and reads a matching non-expired cache entry', async () => {
      await writeCliSessionCache(cachePath, {
        sessionId: 'session-1',
        serverUrl: 'http://127.0.0.1:3050/mcp?preset=dev',
        savedAt: Date.now(),
        hasRestEndpoint: false,
      });

      const entries = await readdir(cacheDir);
      expect(entries).toEqual(['.cli-session.4242']);

      const cache = await readCliSessionCache(cachePath, 'http://127.0.0.1:3050/mcp?preset=dev');
      expect(cache?.sessionId).toBe('session-1');
    });

    it('returns null for expired cache entries', async () => {
      await writeCliSessionCache(cachePath, {
        sessionId: 'session-1',
        serverUrl: 'http://127.0.0.1:3050/mcp',
        savedAt: Date.now() - SESSION_CACHE_TTL_MS - 1,
        hasRestEndpoint: false,
      });

      const cache = await readCliSessionCache(cachePath, 'http://127.0.0.1:3050/mcp');
      expect(cache).toBeNull();
    });

    it('returns null when the server URL does not match', async () => {
      await writeCliSessionCache(cachePath, {
        sessionId: 'session-1',
        serverUrl: 'http://127.0.0.1:3050/mcp?preset=dev',
        savedAt: Date.now(),
        hasRestEndpoint: false,
      });

      const cache = await readCliSessionCache(cachePath, 'http://127.0.0.1:3050/mcp?preset=prod');
      expect(cache).toBeNull();
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

describe('runCommand REST-first path', () => {
  let cacheDir: string;
  let cachePath: string;
  const mockFetch = vi.fn();

  beforeEach(async () => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    transportState.instances = [];
    transportState.callResult = { content: [{ type: 'text', text: 'ok' }] };
    transportState.sessionIdOnInitialize = 'fresh-session';
    transportState.throw404OnMethod = undefined;

    const baseDir = join(process.cwd(), '.tmp-test', 'run-rest-unit');
    await mkdir(baseDir, { recursive: true });
    cacheDir = await mkdtemp(join(baseDir, 'cache-'));
    cachePath = join(cacheDir, '.cli-session.4242');
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(cacheDir, { recursive: true, force: true });
  });

  function makeRestResponse(status: number, body: unknown, options?: { sessionId?: string }) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (name: string) => {
          if (name === 'content-type') {
            return 'application/json';
          }
          if (name === 'mcp-session-id') {
            return options?.sessionId ?? null;
          }
          return null;
        },
      },
      json: async () => body,
    };
  }

  function makeTextResponse(status: number, text: string) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => (name === 'content-type' ? 'text/plain' : null) },
      text: async () => text,
      body: { cancel: async () => undefined },
    };
  }

  it('uses REST when hasRestEndpoint is true in cache and skips MCP', async () => {
    await writeCliSessionCache(cachePath, {
      sessionId: 'cached-session',
      serverUrl: 'http://127.0.0.1:3050/mcp',
      savedAt: Date.now(),
      hasRestEndpoint: true,
    });

    const restResult = {
      result: { content: [{ type: 'text', text: 'rest-result' }], isError: false },
      server: 'runner',
      tool: 'echo_args',
    };
    mockFetch.mockResolvedValueOnce(makeTextResponse(404, 'Not Found')); // schema GET
    mockFetch.mockResolvedValueOnce(makeRestResponse(200, restResult));

    const origStdout = process.stdout.write.bind(process.stdout);
    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });

    const { runCommand } = await import('./run.js');
    await runCommand({
      tool: 'runner/echo_args',
      args: '{"message":"hi"}',
      'config-dir': cacheDir,
      'cli-session-cache-path': join(cacheDir, '.cli-session.{pid}'),
    } as never);

    vi.restoreAllMocks();
    process.stdout.write = origStdout;

    // MCP transport should NOT have been used
    expect(transportState.instances).toHaveLength(0);
    expect(output.join('')).toContain('rest-result');
  });

  it('persists the REST session header in cache after a first successful call', async () => {
    const restResult = {
      result: { content: [{ type: 'text', text: 'rest-result' }], isError: false },
      server: 'runner',
      tool: 'echo_args',
    };
    mockFetch.mockResolvedValueOnce(makeTextResponse(404, 'Not Found'));
    mockFetch.mockResolvedValueOnce(makeRestResponse(200, restResult, { sessionId: 'rest-session-123' }));

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const { runCommand } = await import('./run.js');
    await runCommand({
      tool: 'runner/echo_args',
      args: '{"message":"hi"}',
      'config-dir': cacheDir,
      'cli-session-cache-path': join(cacheDir, '.cli-session.{pid}'),
    } as never);

    vi.restoreAllMocks();

    const cache = await readCliSessionCache(cachePath, 'http://127.0.0.1:3050/mcp');
    expect(cache?.sessionId).toBe('rest-session-123');
    expect(cache?.hasRestEndpoint).toBe(true);
  });

  it('persists a non-empty REST cache session when no session header is returned', async () => {
    const restResult = {
      result: { content: [{ type: 'text', text: 'rest-result' }], isError: false },
      server: 'runner',
      tool: 'echo_args',
    };
    mockFetch.mockResolvedValueOnce(makeTextResponse(404, 'Not Found'));
    mockFetch.mockResolvedValueOnce(makeRestResponse(200, restResult));

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const { runCommand } = await import('./run.js');
    await runCommand({
      tool: 'runner/echo_args',
      args: '{"message":"hi"}',
      'config-dir': cacheDir,
      'cli-session-cache-path': join(cacheDir, '.cli-session.{pid}'),
    } as never);

    vi.restoreAllMocks();

    const cache = await readCliSessionCache(cachePath, 'http://127.0.0.1:3050/mcp');
    expect(cache?.sessionId).toBe('rest');
    expect(cache?.hasRestEndpoint).toBe(true);
  });

  it('falls back to MCP when REST endpoint is missing', async () => {
    await writeCliSessionCache(cachePath, {
      sessionId: 'cached-session',
      serverUrl: 'http://127.0.0.1:3050/mcp',
      savedAt: Date.now(),
      hasRestEndpoint: true,
    });

    mockFetch.mockResolvedValueOnce(makeTextResponse(404, 'Not Found')); // schema GET
    mockFetch.mockResolvedValueOnce(makeTextResponse(404, 'Cannot POST /api/v1/tool-invocations'));

    const origStdout = process.stdout.write.bind(process.stdout);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const { runCommand } = await import('./run.js');
    await runCommand({
      tool: 'runner/echo_args',
      args: '{"message":"hi"}',
      'config-dir': cacheDir,
      'cli-session-cache-path': join(cacheDir, '.cli-session.{pid}'),
    } as never);

    vi.restoreAllMocks();
    process.stdout.write = origStdout;

    // MCP transport should have been used as fallback
    expect(transportState.instances.length).toBeGreaterThan(0);
  });

  it('falls back to MCP for endpoint 404 variants and persists hasRestEndpoint=false', async () => {
    await writeCliSessionCache(cachePath, {
      sessionId: 'cached-session',
      serverUrl: 'http://127.0.0.1:3050/mcp',
      savedAt: Date.now(),
      hasRestEndpoint: true,
    });

    mockFetch.mockResolvedValueOnce(makeTextResponse(404, 'Not Found'));
    mockFetch.mockResolvedValueOnce(makeTextResponse(404, 'Cannot POST /api/v1/tool-invocations'));

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const { runCommand } = await import('./run.js');
    await runCommand({
      tool: 'runner/echo_args',
      args: '{"message":"hi"}',
      'config-dir': cacheDir,
      'cli-session-cache-path': join(cacheDir, '.cli-session.{pid}'),
    } as never);

    vi.restoreAllMocks();

    const cache = await readCliSessionCache(cachePath, 'http://127.0.0.1:3050/mcp');
    expect(cache?.hasRestEndpoint).toBe(false);
  });

  it('surfaces upstream REST errors without MCP fallback', async () => {
    await writeCliSessionCache(cachePath, {
      sessionId: 'cached-session',
      serverUrl: 'http://127.0.0.1:3050/mcp',
      savedAt: Date.now(),
      hasRestEndpoint: true,
    });

    mockFetch.mockResolvedValueOnce(makeTextResponse(404, 'Not Found')); // schema GET
    mockFetch.mockResolvedValueOnce(makeRestResponse(502, { error: 'upstream failed' }));

    const stderr: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });

    const { runCommand } = await import('./run.js');
    await runCommand({
      tool: 'runner/echo_args',
      args: '{"message":"hi"}',
      'config-dir': cacheDir,
      'cli-session-cache-path': join(cacheDir, '.cli-session.{pid}'),
    } as never);

    vi.restoreAllMocks();

    expect(transportState.instances).toHaveLength(0);
    expect(stderr.join('')).toContain('upstream failed');
  });

  it('does not persist hasRestEndpoint=false for transient 503 REST failures', async () => {
    await writeCliSessionCache(cachePath, {
      sessionId: 'cached-session',
      serverUrl: 'http://127.0.0.1:3050/mcp',
      savedAt: Date.now(),
      hasRestEndpoint: true,
    });

    mockFetch.mockResolvedValueOnce(makeTextResponse(404, 'Not Found'));
    mockFetch.mockResolvedValueOnce(makeRestResponse(503, { error: 'temporarily unavailable' }));

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const { runCommand } = await import('./run.js');
    await runCommand({
      tool: 'runner/echo_args',
      args: '{"message":"hi"}',
      'config-dir': cacheDir,
      'cli-session-cache-path': join(cacheDir, '.cli-session.{pid}'),
    } as never);

    vi.restoreAllMocks();

    const cache = await readCliSessionCache(cachePath, 'http://127.0.0.1:3050/mcp');
    expect(cache?.hasRestEndpoint).toBe(true);
  });

  it('reports invalid --args JSON as a RunCommandInputError message', async () => {
    const stderr: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });

    const { runCommand } = await import('./run.js');
    await expect(
      runCommand({
        tool: 'runner/echo_args',
        args: '{bad json}',
        'config-dir': cacheDir,
        'cli-session-cache-path': join(cacheDir, '.cli-session.{pid}'),
      } as never),
    ).rejects.toThrow('Invalid JSON passed to --args');

    vi.restoreAllMocks();
    expect(stderr).toEqual([]);
  });

  it('uses HTTP inspect schema for raw stdin mapping and skips MCP', async () => {
    mockFetch
      .mockResolvedValueOnce(
        makeRestResponse(200, {
          kind: 'tool',
          server: 'runner',
          tool: 'echo_args',
          qualifiedName: 'runner_1mcp_echo_args',
          description: 'Echo message payloads for testing.',
          inputSchema: {
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
            required: ['message'],
          },
        }),
      )
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        if (body.args?.message !== 'hello from stdin') {
          return makeRestResponse(400, { error: 'stdin mapping failed' });
        }

        return makeRestResponse(200, {
          result: { content: [{ type: 'text', text: 'rest-stdin-result' }], isError: false },
          server: 'runner',
          tool: 'echo_args',
        });
      });

    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });

    const originalProcess = process;
    vi.stubGlobal('process', {
      ...process,
      stdin: {
        ...process.stdin,
        isTTY: false,
        async *[Symbol.asyncIterator]() {
          yield Buffer.from('hello from stdin');
        },
      },
    });

    const { runCommand } = await import('./run.js');
    await runCommand({
      tool: 'runner/echo_args',
      'config-dir': cacheDir,
      'cli-session-cache-path': join(cacheDir, '.cli-session.{pid}'),
    } as never);

    vi.restoreAllMocks();
    vi.stubGlobal('process', originalProcess);

    expect(transportState.instances).toHaveLength(0);
    expect(output.join('')).toContain('rest-stdin-result');
  });

  it('skips REST entirely when hasRestEndpoint is false', async () => {
    await writeCliSessionCache(cachePath, {
      sessionId: 'cached-session',
      serverUrl: 'http://127.0.0.1:3050/mcp',
      savedAt: Date.now(),
      hasRestEndpoint: false,
    });

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const { runCommand } = await import('./run.js');
    await runCommand({
      tool: 'runner/echo_args',
      args: '{"message":"hi"}',
      'config-dir': cacheDir,
      'cli-session-cache-path': join(cacheDir, '.cli-session.{pid}'),
    } as never);

    vi.restoreAllMocks();

    // fetch should not have been called for /api/tool-invocations
    const toolInvocationCalls = mockFetch.mock.calls.filter(
      ([url]: [string]) => typeof url === 'string' && url.includes('tool-invocations'),
    );
    expect(toolInvocationCalls).toHaveLength(0);
    // MCP was used
    expect(transportState.instances.length).toBeGreaterThan(0);
  });
});
