import { ADMIN_SESSION_COOKIE_NAME, type AdminIdentityService } from '@src/domains/admin/adminIdentityService.js';

import { type RequestHandler, Router } from 'express';
import { z } from 'zod';

const consentCsrfSchema = z.object({ csrf_token: z.string().min(1) });
const authorizationFormSchema = z.record(z.string(), z.string());

/** Human approval uses the existing Admin Session, whose cookie stays scoped to /admin. */
export function createOperatorConsentGuard(admin: AdminIdentityService, enabled: boolean): RequestHandler {
  return (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!enabled || !admin.hasAdminAccount()) {
      res.status(403).json({ error: 'admin_setup_required' });
      return;
    }
    const cookie = req.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${ADMIN_SESSION_COOKIE_NAME}=`));
    const token = cookie?.slice(ADMIN_SESSION_COOKIE_NAME.length + 1);
    const session = admin.validateSession(token);
    if (!session) {
      res
        .status(401)
        .type('html')
        .send(
          '<!doctype html><title>Sign in to approve access</title><h1>Sign in to approve access</h1>' +
            '<p><a href="/admin" target="_blank" rel="noopener noreferrer">Sign in to 1MCP</a>, then reload this page to review the request.</p>',
        );
      return;
    }
    if (req.method === 'POST') {
      const body = consentCsrfSchema.safeParse(req.body);
      if (!body.success) {
        res.status(403).json({ error: 'csrf_required' });
        return;
      }
      if (!admin.validateCsrf(token, body.data.csrf_token)) {
        res.status(403).json({ error: 'csrf_required' });
        return;
      }
    }
    res.locals.oauthConsentCsrfToken = session.csrfToken;
    next();
  };
}

export function createOperatorConsentRoutes(
  authRouter: RequestHandler,
  oauthRouter: Router,
  guard: RequestHandler,
): Router {
  const router = Router();
  router.get('/authorize', (req, res) => {
    const queryStart = req.originalUrl.indexOf('?');
    const query = queryStart < 0 ? '' : req.originalUrl.slice(queryStart);
    res.set('Cache-Control', 'no-store');
    res.redirect(303, `/admin/oauth/authorize${query}`);
  });
  router.post('/authorize', (req, res) => {
    const form = authorizationFormSchema.safeParse(req.body);
    if (!form.success) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    const params = new URLSearchParams(form.data);
    res.set('Cache-Control', 'no-store');
    res.redirect(303, `/admin/oauth/authorize?${params}`);
  });
  const operator = Router();
  operator.get('/authorize', guard, authRouter);
  operator.post('/consent', guard, oauthRouter);
  router.use('/admin/oauth', operator);
  return router;
}
