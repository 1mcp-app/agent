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
      contextHash: makeContextHash('/tmp/project', 'run', 'run'),
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

    const [, requestInit] = mockFetch.mock.calls[1] as [string, RequestInit];
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

    const [, requestInit] = mockFetch.mock.calls[1] as [string, RequestInit];
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

  it('initializes a fresh MCP transport while preserving the logical context session id', async () => {
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
    expect(instance.initialSessionId).toBeUndefined();
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
