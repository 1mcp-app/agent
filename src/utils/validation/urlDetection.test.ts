import { afterEach, describe, expect, it, vi } from 'vitest';

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
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('accepts the OAuth dashboard redirect as reachable', async () => {
    mockedFetchRuntimeTargetUrl.mockResolvedValueOnce(response({ status: 302, location: '/admin' }));

    await expect(validateServer1mcpUrl('http://127.0.0.1:3050/mcp')).resolves.toEqual({ valid: true });

    expect(mockedFetchRuntimeTargetUrl).toHaveBeenCalledWith(
      'http://127.0.0.1:3050/oauth/',
      expect.objectContaining({ redirect: 'manual' }),
    );
  });

  it('keeps non-redirect client errors invalid', async () => {
    mockedFetchRuntimeTargetUrl.mockResolvedValueOnce(response({ status: 429 }));

    await expect(validateServer1mcpUrl('http://127.0.0.1:3050/mcp')).resolves.toMatchObject({ valid: false });
  });
});

describe('detectRunningServerUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('detects a local server whose OAuth route redirects to the admin console', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/admin' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(detectRunningServerUrl()).resolves.toBe('http://localhost:3050/mcp');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3050/oauth/',
      expect.objectContaining({ redirect: 'manual' }),
    );
  });
});

function response(input: { status: number; location?: string }) {
  return {
    ok: input.status >= 200 && input.status < 300,
    status: input.status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'location' ? (input.location ?? null) : null),
    },
    json: async () => ({}),
  };
}
