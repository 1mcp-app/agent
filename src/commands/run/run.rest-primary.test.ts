import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { buildCliContext } from '@src/commands/shared/cliContext.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getCliSessionContextHash, readCliSessionCache, writeCliSessionCache } from './run.js';

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

function makeContextHash(projectPath: string, transportType: 'run' | 'inspect', version: 'run' | 'inspect'): string {
  return getCliSessionContextHash(
    buildCliContext({
      cwd: projectPath,
      projectRoot: projectPath,
      transportType,
      version,
    }),
  );
}

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

describe('runCommand REST-first path', () => {
  let cacheDir: string;
  let cachePath: string;
  const mockFetch = vi.fn();

  beforeEach(async () => {
    mockedResolveProjectContext.mockReset();
    mockedResolveProjectContext.mockResolvedValue({
      cwd: '/tmp/project',
      projectRoot: '/tmp/project',
      projectName: 'project',
      projectConfig: null,
      source: 'cwd',
    });
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    transportState.instances = [];
    transportState.callResult = { content: [{ type: 'text', text: 'ok' }] };
    transportState.sessionIdOnInitialize = 'fresh-session';
    transportState.throw404OnMethod = undefined;
    mockedResolveProjectContext.mockReset();
    mockedResolveProjectContext.mockResolvedValue({
      cwd: '/tmp/project',
      projectRoot: '/tmp/project',
      projectName: 'project',
      projectConfig: null,
      source: 'cwd',
    });

    const baseDir = join(process.cwd(), '.tmp-test', 'run-rest-unit');
    await mkdir(baseDir, { recursive: true });
    cacheDir = await mkdtemp(join(baseDir, 'cache-'));
    cachePath = join(cacheDir, '.cli-session.4242');
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.exitCode = undefined;
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

  function makeConnectedServerResponse() {
    return makeRestResponse(200, { kind: 'server', server: 'runner', status: 'connected', available: true });
  }

  it.each([undefined, 120_000])('lets REST tool execution use its own budget (%s)', async (timeoutMs) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let finish!: (value: ReturnType<typeof makeRestResponse>) => void;
    let signal: AbortSignal | undefined;
    mockFetch.mockResolvedValueOnce(makeConnectedServerResponse());
    mockFetch.mockResolvedValueOnce(makeTextResponse(404, 'Not Found'));
    mockFetch.mockImplementationOnce((_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      entered();
      return new Promise((resolve, reject) => {
        finish = resolve;
        signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const { runCommand } = await import('./run.js');
    const pending = runCommand({
      tool: 'runner/echo_args',
      args: '{}',
      'timeout-ms': timeoutMs,
      'config-dir': cacheDir,
    });
    await started;
    await vi.advanceTimersByTimeAsync(timeoutMs === undefined ? 10_001 : 30_001);
    expect(signal?.aborted).toBe(false);
    finish(makeRestResponse(200, { result: { content: [{ type: 'text', text: 'completed' }] } }));
    await pending;
    expect(output).toHaveBeenCalledWith(expect.stringContaining('completed'));
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(transportState.instances).toHaveLength(0);
  });

  it('reports uncertain tool completion on a REST execution timeout without fallback or replay', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    mockFetch.mockResolvedValueOnce(makeConnectedServerResponse());
    mockFetch.mockResolvedValueOnce(makeTextResponse(404, 'Not Found'));
    mockFetch.mockImplementationOnce((_url: string, init: RequestInit) => {
      entered();
      return new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });
    const output = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const { runCommand } = await import('./run.js');
    const pending = runCommand({
      tool: 'runner/echo_args',
      args: '{}',
      format: 'json',
      'timeout-ms': 50,
      'config-dir': cacheDir,
    });
    await started;
    await vi.advanceTimersByTimeAsync(50);
    await pending;
    const response = JSON.parse(String(output.mock.calls.at(-1)?.[0]));
    expect(response.error.data['app.1mcp/failure']).toEqual({
      kind: 'deadline-exceeded',
      code: 'cli_tool_execution_timeout',
    });
    expect(response.error.message).toContain('may still be running');
    expect(process.exitCode).toBe(6);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(transportState.instances).toHaveLength(0);
  });

  it.each(['server discovery', 'schema discovery'] as const)('does not dispatch after a %s timeout', async (phase) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    if (phase === 'schema discovery') mockFetch.mockResolvedValueOnce(makeConnectedServerResponse());
    mockFetch.mockImplementationOnce((_url: string, init: RequestInit) => {
      entered();
      return new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });
    const output = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const { runCommand } = await import('./run.js');
    const pending = runCommand({
      tool: 'runner/echo_args',
      args: '{}',
      format: 'json',
      'timeout-ms': 50,
      'config-dir': cacheDir,
    });
    await started;
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
    const response = JSON.parse(String(output.mock.calls.at(-1)?.[0]));
    expect(response.error.data['app.1mcp/failure'].code).toBe(`cli_${phase.replaceAll(' ', '_')}_timeout`);
    expect(response.error.message).toContain('No tool invocation was dispatched');
    expect(process.exitCode).toBe(6);
    expect(mockFetch.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
    expect(transportState.instances).toHaveLength(0);
  });

  it.each([0, -1, 1.5, 600_001, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid execution budget %s before attachment',
    async (timeoutMs) => {
      const { runCommand } = await import('./run.js');
      await expect(runCommand({ tool: 'runner/echo_args', args: '{}', 'timeout-ms': timeoutMs })).rejects.toThrow(
        '--timeout-ms',
      );
      expect(mockFetch).not.toHaveBeenCalled();
      expect(transportState.instances).toHaveLength(0);
    },
  );

  it.each(['json', 'text', 'toon'] as const)(
    'prints deferred REST preparation in %s without fallback or replay',
    async (format) => {
      await writeCliSessionCache(cachePath, {
        sessionId: 'cached-session',
        serverUrl: 'http://127.0.0.1:3050/mcp',
        contextHash: makeContextHash('/tmp/project', 'run', 'run'),
        savedAt: Date.now(),
        hasRestEndpoint: true,
      });
      const pending = {
        preparation: { state: 'pending', status: { id: 'prepare-1', state: 'running' } },
        operationExecuted: false,
        operationQueued: false,
      };
      mockFetch.mockResolvedValueOnce(makeConnectedServerResponse());
      mockFetch.mockResolvedValueOnce(makeTextResponse(404, 'Not Found'));
      mockFetch.mockResolvedValueOnce(makeRestResponse(200, { result: pending, server: 'runner', tool: 'echo_args' }));
      const output: string[] = [];
      vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        output.push(String(chunk));
        return true;
      });
      const { runCommand } = await import('./run.js');
      await runCommand({
        tool: 'runner/echo_args',
        args: '{}',
        format,
        'config-dir': cacheDir,
        'cli-session-cache-path': join(cacheDir, '.cli-session.{pid}'),
      } as never);
      expect(output.join('')).toContain('prepare-1');
      if (format === 'json') expect(JSON.parse(output.join(''))).toEqual(pending);
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(transportState.instances).toHaveLength(0);
    },
  );

  it('uses REST when hasRestEndpoint is true in cache and skips MCP', async () => {
    await writeCliSessionCache(cachePath, {
      sessionId: 'cached-session',
      serverUrl: 'http://127.0.0.1:3050/mcp',
      contextHash: makeContextHash('/tmp/project', 'run', 'run'),
      savedAt: Date.now(),
      hasRestEndpoint: true,
    });

    const restResult = {
      result: { content: [{ type: 'text', text: 'rest-result' }], isError: false },
      server: 'runner',
      tool: 'echo_args',
    };
    mockFetch.mockResolvedValueOnce(makeConnectedServerResponse());
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

    const [, requestInit] = mockFetch.mock.calls[2] as [string, RequestInit];
    expect((requestInit.headers as Record<string, string>)['mcp-session-id']).toBe('cached-session');
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      tool: 'runner/echo_args',
      args: { message: 'hi' },
      _meta: {
        context: {
          project: {
            path: '/tmp/project',
            cwd: '/tmp/project',
            name: 'project',
          },
          sessionId: 'cached-session',
          transport: { type: 'run' },
          version: 'run',
        },
      },
    });

    vi.clearAllMocks();
    process.stdout.write = origStdout;

    // MCP transport should NOT have been used
    expect(transportState.instances).toHaveLength(0);
    expect(output.join('')).toContain('rest-result');
  });

  it('sends the same canonical session id in header and context on a first REST call', async () => {
    const restResult = {
      result: { content: [{ type: 'text', text: 'rest-result' }], isError: false },
      server: 'runner',
      tool: 'echo_args',
    };
    mockFetch.mockResolvedValueOnce(makeConnectedServerResponse());
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

    const [, requestInit] = mockFetch.mock.calls[2] as [string, RequestInit];
    const headers = requestInit.headers as Record<string, string>;
    const body = JSON.parse(String(requestInit.body)) as { _meta: { context: { sessionId: string } } };

    expect(body._meta.context.sessionId).toMatch(/^rest-[a-f0-9]{16}$/);
    expect(headers['mcp-session-id']).toBe(body._meta.context.sessionId);

    vi.clearAllMocks();
  });

  it('persists the REST session header in cache after a first successful call', async () => {
    const restResult = {
      result: { content: [{ type: 'text', text: 'rest-result' }], isError: false },
      server: 'runner',
      tool: 'echo_args',
    };
    mockFetch.mockResolvedValueOnce(makeConnectedServerResponse());
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

    vi.clearAllMocks();

    const cache = await readCliSessionCache(
      cachePath,
      'http://127.0.0.1:3050/mcp',
      makeContextHash('/tmp/project', 'run', 'run'),
    );
    expect(cache?.sessionId).toBe('rest-session-123');
    expect(cache?.hasRestEndpoint).toBe(true);
  });

  it('persists a non-empty REST cache session when no session header is returned', async () => {
    const restResult = {
      result: { content: [{ type: 'text', text: 'rest-result' }], isError: false },
      server: 'runner',
      tool: 'echo_args',
    };
    mockFetch.mockResolvedValueOnce(makeConnectedServerResponse());
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

    vi.clearAllMocks();

    const cache = await readCliSessionCache(
      cachePath,
      'http://127.0.0.1:3050/mcp',
      makeContextHash('/tmp/project', 'run', 'run'),
    );
    expect(cache?.sessionId).toMatch(/^rest-[a-f0-9]{16}$/);
    expect(cache?.sessionId).not.toBe('rest');
    expect(cache?.hasRestEndpoint).toBe(true);
  });

  it('returns server_loading before attempting a REST or MCP tool invocation', async () => {
    mockFetch.mockResolvedValueOnce(
      makeRestResponse(200, { kind: 'server', server: 'runner', status: 'loading', available: false }),
    );
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

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(transportState.instances).toHaveLength(0);
    expect(stderr.join('')).toContain('server_loading');
    expect(stderr.join('')).toContain('1mcp wait runner');
  });

  it('waits instead of restarting when a connected server is not yet available', async () => {
    mockFetch.mockResolvedValueOnce(
      makeRestResponse(200, { kind: 'server', server: 'runner', status: 'connected', available: false }),
    );
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

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(transportState.instances).toHaveLength(0);
    expect(stderr.join('')).toContain("Server 'runner' is connected but not yet available");
    expect(stderr.join('')).toContain('1mcp wait runner');
    expect(stderr.join('')).not.toContain('1mcp mcp restart runner');
  });

  it('checks status with the same preset used by the invocation surface', async () => {
    mockFetch.mockResolvedValueOnce(makeConnectedServerResponse());
    mockFetch.mockResolvedValueOnce(makeTextResponse(404, 'Not Found'));
    mockFetch.mockResolvedValueOnce(
      makeRestResponse(200, {
        result: { content: [{ type: 'text', text: 'ok' }], isError: false },
        server: 'runner',
        tool: 'echo_args',
      }),
    );
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const { runCommand } = await import('./run.js');
    await runCommand({
      tool: 'runner/echo_args',
      args: '{"message":"hi"}',
      preset: 'development',
      'config-dir': cacheDir,
      'cli-session-cache-path': join(cacheDir, '.cli-session.{pid}'),
    } as never);

    const statusUrl = new URL(String(mockFetch.mock.calls[0][0]));
    const schemaUrl = new URL(String(mockFetch.mock.calls[1][0]));
    expect(statusUrl.searchParams.get('target')).toBe('runner');
    expect(statusUrl.searchParams.get('preset')).toBe('development');
    expect(schemaUrl.searchParams.get('target')).toBe('runner/echo_args');
    expect(schemaUrl.searchParams.get('preset')).toBe('development');
  });

  it('initializes a fresh MCP transport while preserving the logical context session id', async () => {
    mockFetch.mockResolvedValueOnce(makeConnectedServerResponse());
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

    vi.clearAllMocks();

    expect(transportState.instances).toHaveLength(1);
    const instance = transportState.instances[0];
    const initializeContext = instance.sentMessages[0].params?._meta as { context: { sessionId: string } };
    expect(instance.sentMessages.map((message) => message.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/call',
    ]);
    expect(initializeContext.context.sessionId).toMatch(/^rest-[a-f0-9]{16}$/);
    expect(instance.initialSessionId).toBe(initializeContext.context.sessionId);
  });

  it('falls back to MCP when REST endpoint is missing', async () => {
    await writeCliSessionCache(cachePath, {
      sessionId: 'cached-session',
      serverUrl: 'http://127.0.0.1:3050/mcp',
      contextHash: makeContextHash('/tmp/project', 'run', 'run'),
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

    vi.clearAllMocks();
    process.stdout.write = origStdout;

    // MCP transport should have been used as fallback
    expect(transportState.instances.length).toBeGreaterThan(0);
  });
});
