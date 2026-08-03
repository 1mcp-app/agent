import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { detectRunningServerUrl, validateServer1mcpUrl } from './urlDetection.js';

const mockedFetchRuntimeTargetUrl = vi.hoisted(() => vi.fn());

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
    mockedFetchRuntimeTargetUrl
      .mockResolvedValueOnce(response({ status: 404 }))
      .mockResolvedValueOnce(response({ status: 429 }));

    await expect(validateServer1mcpUrl('http://127.0.0.1:3050/mcp')).resolves.toMatchObject({ valid: false });
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

function response(input: { status: number; location?: string; body?: unknown }) {
  return {
    ok: input.status >= 200 && input.status < 300,
    status: input.status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'location' ? (input.location ?? null) : null),
    },
    json: async () => input.body ?? {},
  };
}
