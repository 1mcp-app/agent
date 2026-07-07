import fs from 'node:fs';

import type { AdminConfiguredServerOperations } from '@src/domains/admin/adminConfiguredServerService.js';
import { AdminIdentityService } from '@src/domains/admin/adminIdentityService.js';
import type { AdminAuditFact } from '@src/domains/admin/adminOperationService.js';

import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAdminRoutes } from './adminRoutes.js';

const runtimeIdentity = {
  identityProtocolVersion: '1',
  runtimeScopeId: 'scope_123',
  externalUrl: 'https://runtime.example.com',
  runtimeVersion: '1.2.3',
} as const;

function cookieValue(setCookieHeader: string): string {
  const [nameValue] = setCookieHeader.split(';');
  return nameValue.split('=').slice(1).join('=');
}

describe('admin routes', () => {
  let adminService: AdminIdentityService;
  let storageDir: string;
  let configuredServerService: {
    listConfiguredServers: ReturnType<typeof vi.fn<AdminConfiguredServerOperations['listConfiguredServers']>>;
    enableConfiguredServer: ReturnType<typeof vi.fn<AdminConfiguredServerOperations['enableConfiguredServer']>>;
    disableConfiguredServer: ReturnType<typeof vi.fn<AdminConfiguredServerOperations['disableConfiguredServer']>>;
    getRecentAuditFacts: ReturnType<typeof vi.fn<(options?: { limit?: number }) => AdminAuditFact[]>>;
  };

  beforeEach(() => {
    storageDir = `/tmp/admin-routes-${Date.now()}-${Math.random()}`;
    adminService = new AdminIdentityService({
      runtimeScopeId: 'scope_123',
      storageDir,
      now: () => new Date('2026-07-06T00:00:00.000Z'),
      sessionTtlMs: 60 * 60 * 1000,
    });
    configuredServerService = {
      listConfiguredServers: vi.fn<AdminConfiguredServerOperations['listConfiguredServers']>(),
      enableConfiguredServer: vi.fn<AdminConfiguredServerOperations['enableConfiguredServer']>(),
      disableConfiguredServer: vi.fn<AdminConfiguredServerOperations['disableConfiguredServer']>(),
      getRecentAuditFacts: vi.fn<(options?: { limit?: number }) => AdminAuditFact[]>(() => []),
    };
  });

  afterEach(() => {
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  function mountAdminRoutes(options: { externalUrl?: string } = {}) {
    const app = express();
    app.use(express.json());
    const adminRoutes = createAdminRoutes({
      adminEnabled: true,
      adminService,
      configuredServerService,
      getRuntimeIdentity: () => ({
        ...runtimeIdentity,
        externalUrl: options.externalUrl ?? runtimeIdentity.externalUrl,
      }),
      getOAuthDashboard: () => ({
        status: 'ready',
        services: [
          {
            name: 'github',
            status: 'awaiting_oauth',
            requiresOAuth: true,
            lastError: 'token: [REDACTED]',
          },
        ],
      }),
    });

    if (adminRoutes) {
      app.use('/admin', adminRoutes);
    }

    return app;
  }

  it('does not mount admin routes when admin HTTP surfaces are disabled', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    const login = await adminService.login({ username: 'operator', password: 'correct horse battery staple' });
    expect(adminService.validateSession(login.sessionToken)).not.toBeNull();

    const app = express();
    const adminRoutes = createAdminRoutes({
      adminEnabled: false,
      adminService,
      configuredServerService,
      getRuntimeIdentity: () => runtimeIdentity,
    });

    if (adminRoutes) {
      app.use('/admin', adminRoutes);
    }

    expect((await request(app).get('/admin')).status).toBe(404);
    expect((await request(app).get('/admin/cli/v1/capabilities')).status).toBe(404);
    expect(adminService.validateSession(login.sessionToken)).toBeNull();
  });

  it('exposes setup-required admin and CLI capabilities without account facts', async () => {
    const app = express();
    const adminRoutes = createAdminRoutes({
      adminEnabled: true,
      adminService,
      configuredServerService,
      getRuntimeIdentity: () => runtimeIdentity,
    });

    if (adminRoutes) {
      app.use('/admin', adminRoutes);
    }

    const adminResponse = await request(app).get('/admin');
    const capabilitiesResponse = await request(app).get('/admin/cli/v1/capabilities');

    expect(adminResponse.status).toBe(200);
    expect(adminResponse.headers['content-type']).toContain('text/html');
    expect(adminResponse.text).toContain('data-admin-status="setupRequired"');
    expect(adminResponse.text).toContain('Setup required');
    expect(adminResponse.text).toContain('1mcp admin bootstrap');
    expect(adminResponse.text).not.toMatch(/create account|reset password/i);

    expect(capabilitiesResponse.status).toBe(200);
    expect(capabilitiesResponse.body).toEqual({
      cliProtocolVersion: '1',
      runtimeScopeId: 'scope_123',
      externalUrl: 'https://runtime.example.com',
      runtimeVersion: '1.2.3',
      adminSurface: 'enabled',
      adminStatus: 'setupRequired',
      supportedOperations: [],
      featureFlags: {
        adminSetupRequired: true,
      },
    });
    expect(JSON.stringify(capabilitiesResponse.body)).not.toMatch(/account|user|email|serverName|configuredServer/i);
  });

  it('serves a bundled admin console shell with login/logout controls and no account management controls', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    const app = mountAdminRoutes();

    const response = await request(app).get('/admin');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.text).toContain('data-admin-status="loginRequired"');
    expect(response.text).toContain('id="login-form"');
    expect(response.text).toContain('/admin/api/session/login');
    expect(response.text).toContain('/admin/api/session/logout');
    expect(response.text).toContain('/admin/api/status');
    expect(response.text).toContain('/admin/api/configured-servers');
    expect(response.text).not.toMatch(/account create|disable account|delete account|password reset/i);
  });

  it('includes short polling, manual refresh, hidden-tab polling reduction, and enable-disable UI states', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    const app = mountAdminRoutes();

    const response = await request(app).get('/admin');

    expect(response.text).toContain('id="refresh-button"');
    expect(response.text).toContain('document.visibilityState');
    expect(response.text).toContain('POLL_INTERVAL_VISIBLE_MS = 5000');
    expect(response.text).toContain('POLL_INTERVAL_HIDDEN_MS = 60000');
    expect(response.text).toContain("document.addEventListener('visibilitychange'");
    expect(response.text).toContain('async function enableServer');
    expect(response.text).toContain('async function disableServer');
    expect(response.text).toContain('Idempotency-Key');
    expect(response.text).toContain('server-action-success');
    expect(response.text).toContain('server-action-error');
    expect(response.text).toContain('async function refreshConsole');
    expect(response.text).toContain('Session loaded, but refresh failed: ');
    expect(response.text).toContain('Login succeeded, but refresh failed: ');
  });

  it('logs in with an admin account, validates the current session, and logs out with CSRF', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    const app = mountAdminRoutes();

    const loginResponse = await request(app)
      .post('/admin/api/session/login')
      .send({ username: 'operator', password: 'correct horse battery staple' });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body).toMatchObject({
      authenticated: true,
      account: { username: 'operator', role: 'full-admin' },
    });
    expect(loginResponse.body).not.toHaveProperty('sessionToken');
    expect(loginResponse.body.csrfToken).toMatch(/^admin_csrf_/);
    const cookie = loginResponse.headers['set-cookie']?.[0];
    expect(cookie).toContain('1mcp_admin_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Secure');

    const currentResponse = await request(app).get('/admin/api/session').set('Cookie', cookie);
    expect(currentResponse.status).toBe(200);
    expect(currentResponse.body).toMatchObject({
      authenticated: true,
      account: { username: 'operator', role: 'full-admin' },
      csrfToken: loginResponse.body.csrfToken,
    });

    const rejectedLogout = await request(app).post('/admin/api/session/logout').set('Cookie', cookie);
    expect(rejectedLogout.status).toBe(403);

    const logoutResponse = await request(app)
      .post('/admin/api/session/logout')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', loginResponse.body.csrfToken);
    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.headers['set-cookie']?.[0]).toContain('1mcp_admin_session=;');
    expect(adminService.validateSession(cookieValue(cookie))).toBeNull();
  });

  it('rate limits repeated failed login attempts by username and source address', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    const app = mountAdminRoutes();

    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await request(app)
        .post('/admin/api/session/login')
        .set('Origin', `https://console-${attempt}.example.com`)
        .send({ username: 'operator', password: 'wrong password' });
      expect(response.status).toBe(401);
    }

    const limitedResponse = await request(app)
      .post('/admin/api/session/login')
      .set('Origin', 'https://rotated-console.example.com')
      .send({ username: 'operator', password: 'correct horse battery staple' });

    expect(limitedResponse.status).toBe(429);
    expect(limitedResponse.body).toEqual({ error: 'admin_login_rate_limited' });
  });

  it('requires an admin session for safe admin API reads', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    const app = mountAdminRoutes();

    const response = await request(app).get('/admin/api/session');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ authenticated: false });
  });

  it('does not mark admin cookies secure for plain HTTP public runtime URLs', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    const app = mountAdminRoutes({ externalUrl: 'http://localhost:3050' });

    const loginResponse = await request(app)
      .post('/admin/api/session/login')
      .send({ username: 'operator', password: 'correct horse battery staple' });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.headers['set-cookie']?.[0]).not.toContain('Secure');
  });

  it('rejects unsafe admin API requests without a valid session-bound CSRF token', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    const app = mountAdminRoutes();
    const loginResponse = await request(app)
      .post('/admin/api/session/login')
      .send({ username: 'operator', password: 'correct horse battery staple' });
    const cookie = loginResponse.headers['set-cookie']?.[0] as string;

    expect((await request(app).post('/admin/api/session/logout').set('Cookie', cookie).send({})).status).toBe(403);
    expect(
      (
        await request(app)
          .post('/admin/api/session/logout')
          .set('Cookie', cookie)
          .set('X-CSRF-Token', 'admin_csrf_wrong')
          .send({})
      ).status,
    ).toBe(403);
  });

  it('does not expose password management from the browser API', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    const app = mountAdminRoutes();
    const loginResponse = await request(app)
      .post('/admin/api/session/login')
      .send({ username: 'operator', password: 'correct horse battery staple' });
    const cookie = loginResponse.headers['set-cookie']?.[0] as string;

    const passwordResponse = await request(app)
      .post('/admin/api/session/password')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', loginResponse.body.csrfToken)
      .send({ password: 'new correct horse battery staple' });

    expect(passwordResponse.status).toBe(404);
    expect(adminService.validateSession(cookieValue(cookie))).not.toBeNull();
  });

  it('does not expose account disable or delete management routes from the browser API', async () => {
    const account = await adminService.bootstrapFirstAdmin({
      username: 'operator',
      password: 'correct horse battery staple',
    });
    const app = mountAdminRoutes();
    const loginResponse = await request(app)
      .post('/admin/api/session/login')
      .send({ username: 'operator', password: 'correct horse battery staple' });
    const cookie = loginResponse.headers['set-cookie']?.[0] as string;

    const disableResponse = await request(app)
      .post(`/admin/api/accounts/${account.id}/disable`)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', loginResponse.body.csrfToken);
    const deleteResponse = await request(app)
      .delete(`/admin/api/accounts/${account.id}`)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', loginResponse.body.csrfToken);

    expect(disableResponse.status).toBe(404);
    expect(deleteResponse.status).toBe(404);
    expect(adminService.hasAdminAccount()).toBe(true);
  });

  it('returns normalized configured-server read models from the authenticated admin API', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    configuredServerService.listConfiguredServers.mockResolvedValue({
      ok: true,
      status: 'completed',
      operationId: 'op_read',
      operationName: 'listConfiguredServers',
      replayed: false,
      result: {
        servers: [
          {
            id: 'filesystem',
            source: 'mcpServers',
            enabled: true,
            transport: {
              type: 'stdio',
              command: 'npx',
              env: {
                API_TOKEN: { present: true, value: '[REDACTED]', secret: true },
              },
            },
            secretInputs: [
              {
                fieldPath: ['env', 'API_TOKEN'],
                label: 'API_TOKEN',
                state: 'present',
                allowedActions: ['preserve', 'replace', 'clear'],
              },
            ],
          },
        ],
      },
    });
    const app = mountAdminRoutes();
    const loginResponse = await request(app)
      .post('/admin/api/session/login')
      .send({ username: 'operator', password: 'correct horse battery staple' });
    const cookie = loginResponse.headers['set-cookie']?.[0] as string;

    const response = await request(app).get('/admin/api/configured-servers').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      operationId: 'op_read',
      servers: [
        {
          id: 'filesystem',
          source: 'mcpServers',
          enabled: true,
          transport: {
            type: 'stdio',
            command: 'npx',
            env: {
              API_TOKEN: { present: true, value: '[REDACTED]', secret: true },
            },
          },
          secretInputs: [
            {
              fieldPath: ['env', 'API_TOKEN'],
              label: 'API_TOKEN',
              state: 'present',
              allowedActions: ['preserve', 'replace', 'clear'],
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(response.body)).not.toContain('super-secret');
    expect(JSON.stringify(response.body)).not.toContain('raw-token');
    expect(configuredServerService.listConfiguredServers).toHaveBeenCalledWith({
      context: expect.objectContaining({
        actor: expect.objectContaining({ type: 'admin_session', accountId: expect.any(String) }),
        origin: 'browser',
        runtimeIdentity: { runtimeScopeId: 'scope_123', runtimeVersion: '1.2.3' },
        target: { type: 'configured_server_collection' },
      }),
    });
  });

  it('returns authenticated admin console status with runtime identity, OAuth services, and redacted audit facts', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    configuredServerService.getRecentAuditFacts.mockReturnValue([
      {
        timestamp: '2026-07-06T00:00:00.000Z',
        operationId: 'op_enable',
        operationName: 'enableConfiguredServer',
        result: 'completed',
        actor: { type: 'admin_session', accountIdHash: 'hash_account', sessionIdHash: 'hash_session' },
        origin: 'browser',
        target: { type: 'configured_server', id: 'filesystem' },
        request: { requestId: 'req_123' },
      },
    ]);
    const app = mountAdminRoutes();
    const loginResponse = await request(app)
      .post('/admin/api/session/login')
      .send({ username: 'operator', password: 'correct horse battery staple' });
    const cookie = loginResponse.headers['set-cookie']?.[0] as string;

    const response = await request(app).get('/admin/api/status').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      runtime: {
        identityProtocolVersion: '1',
        runtimeScopeId: 'scope_123',
        externalUrl: 'https://runtime.example.com',
        runtimeVersion: '1.2.3',
      },
      session: {
        authenticated: true,
        account: { id: expect.any(String), username: 'operator', role: 'full-admin' },
        expiresAt: '2026-07-06T01:00:00.000Z',
      },
      oauth: {
        status: 'ready',
        services: [
          {
            name: 'github',
            status: 'awaiting_oauth',
            requiresOAuth: true,
            lastError: 'token: [REDACTED]',
          },
        ],
      },
      audit: {
        facts: [
          {
            timestamp: '2026-07-06T00:00:00.000Z',
            operationId: 'op_enable',
            operationName: 'enableConfiguredServer',
            result: 'completed',
            actor: { type: 'admin_session', accountIdHash: 'hash_account', sessionIdHash: 'hash_session' },
            origin: 'browser',
            target: { type: 'configured_server', id: 'filesystem' },
            request: { requestId: 'req_123' },
          },
        ],
      },
    });
    expect(JSON.stringify(response.body)).not.toContain(cookieValue(cookie));
    expect(configuredServerService.getRecentAuditFacts).toHaveBeenCalledWith({ limit: 10 });
  });

  it('redacts OAuth status errors before returning admin console status', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    const app = express();
    app.use(express.json());
    const adminRoutes = createAdminRoutes({
      adminEnabled: true,
      adminService,
      configuredServerService,
      getRuntimeIdentity: () => runtimeIdentity,
      getOAuthDashboard: () => ({
        status: 'ready',
        services: [
          {
            name: 'github',
            status: 'error',
            requiresOAuth: true,
            lastError: 'token: raw-secret',
          },
        ],
      }),
    });
    if (adminRoutes) {
      app.use('/admin', adminRoutes);
    }
    const loginResponse = await request(app)
      .post('/admin/api/session/login')
      .send({ username: 'operator', password: 'correct horse battery staple' });
    const cookie = loginResponse.headers['set-cookie']?.[0] as string;

    const response = await request(app).get('/admin/api/status').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain('raw-secret');
    expect(response.body.oauth.services[0].lastError).toBe('token: [REDACTED]');
  });

  it('enables and disables configured servers through CSRF-protected admin API mutations', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    configuredServerService.enableConfiguredServer.mockResolvedValue({
      ok: true,
      status: 'completed',
      operationId: 'op_enable',
      operationName: 'enableConfiguredServer',
      replayed: false,
      result: {
        targetName: 'filesystem',
        enabled: true,
        outcome: 'enabled',
        configChange: {
          status: 'changed',
          operation: 'enable',
          configPath: '/tmp/mcp.json',
          target: { name: 'filesystem', source: 'mcpServers' },
          changed: true,
          backup: { created: true, path: '/tmp/mcp.json.backup.1' },
          retentionCleanup: { attempted: true, deletedPaths: [], warnings: [] },
          reload: { status: 'observed' },
          warnings: [],
        },
      },
    });
    configuredServerService.disableConfiguredServer.mockResolvedValue({
      ok: true,
      status: 'completed',
      operationId: 'op_disable',
      operationName: 'disableConfiguredServer',
      replayed: false,
      result: {
        targetName: 'filesystem',
        enabled: false,
        outcome: 'disabled',
        configChange: {
          status: 'changed',
          operation: 'disable',
          configPath: '/tmp/mcp.json',
          target: { name: 'filesystem', source: 'mcpServers' },
          changed: true,
          backup: { created: true, path: '/tmp/mcp.json.backup.2' },
          retentionCleanup: { attempted: true, deletedPaths: [], warnings: [] },
          reload: { status: 'observed' },
          warnings: [],
        },
      },
    });
    const app = mountAdminRoutes();
    const loginResponse = await request(app)
      .post('/admin/api/session/login')
      .send({ username: 'operator', password: 'correct horse battery staple' });
    const cookie = loginResponse.headers['set-cookie']?.[0] as string;

    const rejected = await request(app)
      .post('/admin/api/configured-servers/filesystem/enable')
      .set('Cookie', cookie)
      .set('Idempotency-Key', 'enable-key');
    const enabled = await request(app)
      .post('/admin/api/configured-servers/filesystem/enable')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', loginResponse.body.csrfToken)
      .set('Idempotency-Key', 'enable-key');
    const disabled = await request(app)
      .post('/admin/api/configured-servers/filesystem/disable')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', loginResponse.body.csrfToken)
      .set('Idempotency-Key', 'disable-key');

    expect(rejected.status).toBe(403);
    expect(enabled.status).toBe(200);
    expect(enabled.body).toMatchObject({
      ok: true,
      operationId: 'op_enable',
      result: {
        targetName: 'filesystem',
        enabled: true,
        outcome: 'enabled',
        configChange: { reload: { status: 'observed' } },
      },
    });
    expect(disabled.status).toBe(200);
    expect(configuredServerService.enableConfiguredServer).toHaveBeenCalledWith({
      context: expect.objectContaining({
        idempotencyKey: 'enable-key',
        target: { type: 'configured_server', id: 'filesystem' },
        requestFingerprint: expect.stringContaining('enableConfiguredServer'),
      }),
      targetName: 'filesystem',
    });
    expect(configuredServerService.disableConfiguredServer).toHaveBeenCalledWith({
      context: expect.objectContaining({
        idempotencyKey: 'disable-key',
        target: { type: 'configured_server', id: 'filesystem' },
        requestFingerprint: expect.stringContaining('disableConfiguredServer'),
      }),
      targetName: 'filesystem',
    });
  });

  it('bootstraps the first admin from environment only when no account exists', async () => {
    const bootstrapSpy = vi.spyOn(adminService, 'bootstrapFirstAdminFromEnvironment');
    mountAdminRoutes();

    expect(bootstrapSpy).toHaveBeenCalled();
  });
});
