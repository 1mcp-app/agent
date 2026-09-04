import { createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import { LoadingState, LoadingStateTracker } from '@src/core/loading/loadingStateTracker.js';
import { ClientStatus } from '@src/core/types/index.js';
import { OneMcpProtocolError } from '@src/sdk/contracts/index.js';

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

  function createConnection() {
    const close = vi.fn().mockResolvedValue(undefined);
    const connection = createMockOutboundConnection({
      name: 'oauth-server',
      status: ClientStatus.Connected,
      adapter: { close },
      authorizationUrl: 'https://example.com/authorize',
      oauthStartTime: new Date().toISOString(),
    });

    return { close, connection };
  }

  it('publishes AwaitingOAuth and recreates the transport for a direct operation', async () => {
    const { close, connection } = createConnection();
    const unauthorized = new OneMcpProtocolError(401, 'Server returned 401 after successful authentication');

    await expect(
      executeWithPostAuthOAuthRecovery('oauth-server', connection, () => Promise.reject(unauthorized)),
    ).rejects.toBe(unauthorized);

    expect(connection.status).toBe(ClientStatus.AwaitingOAuth);
    expect(connection.authorizationUrl).toBeUndefined();
    expect(connection.oauthStartTime).toBeUndefined();
    expect(connection.lastError).toEqual({ name: 'OneMcpProtocolError', message: unauthorized.message });
    expect(close).toHaveBeenCalledOnce();
    expect(tracker.getServerState('oauth-server')?.state).toBe(LoadingState.AwaitingOAuth);
    expect(tracker.getSummary()).toMatchObject({ ready: 0, awaitingOAuth: 1 });
  });

  it('still publishes awaiting OAuth when adapter close fails', async () => {
    const { close, connection } = createConnection();
    close.mockRejectedValueOnce(new Error('close failed'));
    const unauthorized = new OneMcpProtocolError(401, 'Server returned 401 after successful authentication');

    await expect(
      executeWithPostAuthOAuthRecovery('oauth-server', connection, () => Promise.reject(unauthorized)),
    ).rejects.toBe(unauthorized);

    expect(close).toHaveBeenCalledOnce();
    expect(connection.status).toBe(ClientStatus.AwaitingOAuth);
  });

  it('coalesces concurrent recovery for the same connection', async () => {
    const { close, connection } = createConnection();
    const unauthorized = new OneMcpProtocolError(401, 'Server returned 401 after successful authentication');

    await Promise.allSettled([
      executeWithPostAuthOAuthRecovery('oauth-server', connection, () => Promise.reject(unauthorized)),
      executeWithPostAuthOAuthRecovery('oauth-server', connection, () => Promise.reject(unauthorized)),
    ]);

    expect(close).toHaveBeenCalledOnce();
  });

  it('does not mutate connection or health state for an ordinary 401', async () => {
    const { close, connection } = createConnection();
    const unauthorized = new OneMcpProtocolError(401, 'Unauthorized');

    await expect(
      executeWithPostAuthOAuthRecovery('oauth-server', connection, () => Promise.reject(unauthorized)),
    ).rejects.toBe(unauthorized);

    expect(connection.status).toBe(ClientStatus.Connected);
    expect(close).not.toHaveBeenCalled();
    expect(tracker.getServerState('oauth-server')?.state).toBe(LoadingState.Ready);
  });
});
