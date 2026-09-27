import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { buildCliContext } from '@src/commands/shared/cliContext.js';
import {
  getCliSessionCachePath,
  getCliSessionContextHash,
  readCliSessionCache,
  writeCliSessionCache,
} from '@src/commands/shared/serveClient.js';
import { buildCatalogGeneration } from '@src/core/capabilities/catalogGeneration.js';
import { type Tool, toProtocolTool } from '@src/sdk/contracts/index.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getInspectResult, inspectCommand } from './inspect.js';

interface MockSchemaPayload {
  tools: Tool[];
  nextCursor?: string;
  _meta?: Record<string, unknown>;
}

const transportState = vi.hoisted(() => ({
  malformedPages: {} as Record<string, unknown>,
  pages: {} as Record<string, MockSchemaPayload>,
  sessionIdOnInitialize: 'inspect-session',
  throw404OnMethod: undefined as string | undefined,
  initializeResult: {} as Record<string, unknown>,
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
  } as MockSchemaPayload,
  instances: [] as Array<{ sentMessages: Array<{ method?: string; params?: Record<string, unknown> }> }>,
}));

const mockedApiClientGet = vi.hoisted(() => vi.fn());

const mockedDiscoverServerWithPidFile = vi.hoisted(() => vi.fn());
const mockedValidateServer1mcpUrl = vi.hoisted(() => vi.fn());
const mockedResolveProjectContext = vi.hoisted(() => vi.fn());
const mockedLoadAuthProfile = vi.hoisted(() => vi.fn());
const mockedStdoutWrite = vi.hoisted(() => vi.fn());

function makeClientSurfaceContextHash(
  projectPath: string,
  clientSurface: 'inspect' | 'instructions' = 'inspect',
): string {
  return getCliSessionContextHash(
    buildCliContext({
      cwd: projectPath,
      projectRoot: projectPath,
      transportType: clientSurface,
      version: clientSurface,
    }),
  );
}

