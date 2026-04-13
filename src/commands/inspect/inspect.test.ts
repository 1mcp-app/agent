import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import {
  buildServerUrl,
  getCliSessionCachePath,
  readCliSessionCache,
  SESSION_CACHE_TTL_MS,
  writeCliSessionCache,
} from '@src/commands/shared/serveClient.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { inspectCommand, inspectTools } from './inspect.js';

const transportState = vi.hoisted(() => ({
  sessionIdOnInitialize: 'inspect-session',
  throw404OnMethod: undefined as string | undefined,
  schemaPayload: {
    tools: [
      {
        name: 'runner_1mcp_echo_args',
        description: 'Echo message payloads for testing.',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
          required: ['message'],
        },
      },
    ],
  },
  instances: [] as Array<{ sentMessages: Array<{ method?: string; params?: Record<string, unknown> }> }>,
}));

const mockedApiClientGet = vi.hoisted(() => vi.fn());

const mockedDiscoverServerWithPidFile = vi.hoisted(() => vi.fn());
const mockedValidateServer1mcpUrl = vi.hoisted(() => vi.fn());
const mockedLoadProjectConfig = vi.hoisted(() => vi.fn());
const mockedLoadAuthProfile = vi.hoisted(() => vi.fn());
const mockedStdoutWrite = vi.hoisted(() => vi.fn());

vi.mock('@src/commands/shared/apiClient.js', () => ({
  ApiClient: vi.fn().mockImplementation(() => ({
    get: mockedApiClientGet,
  })),
}));

vi.mock('@src/utils/validation/urlDetection.js', () => ({
  discoverServerWithPidFile: mockedDiscoverServerWithPidFile,
  validateServer1mcpUrl: mockedValidateServer1mcpUrl,
}));

vi.mock('@src/config/projectConfigLoader.js', async () => {
  const actual = await vi.importActual<typeof import('@src/config/projectConfigLoader.js')>(
    '@src/config/projectConfigLoader.js',
  );
  return {
    ...actual,
    loadProjectConfig: mockedLoadProjectConfig,
  };
});

vi.mock('@src/commands/shared/authProfileStore.js', async () => {
  const actual = await vi.importActual<typeof import('@src/commands/shared/authProfileStore.js')>(
    '@src/commands/shared/authProfileStore.js',
  );
  return {
    ...actual,
    loadAuthProfile: mockedLoadAuthProfile,
  };
});

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
            result: transportState.schemaPayload,
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

