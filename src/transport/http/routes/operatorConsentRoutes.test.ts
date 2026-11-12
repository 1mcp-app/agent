import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ADMIN_SESSION_COOKIE_NAME, AdminIdentityService } from '@src/domains/admin/adminIdentityService.js';

import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createOperatorConsentGuard, createOperatorConsentRoutes } from './operatorConsentRoutes.js';

describe('operator consent authorization boundary', () => {
  let directory: string;
  let admin: AdminIdentityService;
  let login: Awaited<ReturnType<AdminIdentityService['login']>>;
  const approve = vi.fn();

  function app(enabled = true) {
    const server = express();
    server.use(express.urlencoded({ extended: false }));
    const authorize = express.Router();
    authorize.get('/authorize', (_req, res) => res.json({ csrfToken: res.locals.oauthConsentCsrfToken }));
    const consent = express.Router();
    const guard = createOperatorConsentGuard(admin, enabled);
    consent.post('/consent', guard, (_req, res) => {
      approve();
      res.sendStatus(204);
    });
    server.use(createOperatorConsentRoutes(authorize, consent, guard));
    server.use('/oauth', consent);
    return server;
  }

  function cookie(token = login.sessionToken) {
    return `${ADMIN_SESSION_COOKIE_NAME}=${token}`;
  }

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'operator-consent-test-'));
    admin = new AdminIdentityService({ storageDir: directory, runtimeScopeId: 'consent-test' });
    await admin.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
    login = await admin.login({ username: 'operator', password: 'correct horse battery staple' });
    approve.mockClear();
  });

  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  it('preserves authorization parameters while moving the browser into the Admin cookie scope', async () => {
    const response = await request(app()).get('/authorize?client_id=test&state=a%26b');
    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('/admin/oauth/authorize?client_id=test&state=a%26b');
    const post = await request(app()).post('/authorize').type('form').send({ client_id: 'test', state: 'a&b' });
    expect(post.status).toBe(303);
    expect(post.headers.location).toBe('/admin/oauth/authorize?client_id=test&state=a%26b');
  });

  it('requires a live Admin Session before showing consent and supplies its CSRF token', async () => {
    const server = app();
    expect((await request(server).get('/admin/oauth/authorize')).status).toBe(401);
    const response = await request(server).get('/admin/oauth/authorize').set('Cookie', cookie());
    expect(response.status).toBe(200);
    expect(response.body.csrfToken).toBe(login.csrfToken);
    expect(response.headers['cache-control']).toBe('no-store');
    admin.revokeSession(login.sessionToken);
    expect((await request(server).get('/admin/oauth/authorize').set('Cookie', cookie())).status).toBe(401);
  });

  it("binds approval to the authenticated session and rejects missing or another session's CSRF token", async () => {
    const server = app();
    const other = await admin.login({ username: 'operator', password: 'correct horse battery staple' });
    for (const csrf of [undefined, other.csrfToken]) {
      const response = await request(server)
        .post('/admin/oauth/consent')
        .set('Cookie', cookie())
        .type('form')
        .send({ csrf_token: csrf });
      expect(response.status).toBe(403);
    }
    expect(approve).not.toHaveBeenCalled();
    expect(
      (
        await request(server)
          .post('/admin/oauth/consent')
          .set('Cookie', cookie())
          .type('form')
          .send({ csrf_token: login.csrfToken })
      ).status,
    ).toBe(204);
    expect(approve).toHaveBeenCalledOnce();
  });

  it('does not allow the original consent path to bypass session checks', async () => {
    expect(
      (await request(app()).post('/oauth/consent').type('form').send({ csrf_token: login.csrfToken })).status,
    ).toBe(401);
    expect(approve).not.toHaveBeenCalled();
  });

  it('fails closed when Admin is disabled or has no account', async () => {
    expect((await request(app(false)).get('/admin/oauth/authorize').set('Cookie', cookie())).status).toBe(403);
    admin = new AdminIdentityService({ storageDir: path.join(directory, 'empty'), runtimeScopeId: 'empty' });
    expect((await request(app()).get('/admin/oauth/authorize')).status).toBe(403);
    expect(approve).not.toHaveBeenCalled();
  });
});
