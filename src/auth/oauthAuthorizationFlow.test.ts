import { describe, expect, it, vi } from 'vitest';

import { createOAuthAuthorizationFlow } from './oauthAuthorizationFlow.js';

describe('OAuth Authorization Flow', () => {
  const createFlow = (
    overrides: {
      storage?: Partial<Parameters<typeof createOAuthAuthorizationFlow>[0]['storage']>;
      enabled?: boolean;
      availableTags?: string[];
      serverRuntime?: Partial<NonNullable<Parameters<typeof createOAuthAuthorizationFlow>[0]['serverRuntime']>>;
      clientRuntime?: Partial<NonNullable<Parameters<typeof createOAuthAuthorizationFlow>[0]['clientRuntime']>>;
      loadingRuntime?: Partial<NonNullable<Parameters<typeof createOAuthAuthorizationFlow>[0]['loadingRuntime']>>;
    } = {},
  ) => {
    const storage = {
      getAuthorizationRequest: vi.fn(),
      getClient: vi.fn(),
      processConsentApproval: vi.fn(),
      processConsentDenial: vi.fn(),
      createSessionWithId: vi.fn(),
      ...overrides.storage,
    };

    return {
      storage,
      flow: createOAuthAuthorizationFlow({
        storage,
        serverRuntime: overrides.serverRuntime as NonNullable<
          Parameters<typeof createOAuthAuthorizationFlow>[0]['serverRuntime']
        >,
        clientRuntime: overrides.clientRuntime as NonNullable<
          Parameters<typeof createOAuthAuthorizationFlow>[0]['clientRuntime']
        >,
        loadingRuntime: overrides.loadingRuntime as NonNullable<
          Parameters<typeof createOAuthAuthorizationFlow>[0]['loadingRuntime']
        >,
        createTokenId: () => 'token-123',
        getAuthConfig: () => ({ enabled: overrides.enabled ?? true, oauthTokenTtlMs: 3_600_000 }),
        getAvailableTags: () => overrides.availableTags ?? ['read', 'write'],
      }),
    };
  };

  it('rejects a callback without owner-bound state before sending its code', async () => {
    const completeOAuthAndReconnect = vi.fn();
    const { flow } = createFlow({ clientRuntime: { completeOAuthAndReconnect } });
    const result = await flow.completeBackendOAuthCallback({ serverName: 'same-name', code: 'sensitive-code' });
    expect(result.status).toBe('callback_failed');
    expect(completeOAuthAndReconnect).not.toHaveBeenCalled();
  });

  it('should approve consent with selected valid scopes and return a redirect outcome', async () => {
    const { flow, storage } = createFlow({
      storage: {
        getAuthorizationRequest: vi.fn().mockReturnValue({ clientId: 'client-123', scopes: ['tag:read'] }),
        getClient: vi.fn().mockReturnValue({ client_id: 'client-123' }),
        processConsentApproval: vi.fn().mockResolvedValue({
          redirectUrl: new URL('https://client.example/callback?code=code-123'),
        }),
      },
    });

    const result = await flow.submitConsent({
      authRequestId: 'req-123',
      action: 'approve',
      scopes: ['tag:read'],
    });

    expect(result).toEqual({
      status: 'approved_redirect',
      redirectUrl: 'https://client.example/callback?code=code-123',
    });
    expect(storage.processConsentApproval).toHaveBeenCalledWith('req-123', ['tag:read']);
  });

  it('should reject invalid consent submissions before mutating storage', async () => {
    const { flow, storage } = createFlow({
      storage: {
        getAuthorizationRequest: vi.fn().mockReturnValue({ clientId: 'client-123', scopes: ['tag:read'] }),
        getClient: vi.fn().mockReturnValue({ client_id: 'client-123' }),
      },
    });

    await expect(flow.submitConsent({ action: 'approve' })).resolves.toEqual({
      status: 'invalid_request',
      errorDescription: 'Missing required parameters',
    });
    await expect(
      flow.submitConsent({
        authRequestId: 'req-123',
        action: 'approve',
        scopes: ['not-a-scope'],
      }),
    ).resolves.toEqual({
      status: 'invalid_scope',
      errorDescription: 'Invalid scopes: Invalid scope format: not-a-scope',
    });

    expect(storage.processConsentApproval).not.toHaveBeenCalled();
    expect(storage.processConsentDenial).not.toHaveBeenCalled();
  });

  it('should deny consent through the flow and return a redirect outcome', async () => {
    const { flow, storage } = createFlow({
      storage: {
        getAuthorizationRequest: vi.fn().mockReturnValue({ clientId: 'client-123' }),
        getClient: vi.fn().mockReturnValue({ client_id: 'client-123' }),
        processConsentDenial: vi.fn().mockResolvedValue(new URL('https://client.example/callback?error=access_denied')),
      },
    });

    const result = await flow.submitConsent({
      authRequestId: 'req-123',
      action: 'deny',
    });

    expect(result).toEqual({
      status: 'denied_redirect',
      redirectUrl: 'https://client.example/callback?error=access_denied',
    });
    expect(storage.processConsentDenial).toHaveBeenCalledWith('req-123');
  });

  it('should reject consent scopes that were not in the original authorization request', async () => {
    const { flow, storage } = createFlow({
      storage: {
        getAuthorizationRequest: vi.fn().mockReturnValue({ clientId: 'client-123', scopes: ['tag:read'] }),
        getClient: vi.fn().mockReturnValue({ client_id: 'client-123' }),
      },
    });

    await expect(
      flow.submitConsent({
        authRequestId: 'req-123',
        action: 'approve',
        scopes: ['tag:write'],
      }),
    ).resolves.toEqual({
      status: 'invalid_scope',
      errorDescription: 'Requested scopes were not part of the authorization request: tag:write',
    });

    expect(storage.processConsentApproval).not.toHaveBeenCalled();
  });

  it('should create a localhost CLI token with available tag scopes when auth is enabled', () => {
    const { flow, storage } = createFlow();

    const result = flow.createLocalhostCliToken();

    expect(result).toEqual({
      authRequired: true,
      token: 'tk-token-123',
      expiresIn: 3600,
      tokenId: 'token-123',
    });
    expect(storage.createSessionWithId).toHaveBeenCalledWith(
      'token-123',
      'cli',
      '',
      ['tag:read', 'tag:write'],
      3_600_000,
    );
  });

  it('should not create a localhost CLI token when auth is disabled', () => {
    const { flow, storage } = createFlow({ enabled: false });

    const result = flow.createLocalhostCliToken();

    expect(result).toEqual({
      authRequired: false,
      message: 'Auth is disabled on this server',
    });
    expect(storage.createSessionWithId).not.toHaveBeenCalled();
  });

  it('creates a fresh authorization attempt on every start instead of reusing an expired or consumed URL', async () => {
    const clientInfo = {
      status: 'awaiting_oauth',
      authorizationUrl: 'https://provider.example/authorize?state=expired',
      transport: {},
    };
    let attempt = 0;
    const initiateOAuth = vi.fn(async () => {
      clientInfo.authorizationUrl = 'https://provider.example/authorize?state=fresh-' + ++attempt;
    });
    const { flow } = createFlow({
      serverRuntime: { getClient: vi.fn().mockReturnValue(clientInfo) },
      clientRuntime: { initiateOAuth },
    });
    for (const state of ['fresh-1', 'fresh-2']) {
      await expect(flow.startBackendOAuth({ serverName: 'github' })).resolves.toEqual({
        status: 'redirect',
        redirectUrl: 'https://provider.example/authorize?state=' + state,
      });
    }
    expect(initiateOAuth).toHaveBeenCalledTimes(2);
  });

  it('should initiate backend OAuth and report the generated authorization URL', async () => {
    const clientInfo: {
      status: string;
      authorizationUrl?: string;
      oauthStartTime?: string;
    } = {
      status: 'disconnected',
    };
    const initiateOAuth = vi.fn(async () => {
      clientInfo.status = 'awaiting_oauth';
      clientInfo.authorizationUrl = 'https://provider.example/generated';
      clientInfo.oauthStartTime = new Date().toISOString();
    });
    const { flow } = createFlow({
      serverRuntime: {
        getClient: vi.fn().mockReturnValue(clientInfo),
      },
      clientRuntime: {
        initiateOAuth,
      },
    });

    const result = await flow.startBackendOAuth({ serverName: 'github' });

    expect(result).toEqual({
      status: 'redirect',
      redirectUrl: 'https://provider.example/generated',
    });
    expect(clientInfo.status).toBe('awaiting_oauth');
    expect(clientInfo.oauthStartTime).toBe(new Date(clientInfo.oauthStartTime!).toISOString());
    expect(initiateOAuth).toHaveBeenCalledWith('github');
  });

  it('should clear backend OAuth state before restart', async () => {
    const clientInfo = {
      status: 'error',
      authorizationUrl: 'https://provider.example/old',
      oauthStartTime: '2026-05-01T00:00:00.000Z',
    };
    const initiateOAuth = vi.fn(async () => {
      clientInfo.status = 'awaiting_oauth';
      clientInfo.authorizationUrl = 'https://provider.example/new';
      clientInfo.oauthStartTime = new Date().toISOString();
    });
    const { flow } = createFlow({
      serverRuntime: {
        getClient: vi.fn().mockReturnValue(clientInfo),
      },
      clientRuntime: {
        initiateOAuth,
      },
    });

    const result = await flow.restartBackendOAuth({ serverName: 'github' });

    expect(result).toEqual({
      status: 'restarted',
      redirectUrl: 'https://provider.example/new',
    });
    expect(clientInfo.authorizationUrl).toBe('https://provider.example/new');
    expect(clientInfo.status).toBe('awaiting_oauth');
  });

  it('should complete backend OAuth callback and mark loading ready', async () => {
    const completeOAuthAndReconnect = vi.fn().mockResolvedValue(undefined);
    const markReady = vi.fn();
    const { flow } = createFlow({
      clientRuntime: {
        completeOAuthAndReconnect,
      },
      loadingRuntime: {
        markReady,
      },
    });

    const result = await flow.completeBackendOAuthCallback({
      serverName: 'github',
      state: 'state-123',
      code: 'auth-code-123',
    });

    expect(result).toEqual({ status: 'completed' });
    expect(completeOAuthAndReconnect).toHaveBeenCalledWith(
      'github',
      new URLSearchParams({ state: 'state-123', code: 'auth-code-123' }),
    );
    expect(markReady).toHaveBeenCalledWith('github');
  });

  it('forwards the actual callback issuer with the code', async () => {
    const completeOAuthAndReconnect = vi.fn().mockResolvedValue(undefined);
    const { flow } = createFlow({ clientRuntime: { completeOAuthAndReconnect } });

    expect(
      await flow.completeBackendOAuthCallback({
        serverName: 'github',
        state: 'state-123',
        code: 'auth-code-123',
        iss: 'https://issuer.example',
        redirectUri: 'https://proxy.example/oauth/callback/github',
      }),
    ).toEqual({ status: 'completed' });
    expect(completeOAuthAndReconnect).toHaveBeenCalledWith(
      'github',
      new URLSearchParams({
        state: 'state-123',
        code: 'auth-code-123',
        iss: 'https://issuer.example',
        redirect_uri: 'https://proxy.example/oauth/callback/github',
      }),
    );
  });

  it('should delegate provider and input errors to the durable callback runtime', async () => {
    const completeOAuthAndReconnect = vi.fn(async (_serverName: string, response: URLSearchParams) => {
      if (response.has('error') || !response.has('code')) throw new Error('callback rejected');
    });
    const markReady = vi.fn();
    const { flow } = createFlow({
      clientRuntime: {
        completeOAuthAndReconnect,
      },
      loadingRuntime: {
        markReady,
      },
    });

    await expect(
      flow.completeBackendOAuthCallback({
        serverName: 'github',
        state: 'denied-state',
        error: 'access_denied',
      }),
    ).resolves.toEqual({
      status: 'callback_failed',
      errorDescription: 'OAuth callback rejected; start authorization again',
    });
    await expect(
      flow.completeBackendOAuthCallback({
        serverName: 'github',
        state: 'missing-code-state',
      }),
    ).resolves.toEqual({
      status: 'callback_failed',
      errorDescription: 'OAuth callback rejected; start authorization again',
    });

    expect(completeOAuthAndReconnect).toHaveBeenNthCalledWith(
      1,
      'github',
      new URLSearchParams({ state: 'denied-state', error: 'access_denied' }),
    );
    expect(completeOAuthAndReconnect).toHaveBeenNthCalledWith(
      2,
      'github',
      new URLSearchParams({ state: 'missing-code-state' }),
    );
    expect(markReady).not.toHaveBeenCalled();
  });

  it('should report backend OAuth callback failures without marking loading ready', async () => {
    const completeOAuthAndReconnect = vi.fn().mockRejectedValue(new Error('reconnect failed'));
    const markReady = vi.fn();
    const { flow } = createFlow({
      clientRuntime: {
        completeOAuthAndReconnect,
      },
      loadingRuntime: {
        markReady,
      },
    });

    const result = await flow.completeBackendOAuthCallback({
      serverName: 'github',
      state: 'state-123',
      code: 'auth-code-123',
    });

    expect(result).toEqual({
      status: 'callback_failed',
      errorDescription: 'OAuth callback rejected; start authorization again',
    });
    expect(markReady).not.toHaveBeenCalled();
  });

  it('should build backend OAuth dashboard facts from runtime clients', () => {
    const lastConnected = '2026-05-27T05:00:00.000Z';
    const getClients = vi.fn().mockReturnValue(
      new Map([
        [
          'plain-connected',
          {
            status: 'connected',
            lastConnected,
            requiresOAuth: false,
          },
        ],
        [
          'oauth-connected',
          {
            status: 'connected',
            requiresOAuth: true,
            lastError: { message: 'token expired' },
          },
        ],
        [
          'awaiting-oauth',
          {
            status: 'awaiting_oauth',
            requiresOAuth: true,
          },
        ],
      ]),
    );
    const { flow } = createFlow({
      serverRuntime: {
        getClients,
      },
    });

    const result = flow.getBackendOAuthDashboard();

    expect(result).toEqual({
      status: 'ready',
      services: [
        {
          name: 'plain-connected',
          status: 'connected',
          lastConnected,
          authorizationUrl: undefined,
          oauthStartTime: undefined,
          lastError: undefined,
          requiresOAuth: false,
        },
        {
          name: 'oauth-connected',
          status: 'connected',
          lastError: 'token expired',
          authorizationUrl: undefined,
          oauthStartTime: undefined,
          lastConnected: undefined,
          requiresOAuth: true,
        },
        {
          name: 'awaiting-oauth',
          status: 'awaiting_oauth',
          authorizationUrl: undefined,
          oauthStartTime: undefined,
          lastError: undefined,
          lastConnected: undefined,
          requiresOAuth: true,
        },
      ],
    });
    expect(getClients).toHaveBeenCalledWith();
  });
  it('binds Admin returns to durable provider state without changing the authorization URL', async () => {
    const firstUrl =
      'https://provider.example/authorize?redirect_uri=https%3A%2F%2Fcallback.example%2Fregistered&state=provider-state-1';
    const secondUrl =
      'https://provider.example/authorize?redirect_uri=https%3A%2F%2Fcallback.example%2Fregistered&state=provider-state-2';
    const getClient = vi
      .fn()
      .mockReturnValueOnce({ authorizationUrl: firstUrl })
      .mockReturnValueOnce({ authorizationUrl: secondUrl });
    const bindOAuthReturn = vi.fn().mockResolvedValue(undefined);
    const completeOAuthAndReconnect = vi.fn().mockResolvedValue(undefined);
    const getOAuthReturn = vi.fn((_serverName: string, state: string) =>
      state === 'provider-state-2' ? 'http://127.0.0.1:3050' : 'http://localhost:3050',
    );
    const { flow } = createFlow({
      serverRuntime: { getClient },
      clientRuntime: {
        initiateOAuth: vi.fn().mockResolvedValue(undefined),
        bindOAuthReturn,
        completeOAuthAndReconnect,
        getOAuthReturn,
      },
    });

    await expect(
      flow.startBackendOAuth({ serverName: 'github', adminReturnOrigin: 'http://localhost:3050' }),
    ).resolves.toEqual({ status: 'redirect', redirectUrl: firstUrl });
    await expect(
      flow.startBackendOAuth({ serverName: 'github', adminReturnOrigin: 'http://127.0.0.1:3050' }),
    ).resolves.toEqual({ status: 'redirect', redirectUrl: secondUrl });
    expect(bindOAuthReturn).toHaveBeenNthCalledWith(1, 'github', 'provider-state-1', 'http://localhost:3050');
    expect(bindOAuthReturn).toHaveBeenNthCalledWith(2, 'github', 'provider-state-2', 'http://127.0.0.1:3050');

    expect(
      await flow.completeBackendOAuthCallback({ serverName: 'github', state: 'provider-state-2', code: 'code' }),
    ).toEqual({ adminReturnOrigin: 'http://127.0.0.1:3050', status: 'completed' });
    expect(completeOAuthAndReconnect).toHaveBeenCalledWith(
      'github',
      new URLSearchParams({ state: 'provider-state-2', code: 'code' }),
    );
    expect(getOAuthReturn).toHaveBeenCalledWith('github', 'provider-state-2');
  });

  it.each(['startBackendOAuth', 'restartBackendOAuth'] as const)(
    'fails closed when %s cannot bind an Admin return to provider state',
    async (operation) => {
      const client = {
        status: 'awaiting_oauth',
        authorizationUrl: 'https://provider.example/authorize',
      };
      const { flow } = createFlow({
        serverRuntime: { getClient: vi.fn().mockReturnValue(client) },
        clientRuntime: {
          initiateOAuth: vi.fn(async () => {
            client.authorizationUrl = 'https://provider.example/authorize';
          }),
        },
      });

      const result = await flow[operation]({ serverName: 'github', adminReturnOrigin: 'http://localhost:3050' });
      expect(result.status).toBe('oauth_url_unavailable');
    },
  );
});
