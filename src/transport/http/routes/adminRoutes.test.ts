import fs from 'node:fs';

import { AdminIdentityService } from '@src/domains/admin/adminIdentityService.js';

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

  beforeEach(() => {
    storageDir = `/tmp/admin-routes-${Date.now()}-${Math.random()}`;
    adminService = new AdminIdentityService({
      runtimeScopeId: 'scope_123',
      storageDir,
      now: () => new Date('2026-07-06T00:00:00.000Z'),
      sessionTtlMs: 60 * 60 * 1000,
    });
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
      getRuntimeIdentity: () => ({
        ...runtimeIdentity,
        externalUrl: options.externalUrl ?? runtimeIdentity.externalUrl,
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
      getRuntimeIdentity: () => runtimeIdentity,
    });

    if (adminRoutes) {
      app.use('/admin', adminRoutes);
    }

    const adminResponse = await request(app).get('/admin');
    const capabilitiesResponse = await request(app).get('/admin/cli/v1/capabilities');

    expect(adminResponse.status).toBe(200);
    expect(adminResponse.body).toEqual({
      status: 'setupRequired',
      adminSurface: 'enabled',
    });

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

    expect(
      (
        await request(app)
          .post('/admin/api/session/password')
          .set('Cookie', cookie)
          .send({ password: 'changed password' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/admin/api/session/password')
          .set('Cookie', cookie)
          .set('X-CSRF-Token', 'admin_csrf_wrong')
          .send({ password: 'changed password' })
      ).status,
    ).toBe(403);
  });

  it('revokes the active session on password change through the admin API', async () => {
    const account = await adminService.bootstrapFirstAdmin({
      username: 'operator',
      password: 'correct horse battery staple',
    });
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

    expect(passwordResponse.status).toBe(200);
    expect(passwordResponse.headers['set-cookie']?.[0]).toContain('1mcp_admin_session=;');
    expect(adminService.validateSession(cookieValue(cookie))).toBeNull();
    const newLogin = await adminService.login({
      username: account.username,
      password: 'new correct horse battery staple',
    });
    expect(newLogin.account.username).toBe('operator');
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

  it('bootstraps the first admin from environment only when no account exists', async () => {
    const bootstrapSpy = vi.spyOn(adminService, 'bootstrapFirstAdminFromEnvironment');
    mountAdminRoutes();

    expect(bootstrapSpy).toHaveBeenCalled();
  });
});
