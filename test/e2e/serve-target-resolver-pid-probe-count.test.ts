import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveServeTarget } from '@src/commands/shared/serveTargetResolver.js';
import { writePidFile } from '@src/core/server/pidFileManager.js';
import { RuntimeTargetStore } from '@src/domains/runtime-targets/runtimeTargetStore.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('local Runtime Target Context PID discovery', () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), '1mcp-local-target-probe-'));
    writePidFile(configDir, {
      pid: process.pid,
      url: 'http://localhost:3050/mcp',
      port: 3050,
      host: 'localhost',
      transport: 'http',
      startedAt: '2026-08-18T00:00:00.000Z',
      configDir,
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await rm(configDir, { recursive: true, force: true });
  });

  it('reuses the PID discovery identity before attaching with the local context', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request) => runtimeIdentityResponse());
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

function runtimeIdentityResponse(): Response {
  return new Response(
    JSON.stringify({
      identityProtocolVersion: '1',
      runtimeScopeId: 'scope-local',
      externalUrl: 'http://localhost:3050',
      runtimeVersion: '0.35.0-beta.4',
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}