vi.mock('@src/commands/shared/apiClient.js', () => ({
  ApiClient: vi.fn().mockImplementation(function () {
    return {
      get: mockedApiClientGet,
    };
  }),
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
    resolveProjectContext: mockedResolveProjectContext,
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
              ...transportState.initializeResult,
            },
          });
          break;
        case 'tools/list':
          {
            const pageKey = String(message.params?.cursor ?? 'first');
            this.onmessage?.({
              jsonrpc: '2.0',
              id: message.id,
              result: Object.hasOwn(transportState.malformedPages, pageKey)
                ? transportState.malformedPages[pageKey]
                : message.params?.cursor
                  ? transportState.pages[String(message.params.cursor)]
                  : transportState.schemaPayload,
            });
          }
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
    transportState.pages = {};
    transportState.malformedPages = {};
    transportState.sessionIdOnInitialize = 'inspect-session';
    transportState.throw404OnMethod = undefined;
    transportState.initializeResult = {};
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
    mockedResolveProjectContext.mockReset();
    mockedLoadAuthProfile.mockReset();
    mockedStdoutWrite.mockReset();

    mockedDiscoverServerWithPidFile.mockResolvedValue({ url: 'http://127.0.0.1:3050/mcp', pid: 4242 });
    mockedValidateServer1mcpUrl.mockResolvedValue({ valid: true });
    mockedResolveProjectContext.mockResolvedValue({
      cwd: '/tmp/project',
      projectRoot: '/tmp/project',
      projectName: 'project',
      projectConfig: null,
      source: 'cwd',
    });
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

  it.each([
    { label: 'missing tools', payload: {} },
    { label: 'non-array tools', payload: { tools: {} } },
    { label: 'invalid tool', payload: { tools: [{ name: 42, inputSchema: { type: 'object' } }] } },
    { label: 'invalid schema', payload: { tools: [{ name: 'bad', inputSchema: [] }] } },
    { label: 'invalid cursor', payload: { tools: [], nextCursor: { injected: true } } },
  ])('rejects $label on first and later pages before forwarding a cursor', async ({ payload }) => {
    mockedApiClientGet.mockResolvedValue({ ok: false, status: 404, error: 'HTTP 404' });
    for (const page of ['first', 'later']) {
      transportState.instances = [];
      transportState.malformedPages = { [page]: payload };
      transportState.schemaPayload.nextCursor = 'later';
      await expect(getInspectResult({ target: 'runner', url: 'http://127.0.0.1:3050/mcp' })).rejects.toThrow(
        'Invalid tools/list response',
      );
      const requests = transportState.instances
        .flatMap((instance) => instance.sentMessages)
        .filter((message) => message.method === 'tools/list');
      expect(requests.map((message) => message.params?.cursor)).toEqual(
        page === 'first' ? [undefined] : [undefined, 'later'],
      );
    }
  });

  it('collects MCP fallback pages before applying local limits and all', async () => {
    mockedApiClientGet.mockResolvedValue({ ok: false, status: 404, error: 'HTTP 404' });
    const tools = buildCatalogGeneration(
      1,
      ['echo_args', 'tail'].map((name) => ({
        kind: 'tools',
        server: 'runner',
        connectionKey: 'runner',
        object: { name, inputSchema: { type: 'object' } },
      })),
    ).entries.map((entry) => toProtocolTool(entry.publicObject));
    transportState.schemaPayload = { tools: [tools[0]], nextCursor: 'empty' };
    transportState.pages.empty = { tools: [], nextCursor: 'tail' };
    transportState.pages.tail = { tools: [tools[1]] };
    const options = { target: 'runner', limit: 1, url: 'http://127.0.0.1:3050/mcp' };
    const first = await getInspectResult(options);
    expect(first).toMatchObject({ tools: [{ tool: 'echo_args' }], totalTools: 2, hasMore: true });
    if (first.kind !== 'server') throw new Error('Expected server');
    expect(await getInspectResult({ ...options, cursor: first.nextCursor })).toMatchObject({
      tools: [{ tool: 'tail' }],
      hasMore: false,
    });
    expect(await getInspectResult({ ...options, all: true })).toMatchObject({
      tools: [{ tool: 'echo_args' }, { tool: 'tail' }],
      hasMore: false,
    });
    transportState.pages.tail.nextCursor = 'empty';
    await expect(getInspectResult(options)).rejects.toThrow('repeated cursor');
  });

  it('searches the complete scoped fallback inventory and retains partial metadata from earlier pages', async () => {
    mockedApiClientGet.mockResolvedValue({ ok: false, status: 404, error: 'HTTP 404' });
    const tools = buildCatalogGeneration(
      1,
      ['first', 'tail'].map((name) => ({
        kind: 'tools',
        server: 'runner',
        connectionKey: 'runner',
        object: { name, inputSchema: { type: 'object' } },
      })),
    ).entries.map((entry) => toProtocolTool(entry.publicObject));
    transportState.schemaPayload = { tools: [tools[0]], nextCursor: 'tail', _meta: { partial: true } };
    transportState.pages.tail = { tools: [tools[1]] };
    const result = await getInspectResult({ target: 'runner', search: 'TAIL', url: 'http://127.0.0.1:3050/mcp' });
    expect(result).toMatchObject({
      kind: 'search',
      totalTools: 1,
      complete: false,
      _meta: { partial: true },
      tools: [{ server: 'runner', tool: 'tail', requiredArgs: 0, optionalArgs: 0 }],
    });
  });

  it('rejects cross-server search on an older endpoint that ignores search', async () => {
    mockedApiClientGet.mockResolvedValue({ ok: true, status: 200, data: { kind: 'servers', servers: [] } });
    await expect(getInspectResult({ search: 'tail', url: 'http://127.0.0.1:3050/mcp' })).rejects.toThrow('Upgrade');
    expect(transportState.instances).toHaveLength(0);
  });

  it('rejects blank searches and exact tool targets before attachment', async () => {
    await expect(getInspectResult({ search: '  ' })).rejects.toThrow('blank');
    await expect(getInspectResult({ search: 'tail', target: 'runner/tail' })).rejects.toThrow('tool target');
    expect(mockedApiClientGet).not.toHaveBeenCalled();
  });

  it('preserves partial facts when a later page supplies complete metadata', async () => {
    mockedApiClientGet.mockResolvedValue({ ok: false, status: 404, error: 'HTTP 404' });
    transportState.schemaPayload = {
      tools: [],
      nextCursor: 'tail',
      _meta: { 'app.1mcp/capability-pagination': { partial: true, complete: false } },
    };
    transportState.pages.tail = {
      tools: [],
      _meta: { 'app.1mcp/capability-pagination': { partial: false, complete: true } },
    };
    expect(
      await getInspectResult({ target: 'runner', search: 'tail', url: 'http://127.0.0.1:3050/mcp' }),
    ).toMatchObject({
      complete: false,
      _meta: { 'app.1mcp/capability-pagination': { partial: true, complete: false } },
    });
  });

  it('rejects unauthorized search without MCP fallback', async () => {
    mockedApiClientGet.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' });
    await expect(
      getInspectResult({ target: 'runner', search: 'tail', url: 'http://127.0.0.1:3050/mcp' }),
    ).rejects.toThrow();
    expect(transportState.instances).toHaveLength(0);
  });

  it('filters a search-ignoring server endpoint through MCP including glob and descriptions', async () => {
    mockedApiClientGet.mockResolvedValue({
      ok: true,
      status: 200,
      data: { kind: 'server', server: 'runner', tools: [] },
    });
    const tools = buildCatalogGeneration(
      1,
      [
        { name: 'a.b', description: 'Read documents', inputSchema: { type: 'object' } },
        { name: 'axb', description: 'Other', inputSchema: { type: 'object' } },
      ].map((object) => ({ kind: 'tools', server: 'runner', connectionKey: 'runner', object })),
    ).entries.map((entry) => toProtocolTool(entry.publicObject));
    transportState.schemaPayload = { tools };
    const options = { target: 'runner', url: 'http://127.0.0.1:3050/mcp', glob: true };
    expect(await getInspectResult({ ...options, search: 'RUNNER/a.?', 'show-descriptions': true })).toMatchObject({
      totalTools: 1,
      tools: [{ tool: 'a.b', description: 'Read documents' }],
    });
    expect(await getInspectResult({ ...options, search: '*DOC*', 'include-descriptions': true })).toMatchObject({
      totalTools: 1,
      tools: [{ tool: 'a.b' }],
    });
  });

  it('rejects malformed, repeating, and over-budget search enumeration', async () => {
    mockedApiClientGet.mockResolvedValue({ ok: false, status: 404, error: 'HTTP 404' });
    const options = { target: 'runner', search: 'tail', url: 'http://127.0.0.1:3050/mcp' };
    transportState.malformedPages.first = { tools: null };
    await expect(getInspectResult(options)).rejects.toThrow('Invalid tools/list');
    transportState.malformedPages = {};
    transportState.schemaPayload = { tools: [], nextCursor: 'loop' };
    transportState.pages.loop = { tools: [], nextCursor: 'loop' };
    await expect(getInspectResult(options)).rejects.toThrow('repeated cursor');
    transportState.schemaPayload = { tools: [], nextCursor: '1' };
    transportState.pages = Object.fromEntries(
      Array.from({ length: 1000 }, (_, i) => [String(i + 1), { tools: [], nextCursor: String(i + 2) }]),
    );
    await expect(getInspectResult(options)).rejects.toThrow('exceeded 1000 pages');
  });

  it.each(['loading', 'disconnected', 'awaiting_oauth'])(
    'preserves authoritative %s source state through MCP search fallback',
    async (status) => {
      mockedApiClientGet.mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          kind: 'server',
          server: 'runner',
          status,
          available: false,
          tools: [],
        },
      });
      transportState.schemaPayload = { tools: [] };
      expect(
        await getInspectResult({ target: 'runner', search: 'tail', url: 'http://127.0.0.1:3050/mcp' }),
      ).toMatchObject({
        kind: 'search',
        complete: false,
        totalTools: 0,
        sources: [{ server: 'runner', status, available: false }],
      });
    },
  );

  it.each(['rest', 'mcp'])('retains partial %s metadata when combining fallback evidence', async (partialSource) => {
    const partial = { partial: true, complete: false, failedSourceCount: 1 };
    const complete = { partial: false, complete: true };
    mockedApiClientGet.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: 'server',
        server: 'runner',
        status: 'connected',
        available: true,
        tools: [],
        _meta: { restFact: true, 'app.1mcp/capability-pagination': partialSource === 'rest' ? partial : complete },
      },
    });
    transportState.schemaPayload = {
      tools: [],
      _meta: {
        mcpFact: true,
        'app.1mcp/capability-pagination': partialSource === 'mcp' ? partial : complete,
      },
    };
    expect(
      await getInspectResult({ target: 'runner', search: 'tail', url: 'http://127.0.0.1:3050/mcp' }),
    ).toMatchObject({
      complete: false,
      sources: [{ server: 'runner', status: 'connected', available: true }],
      _meta: { restFact: true, mcpFact: true, 'app.1mcp/capability-pagination': partial },
    });
  });

  it('rejects legacy unrouted fallback tools even when REST confirms the server exists', async () => {
    mockedApiClientGet.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: 'server',
        server: 'runner',
        status: 'connected',
        available: true,
        tools: [],
      },
    });
    transportState.schemaPayload = { tools: [{ name: 'runner_1mcp_tail', inputSchema: { type: 'object' } }] };
    await expect(
      getInspectResult({ target: 'runner', search: 'tail', url: 'http://127.0.0.1:3050/mcp' }),
    ).rejects.toThrow('public tool route metadata');
  });

  it('does not report unknown fallback servers as complete zero matches', async () => {
    transportState.schemaPayload = { tools: [] };
    mockedApiClientGet.mockResolvedValue({ ok: false, status: 404, error: 'HTTP 404' });
    await expect(
      getInspectResult({ target: 'missing', search: 'anything', url: 'http://127.0.0.1:3050/mcp' }),
    ).rejects.toThrow('Cannot establish whether server');
  });

  it('falls back to MCP when the inspect endpoint is unavailable for a server target', async () => {
    mockedApiClientGet.mockResolvedValue({ ok: false, status: 404, error: 'HTTP 404' });
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
    const cachePath = getCliSessionCachePath({
      cachePathTemplate: join(cacheDir, '.cli-session.{pid}'),
      serverPid: 4242,
    });
    await writeCliSessionCache(cachePath, {
      sessionId: 'cached-session',
      serverUrl: 'http://127.0.0.1:3050/mcp',
      contextHash: makeClientSurfaceContextHash('/tmp/project'),
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
            result: {
              protocolVersion: '2025-06-18',
              ...transportState.initializeResult,
            },
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
      'cli-session-cache-path': join(cacheDir, '.cli-session.{pid}'),
    } as never);

    expect(mockedStdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Inspect: Server'));
    expect(transportState.instances.map((instance) => instance.sentMessages.map((message) => message.method))).toEqual([
      ['tools/list'],
      ['initialize', 'notifications/initialized', 'tools/list'],
    ]);
  });

  it('falls back to MCP when a server target is declared but currently disconnected over REST', async () => {
    mockedApiClientGet.mockResolvedValue({
      ok: false,
      status: 503,
      error: "Server 'serena' is not currently connected",
    });
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

    const cacheDir = join(process.cwd(), '.tmp-test', 'inspect-command-unit', 'rest-disconnected-server');
    await rm(cacheDir, { recursive: true, force: true });
    await mkdir(cacheDir, { recursive: true });

    await inspectCommand({
      target: 'serena',
      format: 'text',
      'config-dir': cacheDir,
      'cli-session-cache-path': join(cacheDir, '.cli-session.{pid}'),
    } as never);

    expect(mockedStdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Inspect: Server'));
    expect(mockedStdoutWrite).toHaveBeenCalledWith(expect.stringContaining('server: serena'));
    expect(transportState.instances.map((instance) => instance.sentMessages.map((message) => message.method))).toEqual([
      ['initialize', 'notifications/initialized', 'tools/list'],
    ]);
  });

  it('uses instructions surface context when requested through getInspectResult', async () => {
    mockedApiClientGet.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: 'servers',
        servers: [
          {
            server: 'runner',
            toolCount: 1,
            hasInstructions: false,
          },
        ],
      },
      sessionId: 'instructions-rest-session',
    });
    const cacheDir = join(process.cwd(), '.tmp-test', 'inspect-command-unit', 'instructions-surface');
    await rm(cacheDir, { recursive: true, force: true });
    await mkdir(cacheDir, { recursive: true });
    const cachePath = getCliSessionCachePath({
      cachePathTemplate: join(cacheDir, '.cli-session.{pid}'),
      serverPid: 4242,
    });

    await getInspectResult(
      {
        'config-dir': cacheDir,
        'cli-session-cache-path': join(cacheDir, '.cli-session.{pid}'),
      } as never,
      { includeServerInstructions: true, clientSurface: 'instructions' },
    );

    const cache = await readCliSessionCache(
      cachePath,
      'http://127.0.0.1:3050/mcp',
      makeClientSurfaceContextHash('/tmp/project', 'instructions'),
    );
    expect(cache?.sessionId).toBe('instructions-rest-session');
    expect(
      await readCliSessionCache(cachePath, 'http://127.0.0.1:3050/mcp', makeClientSurfaceContextHash('/tmp/project')),
    ).toBeNull();
  });
});
