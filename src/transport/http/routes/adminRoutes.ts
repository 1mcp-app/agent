import { RuntimeIdentity } from '@src/core/runtime/runtimeIdentityService.js';
import {
  ADMIN_SESSION_COOKIE_NAME,
  AdminIdentityError,
  AdminIdentityService,
} from '@src/domains/admin/adminIdentityService.js';

import { Request, Response, Router } from 'express';

const FAILED_LOGIN_LIMIT = 5;
const FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1000;

interface AdminRoutesOptions {
  adminEnabled: boolean;
  adminService: AdminIdentityService;
  getRuntimeIdentity: () => RuntimeIdentity;
}

export function createAdminRoutes(options: AdminRoutesOptions): Router | null {
  if (!options.adminEnabled) {
    options.adminService.revokeAllSessions();
    return null;
  }

  const router = Router();
  const failedLoginLimiter = new FailedLoginLimiter();
  options.adminService.bootstrapFirstAdminFromEnvironment();

  router.get('/', (_req, res) => {
    res.status(200).json({
      status: options.adminService.hasAdminAccount() ? 'loginRequired' : 'setupRequired',
      adminSurface: 'enabled',
    });
  });

  router.get('/cli/v1/capabilities', (_req, res) => {
    const identity = options.getRuntimeIdentity();
    const setupRequired = !options.adminService.hasAdminAccount();

    res.status(200).json({
      cliProtocolVersion: '1',
      runtimeScopeId: identity.runtimeScopeId,
      externalUrl: identity.externalUrl,
      runtimeVersion: identity.runtimeVersion,
      adminSurface: 'enabled',
      adminStatus: setupRequired ? 'setupRequired' : 'loginRequired',
      supportedOperations: [],
      featureFlags: {
        adminSetupRequired: setupRequired,
      },
    });
  });

  router.post('/api/session/login', async (req, res) => {
    const username = getBodyString(req.body, 'username');
    const source = getLoginSource(req);
    if (failedLoginLimiter.isLimited(username, source)) {
      res.status(429).json({ error: 'admin_login_rate_limited' });
      return;
    }

    try {
      const login = await options.adminService.login({
        username,
        password: getBodyString(req.body, 'password'),
      });

      failedLoginLimiter.reset(username, source);
      setAdminSessionCookie(res, options.getRuntimeIdentity().externalUrl, login.sessionToken, login.expiresAt);
      res.status(200).json({
        authenticated: true,
        account: login.account,
        csrfToken: login.csrfToken,
        expiresAt: login.expiresAt,
      });
    } catch (error) {
      failedLoginLimiter.recordFailure(username, source);
      sendAdminError(res, error);
    }
  });

  router.use('/api', (req, res, next) => {
    const sessionToken = getAdminSessionCookie(req);
    const session = options.adminService.validateSession(sessionToken);
    if (!session) {
      res.status(401).json({ authenticated: false });
      return;
    }

    if (isUnsafeMethod(req.method) && !options.adminService.validateCsrf(sessionToken, req.header('X-CSRF-Token'))) {
      res.status(403).json({ error: 'csrf_required' });
      return;
    }

    next();
  });

  router.get('/api/session', (req, res) => {
    const session = options.adminService.validateSession(getAdminSessionCookie(req));
    if (!session) {
      res.status(401).json({ authenticated: false });
      return;
    }

    res.status(200).json({
      authenticated: true,
      account: session.account,
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    });
  });

  router.post('/api/session/logout', (req, res) => {
    options.adminService.revokeSession(getAdminSessionCookie(req));
    clearAdminSessionCookie(res, options.getRuntimeIdentity().externalUrl);
    res.status(200).json({ ok: true });
  });

  router.post('/api/session/password', async (req, res) => {
    try {
      const sessionToken = getAdminSessionCookie(req);
      const session = options.adminService.validateSession(sessionToken);
      if (!session) {
        res.status(401).json({ authenticated: false });
        return;
      }

      await options.adminService.changePassword(session.account.id, getBodyString(req.body, 'password'));
      clearAdminSessionCookie(res, options.getRuntimeIdentity().externalUrl);
      res.status(200).json({ ok: true });
    } catch (error) {
      sendAdminError(res, error);
    }
  });

  return router;
}

class FailedLoginLimiter {
  private readonly attempts = new Map<string, { count: number; firstFailureAt: number }>();

  isLimited(username: string, origin: string): boolean {
    const attempt = this.getAttempt(username, origin);
    return attempt ? attempt.count >= FAILED_LOGIN_LIMIT : false;
  }

  recordFailure(username: string, origin: string): void {
    const key = this.key(username, origin);
    const now = Date.now();
    const attempt = this.getAttempt(username, origin);
    this.attempts.set(key, attempt ? { ...attempt, count: attempt.count + 1 } : { count: 1, firstFailureAt: now });
  }

  reset(username: string, origin: string): void {
    this.attempts.delete(this.key(username, origin));
  }

  private getAttempt(username: string, origin: string): { count: number; firstFailureAt: number } | null {
    const key = this.key(username, origin);
    const attempt = this.attempts.get(key);
    if (!attempt) {
      return null;
    }

    if (Date.now() - attempt.firstFailureAt > FAILED_LOGIN_WINDOW_MS) {
      this.attempts.delete(key);
      return null;
    }

    return attempt;
  }

  private key(username: string, origin: string): string {
    return `${username.trim() || '<missing>'}\0${origin}`;
  }
}

function isUnsafeMethod(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

function getLoginSource(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? req.header('origin') ?? 'unknown';
}

function setAdminSessionCookie(res: Response, externalUrl: string, sessionToken: string, expiresAt: string): void {
  res.cookie(ADMIN_SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isHttpsRuntime(externalUrl),
    path: '/admin',
    expires: new Date(expiresAt),
  });
}

function clearAdminSessionCookie(res: Response, externalUrl: string): void {
  res.clearCookie(ADMIN_SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isHttpsRuntime(externalUrl),
    path: '/admin',
  });
}

function getAdminSessionCookie(req: Request): string | undefined {
  const cookieHeader = req.header('cookie');
  if (!cookieHeader) {
    return undefined;
  }

  for (const cookie of cookieHeader.split(';')) {
    const [name, ...valueParts] = cookie.trim().split('=');
    if (name === ADMIN_SESSION_COOKIE_NAME) {
      return valueParts.join('=');
    }
  }

  return undefined;
}

function isHttpsRuntime(externalUrl: string): boolean {
  try {
    return new URL(externalUrl).protocol === 'https:';
  } catch {
    return false;
  }
}

function sendAdminError(res: Response, error: unknown): void {
  if (error instanceof AdminIdentityError) {
    const status = error.code === 'invalid_credentials' ? 401 : error.code === 'admin_account_not_found' ? 404 : 400;
    res.status(status).json({ error: error.code });
    return;
  }

  throw error;
}

function getBodyString(body: unknown, key: string): string {
  if (!body || typeof body !== 'object') {
    return '';
  }

  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}
