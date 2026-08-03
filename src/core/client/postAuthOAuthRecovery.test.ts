import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { LoadingState, LoadingStateTracker } from '@src/core/loading/loadingStateTracker.js';
import { ClientStatus, type OutboundConnection } from '@src/core/types/index.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { executeWithPostAuthOAuthRecovery } from './postAuthOAuthRecovery.js';

const mockGetStateTracker = vi.hoisted(() => vi.fn());

vi.mock('@src/core/loading/mcpLoadingManager.js', () => ({
  McpLoadingManager: {
    get current() {
      return { getStateTracker: mockGetStateTracker };
    },
  },
}));

vi.mock('@src/logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  debugIf: vi.fn(),
}));

describe('post-auth OAuth recovery', () => {
  let tracker: LoadingStateTracker;

  beforeEach(() => {
    vi.clearAllMocks();
    tracker = new LoadingStateTracker();
    tracker.startLoading(['oauth-server']);
    tracker.updateServerState('oauth-server', LoadingState.Ready);
    mockGetStateTracker.mockReturnValue(tracker);
  });

  function createConnection(invalidateCredentials = vi.fn().mockResolvedValue(undefined)) {
    const oauthProvider = { invalidateCredentials };
    const transport = {
      _url: new URL('https://example.com/mcp'),
      oauthProvider,
      close: vi.fn().mockResolvedValue(undefined),
    } as any;
    Object.setPrototypeOf(transport, StreamableHTTPClientTransport.prototype);

    const close = vi.fn().mockResolvedValue(undefined);
    const connection = {
      name: 'oauth-server',
      client: { close, onclose: vi.fn(), transport } as any,
      status: ClientStatus.Connected,
      transport,
      authorizationUrl: 'https://example.com/authorize',
      oauthStartTime: new Date(),
    } as OutboundConnection;

    return { close, connection, invalidateCredentials, oauthProvider, transport };
  }

  it('publishes AwaitingOAuth and recreates the transport for a direct operation', async () => {
    const { close, connection, invalidateCredentials, oauthProvider, transport } = createConnection();
    const unauthorized = new StreamableHTTPError(401, 'Server returned 401 after successful authentication');

    await expect(
      executeWithPostAuthOAuthRecovery('oauth-server', connection, () => Promise.reject(unauthorized)),
    ).rejects.toBe(unauthorized);

    expect(connection.status).toBe(ClientStatus.AwaitingOAuth);
    expect(connection.authorizationUrl).toBeUndefined();
    expect(connection.oauthStartTime).toBeUndefined();
    expect(connection.lastError).toBe(unauthorized);
    expect(invalidateCredentials).toHaveBeenCalledOnce();
    expect(invalidateCredentials).toHaveBeenCalledWith('tokens');
    expect(close).toHaveBeenCalledOnce();
    expect(connection.transport).not.toBe(transport);
    expect(connection.transport.oauthProvider).toBe(oauthProvider);
    expect(tracker.getServerState('oauth-server')?.state).toBe(LoadingState.AwaitingOAuth);
    expect(tracker.getSummary()).toMatchObject({ ready: 0, awaitingOAuth: 1 });
  });

  it('still closes and recreates when credential invalidation fails', async () => {
    const invalidationError = new Error('storage unavailable');
    const { close, connection, transport } = createConnection(vi.fn().mockRejectedValue(invalidationError));
    const unauthorized = new StreamableHTTPError(401, 'Server returned 401 after successful authentication');

    await expect(
      executeWithPostAuthOAuthRecovery('oauth-server', connection, () => Promise.reject(unauthorized)),
    ).rejects.toBe(unauthorized);

    expect(close).toHaveBeenCalledOnce();
    expect(connection.transport).not.toBe(transport);
    expect(connection.status).toBe(ClientStatus.AwaitingOAuth);
  });

  it('coalesces concurrent recovery for the same connection', async () => {
    const { close, connection, invalidateCredentials } = createConnection();
    const unauthorized = new StreamableHTTPError(401, 'Server returned 401 after successful authentication');

    await Promise.allSettled([
      executeWithPostAuthOAuthRecovery('oauth-server', connection, () => Promise.reject(unauthorized)),
      executeWithPostAuthOAuthRecovery('oauth-server', connection, () => Promise.reject(unauthorized)),
    ]);

    expect(invalidateCredentials).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('does not mutate connection or health state for an ordinary 401', async () => {
    const { close, connection, invalidateCredentials, transport } = createConnection();
    const unauthorized = new StreamableHTTPError(401, 'Unauthorized');

    await expect(
      executeWithPostAuthOAuthRecovery('oauth-server', connection, () => Promise.reject(unauthorized)),
    ).rejects.toBe(unauthorized);

    expect(connection.status).toBe(ClientStatus.Connected);
    expect(connection.transport).toBe(transport);
    expect(invalidateCredentials).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(tracker.getServerState('oauth-server')?.state).toBe(LoadingState.Ready);
  });
});
