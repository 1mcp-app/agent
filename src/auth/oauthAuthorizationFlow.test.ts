import { describe, expect, it, vi } from 'vitest';

import { createOAuthAuthorizationFlow } from './oauthAuthorizationFlow.js';

describe('OAuth Authorization Flow', () => {
  const createFlow = (
    overrides: {
      storage?: Partial<Parameters<typeof createOAuthAuthorizationFlow>[0]['storage']>;
      enabled?: boolean;
      availableTags?: string[];
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
});
