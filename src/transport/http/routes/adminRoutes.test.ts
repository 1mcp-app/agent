import fs from 'node:fs';
import path from 'node:path';

import type { AdminBackendRestartOperations } from '@src/domains/admin/adminBackendRestartService.js';
import {
  AdminConfiguredServerNotFoundError,
  type AdminConfiguredServerOperations,
  AdminConfiguredServerService,
  type ConfiguredServerConfigDocument,
} from '@src/domains/admin/adminConfiguredServerService.js';
import { AdminIdentityService } from '@src/domains/admin/adminIdentityService.js';
import { type AdminAuditFact, AdminOperationService } from '@src/domains/admin/adminOperationService.js';
import { createConfigChangeService } from '@src/domains/config-change/configChange.js';

import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAdminRoutes, FailedLoginLimiter } from './adminRoutes.js';
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
    getConfiguredServerDetail: ReturnType<typeof vi.fn<AdminConfiguredServerOperations['getConfiguredServerDetail']>>;
    previewConfiguredServerEdit: ReturnType<
      typeof vi.fn<AdminConfiguredServerOperations['previewConfiguredServerEdit']>
    >;
    applyConfiguredServerEdit: ReturnType<typeof vi.fn<AdminConfiguredServerOperations['applyConfiguredServerEdit']>>;
    enableConfiguredServer: ReturnType<typeof vi.fn<AdminConfiguredServerOperations['enableConfiguredServer']>>;
    disableConfiguredServer: ReturnType<typeof vi.fn<AdminConfiguredServerOperations['disableConfiguredServer']>>;
    getRecentAuditFacts: ReturnType<typeof vi.fn<(options?: { limit?: number }) => AdminAuditFact[]>>;
  };
  let backendRestartService: {
    restartBackend: ReturnType<typeof vi.fn<AdminBackendRestartOperations['restartBackend']>>;
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
      getConfiguredServerDetail: vi.fn<AdminConfiguredServerOperations['getConfiguredServerDetail']>(),
      previewConfiguredServerEdit: vi.fn<AdminConfiguredServerOperations['previewConfiguredServerEdit']>(),
      applyConfiguredServerEdit: vi.fn<AdminConfiguredServerOperations['applyConfiguredServerEdit']>(),
      enableConfiguredServer: vi.fn<AdminConfiguredServerOperations['enableConfiguredServer']>(),
      disableConfiguredServer: vi.fn<AdminConfiguredServerOperations['disableConfiguredServer']>(),
      getRecentAuditFacts: vi.fn<(options?: { limit?: number }) => AdminAuditFact[]>(() => []),
    };
    backendRestartService = {
      restartBackend: vi.fn<AdminBackendRestartOperations['restartBackend']>(),
    };
  });

  afterEach(() => {
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  function mountAdminRoutes(
    options: {
      externalUrl?: string;
      configuredServerService?: AdminConfiguredServerOperations | null;
      backendRestartService?: AdminBackendRestartOperations | null;
      adminConsoleAssetsDir?: string;
      adminMutationAvailability?: { available: boolean; reason?: 'writer_lock_unavailable' };
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
      backendRestartService:
        options.backendRestartService === null ? undefined : (options.backendRestartService ?? backendRestartService),
      getRuntimeIdentity: () => ({
        ...runtimeIdentity,
        externalUrl: options.externalUrl ?? runtimeIdentity.externalUrl,
      }),
      adminMutationAvailability: options.adminMutationAvailability,
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

  function createRealConfiguredServerService(
    readConfigDocument: () => ConfiguredServerConfigDocument | null,
  ): AdminConfiguredServerOperations {
    return new AdminConfiguredServerService({
      operationService: new AdminOperationService({
        runtimeScopeId: 'scope_123',
        storageDir,
        now: () => new Date('2026-07-06T00:00:00.000Z'),
        createOperationId: () => 'op_preview_missing',
      }),
      configChangeService: createConfigChangeService(),
      readConfigDocument,
    });
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
        supportedOperations: [
          'admin.login',
          'admin.status',
          'admin.logout',
          'mcp.enable',
          'mcp.disable',
          'mcp.restart',
        ],
        adminSurface: {
          enabled: true,
          status: 'loginRequired',
        },
        mutationReadiness: {
          mcp: {
            enabled: true,
            status: 'ready',
            operations: ['enable', 'disable', 'restart'],
          },
        },
        adminMutationsAvailable: true,
        features: {
          adminSessions: true,
          bearerSessionAuth: true,
          csrfTokens: true,
          mcpEnableDisable: true,
          mcpRestart: true,
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
            enabled: false,
            status: 'setup_required',
            operations: [],
          },
        },
        adminMutationsAvailable: false,
        adminMutationsUnavailableReason: 'setup_required',
        features: {
          adminSessions: true,
          bearerSessionAuth: true,
          csrfTokens: true,
          mcpEnableDisable: false,
          mcpRestart: false,
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

  it('rejects oversized and mistyped login inputs before authentication or rate-limit key allocation', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    const login = vi.spyOn(adminService, 'login');
    const app = mountAdminRoutes();

    const browserResponse = await request(app)
      .post('/admin/api/session/login')
      .send({ username: 'x'.repeat(257), password: 'wrong password' });
    const cliResponse = await request(app)
      .post('/admin/cli/v1/session/login')
      .send({ username: 'operator', password: 123 });

    expect(browserResponse.status).toBe(400);
    expect(browserResponse.body).toEqual({ error: 'admin_login_request_invalid' });
    expect(cliResponse.status).toBe(400);
    expect(cliResponse.body.error.code).toBe('admin_login_request_invalid');
    expect(login).not.toHaveBeenCalled();
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
      confirmationRequirements: [
        {
          code: 'confirm_non_loopback_runtime',
          expected: true,
          target: { type: 'configured_server', id: 'filesystem' },
        },
        {
          code: 'confirmedOperation',
          expected: 'mcp.enable',
          target: { type: 'configured_server', id: 'filesystem' },
        },
        {
          code: 'confirmedRuntimeScopeId',
          expected: 'scope_123',
          target: { type: 'configured_server', id: 'filesystem' },
        },
        {
          code: 'confirmationSource',
          expected: 'cli_flag',
          target: { type: 'configured_server', id: 'filesystem' },
        },
      ],
    });
    expect(configuredServerService.disableConfiguredServer).toHaveBeenCalledWith({
      context: expect.objectContaining({
        origin: 'cli',
        idempotencyKey: 'disable-key',
        target: { type: 'configured_server', id: 'filesystem' },
        requestFingerprint: expect.stringContaining('disableConfiguredServer'),
      }),
      targetName: 'filesystem',
      confirmationRequirements: [
        {
          code: 'confirm_non_loopback_runtime',
          expected: true,
          target: { type: 'configured_server', id: 'filesystem' },
        },
        {
          code: 'confirmedOperation',
          expected: 'mcp.disable',
          target: { type: 'configured_server', id: 'filesystem' },
        },
        {
          code: 'confirmedRuntimeScopeId',
          expected: 'scope_123',
          target: { type: 'configured_server', id: 'filesystem' },
        },
        {
          code: 'confirmationSource',
          expected: 'cli_flag',
          target: { type: 'configured_server', id: 'filesystem' },
        },
      ],
    });
  });

  it('restarts a selected backend instance through the CLI adapter and maps ambiguous prefixes', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    backendRestartService.restartBackend
      .mockResolvedValueOnce({
        ok: true,
        status: 'completed',
        operationId: 'op_cli_restart',
        operationName: 'restartBackend',
        replayed: false,
        result: {
          targetName: 'github',
          targetType: 'template',
          outcome: 'restarted',
          restartedInstanceIds: ['abcdef0123456789'],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 'completed',
        operationId: 'op_cli_restart_ambiguous',
        operationName: 'restartBackend',
        replayed: false,
        result: {
          targetName: 'github',
          targetType: 'template',
          outcome: 'instance_ambiguous',
          restartedInstanceIds: [],
          candidateInstanceIds: ['abcdef0123456789', 'abcdef9999999999'],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 'completed',
        operationId: 'op_cli_restart_healthy',
        operationName: 'restartBackend',
        replayed: false,
        result: {
          targetName: 'github',
          targetType: 'template',
          outcome: 'no_unhealthy_instances',
          restartedInstanceIds: [],
        },
      });
    const app = mountAdminRoutes();
    const loginResponse = await request(app)
      .post('/admin/cli/v1/session/login')
      .send({ username: 'operator', password: 'correct horse battery staple' });
    const sessionToken = loginResponse.body.result.sessionToken as string;

    const restarted = await request(app)
      .post('/admin/cli/v1/operations/restart-server')
      .set('Authorization', `Bearer ${sessionToken}`)
      .set('X-Request-Id', 'req_cli_restart')
      .set('Idempotency-Key', 'restart-key')
      .send({ targetName: 'github', instance: 'abcdef012345' });
    const ambiguous = await request(app)
      .post('/admin/cli/v1/operations/restart-server')
      .set('Authorization', `Bearer ${sessionToken}`)
      .set('X-Request-Id', 'req_cli_restart_ambiguous')
      .set('Idempotency-Key', 'restart-key-ambiguous')
      .send({ targetName: 'github', instance: 'abcdef' });
    const healthy = await request(app)
      .post('/admin/cli/v1/operations/restart-server')
      .set('Authorization', `Bearer ${sessionToken}`)
      .set('X-Request-Id', 'req_cli_restart_healthy')
      .set('Idempotency-Key', 'restart-key-healthy')
      .send({ targetName: 'github' });

    expect(restarted.status).toBe(200);
    expect(restarted.body).toMatchObject({
      ok: true,
      result: {
        operationName: 'restartBackend',
        targetName: 'github',
        outcome: 'restarted',
        restartedInstanceIds: ['abcdef0123456789'],
      },
    });
    expect(ambiguous.status).toBe(409);
    expect(ambiguous.body).toMatchObject({
      ok: false,
      error: {
        code: 'backend_instance_ambiguous',
        details: { candidateInstanceIds: ['abcdef0123456789', 'abcdef9999999999'] },
      },
    });
    expect(healthy.status).toBe(409);
    expect(healthy.body).toMatchObject({
      ok: false,
      error: {
        code: 'backend_no_unhealthy_instances',
        details: { targetName: 'github' },
      },
    });
    expect(backendRestartService.restartBackend).toHaveBeenNthCalledWith(1, {
      context: expect.objectContaining({
        origin: 'cli',
        idempotencyKey: 'restart-key',
        target: { type: 'backend', id: 'github' },
        requestFingerprint: expect.any(String),
      }),
      targetName: 'github',
      selection: { mode: 'instance', instanceIdOrPrefix: 'abcdef012345' },
      confirmationRequirements: expect.any(Array),
    });
  });

  it('rejects conflicting backend restart selectors before invoking the domain operation', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    const app = mountAdminRoutes();
    const loginResponse = await request(app)
      .post('/admin/cli/v1/session/login')
      .send({ username: 'operator', password: 'correct horse battery staple' });

    const response = await request(app)
      .post('/admin/cli/v1/operations/restart-server')
      .set('Authorization', `Bearer ${loginResponse.body.result.sessionToken}`)
      .send({ targetName: 'github', instance: 'abcdef', allInstances: true });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_request_invalid');
    expect(backendRestartService.restartBackend).not.toHaveBeenCalled();
  });

  it('passes CLI dry-run and confirmation facts into configured-server mutation input', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    configuredServerService.enableConfiguredServer.mockResolvedValue({
      ok: true,
      status: 'completed',
      operationId: 'op_cli_preview',
      operationName: 'enableConfiguredServer',
      replayed: false,
      result: {
        mode: 'dry_run',
        targetName: 'filesystem',
        enabled: true,
        outcome: 'enabled',
        configChange: {
          status: 'changed',
          operation: 'enable',
          configPath: '/tmp/mcp.json',
          target: { name: 'filesystem', source: 'mcpServers' },
          changed: true,
          backup: { created: false },
          retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
          reload: { status: 'skipped' },
          warnings: [],
        },
      },
    });
    const app = mountAdminRoutes();
    const loginResponse = await request(app)
      .post('/admin/cli/v1/session/login')
      .send({ username: 'operator', password: 'correct horse battery staple' });

    const response = await request(app)
      .post('/admin/cli/v1/operations/enable-server')
      .set('Authorization', `Bearer ${loginResponse.body.result.sessionToken}`)
      .set('X-Request-Id', 'req_cli_preview')
      .send({
        targetName: 'filesystem',
        dryRun: true,
        confirmationFacts: {
          confirm_non_loopback_runtime: true,
          confirmationSource: 'cli_flag',
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.result).toMatchObject({
      mode: 'dry_run',
      targetName: 'filesystem',
      configChange: { reload: { status: 'skipped' } },
    });
    expect(configuredServerService.enableConfiguredServer).toHaveBeenCalledWith({
      context: expect.objectContaining({
        origin: 'cli',
        confirmationFacts: {
          confirm_non_loopback_runtime: true,
          confirmationSource: 'cli_flag',
        },
      }),
      targetName: 'filesystem',
      dryRun: true,
      confirmationRequirements: [],
    });
  });

  it('rejects a non-boolean CLI dryRun without invoking a live mutation', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    const app = mountAdminRoutes();
    const loginResponse = await request(app)
      .post('/admin/cli/v1/session/login')
      .send({ username: 'operator', password: 'correct horse battery staple' });

    const response = await request(app)
      .post('/admin/cli/v1/operations/enable-server')
      .set('Authorization', `Bearer ${loginResponse.body.result.sessionToken}`)
      .send({ targetName: 'filesystem', dryRun: 'true' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_request_invalid');
    expect(configuredServerService.enableConfiguredServer).not.toHaveBeenCalled();
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

  it('returns a bounded CLI error instead of streaming oversized success responses', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    const oversizedValue = 'x'.repeat(300 * 1024);
    configuredServerService.enableConfiguredServer.mockResolvedValue({
      ok: true,
      status: 'completed',
      operationId: 'op_cli_large_success',
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
          backup: { created: false },
          retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
          reload: { status: 'observed' },
          warnings: [oversizedValue],
        },
      },
    });
    const app = mountAdminRoutes();
    const loginResponse = await request(app)
      .post('/admin/cli/v1/session/login')
      .send({ username: 'operator', password: 'correct horse battery staple' });

    const response = await request(app)
      .post('/admin/cli/v1/operations/enable-server')
      .set('Authorization', `Bearer ${loginResponse.body.result.sessionToken}`)
      .set('X-Request-Id', 'req_cli_large_success')
      .set('Idempotency-Key', 'large-success-key')
      .send({ targetName: 'filesystem' });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      ok: false,
      cliProtocolVersion: '1',
      requestId: 'req_cli_large_success',
      error: {
        code: 'validation_response_too_large',
        message: 'CLI Admin response exceeded the maximum supported size; use a narrower or paginated request.',
        retryable: false,
        requestId: 'req_cli_large_success',
        details: {
          maxBytes: expect.any(Number),
        },
      },
      warnings: [],
    });
    expect(response.body.error.details.maxBytes).toBeLessThan(oversizedValue.length);
    expect(response.text).not.toContain(oversizedValue.slice(0, 128));
  });

  it('returns a bounded CLI error instead of streaming oversized error details', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    const oversizedValue = 'x'.repeat(300 * 1024);
    configuredServerService.enableConfiguredServer.mockResolvedValue({
      ok: false,
      status: 'mutation_failed',
      code: 'mutation_failed',
      retryable: false,
      operationName: 'enableConfiguredServer',
      error: oversizedValue,
    });
    const app = mountAdminRoutes();
    const loginResponse = await request(app)
      .post('/admin/cli/v1/session/login')
      .send({ username: 'operator', password: 'correct horse battery staple' });

    const response = await request(app)
      .post('/admin/cli/v1/operations/enable-server')
      .set('Authorization', `Bearer ${loginResponse.body.result.sessionToken}`)
      .set('X-Request-Id', 'req_cli_large_error')
      .set('Idempotency-Key', 'large-error-key')
      .send({ targetName: 'filesystem' });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      ok: false,
      cliProtocolVersion: '1',
      requestId: 'req_cli_large_error',
      error: {
        code: 'validation_response_too_large',
        message: 'CLI Admin response exceeded the maximum supported size; use a narrower or paginated request.',
        retryable: false,
        requestId: 'req_cli_large_error',
        details: {
          maxBytes: expect.any(Number),
        },
      },
      warnings: [],
    });
    expect(response.body.error.details.maxBytes).toBeLessThan(oversizedValue.length);
    expect(response.text).not.toContain(oversizedValue.slice(0, 128));
  });

  it('reports an unavailable runtime scope admin lock and rejects CLI mutations without calling the service', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    const app = mountAdminRoutes({
      adminMutationAvailability: {
        available: false,
        reason: 'writer_lock_unavailable',
      },
    });
    const loginResponse = await request(app)
      .post('/admin/cli/v1/session/login')
      .send({ username: 'operator', password: 'correct horse battery staple' });

    const capabilities = await request(app).get('/admin/cli/v1/capabilities').set('X-Request-Id', 'req_caps_locked');
    const mutation = await request(app)
      .post('/admin/cli/v1/operations/enable-server')
      .set('Authorization', `Bearer ${loginResponse.body.result.sessionToken}`)
      .set('X-Request-Id', 'req_cli_locked')
      .set('Idempotency-Key', 'enable-key')
      .send({ targetName: 'filesystem' });

    expect(capabilities.status).toBe(200);
    expect(capabilities.body.result).toMatchObject({
      adminMutationsAvailable: false,
      adminMutationsUnavailableReason: 'writer_lock_unavailable',
      mutationReadiness: {
        mcp: {
          enabled: false,
          status: 'writer_lock_unavailable',
          operations: [],
        },
      },
    });
    expect(JSON.stringify(capabilities.body)).not.toMatch(/pid|lockPath|hostname|filesystem/i);
    expect(mutation.status).toBe(409);
    expect(mutation.body).toEqual({
      ok: false,
      cliProtocolVersion: '1',
      requestId: 'req_cli_locked',
      error: {
        code: 'runtime_scope_locked',
        message: 'Runtime scope admin mutations are locked by another writer',
        retryable: true,
        requestId: 'req_cli_locked',
        details: {
          operationName: 'enableConfiguredServer',
          reason: 'writer_lock_unavailable',
        },
      },
      warnings: [],
    });
    expect(configuredServerService.enableConfiguredServer).not.toHaveBeenCalled();
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
    expect(capabilities.body.result.supportedOperations).toEqual([
      'admin.login',
      'admin.status',
      'admin.logout',
      'mcp.restart',
    ]);
    expect(capabilities.body.result.mutationReadiness.mcp).toEqual({
      enabled: true,
      status: 'ready',
      operations: ['restart'],
    });
    expect(capabilities.body.result.adminMutationsAvailable).toBe(true);
    expect(capabilities.body.result.adminMutationsUnavailableReason).toBeUndefined();
    expect(capabilities.body.result.features.mcpEnableDisable).toBe(false);
    expect(capabilities.body.result.features.mcpRestart).toBe(true);
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

  it('returns one configured-server detail and edit contract with decoded target context', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    configuredServerService.getConfiguredServerDetail.mockResolvedValue({
      ok: true,
      status: 'completed',
      operationId: 'op_detail',
      operationName: 'getConfiguredServerDetail',
      replayed: false,
      result: {
        server: {
          id: 'github/api server',
          source: 'mcpServers',
          target: { type: 'configured_server', id: 'github/api server', source: 'mcpServers' },
          enabled: true,
          tags: ['remote'],
          transportSummary: { kind: 'http', label: 'https://api.example.com/mcp?token=REDACTED' },
          mutationAvailability: { available: true, operations: ['enable', 'disable'] },
          actionState: {
            enable: { available: false, label: 'Enable github/api server', disabledReason: 'already_enabled' },
            disable: { available: true, label: 'Disable github/api server' },
          },
          transport: {
            type: 'http',
            url: 'https://api.example.com/mcp?token=REDACTED',
            headers: {
              Authorization: { present: true, value: '[REDACTED]', secret: true },
            },
          },
          secretInputs: [
            {
              fieldPath: ['headers', 'Authorization'],
              label: 'Authorization',
              state: 'present',
              allowedActions: ['preserve', 'replace', 'clear'],
            },
          ],
        },
        editContract: {
          schemaVersion: 3,
          target: { type: 'configured_server', id: 'github/api server', source: 'mcpServers' },
          capabilities: {
            singleTargetEdit: true,
            rename: { supported: true },
            create: { supported: false },
            delete: { supported: false },
            bulkEdit: { supported: false },
            rawJson: { supported: false },
            preview: { supported: true },
            apply: { supported: true },
          },
          fieldGroups: [
            {
              id: 'secrets',
              label: 'Secrets',
              fields: [
                {
                  fieldPath: ['headers', 'Authorization'],
                  label: 'Authorization',
                  control: 'secret',
                  editable: true,
                  secret: {
                    state: 'present',
                    defaultAction: 'preserve',
                    allowedActions: ['preserve', 'replace', 'clear'],
                    environmentReference: {
                      supported: true,
                      recommended: true,
                      valueFormat: 'env_var_name_or_substitution',
                      storesSecretMaterial: false,
                      guidance:
                        'Store only the environment variable name or substitution expression; keep secret material outside 1MCP config.',
                    },
                    inlineReplacement: {
                      supported: true,
                      emphasis: 'secondary',
                      guidance:
                        'Use inline replacement only as a secondary path when an environment reference is not suitable.',
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    });
    const app = mountAdminRoutes();
    const loginResponse = await request(app)
      .post('/admin/api/session/login')
      .send({ username: 'operator', password: 'correct horse battery staple' });
    const cookie = loginResponse.headers['set-cookie']?.[0] as string;

    const response = await request(app)
      .get('/admin/api/configured-servers/github%2Fapi%20server')
      .set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      operationId: 'op_detail',
      server: {
        id: 'github/api server',
        transport: {
          headers: {
            Authorization: { present: true, value: '[REDACTED]', secret: true },
          },
        },
      },
      editContract: {
        schemaVersion: 3,
        target: { type: 'configured_server', id: 'github/api server', source: 'mcpServers' },
      },
    });
    expect(response.body.server.id).toBe('github/api server');
    expect(response.body.editContract.capabilities).toMatchObject({
      singleTargetEdit: true,
      rename: { supported: true },
      create: { supported: false },
      delete: { supported: false },
      bulkEdit: { supported: false },
      rawJson: { supported: false },
    });
    expect(configuredServerService.getConfiguredServerDetail).toHaveBeenCalledWith({
      context: expect.objectContaining({
        actor: expect.objectContaining({ type: 'admin_session', accountId: expect.any(String) }),
        origin: 'browser',
        runtimeIdentity: { runtimeScopeId: 'scope_123', runtimeVersion: '1.2.3' },
        target: { type: 'configured_server', id: 'github/api server' },
      }),
      targetName: 'github/api server',
    });
    expect(JSON.stringify(response.body)).not.toMatch(/raw-token|raw-secret|Bearer raw/i);
  });

  it('returns an operator-friendly not-found error for missing configured-server detail', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    configuredServerService.getConfiguredServerDetail.mockRejectedValue(
      new AdminConfiguredServerNotFoundError('missing'),
    );
    const app = mountAdminRoutes();
    const loginResponse = await request(app)
      .post('/admin/api/session/login')
      .send({ username: 'operator', password: 'correct horse battery staple' });
    const cookie = loginResponse.headers['set-cookie']?.[0] as string;

    const response = await request(app).get('/admin/api/configured-servers/missing').set('Cookie', cookie);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      ok: false,
      error: 'configured_server_not_found',
      code: 'configured_server_not_found',
      message: 'Configured server target was not found',
      target: { type: 'configured_server', id: 'missing' },
    });
    expect(JSON.stringify(response.body)).not.toMatch(/raw|secret|token|password/i);
  });

  it('returns an operator-friendly not-found error for missing configured-server preview', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    configuredServerService.previewConfiguredServerEdit.mockRejectedValue(
      new AdminConfiguredServerNotFoundError('missing'),
    );
    const app = mountAdminRoutes();
    const loginResponse = await request(app)
      .post('/admin/api/session/login')
      .send({ username: 'operator', password: 'correct horse battery staple' });
    const cookie = loginResponse.headers['set-cookie']?.[0] as string;

    const response = await request(app)
      .post('/admin/api/configured-servers/missing/preview')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', loginResponse.body.csrfToken)
      .send({ edit: {} });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      ok: false,
      error: 'configured_server_not_found',
      code: 'configured_server_not_found',
      message: 'Configured server target was not found',
      target: { type: 'configured_server', id: 'missing' },
    });
    expect(JSON.stringify(response.body)).not.toMatch(/raw|secret|token|password/i);
  });

  it('returns preview not-found as 404 when using the real configured-server service', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    const app = mountAdminRoutes({
      configuredServerService: createRealConfiguredServerService(() => ({
        mcpServers: {},
      })),
    });
    const loginResponse = await request(app)
      .post('/admin/api/session/login')
      .send({ username: 'operator', password: 'correct horse battery staple' });
    const cookie = loginResponse.headers['set-cookie']?.[0] as string;

    const response = await request(app)
      .post('/admin/api/configured-servers/missing/preview')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', loginResponse.body.csrfToken)
      .send({ edit: {} });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      ok: false,
      error: 'configured_server_not_found',
      code: 'configured_server_not_found',
      message: 'Configured server target was not found',
      target: { type: 'configured_server', id: 'missing' },
    });
  });

  it('previews configured-server edits through the CSRF-protected admin API without idempotency reservation', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    configuredServerService.previewConfiguredServerEdit.mockResolvedValue({
      ok: true,
      status: 'completed',
      operationId: 'op_preview',
      operationName: 'previewConfiguredServerEdit',
      replayed: false,
      result: {
        targetName: 'github/api',
        proposedTargetName: 'github-renamed',
        previewFingerprint: 'preview_123',
        validation: { status: 'valid', errors: [] },
        diff: [
          {
            fieldPath: ['headers', 'Authorization'],
            secretAction: 'replace',
            oldValue: { present: true, value: '[REDACTED]', secret: true },
            newValue: {
              kind: 'environmentReference',
              value: '${GITHUB_AUTHORIZATION}',
              storesSecretMaterial: false,
            },
            riskFlags: ['connection_critical', 'secret'],
          },
        ],
        configChange: {
          status: 'changed',
          operation: 'set_static',
          configPath: '[redacted]',
          target: { name: 'github/api', source: 'mcpServers' },
          changed: true,
          backup: { created: false },
          retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
          reload: { status: 'skipped' },
          warnings: [],
        },
        connectivityCheck: {
          status: 'passed',
          mode: 'bounded_dry_run',
          checkedAt: '2026-07-07T00:00:00.000Z',
        },
      },
    });
    const app = mountAdminRoutes();
    const loginResponse = await request(app)
      .post('/admin/api/session/login')
      .send({ username: 'operator', password: 'correct horse battery staple' });
    const cookie = loginResponse.headers['set-cookie']?.[0] as string;
    const edit = {
      id: 'github-renamed',
      secrets: [
        {
          fieldPath: ['headers', 'Authorization'],
          action: 'replace',
          replacement: { kind: 'environmentReference', value: 'GITHUB_AUTHORIZATION' },
        },
      ],
    };

    const rejected = await request(app)
      .post('/admin/api/configured-servers/github%2Fapi/preview')
      .set('Cookie', cookie)
      .send({ edit });
    const response = await request(app)
      .post('/admin/api/configured-servers/github%2Fapi/preview')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', loginResponse.body.csrfToken)
      .send({ edit, connectivityCheck: 'manual' });

    expect(rejected.status).toBe(403);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      operationId: 'op_preview',
      preview: {
        targetName: 'github/api',
        proposedTargetName: 'github-renamed',
        previewFingerprint: 'preview_123',
        validation: { status: 'valid', errors: [] },
        diff: [
          {
            fieldPath: ['headers', 'Authorization'],
            secretAction: 'replace',
            oldValue: { present: true, value: '[REDACTED]', secret: true },
            newValue: {
              kind: 'environmentReference',
              value: '${GITHUB_AUTHORIZATION}',
              storesSecretMaterial: false,
            },
            riskFlags: ['connection_critical', 'secret'],
          },
        ],
        configChange: {
          status: 'changed',
          operation: 'set_static',
          configPath: '[redacted]',
          target: { name: 'github/api', source: 'mcpServers' },
          changed: true,
          backup: { created: false },
          retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
          reload: { status: 'skipped' },
          warnings: [],
        },
        connectivityCheck: {
          status: 'passed',
          mode: 'bounded_dry_run',
          checkedAt: '2026-07-07T00:00:00.000Z',
        },
      },
    });
    expect(configuredServerService.previewConfiguredServerEdit).toHaveBeenCalledWith({
      context: expect.objectContaining({
        actor: expect.objectContaining({ type: 'admin_session', accountId: expect.any(String) }),
        origin: 'browser',
        target: { type: 'configured_server', id: 'github/api' },
        requestFingerprint: expect.stringContaining('previewConfiguredServerEdit'),
      }),
      targetName: 'github/api',
      edit,
      connectivityCheck: 'manual',
    });
    expect(response.text).not.toMatch(/raw-secret|raw-token|Bearer raw/i);
  });

  it('applies configured-server edits through the CSRF and idempotency protected admin API', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    configuredServerService.applyConfiguredServerEdit.mockResolvedValue({
      ok: true,
      status: 'completed',
      operationId: 'op_apply',
      operationName: 'applyConfiguredServerEdit',
      replayed: false,
      result: {
        originalTargetName: 'github/api',
        targetName: 'github-renamed',
        previewFingerprint: 'preview_123',
        configChange: {
          status: 'changed',
          operation: 'edit',
          configPath: '/runtime/mcp.json',
          target: { name: 'github-renamed', source: 'mcpServers' },
          changed: true,
          backup: { created: true, path: '/runtime/mcp.json.backup.1' },
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
    const body = {
      edit: {
        id: 'github-renamed',
        secrets: [
          {
            fieldPath: ['headers', 'Authorization'],
            action: 'replace',
            replacement: { kind: 'inlineSecret', value: 'raw-secret' },
          },
        ],
      },
      previewFingerprint: 'preview_123',
      confirmationFacts: {
        previewConfirmed: 'preview_123',
        targetNameConfirmed: 'github-renamed',
        secretChangeConfirmed: true,
        connectionCriticalConfirmed: true,
      },
    };

    const csrfRejected = await request(app)
      .post('/admin/api/configured-servers/github%2Fapi/apply')
      .set('Cookie', cookie)
      .set('Idempotency-Key', 'apply-1')
      .send(body);
    const response = await request(app)
      .post('/admin/api/configured-servers/github%2Fapi/apply')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', loginResponse.body.csrfToken)
      .set('Idempotency-Key', 'apply-1')
      .send(body);

    expect(csrfRejected.status).toBe(403);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      operationId: 'op_apply',
      result: {
        originalTargetName: 'github/api',
        targetName: 'github-renamed',
        previewFingerprint: 'preview_123',
        configChange: { status: 'changed', operation: 'edit' },
      },
    });
    expect(configuredServerService.applyConfiguredServerEdit).toHaveBeenCalledWith({
      context: expect.objectContaining({
        idempotencyKey: 'apply-1',
        requestFingerprint: expect.stringMatching(/^configured_server_apply_[a-f0-9]{64}$/u),
        confirmationFacts: body.confirmationFacts,
      }),
      targetName: 'github/api',
      edit: body.edit,
      previewFingerprint: 'preview_123',
    });
    const operationContext = configuredServerService.applyConfiguredServerEdit.mock.calls[0]?.[0].context;
    expect(operationContext.requestFingerprint).not.toContain('raw-secret');
  });

  it('maps configured-server apply conflicts to structured responses', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    configuredServerService.applyConfiguredServerEdit.mockResolvedValue({
      ok: false,
      status: 'mutation_failed',
      code: 'mutation_failed',
      retryable: false,
      operationName: 'applyConfiguredServerEdit',
      error: 'configured_server_stale_preview',
    });
    const app = mountAdminRoutes();
    const loginResponse = await request(app)
      .post('/admin/api/session/login')
      .send({ username: 'operator', password: 'correct horse battery staple' });
    const response = await request(app)
      .post('/admin/api/configured-servers/alpha/apply')
      .set('Cookie', loginResponse.headers['set-cookie']?.[0] as string)
      .set('X-CSRF-Token', loginResponse.body.csrfToken)
      .set('Idempotency-Key', 'apply-conflict')
      .send({ edit: { tags: ['edited'] }, previewFingerprint: 'stale', confirmationFacts: {} });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      ok: false,
      error: 'configured_server_stale_preview',
      code: 'configured_server_stale_preview',
      message: 'The configured server changed after preview. Preview the edit again.',
    });
  });

  it('forwards malformed configured-server preview edits to the validation service', async () => {
    await adminService.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    configuredServerService.previewConfiguredServerEdit.mockResolvedValue({
      ok: true,
      status: 'completed',
      operationId: 'op_preview_invalid',
      operationName: 'previewConfiguredServerEdit',
      replayed: false,
      result: {
        targetName: 'github/api',
        proposedTargetName: 'github/api',
        previewFingerprint: 'preview_invalid',
        validation: {
          status: 'invalid',
          errors: [
            {
              fieldPath: [],
              code: 'invalid_edit',
              message: 'Edit must be an object.',
            },
          ],
        },
        diff: [],
        configChange: {
          status: 'unchanged',
          operation: 'set_static',
          configPath: '[redacted]',
          target: { name: 'github/api', source: 'mcpServers' },
          changed: false,
          backup: { created: false },
          retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
          reload: { status: 'skipped' },
          warnings: [],
        },
        connectivityCheck: {
          status: 'skipped',
          reason: 'validation_failed',
        },
      },
    });
    const app = mountAdminRoutes();
    const loginResponse = await request(app)
      .post('/admin/api/session/login')
      .send({ username: 'operator', password: 'correct horse battery staple' });
    const cookie = loginResponse.headers['set-cookie']?.[0] as string;

    const response = await request(app)
      .post('/admin/api/configured-servers/github%2Fapi/preview')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', loginResponse.body.csrfToken)
      .send({ edit: 'not-an-object' });

    expect(response.status).toBe(200);
    expect(response.body.preview.validation).toEqual({
      status: 'invalid',
      errors: [
        {
          fieldPath: [],
          code: 'invalid_edit',
          message: 'Edit must be an object.',
        },
      ],
    });
    expect(configuredServerService.previewConfiguredServerEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        targetName: 'github/api',
        edit: 'not-an-object',
        connectivityCheck: 'auto',
      }),
    );
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
      about: {
        productName: '1MCP Agent',
        runtimeVersion: '1.2.3',
        adminApiProtocolVersion: '1',
        protocolCompatible: false,
        runtime: { runtimeScopeId: 'scope_123', externalUrl: 'https://runtime.example.com' },
        build: {},
        project: {
          repository: 'https://github.com/1mcp-app/agent',
          documentation: 'https://docs.1mcp.app',
          issues: 'https://github.com/1mcp-app/agent/issues',
          license: 'Apache-2.0',
        },
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

describe('FailedLoginLimiter', () => {
  it('bounds active keys, fails closed at capacity, and prunes expired entries globally', () => {
    let now = 0;
    const limiter = new FailedLoginLimiter(() => now, 2, 100);
    limiter.recordFailure('one', 'source');
    limiter.recordFailure('two', 'source');

    expect(limiter.isLimited('three', 'source')).toBe(true);
    limiter.recordFailure('three', 'source');
    now = 101;
    expect(limiter.isLimited('three', 'source')).toBe(false);
    limiter.recordFailure('three', 'source');
    expect(limiter.isLimited('four', 'source')).toBe(false);
  });
});
