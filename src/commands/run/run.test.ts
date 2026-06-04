import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { buildCliContext } from '@src/commands/shared/cliContext.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildServerUrl,
  getCliSessionContextHash,
  readCliSessionCache,
  SESSION_CACHE_TTL_MS,
  writeCliSessionCache,
} from './run.js';

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

  describe('buildServerUrl', () => {
    it('rejects multiple query selectors instead of silently applying precedence', () => {
      expect(() =>
        buildServerUrl('http://127.0.0.1:3050/mcp', {
          preset: 'dev',
          filter: 'a && b',
          tags: ['x', 'y'],
          'tag-filter': 'foo',
        }),
      ).toThrow(
        'Cannot use multiple filtering parameters simultaneously. Use "preset" for dynamic presets, "tag-filter" for advanced expressions, "filter" for legacy compatibility, or "tags" for simple OR filtering.',
      );
    });

    it('applies preset when it is the only selector', () => {
      const url = buildServerUrl('http://127.0.0.1:3050/mcp', {
        preset: 'dev',
      });

      expect(url.searchParams.get('preset')).toBe('dev');
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
    let runContextHash: string;

    beforeEach(async () => {
      const baseDir = join(process.cwd(), '.tmp-test', 'run-command-unit');
      await mkdir(baseDir, { recursive: true });
      cacheDir = await mkdtemp(join(baseDir, 'cache-'));
      cachePath = join(cacheDir, '.cli-session.4242');
      runContextHash = makeContextHash('/tmp/agent', 'run', 'run');
    });

    afterEach(async () => {
      await rm(cacheDir, { recursive: true, force: true });
    });

    it('writes and reads a matching non-expired cache entry', async () => {
      await writeCliSessionCache(cachePath, {
        sessionId: 'session-1',
        serverUrl: 'http://127.0.0.1:3050/mcp?preset=dev',
        contextHash: runContextHash,
        savedAt: Date.now(),
        hasRestEndpoint: false,
      });

      const entries = await readdir(cacheDir);
      expect(entries).toEqual(['.cli-session.4242']);

      const cacheDirStats = await stat(cacheDir);
      const cacheFileStats = await stat(cachePath);
      expect(cacheDirStats.mode & 0o777).toBe(0o700);
      expect(cacheFileStats.mode & 0o777).toBe(0o600);

      const cache = await readCliSessionCache(cachePath, 'http://127.0.0.1:3050/mcp?preset=dev', runContextHash);
      expect(cache?.sessionId).toBe('session-1');
    });

    it('returns null for expired cache entries', async () => {
      await writeCliSessionCache(cachePath, {
        sessionId: 'session-1',
        serverUrl: 'http://127.0.0.1:3050/mcp',
        contextHash: runContextHash,
        savedAt: Date.now() - SESSION_CACHE_TTL_MS - 1,
        hasRestEndpoint: false,
      });

      const cache = await readCliSessionCache(cachePath, 'http://127.0.0.1:3050/mcp', runContextHash);
      expect(cache).toBeNull();
    });

    it('returns null when the server URL does not match', async () => {
      await writeCliSessionCache(cachePath, {
        sessionId: 'session-1',
        serverUrl: 'http://127.0.0.1:3050/mcp?preset=dev',
        contextHash: runContextHash,
        savedAt: Date.now(),
        hasRestEndpoint: false,
      });

      const cache = await readCliSessionCache(cachePath, 'http://127.0.0.1:3050/mcp?preset=prod', runContextHash);
      expect(cache).toBeNull();
    });

    it('returns null when the context hash does not match', async () => {
      await writeCliSessionCache(cachePath, {
        sessionId: 'session-1',
        serverUrl: 'http://127.0.0.1:3050/mcp',
        contextHash: runContextHash,
        savedAt: Date.now(),
        hasRestEndpoint: false,
      });

      const inspectContextHash = getCliSessionContextHash({
        ...buildCliContext({
          transportType: 'inspect',
          version: 'inspect',
        }),
        project: {
          ...buildCliContext({
            transportType: 'inspect',
            version: 'inspect',
          }).project,
          path: '/tmp/agent',
          name: 'agent',
        },
        environment: {
          ...buildCliContext({
            transportType: 'inspect',
            version: 'inspect',
          }).environment,
          variables: {
            ...buildCliContext({
              transportType: 'inspect',
              version: 'inspect',
            }).environment.variables,
            PWD: '/tmp/agent',
          },
        },
        timestamp: new Date('2026-01-02T00:00:00.000Z').toISOString(),
      });

      const cache = await readCliSessionCache(cachePath, 'http://127.0.0.1:3050/mcp', inspectContextHash);
      expect(cache).toBeNull();
    });

    it('returns null for legacy cache entries without a context hash', async () => {
      await writeFile(
        cachePath,
        JSON.stringify({
          sessionId: 'session-1',
          serverUrl: 'http://127.0.0.1:3050/mcp',
          savedAt: Date.now(),
        }),
        'utf8',
      );

      const cache = await readCliSessionCache(cachePath, 'http://127.0.0.1:3050/mcp', runContextHash);
      expect(cache).toBeNull();
    });
  });

  describe('context hash', () => {
    it('ignores timestamp changes', () => {
      const first = getCliSessionContextHash({
        ...buildCliContext({ transportType: 'run', version: 'run' }),
        project: { ...buildCliContext({ transportType: 'run', version: 'run' }).project, path: '/tmp/project-a' },
        environment: {
          ...buildCliContext({ transportType: 'run', version: 'run' }).environment,
          variables: {
            ...buildCliContext({ transportType: 'run', version: 'run' }).environment.variables,
            PWD: '/tmp/project-a',
          },
        },
        timestamp: '2026-01-01T00:00:00.000Z',
      });
      const second = getCliSessionContextHash({
        ...buildCliContext({ transportType: 'run', version: 'run' }),
        project: { ...buildCliContext({ transportType: 'run', version: 'run' }).project, path: '/tmp/project-a' },
        environment: {
          ...buildCliContext({ transportType: 'run', version: 'run' }).environment,
          variables: {
            ...buildCliContext({ transportType: 'run', version: 'run' }).environment.variables,
            PWD: '/tmp/project-a',
          },
        },
        timestamp: '2026-01-02T00:00:00.000Z',
      });

      expect(second).toBe(first);
    });

    it('changes when project path changes', () => {
      const first = makeContextHash('/tmp/project-a', 'run', 'run');
      const second = makeContextHash('/tmp/project-b', 'run', 'run');

      expect(second).not.toBe(first);
    });

    it('ignores cwd changes when project root is the same', () => {
      const first = getCliSessionContextHash(
        buildCliContext({
          cwd: '/tmp/project-a/packages/api',
          projectRoot: '/tmp/project-a',
          transportType: 'run',
          version: 'run',
        }),
      );
      const second = getCliSessionContextHash(
        buildCliContext({
          cwd: '/tmp/project-a/packages/worker',
          projectRoot: '/tmp/project-a',
          transportType: 'run',
          version: 'run',
        }),
      );

      expect(second).toBe(first);
    });

    it('changes when transport context changes', () => {
      const runHash = makeContextHash('/tmp/project-a', 'run', 'run');
      const inspectHash = makeContextHash('/tmp/project-a', 'inspect', 'inspect');

      expect(inspectHash).not.toBe(runHash);
    });
  });
});
