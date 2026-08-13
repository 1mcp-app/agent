import type { ResolvedProjectContext } from '@src/config/projectConfigLoader.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveServeTarget } from './serveTargetResolver.js';

const mockedResolveProjectContext = vi.hoisted(() => vi.fn());
const mockedDiscoverScopedRuntime = vi.hoisted(() => vi.fn());

vi.mock('@src/config/projectConfigLoader.js', async () => {
  const actual = await vi.importActual<typeof import('@src/config/projectConfigLoader.js')>(
    '@src/config/projectConfigLoader.js',
  );
  return { ...actual, resolveProjectContext: mockedResolveProjectContext };
});

vi.mock('@src/core/server/runtimeLifecycle.js', async () => {
  const actual = await vi.importActual<typeof import('@src/core/server/runtimeLifecycle.js')>(
    '@src/core/server/runtimeLifecycle.js',
  );
  return { ...actual, discoverScopedRuntime: mockedDiscoverScopedRuntime };
});

describe('resolveServeTarget port-scan composition', () => {
  beforeEach(() => {
    mockedResolveProjectContext.mockResolvedValue({
      cwd: '/tmp/project',
      projectRoot: '/tmp/project',
      projectName: 'project',
      projectConfig: {},
      source: 'repo-root',
    } satisfies ResolvedProjectContext);
    mockedDiscoverScopedRuntime.mockResolvedValue({ status: 'absent' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('runs dual-family discovery followed by one validation of the winning address', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('http://[::1]:3050/')) {
        const cause = Object.assign(new Error('connect ECONNREFUSED ::1:3050'), { code: 'ECONNREFUSED' });
        throw Object.assign(new TypeError('fetch failed'), { cause });
      }
      if (url.startsWith('http://127.0.0.1:3050/')) {
        return runtimeIdentityResponse();
      }
      throw new Error(`Unexpected probe URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveServeTarget(
      {},
      {
        runtimeTargetStore: {
          inspect: vi.fn(),
          current: vi.fn().mockReturnValue({ name: 'local', kind: 'local', synthetic: true, current: true }),
          requireInsecureTlsConfirmation: vi.fn(),
          updateObservedIdentityMetadata: vi.fn(),
        },
      },
    );

    expect(result.source).toBe('portscan');
    expect(result.discoveredUrl).toBe('http://127.0.0.1:3050/mcp');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:3050/.well-known/1mcp/runtime-identity',
      'http://[::1]:3050/.well-known/1mcp/runtime-identity',
      'http://127.0.0.1:3050/.well-known/1mcp/runtime-identity',
    ]);
  });
});

function runtimeIdentityResponse(): Response {
  return new Response(
    JSON.stringify({
      identityProtocolVersion: '1',
      runtimeScopeId: 'ae625936-93ea-4d98-a2d7-c7967c5c19ca',
      externalUrl: 'http://127.0.0.1:3050',
      runtimeVersion: '0.35.0-beta.4',
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}
