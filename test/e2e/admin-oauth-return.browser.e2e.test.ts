import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createOAuthAuthorizationFlow } from '@src/auth/oauthAuthorizationFlow.js';
import type { SDKOAuthServerProvider } from '@src/auth/sdkOAuthServerProvider.js';
import { AdminIdentityService } from '@src/domains/admin/adminIdentityService.js';
import { AdminOAuthService } from '@src/domains/admin/adminOAuthService.js';
import { AdminOperationService } from '@src/domains/admin/adminOperationService.js';
import { createAdminRoutes } from '@src/transport/http/routes/adminRoutes.js';
import { createOAuthRoutes } from '@src/transport/http/routes/oauthRoutes.js';

import express from 'express';
import { chromium } from 'playwright';
import { expect, it, vi } from 'vitest';

import { createMockLegacySdkAdapter } from '../unit-utils/MockFactories.js';

it('returns through a committed initiating-site document with the original Strict Admin session', async () => {
  const storageDir = mkdtempSync(path.join(tmpdir(), 'admin-oauth-return-'));
  let nowMs = Date.now();
  const admin = new AdminIdentityService({
    now: () => new Date(nowMs),
    runtimeScopeId: 'return-test',
    storageDir,
    sessionTtlMs: 60_000,
  });
  await admin.bootstrapFirstAdmin({ username: 'operator', password: 'correct horse battery staple' });
  const app = express();
  app.use(express.json());
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No server port');
  const callbackOrigin = `http://127.0.0.1:${address.port}`;
  const providerOrigin = `http://provider.test:${address.port}`;
  const completeOAuthAndReconnect = vi.fn().mockResolvedValue(undefined);
  const flow = createOAuthAuthorizationFlow({
    storage: {
      getAuthorizationRequest: vi.fn(),
      getClient: vi.fn(),
      processConsentApproval: vi.fn(),
      processConsentDenial: vi.fn(),
      createSessionWithId: vi.fn(),
    },
    serverRuntime: {
      getClient: () => ({
        status: 'awaiting_oauth',
        requiresOAuth: true,
        adapter: createMockLegacySdkAdapter(),
        authorizationUrl: `${providerOrigin}/provider?state=original&redirect_uri=${encodeURIComponent(callbackOrigin + '/oauth/callback/github')}`,
      }),
    },
    clientRuntime: { initiateOAuth: vi.fn(), completeOAuthAndReconnect },
    createTokenId: () => '',
    getAuthConfig: () => ({ enabled: true, oauthTokenTtlMs: 60000 }),
    getAvailableTags: () => [],
  });
  app.use('/oauth', createOAuthRoutes({} as SDKOAuthServerProvider, undefined, flow));
  // A minimal browser document exercises the real session API after the return landing page.
  app.get('/admin/oauth', (_req, res) =>
    res
      .type('html')
      .send(
        '<script>fetch("/admin/api/session").then(r=>r.json()).then(s=>document.body.textContent=s.authenticated?"authenticated":"login required")</script>',
      ),
  );
  app.use(
    '/admin',
    createAdminRoutes({
      adminEnabled: true,
      adminService: admin,
      oauthService: new AdminOAuthService({
        operationService: new AdminOperationService({ runtimeScopeId: 'return-test', storageDir }),
        oauthFlow: flow,
      }),
      getRuntimeIdentity: () => ({
        identityProtocolVersion: '1',
        runtimeScopeId: 'return-test',
        externalUrl: callbackOrigin,
        runtimeVersion: 'test',
      }),
    })!,
  );
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    for (const host of ['localhost', '127.0.0.1']) {
      for (const { cancel, expired } of [
        { cancel: false, expired: false },
        { cancel: true, expired: false },
        { cancel: false, expired: true },
      ]) {
        nowMs = Date.now();
        const context = await browser.newContext();
        await context.route(`${providerOrigin}/provider?*`, async (route) => {
          const request = new URL(route.request().url());
          const callback = new URL(request.searchParams.get('redirect_uri')!);
          callback.searchParams.set('state', request.searchParams.get('state')!);
          const cancelled = request.searchParams.has('cancel');
          callback.searchParams.set(cancelled ? 'error' : 'code', cancelled ? 'access_denied' : 'fixture-code');
          await route.fulfill({
            contentType: 'text/html',
            body: `<a href="${callback.toString().replaceAll('&', '&amp;')}">Return from provider</a>`,
          });
        });
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        page.setDefaultNavigationTimeout(5000);

        const origin = `http://${host}:${address.port}`;
        const chain: string[] = [];
        page.on('framenavigated', (frame) => {
          if (frame === page.mainFrame()) chain.push(frame.url());
        });
        await page.goto(`${origin}/admin/oauth`);
        await page.evaluate(async () => {
          const response = await fetch('/admin/api/session/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'operator', password: 'correct horse battery staple' }),
          });
          if (!response.ok) throw new Error('Login failed');
        });
        const cookies = await context.cookies();
        expect(cookies.some((cookie) => cookie.sameSite === 'Strict' && cookie.path === '/admin')).toBe(true);
        const redirectUrl = await page.evaluate(async () => {
          const session = await (await fetch('/admin/api/session')).json();
          const response = await fetch('/admin/api/oauth/github/authorize', {
            method: 'POST',
            headers: { 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': crypto.randomUUID() },
          });
          const result = await response.json();
          if (!response.ok) throw new Error(JSON.stringify(result));
          return result.result.redirectUrl as string;
        });
        const url = new URL(redirectUrl);
        if (cancel) url.searchParams.set('cancel', '1');
        await page.goto(url.toString());
        if (expired) nowMs += 60_001;
        await page.getByRole('link', { name: 'Return from provider' }).click();
        await page.waitForURL(`${origin}/admin/oauth?${cancel ? 'error=access_denied' : 'success=1'}`);
        await page.getByText(expired ? 'login required' : 'authenticated', { exact: true }).waitFor();
        expect(chain.some((url) => url.startsWith(`${origin}/oauth/return?`))).toBe(true);
        expect(page.url()).not.toContain('fixture-code');
        await context.close();
      }
    }
    expect(completeOAuthAndReconnect).toHaveBeenCalledTimes(4);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    rmSync(storageDir, { recursive: true, force: true });
  }
}, 30_000);