describe('inspect command internals', () => {
  beforeEach(() => {
    transportState.sessionIdOnInitialize = 'inspect-session';
    transportState.throw404OnMethod = undefined;
    transportState.schemaPayload = {
      tools: [
        {
          name: 'runner_1mcp_echo_args',
          description: 'Echo message payloads for testing.',
          inputSchema: {
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
            required: ['message'],
          },
        },
      ],
    };
    transportState.instances = [];
    mockedApiClientGet.mockReset();
    mockedDiscoverServerWithPidFile.mockReset();
    mockedValidateServer1mcpUrl.mockReset();
    mockedLoadProjectConfig.mockReset();
    mockedLoadAuthProfile.mockReset();
    mockedStdoutWrite.mockReset();

    mockedDiscoverServerWithPidFile.mockResolvedValue({ url: 'http://127.0.0.1:3050/mcp' });
    mockedValidateServer1mcpUrl.mockResolvedValue({ valid: true });
    mockedLoadProjectConfig.mockResolvedValue(null);
    mockedLoadAuthProfile.mockResolvedValue(null);

    vi.stubGlobal('process', {
      ...process,
      stdout: {
        ...process.stdout,
        write: mockedStdoutWrite,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds a filtered inspect server URL', () => {
    const url = buildServerUrl('http://127.0.0.1:3050/mcp', {
      preset: 'dev',
      tags: ['ignored'],
    });

    expect(url.searchParams.get('preset')).toBe('dev');
    expect(url.searchParams.has('tags')).toBe(false);
  });

  it('initializes a fresh session before listing tools', async () => {
    const response = await inspectTools({
      serverUrl: new URL('http://127.0.0.1:3050/mcp'),
    });

    expect(response.retryWithFreshSession).toBe(false);
    expect(response.sessionId).toBe('inspect-session');
    expect(response.tools).toHaveLength(1);
    expect(transportState.instances[0].sentMessages.map((message) => message.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
    ]);
  });

  it('sends project context in initialize metadata for template-aware inspection', async () => {
    await inspectTools({
      serverUrl: new URL('http://127.0.0.1:3050/mcp'),
      context: {
        project: { path: '/tmp/project', name: 'project' },
        user: { username: 'tester' },
        environment: { variables: { PWD: '/tmp/project' } },
        sessionId: 'inspect-session',
        version: 'inspect',
      },
    });

    expect(transportState.instances[0].sentMessages[0]).toMatchObject({
      method: 'initialize',
      params: {
        _meta: {
          context: {
            project: { path: '/tmp/project', name: 'project' },
            sessionId: 'inspect-session',
          },
        },
      },
    });
  });

  it('skips initialize when a cached session is present', async () => {
    const response = await inspectTools({
      serverUrl: new URL('http://127.0.0.1:3050/mcp'),
      sessionId: 'cached-session',
    });

    expect(response.retryWithFreshSession).toBe(false);
    expect(response.sessionId).toBe('cached-session');
    expect(transportState.instances[0].sentMessages.map((message) => message.method)).toEqual(['tools/list']);
  });

  it('requests a retry when a cached session 404s', async () => {
    transportState.throw404OnMethod = 'tools/list';

    const response = await inspectTools({
      serverUrl: new URL('http://127.0.0.1:3050/mcp'),
      sessionId: 'stale-session',
    });

    expect(response.retryWithFreshSession).toBe(true);
    expect('error' in response.rawResponse && response.rawResponse.error.message).toBe('Cached session expired.');
  });

  describe('shared cache helpers', () => {
    let cacheDir: string;

    beforeEach(async () => {
      const baseDir = join(process.cwd(), '.tmp-test', 'inspect-command-unit');
      await mkdir(baseDir, { recursive: true });
      cacheDir = await mkdtemp(join(baseDir, 'cache-'));
    });

    afterEach(async () => {
      await rm(cacheDir, { recursive: true, force: true });
    });

    it('writes and reads a matching cache entry', async () => {
      const cachePath = getCliSessionCachePath(cacheDir);

      await writeCliSessionCache(cachePath, {
        sessionId: 'session-1',
        serverUrl: 'http://127.0.0.1:3050/mcp?preset=dev',
        savedAt: Date.now(),
      });

      expect(await readdir(cacheDir)).toEqual(['.cli-session']);
      const cache = await readCliSessionCache(cachePath, 'http://127.0.0.1:3050/mcp?preset=dev');
      expect(cache?.sessionId).toBe('session-1');
    });

    it('treats expired cache entries as misses', async () => {
      const cachePath = getCliSessionCachePath(cacheDir);

      await writeCliSessionCache(cachePath, {
        sessionId: 'session-1',
        serverUrl: 'http://127.0.0.1:3050/mcp',
        savedAt: Date.now() - SESSION_CACHE_TTL_MS - 1,
      });

      const cache = await readCliSessionCache(cachePath, 'http://127.0.0.1:3050/mcp');
      expect(cache).toBeNull();
    });
  });

  it('retries with a fresh session when a cached session has no tools for the requested server', async () => {
    mockedApiClientGet.mockResolvedValue({ ok: false, status: 503, error: 'disconnected' });
    transportState.schemaPayload = {
      tools: [
        {
          name: 'context7_1mcp_query-docs',
          description: 'Query docs',
          inputSchema: {
            type: 'object',
            properties: {
              libraryId: { type: 'string' },
              query: { type: 'string' },
            },
            required: ['libraryId', 'query'],
          },
        },
      ],
    } as any;

    const cacheDir = join(process.cwd(), '.tmp-test', 'inspect-command-unit', 'retry-missing-server');
    await mkdir(cacheDir, { recursive: true });
    const cachePath = getCliSessionCachePath(cacheDir);
    await writeCliSessionCache(cachePath, {
      sessionId: 'cached-session',
      serverUrl: 'http://127.0.0.1:3050/mcp',
      savedAt: Date.now(),
    });

    let callCount = 0;
    transportState.instances = [];
    const originalPayload = transportState.schemaPayload;
    mockedTransport.MockStreamableHTTPClientTransport.prototype.send = async function (message: {
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
    }): Promise<void> {
      this.sentMessages.push({ method: message.method, params: message.params });

      if (message.id === undefined || !message.method) {
        return;
      }

      switch (message.method) {
        case 'initialize':
          this.sessionId = transportState.sessionIdOnInitialize;
          this.onmessage?.({
            jsonrpc: '2.0',
            id: message.id,
            result: { protocolVersion: '2025-06-18' },
          });
          break;
        case 'tools/list':
          callCount += 1;
          this.onmessage?.({
            jsonrpc: '2.0',
            id: message.id,
            result:
              callCount === 1
                ? originalPayload
                : {
                    tools: [
                      {
                        name: 'serena_1mcp_find_symbol',
                        description: 'Find symbol',
                        inputSchema: {
                          type: 'object',
                          properties: { name_path_pattern: { type: 'string' } },
                          required: ['name_path_pattern'],
                        },
                      },
                    ],
                  },
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
    };

    await inspectCommand({
      target: 'serena',
      format: 'text',
      'config-dir': cacheDir,
    } as never);

    expect(mockedStdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Server: serena'));
    expect(transportState.instances.map((instance) => instance.sentMessages.map((message) => message.method))).toEqual([
      ['tools/list'],
      ['initialize', 'notifications/initialized', 'tools/list'],
    ]);
  });

  it('retries with a fresh session when a server target needs instructions', async () => {
    mockedApiClientGet.mockResolvedValue({ ok: false, status: 503, error: 'disconnected' });
    transportState.schemaPayload = {
      tools: [
        {
          name: 'serena_1mcp_find_symbol',
          description: 'Find symbol',
          inputSchema: {
            type: 'object',
            properties: { name_path_pattern: { type: 'string' } },
            required: ['name_path_pattern'],
          },
        },
      ],
    } as any;

    const cacheDir = join(process.cwd(), '.tmp-test', 'inspect-command-unit', 'retry-missing-instructions');
    await mkdir(cacheDir, { recursive: true });
    const cachePath = getCliSessionCachePath(cacheDir);
    await writeCliSessionCache(cachePath, {
      sessionId: 'cached-session',
      serverUrl: 'http://127.0.0.1:3050/mcp',
      savedAt: Date.now(),
    });

    await inspectCommand({
      target: 'serena',
      format: 'text',
      'config-dir': cacheDir,
    } as never);

    expect(mockedStdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Instructions:'));
    expect(transportState.instances.map((instance) => instance.sentMessages.map((message) => message.method))).toEqual([
      ['tools/list'],
      ['initialize', 'notifications/initialized', 'tools/list'],
    ]);
  });
});
