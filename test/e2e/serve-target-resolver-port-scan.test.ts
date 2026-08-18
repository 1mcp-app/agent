import { resolveServeTarget } from '@src/commands/shared/serveTargetResolver.js';
import type { ResolvedProjectContext } from '@src/config/projectConfigLoader.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runtimeIdentityResponse } from './fixtures/runtimeTargetFixtures.js';

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
        return runtimeIdentityResponse({
          runtimeScopeId: 'ae625936-93ea-4d98-a2d7-c7967c5c19ca',
          externalUrl: 'http://127.0.0.1:3050',
        });
      }
      throw new Error(`Unexpected probe URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveServeTarget(
      { context: 'local' },
      {
        runtimeTargetStore: {
          inspect: vi.fn().mockReturnValue({ name: 'local', kind: 'local', synthetic: true, current: true }),
          current: vi.fn().mockReturnValue({ name: 'local', kind: 'local', synthetic: true, current: true }),
          requireInsecureTlsConfirmation: vi.fn(),
          updateObservedIdentityMetadata: vi.fn(),
        },
      },
    );

    expect(result.source).toBe('portscan');
    expect(result.discoveredUrl).toBe('http://127.0.0.1:3050/mcp');
    expect(result.runtimeTargetContext).toEqual({
      name: 'local',
      kind: 'local',
      runtimeScopeId: 'ae625936-93ea-4d98-a2d7-c7967c5c19ca',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:3050/.well-known/1mcp/runtime-identity',
      'http://[::1]:3050/.well-known/1mcp/runtime-identity',
      'http://127.0.0.1:3050/.well-known/1mcp/runtime-identity',
    ]);
  });
});
