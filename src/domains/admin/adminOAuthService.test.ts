import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { OAuthAuthorizationFlow } from '@src/auth/oauthAuthorizationFlow.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminOAuthService } from './adminOAuthService.js';
import type { AdminOperationContext } from './adminOperationService.js';
import { AdminOperationService } from './adminOperationService.js';

describe('AdminOAuthService', () => {
  let storageDir: string;

  beforeEach(() => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-oauth-service-'));
  });

  afterEach(() => {
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  it('authorizes the exact backend OAuth service identity as an audited Admin Operation', async () => {
    const oauthFlow = createOAuthFlow();
    vi.mocked(oauthFlow.startBackendOAuth).mockResolvedValue({
      status: 'redirect',
      redirectUrl: 'https://provider.example/authorize',
    });
    const operationService = new AdminOperationService({
      runtimeScopeId: 'scope_123',
      storageDir,
      now: () => new Date('2026-07-27T00:00:00.000Z'),
      createOperationId: () => 'op_oauth_authorize',
    });
    const service = new AdminOAuthService({ operationService, oauthFlow });

    const result = await service.authorizeService({
      context: context(),
      serviceId: 'context7:0123456789abcdef',
    });

    expect(oauthFlow.startBackendOAuth).toHaveBeenCalledWith({ serverName: 'context7:0123456789abcdef' });
    expect(result).toMatchObject({
      ok: true,
      operationId: 'op_oauth_authorize',
      operationName: 'authorizeBackendOAuth',
      result: {
        serviceId: 'context7:0123456789abcdef',
        redirectUrl: 'https://provider.example/authorize',
      },
    });
    expect(operationService.getRecentAuditFacts()).toMatchObject([
      {
        operationName: 'authorizeBackendOAuth',
        result: 'completed',
        target: { type: 'backend_oauth_service', id: 'context7:0123456789abcdef' },
      },
    ]);
  });

  it('restarts backend OAuth and returns its authorization redirect as operation result data', async () => {
    const oauthFlow = createOAuthFlow();
    vi.mocked(oauthFlow.restartBackendOAuth).mockResolvedValue({
      status: 'restarted',
      redirectUrl: 'https://provider.example/restart',
    });
    const operationService = new AdminOperationService({
      runtimeScopeId: 'scope_123',
      storageDir,
      createOperationId: () => 'op_oauth_restart',
    });
    const service = new AdminOAuthService({ operationService, oauthFlow });

    const result = await service.restartService({
      context: context(),
      serviceId: 'context7:0123456789abcdef',
    });

    expect(oauthFlow.restartBackendOAuth).toHaveBeenCalledWith({ serverName: 'context7:0123456789abcdef' });
    expect(result).toMatchObject({
      ok: true,
      operationId: 'op_oauth_restart',
      operationName: 'restartBackendOAuth',
      result: {
        serviceId: 'context7:0123456789abcdef',
        redirectUrl: 'https://provider.example/restart',
      },
    });
    expect(operationService.getRecentAuditFacts()).toMatchObject([
      {
        operationName: 'restartBackendOAuth',
        target: { type: 'backend_oauth_service', id: 'context7:0123456789abcdef' },
      },
    ]);
  });

  it('maps a missing backend OAuth service to a stable operation error', async () => {
    const oauthFlow = createOAuthFlow();
    vi.mocked(oauthFlow.startBackendOAuth).mockResolvedValue({
      status: 'service_not_found',
      errorDescription: 'Service details that must not cross the admin boundary',
    });
    const service = new AdminOAuthService({
      operationService: new AdminOperationService({ runtimeScopeId: 'scope_123', storageDir }),
      oauthFlow,
    });

    const result = await service.authorizeService({
      context: context(),
      serviceId: 'missing-service',
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'mutation_failed',
      error: 'backend_oauth_service_not_found',
    });
    expect(JSON.stringify(result)).not.toContain('Service details');
  });

  it('maps an unavailable backend OAuth runtime to a stable operation error', async () => {
    const oauthFlow = createOAuthFlow();
    vi.mocked(oauthFlow.startBackendOAuth).mockResolvedValue({
      status: 'runtime_unavailable',
      errorDescription: 'Internal runtime details',
    });
    const service = new AdminOAuthService({
      operationService: new AdminOperationService({ runtimeScopeId: 'scope_123', storageDir }),
      oauthFlow,
    });

    const result = await service.authorizeService({
      context: context(),
      serviceId: 'github',
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'mutation_failed',
      error: 'backend_oauth_runtime_unavailable',
    });
    expect(JSON.stringify(result)).not.toContain('Internal runtime details');
  });

  it('does not expose errors thrown while backend authorization starts', async () => {
    const oauthFlow = createOAuthFlow();
    vi.mocked(oauthFlow.startBackendOAuth).mockRejectedValue(new Error('provider_secret=do-not-expose'));
    const service = new AdminOAuthService({
      operationService: new AdminOperationService({ runtimeScopeId: 'scope_123', storageDir }),
      oauthFlow,
    });

    const result = await service.authorizeService({
      context: context(),
      serviceId: 'github',
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'mutation_failed',
      error: 'backend_oauth_authorization_start_failed',
    });
    expect(JSON.stringify(result)).not.toContain('provider_secret');
  });

  it('uses the same stable error taxonomy when backend OAuth restart cannot find the service', async () => {
    const oauthFlow = createOAuthFlow();
    vi.mocked(oauthFlow.restartBackendOAuth).mockResolvedValue({
      status: 'service_not_found',
      errorDescription: 'Backend lookup details',
    });
    const service = new AdminOAuthService({
      operationService: new AdminOperationService({ runtimeScopeId: 'scope_123', storageDir }),
      oauthFlow,
    });

    const result = await service.restartService({
      context: context(),
      serviceId: 'missing-service',
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'mutation_failed',
      error: 'backend_oauth_service_not_found',
    });
    expect(JSON.stringify(result)).not.toContain('Backend lookup details');
  });

  it('maps an unavailable backend OAuth runtime during restart to a stable operation error', async () => {
    const oauthFlow = createOAuthFlow();
    vi.mocked(oauthFlow.restartBackendOAuth).mockResolvedValue({
      status: 'runtime_unavailable',
      errorDescription: 'Internal restart runtime details',
    });
    const service = new AdminOAuthService({
      operationService: new AdminOperationService({ runtimeScopeId: 'scope_123', storageDir }),
      oauthFlow,
    });

    const result = await service.restartService({
      context: context(),
      serviceId: 'github',
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'mutation_failed',
      error: 'backend_oauth_runtime_unavailable',
    });
    expect(JSON.stringify(result)).not.toContain('Internal restart runtime details');
  });

  it('does not expose errors thrown while backend OAuth restart starts authorization', async () => {
    const oauthFlow = createOAuthFlow();
    vi.mocked(oauthFlow.restartBackendOAuth).mockRejectedValue(new Error('refresh_token=do-not-expose'));
    const service = new AdminOAuthService({
      operationService: new AdminOperationService({ runtimeScopeId: 'scope_123', storageDir }),
      oauthFlow,
    });

    const result = await service.restartService({
      context: context(),
      serviceId: 'github',
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'mutation_failed',
      error: 'backend_oauth_authorization_start_failed',
    });
    expect(JSON.stringify(result)).not.toContain('refresh_token');
  });

  function context(): AdminOperationContext {
    return {
      actor: { type: 'admin_session', accountId: 'acct_1', sessionId: 'sess_1' },
      origin: 'browser',
      target: { type: 'backend_oauth_service', id: 'context7:0123456789abcdef' },
      runtimeIdentity: { runtimeScopeId: 'scope_123', runtimeVersion: '1.2.3' },
      request: { requestId: 'req_1', jsonMode: true },
      idempotencyKey: 'idem_1',
      requestFingerprint: 'fingerprint_1',
    };
  }
});

function createOAuthFlow(): OAuthAuthorizationFlow {
  return {
    submitConsent: vi.fn(),
    createLocalhostCliToken: vi.fn(),
    startBackendOAuth: vi.fn(),
    restartBackendOAuth: vi.fn(),
    completeBackendOAuthCallback: vi.fn(),
    getBackendOAuthDashboard: vi.fn(),
  };
}
