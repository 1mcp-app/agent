import fs from 'node:fs';
import path from 'node:path';

import type { AdminConfiguredServerOperations } from '@src/domains/admin/adminConfiguredServerService.js';
import { AdminIdentityService } from '@src/domains/admin/adminIdentityService.js';
import type { AdminAuditFact } from '@src/domains/admin/adminOperationService.js';

import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAdminRoutes } from './adminRoutes.js';
import { resolveDefaultAdminConsoleAssetsDir } from './adminRoutes.js';

const runtimeIdentity = {
  identityProtocolVersion: '1',
  runtimeScopeId: 'scope_123',
  externalUrl: 'https://runtime.example.com',
  runtimeVersion: '1.2.3',
} as const;

const cliRuntimeIdentity = {
  identityProtocolVersion: '1',
  runtimeScopeId: 'scope_123',
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

  function mountAdminRoutes(
    options: {
      externalUrl?: string;
      configuredServerService?: AdminConfiguredServerOperations | null;
      adminConsoleAssetsDir?: string;
    } = {},
  ) {
    const app = express();
    app.use(express.json());
    const adminRoutes = createAdminRoutes({
      adminEnabled: true,
      adminService,
      configuredServerService:
        options.configuredServerService === null
          ? undefined
          : (options.configuredServerService ?? configuredServerService),
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
      adminConsoleAssetsDir: options.adminConsoleAssetsDir,
    });

    if (adminRoutes) {
      app.use('/admin', adminRoutes);
    }

    return app;
  }

  function createAdminAssetFixture(): string {
    const assetsRoot = `${storageDir}/admin-assets`;
    fs.mkdirSync(`${assetsRoot}/assets`, { recursive: true });
    fs.writeFileSync(
      `${assetsRoot}/index.html`,
      [
        '<!doctype html>',
        '<html lang="en">',
        '<head>',
        '<meta charset="UTF-8" />',
        '<title>1MCP Admin Console</title>',
        '<script type="module" crossorigin src="/admin/assets/admin-console.js"></script>',
        '<link rel="stylesheet" crossorigin href="/admin/assets/admin-console.css" />',
        '</head>',
        '<body><div id="admin-root"></div></body>',
        '</html>',
      ].join(''),
    );
    fs.writeFileSync(`${assetsRoot}/assets/admin-console.js`, 'window.__adminConsoleSmoke = true;');
    fs.writeFileSync(`${assetsRoot}/assets/admin-console.css`, '.admin-console { display: block; }');
    return assetsRoot;
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
    expect((await request(app).post('/admin/cli/v1/session/login').send({})).status).toBe(404);
    expect((await request(app).get('/admin/cli/v1/session/status')).status).toBe(404);
    expect((await request(app).post('/admin/cli/v1/session/logout')).status).toBe(404);
    expect(adminService.validateSession(login.sessionToken)).toBeNull();
  });

  it('returns pre-auth CLI capabilities in a low-disclosure stable envelope', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    const app = mountAdminRoutes();

    const response = await request(app).get('/admin/cli/v1/capabilities').set('X-Request-Id', 'req_caps');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      cliProtocolVersion: '1',
      requestId: 'req_caps',
      warnings: [],
      result: {
        runtime: cliRuntimeIdentity,
        supportedOperations: ['admin.login', 'admin.status', 'admin.logout', 'mcp.enable', 'mcp.disable'],
        adminSurface: {
          enabled: true,
          status: 'loginRequired',
        },
        mutationReadiness: {
          mcp: {
            enabled: true,
            status: 'ready',
            operations: ['enable', 'disable'],
          },
        },
        features: {
          adminSessions: true,
          bearerSessionAuth: true,
          csrfTokens: true,
          mcpEnableDisable: true,
        },
      },
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /runtime\.example\.com|operator|correct horse battery staple|filesystem|raw-token|passwordHash|process\.pid/i,
    );
  });

  it('exposes setup-required admin and CLI capabilities without account facts', async () => {
    const app = express();
    const adminRoutes = createAdminRoutes({
      adminEnabled: true,
      adminService,
      configuredServerService,
      getRuntimeIdentity: () => runtimeIdentity,
      adminConsoleAssetsDir: createAdminAssetFixture(),
    });

    if (adminRoutes) {
      app.use('/admin', adminRoutes);
    }

    const adminResponse = await request(app).get('/admin');
    const capabilitiesResponse = await request(app).get('/admin/cli/v1/capabilities');

    expect(adminResponse.status).toBe(200);
    expect(adminResponse.headers['content-type']).toContain('text/html');
    expect(adminResponse.text).toContain('/admin/assets/admin-console.js');
    expect(adminResponse.text).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    expect(adminResponse.text).not.toMatch(/<style[\s>]/i);

    expect(capabilitiesResponse.status).toBe(200);
    expect(capabilitiesResponse.body).toEqual({
      ok: true,
      cliProtocolVersion: '1',
      requestId: expect.any(String),
      warnings: [],
      result: {
        runtime: cliRuntimeIdentity,
        supportedOperations: ['admin.login', 'admin.status', 'admin.logout', 'mcp.enable', 'mcp.disable'],
        adminSurface: {
          enabled: true,
          status: 'setupRequired',
        },
        mutationReadiness: {
          mcp: {
            enabled: true,
            status: 'ready',
            operations: ['enable', 'disable'],
          },
        },
        features: {
          adminSessions: true,
          bearerSessionAuth: true,
          csrfTokens: true,
          mcpEnableDisable: true,
        },
      },
    });
    expect(JSON.stringify(capabilitiesResponse.body)).not.toMatch(
      /runtime\.example\.com|account|user|email|serverName|filesystem|raw-token|passwordHash/i,
    );
  });

  it('serves the packaged admin console entrypoint without inline application code', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    const app = mountAdminRoutes({ adminConsoleAssetsDir: createAdminAssetFixture() });

    const response = await request(app).get('/admin');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.text).toContain('<div id="admin-root"></div>');
    expect(response.text).toContain('/admin/assets/admin-console.js');
    expect(response.text).toContain('/admin/assets/admin-console.css');
    expect(response.text).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    expect(response.text).not.toMatch(/<style[\s>]/i);
    expect(response.text).not.toMatch(/account create|disable account|delete account|password reset/i);
  });

  it('falls browser admin subroutes back to the SPA entrypoint', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    const app = mountAdminRoutes({ adminConsoleAssetsDir: createAdminAssetFixture() });

    const response = await request(app).get('/admin/workflows/runtime');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.text).toContain('/admin/assets/admin-console.js');
  });

  it('serves packaged admin console assets with long-lived cache headers', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    const app = mountAdminRoutes({ adminConsoleAssetsDir: createAdminAssetFixture() });

    const response = await request(app).get('/admin/assets/admin-console.js');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('javascript');
    expect(response.headers['cache-control']).toContain('public');
    expect(response.headers['cache-control']).toContain('max-age=31536000');
    expect(response.text).toBe('window.__adminConsoleSmoke = true;');
  });

  it('resolves the default admin console asset directory as a decoded filesystem path', () => {
    const assetsDir = resolveDefaultAdminConsoleAssetsDir();

    expect(path.isAbsolute(assetsDir)).toBe(true);
    expect(assetsDir).toMatch(new RegExp(`${path.sep}admin$`));
    expect(assetsDir).not.toContain('%20');
  });

  it('does not fall missing admin assets back to the SPA entrypoint', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    const app = mountAdminRoutes({ adminConsoleAssetsDir: createAdminAssetFixture() });

    const response = await request(app).get('/admin/assets/missing.js');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).not.toContain('<div id="admin-root"></div>');
  });

  it('keeps admin API and CLI routes ahead of the SPA fallback', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    const app = mountAdminRoutes({ adminConsoleAssetsDir: createAdminAssetFixture() });

    const sessionResponse = await request(app).get('/admin/api/session');
    const capabilitiesResponse = await request(app).get('/admin/cli/v1/capabilities');

    expect(sessionResponse.status).toBe(401);
    expect(sessionResponse.body).toEqual({ authenticated: false });
    expect(sessionResponse.headers['content-type']).toContain('application/json');
    expect(capabilitiesResponse.status).toBe(200);
    expect(capabilitiesResponse.body).toMatchObject({
      ok: true,
      cliProtocolVersion: '1',
      result: {
        adminSurface: {
          enabled: true,
          status: 'loginRequired',
        },
      },
    });
    expect(capabilitiesResponse.headers['content-type']).toContain('application/json');
  });

  it('does not fall unknown admin API or CLI paths back to the SPA entrypoint', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    const app = mountAdminRoutes({ adminConsoleAssetsDir: createAdminAssetFixture() });
    const loginResponse = await request(app)
      .post('/admin/api/session/login')
      .send({ username: 'operator', password: 'correct horse battery staple' });
    const cookie = loginResponse.headers['set-cookie']?.[0] as string;

    const apiResponse = await request(app).get('/admin/api/unknown').set('Cookie', cookie);
    const cliResponse = await request(app).get('/admin/cli/v1/unknown');

    expect(apiResponse.status).toBe(404);
    expect(apiResponse.text).not.toContain('<div id="admin-root"></div>');
    expect(cliResponse.status).toBe(404);
    expect(cliResponse.text).not.toContain('<div id="admin-root"></div>');
  });

  it('serves setup-required state through the admin session API without account management facts', async () => {
    const app = mountAdminRoutes({ adminConsoleAssetsDir: createAdminAssetFixture() });

    const response = await request(app).get('/admin/api/session');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ authenticated: false, adminStatus: 'setupRequired' });
    expect(JSON.stringify(response.body)).not.toMatch(/account|create|reset|password/i);
  });

  it('keeps SPA interaction logic out of the server-rendered entrypoint', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    const app = mountAdminRoutes({ adminConsoleAssetsDir: createAdminAssetFixture() });

    const response = await request(app).get('/admin');

    expect(response.text).not.toContain('document.visibilityState');
    expect(response.text).not.toContain('async function enableServer');
    expect(response.text).not.toContain('Idempotency-Key');
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

  it('logs in through the CLI adapter with tokens, redacted account facts, and stable credential errors', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    const app = mountAdminRoutes();

    const loginResponse = await request(app)
      .post('/admin/cli/v1/session/login')
      .set('X-Request-Id', 'req_cli_login')
      .send({ username: 'operator', password: 'correct horse battery staple' });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.headers['set-cookie']).toBeUndefined();
    expect(loginResponse.body).toMatchObject({
      ok: true,
      cliProtocolVersion: '1',
      requestId: 'req_cli_login',
      warnings: [],
      result: {
        sessionToken: expect.stringMatching(/^admin_sess_/),
        csrfToken: expect.stringMatching(/^admin_csrf_/),
        expiresAt: '2026-07-06T01:00:00.000Z',
        account: {
          username: 'operator',
          role: 'full-admin',
        },
      },
    });
    expect(JSON.stringify(loginResponse.body.result.account)).not.toMatch(
      /password|hash|disabled|createdAt|updatedAt|id/i,
    );

    const invalidResponse = await request(app)
      .post('/admin/cli/v1/session/login')
      .set('X-Request-Id', 'req_cli_bad_login')
      .send({ username: 'operator', password: 'wrong password' });

    expect(invalidResponse.status).toBe(401);
    expect(invalidResponse.body).toEqual({
      ok: false,
      cliProtocolVersion: '1',
      requestId: 'req_cli_bad_login',
      error: {
        code: 'invalid_credentials',
        message: 'Invalid admin credentials',
        retryable: false,
        requestId: 'req_cli_bad_login',
      },
      warnings: [],
    });
    expect(JSON.stringify(invalidResponse.body)).not.toMatch(
      /stack|passwordHash|correct horse battery staple|storageDir/i,
    );
  });

  it('returns CLI session status envelopes after validating bearer sessions against the admin identity service', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    const validateSpy = vi.spyOn(adminService, 'validateSession');
    const app = mountAdminRoutes();
    const loginResponse = await request(app)
      .post('/admin/cli/v1/session/login')
      .send({ username: 'operator', password: 'correct horse battery staple' });
    const sessionToken = loginResponse.body.result.sessionToken as string;
    validateSpy.mockClear();

    const authenticatedResponse = await request(app)
      .get('/admin/cli/v1/session/status')
      .set('Authorization', `Bearer ${sessionToken}`)
      .set('X-Request-Id', 'req_cli_status');
    const unauthenticatedResponse = await request(app)
      .get('/admin/cli/v1/session/status')
      .set('Authorization', 'Bearer admin_sess_missing')
      .set('X-Request-Id', 'req_cli_status_missing');

    expect(validateSpy).toHaveBeenCalledWith(sessionToken);
    expect(authenticatedResponse.status).toBe(200);
    expect(authenticatedResponse.body).toEqual({
      ok: true,
      cliProtocolVersion: '1',
      requestId: 'req_cli_status',
      warnings: [],
      result: {
        authenticated: true,
        runtime: cliRuntimeIdentity,
        account: {
          username: 'operator',
          role: 'full-admin',
        },
        expiresAt: '2026-07-06T01:00:00.000Z',
      },
    });
    expect(unauthenticatedResponse.status).toBe(200);
    expect(unauthenticatedResponse.body).toEqual({
      ok: true,
      cliProtocolVersion: '1',
      requestId: 'req_cli_status_missing',
      warnings: [],
      result: {
        authenticated: false,
        runtime: cliRuntimeIdentity,
      },
    });
  });

  it('logs out through the CLI adapter by revoking the bearer session server-side', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    const app = mountAdminRoutes();
    const loginResponse = await request(app)
      .post('/admin/cli/v1/session/login')
      .send({ username: 'operator', password: 'correct horse battery staple' });
    const sessionToken = loginResponse.body.result.sessionToken as string;
    expect(adminService.validateSession(sessionToken)).not.toBeNull();

    const logoutResponse = await request(app)
      .post('/admin/cli/v1/session/logout')
      .set('Authorization', `Bearer ${sessionToken}`)
      .set('X-Request-Id', 'req_cli_logout');

    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.body).toEqual({
      ok: true,
      cliProtocolVersion: '1',
      requestId: 'req_cli_logout',
      warnings: [],
      result: {
        revoked: true,
      },
    });
    expect(adminService.validateSession(sessionToken)).toBeNull();
  });

  it('enables and disables configured servers through the CLI adapter with bearer sessions and idempotency context', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    configuredServerService.enableConfiguredServer.mockResolvedValue({
      ok: true,
      status: 'completed',
      operationId: 'op_cli_enable',
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
      operationId: 'op_cli_disable',
      operationName: 'disableConfiguredServer',
      replayed: true,
      result: {
        targetName: 'filesystem',
        enabled: false,
        outcome: 'already_disabled',
        configChange: {
          status: 'unchanged',
          operation: 'disable',
          configPath: '/tmp/mcp.json',
          target: { name: 'filesystem', source: 'mcpServers' },
          changed: false,
          backup: { created: false },
          retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
          reload: { status: 'observed' },
          warnings: [],
        },
      },
    });
    const app = mountAdminRoutes();
    const loginResponse = await request(app)
      .post('/admin/cli/v1/session/login')
      .send({ username: 'operator', password: 'correct horse battery staple' });
    const sessionToken = loginResponse.body.result.sessionToken as string;

    const rejected = await request(app)
      .post('/admin/cli/v1/operations/enable-server')
      .set('X-Request-Id', 'req_cli_enable_rejected')
      .set('Idempotency-Key', 'enable-key')
      .send({ targetName: 'filesystem' });
    const enabled = await request(app)
      .post('/admin/cli/v1/operations/enable-server')
      .set('Authorization', `Bearer ${sessionToken}`)
      .set('X-Request-Id', 'req_cli_enable')
      .set('Idempotency-Key', 'enable-key')
      .send({ targetName: 'filesystem' });
    const disabled = await request(app)
      .post('/admin/cli/v1/operations/disable-server')
      .set('Authorization', `Bearer ${sessionToken}`)
      .set('X-Request-Id', 'req_cli_disable')
      .set('Idempotency-Key', 'disable-key')
      .send({ targetName: 'filesystem' });

    expect(rejected.status).toBe(401);
    expect(rejected.body).toEqual({
      ok: false,
      cliProtocolVersion: '1',
      requestId: 'req_cli_enable_rejected',
      error: {
        code: 'admin_session_required',
        message: 'A valid admin session bearer token is required',
        retryable: false,
        requestId: 'req_cli_enable_rejected',
      },
      warnings: [],
    });
    expect(enabled.status).toBe(200);
    expect(enabled.body).toMatchObject({
      ok: true,
      cliProtocolVersion: '1',
      requestId: 'req_cli_enable',
      warnings: [],
      result: {
        operationId: 'op_cli_enable',
        operationName: 'enableConfiguredServer',
        replayed: false,
        targetName: 'filesystem',
        enabled: true,
        outcome: 'enabled',
        configChange: { reload: { status: 'observed' } },
      },
    });
    expect(disabled.status).toBe(200);
    expect(disabled.body).toMatchObject({
      ok: true,
      cliProtocolVersion: '1',
      requestId: 'req_cli_disable',
      warnings: [],
      result: {
        operationId: 'op_cli_disable',
        operationName: 'disableConfiguredServer',
        replayed: true,
        targetName: 'filesystem',
        enabled: false,
        outcome: 'already_disabled',
      },
    });
    expect(configuredServerService.enableConfiguredServer).toHaveBeenCalledTimes(1);
    expect(configuredServerService.enableConfiguredServer).toHaveBeenCalledWith({
      context: expect.objectContaining({
        actor: expect.objectContaining({
          type: 'admin_session',
          accountId: expect.any(String),
          sessionId: sessionToken,
        }),
        origin: 'cli',
        idempotencyKey: 'enable-key',
        request: { requestId: 'req_cli_enable', jsonMode: true },
        runtimeIdentity: { runtimeScopeId: 'scope_123', runtimeVersion: '1.2.3' },
        target: { type: 'configured_server', id: 'filesystem' },
        requestFingerprint: expect.stringContaining('enableConfiguredServer'),
      }),
      targetName: 'filesystem',
    });
    expect(configuredServerService.disableConfiguredServer).toHaveBeenCalledWith({
      context: expect.objectContaining({
        origin: 'cli',
        idempotencyKey: 'disable-key',
        target: { type: 'configured_server', id: 'filesystem' },
        requestFingerprint: expect.stringContaining('disableConfiguredServer'),
      }),
      targetName: 'filesystem',
    });
  });

  it('returns stable CLI recovery errors for configured-server mutation failures', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    configuredServerService.enableConfiguredServer.mockResolvedValue({
      ok: false,
      status: 'operation_in_progress',
      code: 'operation_in_progress',
      retryable: true,
      operationName: 'enableConfiguredServer',
      retryAfterMs: 250,
    });
    const app = mountAdminRoutes();
    const loginResponse = await request(app)
      .post('/admin/cli/v1/session/login')
      .send({ username: 'operator', password: 'correct horse battery staple' });

    const response = await request(app)
      .post('/admin/cli/v1/operations/enable-server')
      .set('Authorization', `Bearer ${loginResponse.body.result.sessionToken}`)
      .set('X-Request-Id', 'req_cli_recovery')
      .set('Idempotency-Key', 'enable-key')
      .send({ targetName: 'filesystem' });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      ok: false,
      cliProtocolVersion: '1',
      requestId: 'req_cli_recovery',
      error: {
        code: 'operation_in_progress',
        message: 'Admin operation is still in progress',
        retryable: true,
        requestId: 'req_cli_recovery',
        retryAfterMs: 250,
        details: {
          operationName: 'enableConfiguredServer',
        },
      },
      warnings: [],
    });
  });

  it('uses a normalized CLI configured-server request fingerprint independent of raw JSON body shape', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    configuredServerService.enableConfiguredServer.mockResolvedValue({
      ok: true,
      status: 'completed',
      operationId: 'op_cli_enable',
      operationName: 'enableConfiguredServer',
      replayed: false,
      result: {
        targetName: 'filesystem',
        enabled: true,
        outcome: 'enabled',
        configChange: {
          status: 'unchanged',
          operation: 'enable',
          configPath: '/tmp/mcp.json',
          target: { name: 'filesystem', source: 'mcpServers' },
          changed: false,
          backup: { created: false },
          retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
          reload: { status: 'observed' },
          warnings: [],
        },
      },
    });
    const app = mountAdminRoutes();
    const loginResponse = await request(app)
      .post('/admin/cli/v1/session/login')
      .send({ username: 'operator', password: 'correct horse battery staple' });

    await request(app)
      .post('/admin/cli/v1/operations/enable-server')
      .set('Authorization', `Bearer ${loginResponse.body.result.sessionToken}`)
      .set('Idempotency-Key', 'enable-key-a')
      .send({ targetName: 'filesystem', ignored: 'first' });
    await request(app)
      .post('/admin/cli/v1/operations/enable-server')
      .set('Authorization', `Bearer ${loginResponse.body.result.sessionToken}`)
      .set('Idempotency-Key', 'enable-key-b')
      .send({ ignored: 'second', targetName: 'filesystem' });

    const firstFingerprint =
      configuredServerService.enableConfiguredServer.mock.calls[0]?.[0].context.requestFingerprint;
    const secondFingerprint =
      configuredServerService.enableConfiguredServer.mock.calls[1]?.[0].context.requestFingerprint;
    expect(firstFingerprint).toBe(secondFingerprint);
    expect(firstFingerprint).toBe(
      '{"operationName":"enableConfiguredServer","schemaVersion":1,"target":{"id":"filesystem","type":"configured_server"}}',
    );
  });

  it('does not advertise or expose CLI configured-server mutations when the service is unavailable', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    const app = mountAdminRoutes({ configuredServerService: null });
    const loginResponse = await request(app)
      .post('/admin/cli/v1/session/login')
      .send({ username: 'operator', password: 'correct horse battery staple' });

    const capabilities = await request(app).get('/admin/cli/v1/capabilities').set('X-Request-Id', 'req_caps_no_mcp');
    const mutation = await request(app)
      .post('/admin/cli/v1/operations/enable-server')
      .set('Authorization', `Bearer ${loginResponse.body.result.sessionToken}`)
      .set('X-Request-Id', 'req_cli_no_mcp')
      .set('Idempotency-Key', 'enable-key')
      .send({ targetName: 'filesystem' });

    expect(capabilities.status).toBe(200);
    expect(capabilities.body.result.supportedOperations).toEqual(['admin.login', 'admin.status', 'admin.logout']);
    expect(capabilities.body.result.mutationReadiness.mcp).toEqual({
      enabled: false,
      status: 'unavailable',
      operations: [],
    });
    expect(capabilities.body.result.features.mcpEnableDisable).toBe(false);
    expect(mutation.status).toBe(404);
    expect(mutation.body).toEqual({
      ok: false,
      cliProtocolVersion: '1',
      requestId: 'req_cli_no_mcp',
      error: {
        code: 'admin_configured_servers_unavailable',
        message: 'Configured server administration is unavailable',
        retryable: false,
        requestId: 'req_cli_no_mcp',
      },
      warnings: [],
    });
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
            target: { type: 'configured_server', id: 'filesystem', source: 'mcpServers' },
            enabled: true,
            tags: [],
            transportSummary: { kind: 'stdio', label: 'npx' },
            mutationAvailability: { available: true, operations: ['enable', 'disable'] },
            actionState: {
              enable: { available: false, label: 'Enable filesystem', disabledReason: 'already_enabled' },
              disable: { available: true, label: 'Disable filesystem' },
            },
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
          target: { type: 'configured_server', id: 'filesystem', source: 'mcpServers' },
          enabled: true,
          tags: [],
          transportSummary: { kind: 'stdio', label: 'npx' },
          mutationAvailability: { available: true, operations: ['enable', 'disable'] },
          actionState: {
            enable: { available: false, label: 'Enable filesystem', disabledReason: 'already_enabled' },
            disable: { available: true, label: 'Disable filesystem' },
          },
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
