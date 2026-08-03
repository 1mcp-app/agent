import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { detectRunningServerUrl, discoverServerWithPidFile, validateServer1mcpUrl } from './urlDetection.js';

const mockedFetchRuntimeTargetUrl = vi.hoisted(() => vi.fn());
const mockedDiscoverScopedRuntime = vi.hoisted(() => vi.fn());

vi.mock('@src/core/server/runtimeLifecycle.js', async () => {
  const actual = await vi.importActual<typeof import('@src/core/server/runtimeLifecycle.js')>(
    '@src/core/server/runtimeLifecycle.js',
  );
  return {
    ...actual,
    discoverScopedRuntime: mockedDiscoverScopedRuntime,
  };
});

vi.mock('@src/domains/runtime-targets/runtimeIdentityVerification.js', async () => {
  const actual = await vi.importActual<typeof import('@src/domains/runtime-targets/runtimeIdentityVerification.js')>(
    '@src/domains/runtime-targets/runtimeIdentityVerification.js',
  );
  return {
    ...actual,
    fetchRuntimeTargetUrl: mockedFetchRuntimeTargetUrl,
  };
});

describe('validateServer1mcpUrl', () => {
  beforeEach(() => {
    mockedFetchRuntimeTargetUrl.mockReset();
    mockedDiscoverScopedRuntime.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses the OAuth dashboard redirect as a fallback for runtimes without identity discovery', async () => {
    mockedFetchRuntimeTargetUrl
      .mockResolvedValueOnce(response({ status: 404 }))
      .mockResolvedValueOnce(response({ status: 302, location: '/admin' }));

    await expect(validateServer1mcpUrl('http://127.0.0.1:3050/mcp')).resolves.toEqual({ valid: true });

    expect(mockedFetchRuntimeTargetUrl).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:3050/.well-known/1mcp/runtime-identity',
      expect.objectContaining({ credentials: 'omit' }),
    );
    expect(mockedFetchRuntimeTargetUrl).toHaveBeenCalledWith(
      'http://127.0.0.1:3050/oauth/',
      expect.objectContaining({ redirect: 'manual' }),
    );
  });

  it('does not reject a healthy runtime when the OAuth route is rate limited', async () => {
    mockedFetchRuntimeTargetUrl.mockImplementation(async (url: string) => {
      if (url.endsWith('/.well-known/1mcp/runtime-identity')) {
        return response({
          status: 200,
          body: {
            identityProtocolVersion: '1',
            runtimeScopeId: 'ae625936-93ea-4d98-a2d7-c7967c5c19ca',
            externalUrl: 'http://127.0.0.1:3050',
            runtimeVersion: '0.35.0-beta.3',
            serverTime: '2026-08-03T08:10:47.192Z',
          },
        });
      }
      return response({ status: 429 });
    });

    await expect(validateServer1mcpUrl('http://127.0.0.1:3050/mcp')).resolves.toEqual({ valid: true });

    expect(mockedFetchRuntimeTargetUrl).toHaveBeenCalledTimes(1);
    expect(mockedFetchRuntimeTargetUrl).not.toHaveBeenCalledWith('http://127.0.0.1:3050/oauth/', expect.anything());
  });

  it('keeps non-redirect client errors invalid', async () => {
    mockedFetchRuntimeTargetUrl.mockResolvedValueOnce(response({ status: 404 })).mockResolvedValueOnce(
      response({
        status: 429,
        retryAfter: '720',
        body: { error: 'Too many requests, please try again later.' },
      }),
    );

    await expect(validateServer1mcpUrl('http://127.0.0.1:3050/mcp')).resolves.toMatchObject({
      valid: false,
      error: 'HTTP 429: Too many requests, please try again later.',
      failure: {
        failureKind: 'http_rejection',
        endpoint: '/oauth/',
        reason: 'Too many requests, please try again later.',
        retryable: true,
        httpStatus: 429,
        retryAfterSeconds: 720,
      },
    });
  });

  it('does not use legacy OAuth fallback for non-404 identity failures', async () => {
    mockedFetchRuntimeTargetUrl.mockResolvedValueOnce(
      response({ status: 503, retryAfter: '30', body: { message: 'Runtime identity is temporarily unavailable' } }),
    );

    const result = await validateServer1mcpUrl('http://127.0.0.1:3050/mcp');
    expect(result).toMatchObject({
      valid: false,
      failure: {
        endpoint: '/.well-known/1mcp/runtime-identity',
        httpStatus: 503,
        reason: 'Runtime identity is temporarily unavailable',
      },
    });
    expect(result.failure?.retryAfterSeconds).toBeUndefined();
    expect(mockedFetchRuntimeTargetUrl).toHaveBeenCalledTimes(1);
  });

  it('preserves connection refusal as a retryable transport failure', async () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3050'), { code: 'ECONNREFUSED' });
    mockedFetchRuntimeTargetUrl.mockRejectedValueOnce(Object.assign(new TypeError('fetch failed'), { cause }));

    await expect(validateServer1mcpUrl('http://127.0.0.1:3050/mcp')).resolves.toMatchObject({
      valid: false,
      failure: {
        failureKind: 'connection_refused',
        endpoint: '/.well-known/1mcp/runtime-identity',
        reason: 'Connection refused (ECONNREFUSED)',
        retryable: true,
      },
    });
    expect(mockedFetchRuntimeTargetUrl).toHaveBeenCalledTimes(1);
  });

  it('reports a live PID probe rejection instead of scanning another port', async () => {
    mockedDiscoverScopedRuntime.mockImplementation(async (_configDir, probe) => {
      const info = {
        pid: 4242,
        url: 'http://127.0.0.1:3050/mcp',
        port: 3050,
        host: '127.0.0.1',
        transport: 'http',
        startedAt: '2026-08-03T00:00:00.000Z',
        configDir: '/tmp/runtime-scope',
      };
      const reachable = await probe(info);
      return { status: reachable ? 'running' : 'unreachable', info };
    });
    mockedFetchRuntimeTargetUrl
      .mockResolvedValueOnce(response({ status: 404 }))
      .mockResolvedValueOnce(
        response({ status: 429, retryAfter: '60', body: { error: 'Too many requests, please try again later.' } }),
      );
    const portScanFetch = vi.fn();
    vi.stubGlobal('fetch', portScanFetch);

    await expect(discoverServerWithPidFile('/tmp/runtime-scope')).rejects.toMatchObject({
      code: 'runtime_probe_failed',
      retryable: true,
      details: expect.objectContaining({
        targetKind: 'local',
        pid: 4242,
        httpStatus: 429,
        retryAfterSeconds: 60,
        nextAction: 'retry_original_command',
      }),
    });
    expect(portScanFetch).not.toHaveBeenCalled();
  });
});

describe('detectRunningServerUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('detects a local server through runtime identity without probing OAuth', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(detectRunningServerUrl()).resolves.toBe('http://localhost:3050/mcp');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3050/.well-known/1mcp/runtime-identity',
      expect.objectContaining({ redirect: 'manual' }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function response(input: { status: number; location?: string; retryAfter?: string; body?: unknown }) {
  return {
    ok: input.status >= 200 && input.status < 300,
    status: input.status,
    headers: {
      get: (name: string) => {
        if (name.toLowerCase() === 'location') return input.location ?? null;
        if (name.toLowerCase() === 'retry-after') return input.retryAfter ?? null;
        return null;
      },
    },
    json: async () => input.body ?? {},
  };
}
