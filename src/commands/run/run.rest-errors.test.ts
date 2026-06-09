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

  it('does not persist hasRestEndpoint=false for transient 503 REST failures', async () => {
    await writeCliSessionCache(cachePath, {
      sessionId: 'cached-session',
      serverUrl: 'http://127.0.0.1:3050/mcp',
      contextHash: makeContextHash('/tmp/project', 'run', 'run'),
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

    vi.clearAllMocks();

    const cache = await readCliSessionCache(
      cachePath,
      'http://127.0.0.1:3050/mcp',
      makeContextHash('/tmp/project', 'run', 'run'),
    );
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

    vi.clearAllMocks();
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

    vi.clearAllMocks();
    vi.stubGlobal('process', originalProcess);

    expect(transportState.instances).toHaveLength(0);
    expect(output.join('')).toContain('rest-stdin-result');
  });

  it('skips REST entirely when hasRestEndpoint is false', async () => {
    await writeCliSessionCache(cachePath, {
      sessionId: 'cached-session',
      serverUrl: 'http://127.0.0.1:3050/mcp',
      contextHash: makeContextHash('/tmp/project', 'run', 'run'),
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

    vi.clearAllMocks();

    // fetch should not have been called for /api/tool-invocations
    const toolInvocationCalls = mockFetch.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('tool-invocations'),
    );
    expect(toolInvocationCalls).toHaveLength(0);
    // MCP was used
    expect(transportState.instances.length).toBeGreaterThan(0);
  });
});
