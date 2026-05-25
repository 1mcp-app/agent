import type { ProjectConfig } from '@src/config/projectConfigTypes.js';
import type { ContextData } from '@src/types/context.js';

import { describe, expect, it, vi } from 'vitest';

import type { AuthProfile } from './authProfileStore.js';
import {
  attachReusableClientSurface,
  type ClientSurfaceRestResponse,
  type ResolvedAttachmentTarget,
} from './clientSurfaceAttachment.js';
import type { CliSessionCache } from './serveClient.js';

function makeResolvedTarget(overrides: Partial<ResolvedAttachmentTarget> = {}): ResolvedAttachmentTarget {
  return {
    cwd: '/tmp/project/packages/api',
    projectRoot: '/tmp/project',
    projectConfig: null,
    mergedOptions: {
      'config-dir': '/tmp/config',
      'cli-session-cache-path': '/tmp/cache/.cli-session.{pid}',
    },
    discoveredUrl: 'http://127.0.0.1:3050/mcp',
    serverUrl: new URL('http://127.0.0.1:3050/mcp'),
    serverPid: 4242,
    ...overrides,
  };
}

function makePorts(
  options: {
    target?: ResolvedAttachmentTarget;
    authProfile?: AuthProfile | null;
    cachedSession?: CliSessionCache | null;
  } = {},
) {
  return {
    resolveTarget: vi.fn().mockResolvedValue(options.target ?? makeResolvedTarget()),
    loadAuthProfile: vi.fn().mockResolvedValue(options.authProfile ?? null),
    readSessionCache: vi.fn().mockResolvedValue(options.cachedSession ?? null),
    writeSessionCache: vi.fn().mockResolvedValue(undefined),
    deleteSessionCache: vi.fn().mockResolvedValue(undefined),
    now: vi.fn(() => 1234),
  };
}

function unusedAdapter() {
  return vi.fn(async () => {
    throw new Error('Attachment adapter should not be called.');
  });
}

