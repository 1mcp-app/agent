import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ClientSurfaceAttachmentContext } from '@src/commands/shared/clientSurfaceAttachment.js';

import { selectWaitServers, waitForServers, WaitCommandError, type WaitCommandOptions } from './wait.js';

const baseContext: ClientSurfaceAttachmentContext<WaitCommandOptions> = {
  target: {
    cwd: '/tmp/project',
    projectRoot: '/tmp/project',
    projectConfig: null,
    mergedOptions: {},
    discoveredUrl: 'http://127.0.0.1:3050/mcp',
    serverUrl: new URL('http://127.0.0.1:3050/mcp'),
    source: 'user',
  },
  options: {},
  baseUrl: 'http://127.0.0.1:3050',
  serverUrl: new URL('http://127.0.0.1:3050/mcp'),
  context: {
    project: { path: '/tmp/project', cwd: '/tmp/project', name: 'project' },
    user: {},
    environment: {},
  },
  contextHash: 'wait-test',
  cachePath: '/tmp/wait-test',
  cachedSession: null,
  requestSessionId: 'wait-session',
  sessionId: 'wait-session',
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name === 'content-type' ? 'application/json' : null) },
    json: async () => body,
  };
}

describe('wait status workflow', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('waits only for enabled configured static servers and succeeds when connected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          kind: 'servers',
          servers: [
            { server: 'static', type: 'external', status: 'connected', available: true, loadTracked: true },
            { server: 'template', type: 'template', status: 'connected', available: true, loadTracked: false },
          ],
        }),
      ),
    );

    const result = await waitForServers(baseContext, 1_000);

    expect(result).toMatchObject({
      status: 'success',
      value: { servers: [{ server: 'static', status: 'connected' }] },
    });
  });

  it('rejects a template target without waiting', () => {
    try {
      selectWaitServers(
        [{ server: 'template', type: 'template', status: 'connected', available: true, loadTracked: false }],
        'template',
      );
      throw new Error('Expected template target to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(WaitCommandError);
      expect(error).toMatchObject({ code: 'server_not_load_tracked' });
    }
  });

  it('stops immediately for terminal startup state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          kind: 'servers',
          servers: [{ server: 'static', type: 'external', status: 'failed', available: false, loadTracked: true }],
        }),
      ),
    );

    await expect(waitForServers(baseContext, 1_000)).rejects.toMatchObject({
      code: 'server_unavailable',
      recoveryCommand: '1mcp mcp restart static',
    });
  });
});
