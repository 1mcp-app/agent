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

  it('should approve consent with selected valid scopes and return a redirect outcome', async () => {
    const { flow, storage } = createFlow({
      storage: {
        getAuthorizationRequest: vi.fn().mockReturnValue({ clientId: 'client-123' }),
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

  it('should reuse an existing backend authorization URL when starting OAuth', async () => {
    const clientInfo = {
      status: 'awaiting_oauth',
      authorizationUrl: 'https://provider.example/authorize',
      transport: {},
    };
    const { flow } = createFlow({
      serverRuntime: {
        getClient: vi.fn().mockReturnValue(clientInfo),
      },
    });

    const result = await flow.startBackendOAuth({ serverName: 'github' });

    expect(result).toEqual({
      status: 'redirect',
      redirectUrl: 'https://provider.example/authorize',
    });
  });

  it('should initiate backend OAuth and report the generated authorization URL', async () => {
    const clientInfo: {
      status: string;
      authorizationUrl?: string;
      oauthStartTime?: Date;
      transport: {
        oauthProvider: {
          getAuthorizationUrl: ReturnType<typeof vi.fn>;
        };
      };
    } = {
      status: 'disconnected',
      transport: {
        oauthProvider: {
          getAuthorizationUrl: vi.fn().mockReturnValue('https://provider.example/generated'),
        },
      },
    };
    const connect = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('OAuth required'), { name: 'OAuthRequiredError' }));
    const { flow } = createFlow({
      serverRuntime: {
        getClient: vi.fn().mockReturnValue(clientInfo),
      },
      clientRuntime: {
        createClientInstance: vi.fn().mockReturnValue({ connect }),
      },
    });

    const result = await flow.startBackendOAuth({ serverName: 'github' });

    expect(result).toEqual({
      status: 'redirect',
      redirectUrl: 'https://provider.example/generated',
    });
    expect(clientInfo.status).toBe('awaiting_oauth');
    expect(clientInfo.oauthStartTime).toBeInstanceOf(Date);
    expect(connect).toHaveBeenCalledWith(clientInfo.transport);
  });

  it('should clear backend OAuth state before restart', async () => {
    const clientInfo = {
      status: 'error',
      authorizationUrl: 'https://provider.example/old',
      oauthStartTime: new Date('2026-05-01T00:00:00Z'),
      transport: {
        oauthProvider: {
          getAuthorizationUrl: vi.fn().mockReturnValue('https://provider.example/new'),
        },
      },
    };
    const connect = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('OAuth required'), { name: 'OAuthRequiredError' }));
    const { flow } = createFlow({
      serverRuntime: {
        getClient: vi.fn().mockReturnValue(clientInfo),
      },
      clientRuntime: {
        createClientInstance: vi.fn().mockReturnValue({ connect }),
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
      code: 'auth-code-123',
    });

    expect(result).toEqual({ status: 'completed' });
    expect(completeOAuthAndReconnect).toHaveBeenCalledWith('github', 'auth-code-123');
    expect(markReady).toHaveBeenCalledWith('github');
  });

  it('should build backend OAuth dashboard facts from runtime clients', () => {
    const lastConnected = new Date('2026-05-27T05:00:00Z');
    const getClients = vi.fn().mockReturnValue(
      new Map([
        [
          'plain-connected',
          {
            status: 'connected',
            transport: {},
            lastConnected,
          },
        ],
        [
          'oauth-connected',
          {
            status: 'connected',
            transport: {},
            authorizationUrl: 'https://provider.example/authorize',
            oauthStartTime: new Date('2026-05-27T04:00:00Z'),
            lastError: new Error('token expired'),
          },
        ],
        [
          'awaiting-oauth',
          {
            status: 'awaiting_oauth',
            transport: {},
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
          requiresOAuth: false,
        },
        {
          name: 'oauth-connected',
          status: 'connected',
          authorizationUrl: 'https://provider.example/authorize',
          oauthStartTime: new Date('2026-05-27T04:00:00Z'),
          lastError: 'token expired',
          requiresOAuth: true,
        },
        {
          name: 'awaiting-oauth',
          status: 'awaiting_oauth',
          requiresOAuth: true,
        },
      ],
    });
    expect(getClients).toHaveBeenCalledWith();
  });
});