describe('attachReusableClientSurface', () => {
  it('builds a canonical request session and writes REST support after a successful REST attachment', async () => {
    const ports = makePorts();
    const rest = vi.fn(async ({ sessionId, context }: { sessionId: string; context: ContextData }) => ({
      status: 'success' as const,
      sessionId: `header-${sessionId}`,
      value: { ok: true },
      observed: { sessionId, context },
    }));
    const mcp = unusedAdapter();

    const result = await attachReusableClientSurface({
      clientSurface: 'run',
      version: 'run',
      options: { 'config-dir': '/tmp/config' },
      ports,
      rest,
      mcp,
    });

    if (result.status !== 'success') {
      throw new Error(`Unexpected attachment status: ${result.status}`);
    }

    expect(result.status).toBe('success');
    expect(result.protocol).toBe('rest');
    expect(result.requestSessionId).toMatch(/^rest-[a-f0-9]{16}$/);
    expect(result.sessionId).toBe(`header-${result.requestSessionId}`);
    expect(result.context.sessionId).toBe(result.requestSessionId);
    expect(rest).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'http://127.0.0.1:3050',
        bearerToken: undefined,
        sessionId: result.requestSessionId,
        context: expect.objectContaining({ sessionId: result.requestSessionId }),
      }),
    );
    expect(mcp).not.toHaveBeenCalled();
    expect(ports.writeSessionCache).toHaveBeenCalledWith(
      '/tmp/cache/.cli-session.4242',
      expect.objectContaining({
        sessionId: `header-${result.requestSessionId}`,
        serverUrl: 'http://127.0.0.1:3050/mcp',
        hasRestEndpoint: true,
        savedAt: 1234,
      }),
    );
  });

  it('reuses a matching cached session for REST and canonical context', async () => {
    const ports = makePorts({
      cachedSession: {
        sessionId: 'cached-session',
        serverUrl: 'http://127.0.0.1:3050/mcp',
        contextHash: 'hash-from-port',
        savedAt: 1000,
        hasRestEndpoint: true,
      },
    });
    const rest = vi.fn(async ({ sessionId, context }: { sessionId: string; context: ContextData }) => ({
      status: 'success' as const,
      value: { sessionId, contextSessionId: context.sessionId },
    }));
    const mcp = unusedAdapter();

    const result = await attachReusableClientSurface({
      clientSurface: 'run',
      version: 'run',
      options: {},
      ports,
      rest,
      mcp,
    });

    if (result.status !== 'success') {
      throw new Error(`Unexpected attachment status: ${result.status}`);
    }

    expect(result.protocol).toBe('rest');
    expect(result.requestSessionId).toBe('cached-session');
    expect(result.context.sessionId).toBe('cached-session');
    expect(rest).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'cached-session' }));
    expect(mcp).not.toHaveBeenCalled();
  });

  it('skips REST when the cache records endpoint support as false', async () => {
    const ports = makePorts({
      cachedSession: {
        sessionId: 'cached-session',
        serverUrl: 'http://127.0.0.1:3050/mcp',
        contextHash: 'hash-from-port',
        savedAt: 1000,
        hasRestEndpoint: false,
      },
    });
    const rest = unusedAdapter();
    const mcp = vi.fn(async ({ sessionId }: { sessionId: string }) => ({
      status: 'success' as const,
      sessionId,
      value: 'mcp-value',
    }));

    const result = await attachReusableClientSurface({
      clientSurface: 'inspect',
      version: 'inspect',
      options: {},
      ports,
      rest,
      mcp,
    });

    if (result.status !== 'success') {
      throw new Error(`Unexpected attachment status: ${result.status}`);
    }

    expect(result.protocol).toBe('mcp');
    expect(result.value).toBe('mcp-value');
    expect(rest).not.toHaveBeenCalled();
    expect(mcp).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'cached-session',
        sendInitialize: false,
      }),
    );
    expect(ports.writeSessionCache).toHaveBeenCalledWith(
      '/tmp/cache/.cli-session.4242',
      expect.objectContaining({ sessionId: 'cached-session', hasRestEndpoint: false }),
    );
  });

  it('falls back to MCP and persists unsupported REST on endpoint-missing responses', async () => {
    const ports = makePorts({
      cachedSession: {
        sessionId: 'cached-session',
        serverUrl: 'http://127.0.0.1:3050/mcp',
        contextHash: 'hash-from-port',
        savedAt: 1000,
        hasRestEndpoint: true,
      },
    });
    const rest = vi.fn(
      async (): Promise<ClientSurfaceRestResponse<string>> => ({
        status: 'fallback',
        reason: 'endpoint_missing',
      }),
    );
    const mcp = vi.fn(async ({ sessionId }: { sessionId: string }) => ({
      status: 'success' as const,
      sessionId,
      value: 'mcp-value',
    }));

    const result = await attachReusableClientSurface({
      clientSurface: 'run',
      version: 'run',
      options: {},
      ports,
      rest,
      mcp,
    });

    if (result.status !== 'success') {
      throw new Error(`Unexpected attachment status: ${result.status}`);
    }

    expect(result.protocol).toBe('mcp');
    expect(result.restSupport).toBe(false);
    expect(ports.writeSessionCache).toHaveBeenNthCalledWith(
      1,
      '/tmp/cache/.cli-session.4242',
      expect.objectContaining({ sessionId: 'cached-session', hasRestEndpoint: false }),
    );
    expect(ports.writeSessionCache).toHaveBeenLastCalledWith(
      '/tmp/cache/.cli-session.4242',
      expect.objectContaining({ sessionId: 'cached-session', hasRestEndpoint: false }),
    );
  });

  it('falls back to MCP without disabling REST support for transient REST failures', async () => {
    const ports = makePorts({
      cachedSession: {
        sessionId: 'cached-session',
        serverUrl: 'http://127.0.0.1:3050/mcp',
        contextHash: 'hash-from-port',
        savedAt: 1000,
        hasRestEndpoint: true,
      },
    });
    const rest = vi.fn(
      async (): Promise<ClientSurfaceRestResponse<string>> => ({
        status: 'fallback',
        reason: 'transient_failure',
      }),
    );
    const mcp = vi.fn(async ({ sessionId }: { sessionId: string }) => ({
      status: 'success' as const,
      sessionId,
      value: 'mcp-value',
    }));

    const result = await attachReusableClientSurface({
      clientSurface: 'inspect',
      version: 'inspect',
      options: {},
      ports,
      rest,
      mcp,
    });

    if (result.status !== 'success') {
      throw new Error(`Unexpected attachment status: ${result.status}`);
    }

    expect(result.protocol).toBe('mcp');
    expect(result.restSupport).toBe(true);
    expect(ports.writeSessionCache).toHaveBeenCalledTimes(1);
    expect(ports.writeSessionCache).toHaveBeenCalledWith(
      '/tmp/cache/.cli-session.4242',
      expect.objectContaining({ hasRestEndpoint: true }),
    );
  });

  it('surfaces REST authentication errors without MCP fallback', async () => {
    const ports = makePorts();
    const rest = vi.fn(
      async (): Promise<ClientSurfaceRestResponse<string>> => ({
        status: 'auth_required',
        message: 'Authentication required.',
      }),
    );
    const mcp = unusedAdapter();

    const result = await attachReusableClientSurface({
      clientSurface: 'run',
      version: 'run',
      options: {},
      ports,
      rest,
      mcp,
    });

    expect(result.status).toBe('auth_required');
    if (result.status !== 'auth_required') {
      throw new Error(`Unexpected attachment status: ${result.status}`);
    }
    expect(result.message).toBe('Authentication required.');
    expect(mcp).not.toHaveBeenCalled();
    expect(ports.writeSessionCache).not.toHaveBeenCalled();
  });

  it('deletes stale cached sessions and retries MCP with initialize on the same canonical session', async () => {
    const ports = makePorts({
      cachedSession: {
        sessionId: 'cached-session',
        serverUrl: 'http://127.0.0.1:3050/mcp',
        contextHash: 'hash-from-port',
        savedAt: 1000,
        hasRestEndpoint: false,
      },
    });
    const rest = vi.fn();
    const mcp = vi
      .fn()
      .mockResolvedValueOnce({ status: 'stale_session' as const })
      .mockResolvedValueOnce({ status: 'success' as const, sessionId: 'fresh-session', value: 'fresh-value' });

    const result = await attachReusableClientSurface({
      clientSurface: 'run',
      version: 'run',
      options: {},
      ports,
      rest,
      mcp,
    });

    if (result.status !== 'success') {
      throw new Error(`Unexpected attachment status: ${result.status}`);
    }

    expect(result.protocol).toBe('mcp');
    expect(result.value).toBe('fresh-value');
    expect(ports.deleteSessionCache).toHaveBeenCalledWith('/tmp/cache/.cli-session.4242');
    expect(mcp).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ sessionId: 'cached-session', sendInitialize: false }),
    );
    expect(mcp).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ sessionId: 'cached-session', sendInitialize: true }),
    );
  });

  it('passes auth profile token and project-config environment into attachment context', async () => {
    const projectConfig: ProjectConfig = {
      context: {
        environment: 'staging',
        team: 'platform',
        envPrefixes: ['ONE_MCP_TEST_'],
      },
    };
    const ports = makePorts({
      target: makeResolvedTarget({ projectConfig }),
      authProfile: {
        serverUrl: 'http://127.0.0.1:3050',
        token: 'secret-token',
        savedAt: 1000,
      },
    });
    process.env.ONE_MCP_TEST_VALUE = 'included';
    const rest = vi.fn(async ({ bearerToken, context }: { bearerToken?: string; context: ContextData }) => ({
      status: 'success' as const,
      value: { bearerToken, context },
    }));

    const result = await attachReusableClientSurface({
      clientSurface: 'inspect',
      version: 'inspect',
      options: {},
      ports,
      rest,
      mcp: unusedAdapter(),
    });

    if (result.status !== 'success') {
      throw new Error(`Unexpected attachment status: ${result.status}`);
    }

    expect(result.value.bearerToken).toBe('secret-token');
    expect(result.context.project.environment).toBe('staging');
    expect(result.context.project.custom).toMatchObject({ team: 'platform' });
    expect(result.context.environment.variables?.ONE_MCP_TEST_VALUE).toBe('included');
    delete process.env.ONE_MCP_TEST_VALUE;
  });
});
