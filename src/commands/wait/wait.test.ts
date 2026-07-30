import {
  createMockClientSurfaceAttachmentContext,
  createMockInspectServerSummary,
} from '@test/unit-utils/MockFactories.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { selectWaitServers, waitCommand, WaitCommandError, type WaitCommandOptions, waitForServers } from './wait.js';

const mockedAttachReusableClientSurface = vi.hoisted(() => vi.fn());

vi.mock('@src/commands/shared/clientSurfaceAttachment.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@src/commands/shared/clientSurfaceAttachment.js')>()),
  attachReusableClientSurface: mockedAttachReusableClientSurface,
}));

const baseContext = createMockClientSurfaceAttachmentContext<WaitCommandOptions>({
  contextHash: 'wait-test',
  cachePath: '/tmp/wait-test',
  requestSessionId: 'wait-session',
  sessionId: 'wait-session',
});

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name === 'content-type' ? 'application/json' : null) },
    json: async () => body,
  };
}

describe('wait status workflow', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    mockedAttachReusableClientSurface.mockReset();
  });

  it('validates the complete wait option boundary before attachment', async () => {
    await expect(waitCommand({ format: 'xml' } as never)).rejects.toMatchObject({
      code: 'validation_options',
      recoveryCommand: '1mcp wait',
    });
    expect(mockedAttachReusableClientSurface).not.toHaveBeenCalled();
  });

  it.each([0, Number.NaN, Number.POSITIVE_INFINITY])(
    'preserves the positive finite timeout validation contract for %s',
    async (timeout) => {
      await expect(waitCommand({ timeout })).rejects.toMatchObject({ code: 'validation_timeout' });
      expect(mockedAttachReusableClientSurface).not.toHaveBeenCalled();
    },
  );

  it('preserves context-aware authentication recovery', async () => {
    mockedAttachReusableClientSurface.mockResolvedValue({
      status: 'auth_required',
      message:
        'Authentication required for target context "prod". Run: 1mcp auth login --context prod --token <your-token>',
      target: { runtimeTargetContext: { name: 'prod', kind: 'remote', runtimeScopeId: 'scope-prod' } },
      options: { context: 'prod' },
      baseUrl: 'https://prod.example.com',
    });

    await expect(waitCommand({ context: 'prod' })).rejects.toMatchObject({
      code: 'auth_required',
      recoveryCommand: '1mcp auth login --context prod --token <your-token>',
    });
  });

  it('waits only for enabled configured static servers and succeeds when connected and available', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          kind: 'servers',
          servers: [
            createMockInspectServerSummary({ server: 'static' }),
            createMockInspectServerSummary({ server: 'template', type: 'template', loadTracked: false }),
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
        [createMockInspectServerSummary({ server: 'template', type: 'template', loadTracked: false })],
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
          servers: [createMockInspectServerSummary({ server: 'static', status: 'failed', available: false })],
        }),
      ),
    );

    await expect(waitForServers(baseContext, 1_000)).rejects.toMatchObject({
      code: 'server_unavailable',
      recoveryCommand: '1mcp mcp restart static',
    });
  });

  it('polls from pending until the selected server is connected', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          kind: 'servers',
          servers: [createMockInspectServerSummary({ server: 'static', status: 'pending', available: false })],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          kind: 'servers',
          servers: [createMockInspectServerSummary({ server: 'static' })],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(waitForServers(baseContext, 1_000)).resolves.toMatchObject({ status: 'success' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(['awaiting_oauth', 'cancelled'] as const)('stops immediately for %s', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          kind: 'servers',
          servers: [createMockInspectServerSummary({ server: 'static', status, available: false })],
        }),
      ),
    );

    await expect(waitForServers(baseContext, 1_000)).rejects.toMatchObject({
      code: status === 'awaiting_oauth' ? 'server_awaiting_oauth' : 'server_unavailable',
    });
  });

  it('propagates filter selection to inspect polling', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        kind: 'servers',
        servers: [createMockInspectServerSummary({ server: 'static' })],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await waitForServers({ ...baseContext, options: { preset: 'development' } }, 1_000);

    expect(String(fetchMock.mock.calls[0][0])).toContain('preset=development');
  });

  it('rejects malformed inspect payloads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ kind: 'servers', servers: [{ server: 42 }] })));

    await expect(waitForServers(baseContext, 1_000)).resolves.toEqual({
      status: 'error',
      message: 'Invalid response from /api/v1/inspect.',
    });
  });

  it('aborts an inspect request at the CLI deadline and preserves timeout state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            );
          }),
      ),
    );

    const startedAt = Date.now();
    await expect(waitForServers(baseContext, 25)).rejects.toMatchObject({
      code: 'server_wait_timeout',
      details: { status: 'timeout', servers: [] },
    });
    expect(Date.now() - startedAt).toBeLessThan(500);
  });
});
