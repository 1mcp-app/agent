import type { BackendOAuthDashboardResult } from '@src/auth/oauthAuthorizationFlow.js';
import { RuntimeIdentity } from '@src/core/runtime/runtimeIdentityService.js';
import type { AdminConfiguredServerOperations } from '@src/domains/admin/adminConfiguredServerService.js';
import {
  ADMIN_SESSION_COOKIE_NAME,
  AdminAccount,
  AdminIdentityError,
  AdminIdentityService,
} from '@src/domains/admin/adminIdentityService.js';
import type { AdminOperationContext, AdminOperationResult } from '@src/domains/admin/adminOperationService.js';
import { sanitizeErrorMessage } from '@src/utils/validation/sanitization.js';

import { Request, Response, Router } from 'express';

import { renderAdminConsoleHtml } from './adminConsoleHtml.js';

const FAILED_LOGIN_LIMIT = 5;
const FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1000;

interface AdminRoutesOptions {
  adminEnabled: boolean;
  adminService: AdminIdentityService;
  configuredServerService?: AdminConfiguredServerOperations;
  getRuntimeIdentity: () => RuntimeIdentity;
  getOAuthDashboard?: () => BackendOAuthDashboardResult;
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
    res
      .status(200)
      .type('html')
      .send(
        renderAdminConsoleHtml({
          status: options.adminService.hasAdminAccount() ? 'loginRequired' : 'setupRequired',
        }),
      );
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

  router.get('/api/status', (req, res) => {
    const session = options.adminService.validateSession(getAdminSessionCookie(req));
    if (!session) {
      res.status(401).json({ authenticated: false });
      return;
    }

    res.status(200).json({
      ok: true,
      runtime: options.getRuntimeIdentity(),
      session: {
        authenticated: true,
        account: toAdminConsoleAccount(session.account),
        expiresAt: session.expiresAt,
      },
      oauth: sanitizeOAuthDashboard(options.getOAuthDashboard?.() ?? { status: 'ready', services: [] }),
      audit: {
        facts: options.configuredServerService?.getRecentAuditFacts({ limit: 10 }) ?? [],
      },
    });
  });

  router.get('/api/configured-servers', async (req, res) => {
    if (!options.configuredServerService) {
      res.status(404).json({ error: 'admin_configured_servers_unavailable' });
      return;
    }

    const result = await options.configuredServerService.listConfiguredServers({
      context: buildAdminOperationContext(req, options, { type: 'configured_server_collection' }),
    });
    if (!result.ok) {
      sendAdminOperationResult(res, result);
      return;
    }

    res.status(200).json({
      ok: true,
      operationId: result.operationId,
      servers: result.result.servers,
    });
  });

  router.post('/api/configured-servers/:name/enable', async (req, res) => {
    await handleConfiguredServerMutation(req, res, options, 'enableConfiguredServer');
  });

  router.post('/api/configured-servers/:name/disable', async (req, res) => {
    await handleConfiguredServerMutation(req, res, options, 'disableConfiguredServer');
  });

  return router;
}

async function handleConfiguredServerMutation(
  req: Request,
  res: Response,
  options: AdminRoutesOptions,
  operationName: 'enableConfiguredServer' | 'disableConfiguredServer',
): Promise<void> {
  if (!options.configuredServerService) {
    res.status(404).json({ error: 'admin_configured_servers_unavailable' });
    return;
  }

  const targetName = req.params.name;
  const context = buildAdminOperationContext(req, options, { type: 'configured_server', id: targetName });
  const input = { context, targetName };
  const result =
    operationName === 'enableConfiguredServer'
      ? await options.configuredServerService.enableConfiguredServer(input)
      : await options.configuredServerService.disableConfiguredServer(input);

  sendAdminOperationResult(res, result);
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

function sendAdminOperationResult<T>(res: Response, result: AdminOperationResult<T>): void {
  if (result.ok) {
    res.status(200).json({
      ok: true,
      operationId: result.operationId,
      replayed: result.replayed,
      result: result.result,
    });
    return;
  }

  const status = result.status === 'idempotency_key_required' ? 400 : result.status === 'mutation_failed' ? 409 : 409;
  res.status(status).json(result);
}

function buildAdminOperationContext(
  req: Request,
  options: AdminRoutesOptions,
  target: AdminOperationContext['target'],
): AdminOperationContext {
  const sessionToken = getAdminSessionCookie(req);
  const session = options.adminService.validateSession(sessionToken);
  if (!session) {
    throw new Error('Admin operation context requested without a valid session');
  }

  const runtimeIdentity = options.getRuntimeIdentity();
  const operationName = operationNameForRequest(req);
  return {
    actor: {
      type: 'admin_session',
      accountId: session.account.id,
      sessionId: sessionToken,
    },
    origin: 'browser',
    target,
    runtimeIdentity: {
      runtimeScopeId: runtimeIdentity.runtimeScopeId,
      runtimeVersion: runtimeIdentity.runtimeVersion,
    },
    request: {
      requestId: getRequestId(req),
      jsonMode: true,
    },
    idempotencyKey: req.header('Idempotency-Key'),
    requestFingerprint: `${operationName}:${req.method}:${req.originalUrl}:${JSON.stringify(req.body ?? {})}`,
  };
}

function operationNameForRequest(req: Request): string {
  if (req.path.endsWith('/enable')) {
    return 'enableConfiguredServer';
  }
  if (req.path.endsWith('/disable')) {
    return 'disableConfiguredServer';
  }
  return 'listConfiguredServers';
}

function getRequestId(req: Request): string {
  const requestId = req.header('X-Request-Id');
  return requestId?.trim() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function toAdminConsoleAccount(account: AdminAccount): Pick<AdminAccount, 'id' | 'username' | 'role'> {
  return {
    id: account.id,
    username: account.username,
    role: account.role,
  };
}

function sanitizeOAuthDashboard(dashboard: BackendOAuthDashboardResult): BackendOAuthDashboardResult {
  if (dashboard.status !== 'ready') {
    return dashboard;
  }

  return {
    ...dashboard,
    services: dashboard.services.map((service) => ({
      ...service,
      lastError: service.lastError ? sanitizeErrorMessage(service.lastError) : undefined,
    })),
  };
}

function getBodyString(body: unknown, key: string): string {
  if (!body || typeof body !== 'object') {
    return '';
  }

  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}
