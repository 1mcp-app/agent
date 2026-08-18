import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveServeTarget } from '@src/commands/shared/serveTargetResolver.js';
import { writePidFile } from '@src/core/server/pidFileManager.js';
import { RuntimeTargetStore } from '@src/domains/runtime-targets/runtimeTargetStore.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { localRuntimePidFile, runtimeIdentityResponse } from './fixtures/runtimeTargetFixtures.js';

describe('local Runtime Target Context PID discovery', () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), '1mcp-local-target-probe-'));
    writePidFile(configDir, localRuntimePidFile(configDir));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await rm(configDir, { recursive: true, force: true });
  });

  it('reuses the PID discovery identity before attaching with the local context', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request) =>
      runtimeIdentityResponse({
        runtimeScopeId: 'scope-local',
        externalUrl: 'http://localhost:3050',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveServeTarget(
      { context: 'local', 'config-dir': configDir },
      { runtimeTargetStore: new RuntimeTargetStore({ storeDir: join(configDir, 'targets') }) },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'http://127.0.0.1:3050/.well-known/1mcp/runtime-identity',
      'http://[::1]:3050/.well-known/1mcp/runtime-identity',
    ]);
    expect(result.runtimeTargetContext).toEqual({
      name: 'local',
      kind: 'local',
      runtimeScopeId: 'scope-local',
    });
  });
});
