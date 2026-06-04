import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { buildCliContext } from '@src/commands/shared/cliContext.js';
import {
  getCliSessionCachePath,
  getCliSessionContextHash,
  writeCliSessionCache,
} from '@src/commands/shared/serveClient.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { inspectCommand } from './inspect.js';

interface MockSchemaPayload {
  tools: Tool[];
}

const transportState = vi.hoisted(() => ({
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

  it('lists servers for bare inspect without printing instruction blocks', async () => {
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
    });
    const cacheDir = join(process.cwd(), '.tmp-test', 'inspect-command-unit', 'inspect-servers');
    await mkdir(cacheDir, { recursive: true });

    await inspectCommand({
      format: 'text',
      'config-dir': cacheDir,
      'cli-session-cache-path': join(cacheDir, '.cli-session.{pid}'),
    } as never);

    expect(mockedStdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Inspect: Servers'));
    expect(mockedStdoutWrite).toHaveBeenCalledWith(expect.stringContaining('- server: runner'));
    expect(mockedStdoutWrite).not.toHaveBeenCalledWith(
      expect.stringContaining('# 1MCP - Model Context Protocol Proxy'),
    );
    expect(transportState.instances).toHaveLength(0);
  });

  it('omits server instructions for server targets', async () => {
    mockedApiClientGet.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: 'server',
        server: 'serena',
        instructions: '# Serena Instructions\nUse Serena tools first.',
        tools: [
          {
            tool: 'find_symbol',
            qualifiedName: 'serena_1mcp_find_symbol',
            description: 'Find symbol',
            requiredArgs: 1,
            optionalArgs: 0,
          },
        ],
        totalTools: 1,
        hasMore: false,
      },
    });
    const cacheDir = join(process.cwd(), '.tmp-test', 'inspect-command-unit', 'retry-missing-instructions');
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

    await inspectCommand({
      target: 'serena',
      format: 'text',
      'config-dir': cacheDir,
      'cli-session-cache-path': join(cacheDir, '.cli-session.{pid}'),
    } as never);

    expect(mockedStdoutWrite).toHaveBeenCalledWith(expect.stringContaining('Inspect: Server'));
    expect(mockedStdoutWrite).not.toHaveBeenCalledWith(expect.stringContaining('instructions:'));
    expect(mockedStdoutWrite).not.toHaveBeenCalledWith(expect.stringContaining('# Serena Instructions'));
    expect(mockedStdoutWrite).not.toHaveBeenCalledWith(
      expect.stringContaining('# 1MCP - Model Context Protocol Proxy'),
    );
    expect(transportState.instances).toHaveLength(0);
  });
});
