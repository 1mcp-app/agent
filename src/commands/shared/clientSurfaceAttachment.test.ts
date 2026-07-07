import type { ProjectConfig } from '@src/config/projectConfigTypes.js';
import type { ContextData } from '@src/types/context.js';

import { describe, expect, it, vi } from 'vitest';

import type { AuthProfile } from './authProfileStore.js';
import {
  attachFreshClientSurface,
  attachReusableClientSurface,
  type ClientSurfaceRestResponse,
  formatClientSurfaceAuthRequiredMessage,
  type ResolvedAttachmentTarget,
} from './clientSurfaceAttachment.js';
import type { CliSessionCache } from './serveClient.js';

interface TestFreshOptions {
  'config-dir'?: string;
  filter?: string;
  url?: string;
}

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
    source: 'pidfile',
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
    const rest = vi.fn(async (): Promise<ClientSurfaceRestResponse<string>> => ({
      status: 'fallback',
      reason: 'endpoint_missing',
    }));
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
    const rest = vi.fn(async (): Promise<ClientSurfaceRestResponse<string>> => ({
      status: 'fallback',
      reason: 'transient_failure',
    }));
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
    const rest = vi.fn(async (): Promise<ClientSurfaceRestResponse<string>> => ({
      status: 'auth_required',
      message: 'Authentication required.',
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

  it('does not load URL-keyed auth profiles for remote target contexts or ephemeral URLs', async () => {
    const remoteTarget = makeResolvedTarget({
      runtimeTargetContext: {
        name: 'prod',
        kind: 'remote',
      },
      discoveredUrl: 'https://prod.example.com/mcp',
      serverUrl: new URL('https://prod.example.com/mcp'),
    });
    const ports = makePorts({
      target: remoteTarget,
      authProfile: {
        serverUrl: 'https://prod.example.com',
        token: 'legacy-token',
        savedAt: 1000,
      },
    });
    const rest = vi.fn(async () => ({
      status: 'success' as const,
      value: { ok: true },
    }));

    const result = await attachReusableClientSurface({
      clientSurface: 'run',
      version: 'run',
      options: { context: 'prod' },
      ports,
      rest,
      mcp: unusedAdapter(),
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      throw new Error(`Unexpected attachment status: ${result.status}`);
    }
    expect(ports.loadAuthProfile).not.toHaveBeenCalled();
    expect(rest).toHaveBeenCalledWith(expect.objectContaining({ bearerToken: undefined }));

    const ephemeralPorts = makePorts({
      target: makeResolvedTarget({
        mergedOptions: {
          url: 'https://adhoc.example.com',
        },
        discoveredUrl: 'https://adhoc.example.com/mcp',
        serverUrl: new URL('https://adhoc.example.com/mcp'),
      }),
      authProfile: {
        serverUrl: 'https://adhoc.example.com',
        token: 'legacy-url-token',
        savedAt: 1000,
      },
    });

    await attachReusableClientSurface({
      clientSurface: 'inspect',
      version: 'inspect',
      options: { url: 'https://adhoc.example.com' },
      ports: ephemeralPorts,
      rest,
      mcp: unusedAdapter(),
    });

    expect(ephemeralPorts.loadAuthProfile).not.toHaveBeenCalled();
  });

  it('formats authentication recovery for local, remote context, and ephemeral URL attachments', () => {
    expect(
      formatClientSurfaceAuthRequiredMessage({
        baseUrl: 'http://127.0.0.1:3050',
        options: {},
        target: makeResolvedTarget(),
      }),
    ).toBe('Authentication required. Run: 1mcp auth login --url http://127.0.0.1:3050 --token <your-token>');

    expect(
      formatClientSurfaceAuthRequiredMessage({
        baseUrl: 'https://prod.example.com',
        options: { context: 'prod' },
        target: makeResolvedTarget({
          runtimeTargetContext: {
            name: 'prod',
            kind: 'remote',
          },
        }),
      }),
    ).toBe(
      'Authentication required for target context "prod". Context-scoped credentials are required; URL-keyed auth profiles are not used for runtime targets.',
    );

    expect(
      formatClientSurfaceAuthRequiredMessage({
        baseUrl: 'https://adhoc.example.com',
        options: { url: 'https://adhoc.example.com' },
        target: makeResolvedTarget(),
      }),
    ).toBe(
      'Authentication required for ephemeral URL target. Ephemeral URLs are credentialless; run: 1mcp target add <name> https://adhoc.example.com and retry with --context <name> after context-scoped credentials are available.',
    );
  });

  it('prints remote runtime identity warnings to stderr during attachment', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const ports = makePorts({
      target: makeResolvedTarget({
        runtimeIdentityWarnings: [
          {
            code: 'warning_external_url_mismatch',
            message: 'Runtime identity externalUrl differs from configured URL',
          },
        ],
      }),
    });

    try {
      await attachReusableClientSurface({
        clientSurface: 'inspect',
        version: 'inspect',
        options: {},
        ports,
        rest: vi.fn(async () => ({ status: 'success' as const, value: 'ok' })),
        mcp: unusedAdapter(),
      });
      expect(stderr).toHaveBeenCalledWith(
        'warning_external_url_mismatch: Runtime identity externalUrl differs from configured URL\n',
      );
    } finally {
      stderr.mockRestore();
    }
  });
});

describe('attachFreshClientSurface', () => {
  it('builds a fresh proxy attachment without reading or writing the reusable session cache', async () => {
    const ports = makePorts({
      target: makeResolvedTarget({
        mergedOptions: {
          'config-dir': '/tmp/config',
          filter: 'web,api',
        },
        discoveredUrl: 'http://127.0.0.1:3050/mcp',
        serverUrl: new URL('http://127.0.0.1:3050/mcp?filter=web%2Capi'),
      }),
      authProfile: {
        serverUrl: 'http://127.0.0.1:3050',
        token: 'secret-token',
        savedAt: 1000,
      },
    });

    const result = await attachFreshClientSurface({
      clientSurface: 'stdio-proxy',
      version: 'proxy',
      options: { 'config-dir': '/tmp/config' } as TestFreshOptions,
      ports,
    });

    expect(result.requestSessionId).toMatch(/^stream-/);
    expect(result.sessionId).toBe(result.requestSessionId);
    expect(result.context.sessionId).toBe(result.requestSessionId);
    expect(result.context.transport?.type).toBe('stdio-proxy');
    expect(result.context.version).toBe('proxy');
    expect(result.baseUrl).toBe('http://127.0.0.1:3050');
    expect(result.serverUrl.toString()).toBe('http://127.0.0.1:3050/mcp?filter=web%2Capi');
    expect(result.options.filter).toBe('web,api');
    expect(result.bearerToken).toBe('secret-token');
    expect(ports.resolveTarget).toHaveBeenCalledWith({ 'config-dir': '/tmp/config' });
    expect(ports.loadAuthProfile).toHaveBeenCalledWith('/tmp/config', 'http://127.0.0.1:3050');
    expect(ports.readSessionCache).not.toHaveBeenCalled();
    expect(ports.writeSessionCache).not.toHaveBeenCalled();
    expect(ports.deleteSessionCache).not.toHaveBeenCalled();
  });
});
