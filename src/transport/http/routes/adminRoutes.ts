import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BackendOAuthDashboardResult } from '@src/auth/oauthAuthorizationFlow.js';
import { RuntimeIdentity } from '@src/core/runtime/runtimeIdentityService.js';
import type { AdminConfiguredServerOperations } from '@src/domains/admin/adminConfiguredServerService.js';
import {
  ADMIN_SESSION_COOKIE_NAME,
  AdminAccount,
  AdminIdentityError,
  AdminIdentityService,
} from '@src/domains/admin/adminIdentityService.js';
import type {
  AdminConfirmationRequirement,
  AdminOperationContext,
  AdminOperationResult,
} from '@src/domains/admin/adminOperationService.js';
import type { AdminMutationAvailability } from '@src/domains/admin/runtimeScopeAdminLock.js';
import { sanitizeErrorMessage } from '@src/utils/validation/sanitization.js';

import express, { Request, Response, Router } from 'express';

const FAILED_LOGIN_LIMIT = 5;
const FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const CLI_ADMIN_PROTOCOL_VERSION = '1';
const CLI_ADMIN_RESPONSE_MAX_BYTES = 256 * 1024;
const CLI_ADMIN_RESPONSE_TOO_LARGE_MESSAGE =
  'CLI Admin response exceeded the maximum supported size; use a narrower or paginated request.';
const CLI_SESSION_OPERATIONS = ['admin.login', 'admin.status', 'admin.logout'] as const;
const CLI_MCP_OPERATIONS = ['mcp.enable', 'mcp.disable'] as const;
type AdminOperationFailure = Extract<AdminOperationResult, { ok: false }>;
interface CliAdminEnvelope {
  ok: boolean;
  cliProtocolVersion: typeof CLI_ADMIN_PROTOCOL_VERSION;
  requestId: string;
  warnings: unknown[];
  [key: string]: unknown;
}

interface AdminRoutesOptions {
  adminEnabled: boolean;
  adminService: AdminIdentityService;
  configuredServerService?: AdminConfiguredServerOperations;
  adminMutationAvailability?: AdminMutationAvailability;
  getRuntimeIdentity: () => RuntimeIdentity;
  getOAuthDashboard?: () => BackendOAuthDashboardResult;
  adminConsoleAssetsDir?: string;
}

export function createAdminRoutes(options: AdminRoutesOptions): Router | null {
  if (!options.adminEnabled) {
    options.adminService.revokeAllSessions();
    return null;
  }

  const router = Router();
  const failedLoginLimiter = new FailedLoginLimiter();
  const adminConsoleAssets = resolveAdminConsoleAssets(options.adminConsoleAssetsDir);
  options.adminService.bootstrapFirstAdminFromEnvironment();

  router.get('/cli/v1/capabilities', (req, res) => {
    const identity = options.getRuntimeIdentity();
    const setupRequired = !options.adminService.hasAdminAccount();
    const mutationAvailability = cliMutationAvailability(options, setupRequired);
    const configuredServerOperationsSupported = Boolean(options.configuredServerService);
    const mcpMutationsReady = configuredServerOperationsSupported && mutationAvailability.available;
    const mcpOperations = configuredServerOperationsSupported ? [...CLI_MCP_OPERATIONS] : [];
    const mcpMutationOperations = mcpMutationsReady ? ['enable', 'disable'] : [];
    const mcpReadinessStatus = cliMcpReadinessStatus(mutationAvailability);

    sendCliSuccess(req, res, {
      runtime: toCliRuntimeIdentity(identity),
      supportedOperations: [...CLI_SESSION_OPERATIONS, ...mcpOperations],
      adminSurface: {
        enabled: true,
        status: setupRequired ? 'setupRequired' : 'loginRequired',
      },
      mutationReadiness: {
        mcp: {
          enabled: mcpMutationsReady,
          status: mcpReadinessStatus,
          operations: mcpMutationOperations,
        },
      },
      adminMutationsAvailable: mutationAvailability.available,
      ...(mutationAvailability.reason ? { adminMutationsUnavailableReason: mutationAvailability.reason } : {}),
      features: {
        adminSessions: true,
        bearerSessionAuth: true,
        csrfTokens: true,
        mcpEnableDisable: mcpMutationsReady,
      },
    });
  });

  router.post('/cli/v1/session/login', async (req, res) => {
    const username = getBodyString(req.body, 'username');
    const source = getLoginSource(req);
    if (failedLoginLimiter.isLimited(username, source)) {
      sendCliError(req, res, {
        status: 429,
        code: 'admin_login_rate_limited',
        message: 'Too many failed admin login attempts',
        retryable: true,
      });
      return;
    }

    try {
      const login = await options.adminService.login({
        username,
        password: getBodyString(req.body, 'password'),
      });

      failedLoginLimiter.reset(username, source);
      sendCliSuccess(req, res, {
        sessionToken: login.sessionToken,
        csrfToken: login.csrfToken,
        expiresAt: login.expiresAt,
        account: toCliAdminAccount(login.account),
      });
    } catch (error) {
      failedLoginLimiter.recordFailure(username, source);
      sendCliAdminError(req, res, error);
    }
  });

  router.get('/cli/v1/session/status', (req, res) => {
    const sessionToken = getBearerSessionToken(req);
    const session = options.adminService.validateSession(sessionToken);
    const runtime = toCliRuntimeIdentity(options.getRuntimeIdentity());
    if (!session) {
      sendCliSuccess(req, res, {
        authenticated: false,
        runtime,
      });
      return;
    }

    sendCliSuccess(req, res, {
      authenticated: true,
      runtime,
      account: toCliAdminAccount(session.account),
      expiresAt: session.expiresAt,
    });
  });

  router.post('/cli/v1/session/logout', (req, res) => {
    const sessionToken = getBearerSessionToken(req);
    const session = options.adminService.validateSession(sessionToken);
    options.adminService.revokeSession(sessionToken);

    sendCliSuccess(req, res, {
      revoked: Boolean(session),
    });
  });

  router.post('/cli/v1/operations/enable-server', async (req, res) => {
    await handleCliConfiguredServerMutation(req, res, options, 'enableConfiguredServer');
  });

  router.post('/cli/v1/operations/disable-server', async (req, res) => {
    await handleCliConfiguredServerMutation(req, res, options, 'disableConfiguredServer');
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
      res.status(401).json(unauthenticatedAdminApiResponse(options));
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

  router.use(
    '/assets',
    express.static(path.join(adminConsoleAssets.rootDir, 'assets'), {
      immutable: true,
      maxAge: '1y',
    }),
  );

  router.use('/assets', (_req, res) => {
    res.status(404).type('text/plain').send('Admin Console asset not found');
  });

  router.get(['/', '/*splat'], (req, res, next) => {
    if (isAdminApiPath(req.path)) {
      next();
      return;
    }

    sendAdminConsoleIndex(res, adminConsoleAssets.indexPath);
  });

  return router;
}

function resolveAdminConsoleAssets(configuredDir?: string): { rootDir: string; indexPath: string } {
  const rootDir = configuredDir ?? resolveDefaultAdminConsoleAssetsDir();
  return {
    rootDir,
    indexPath: path.join(rootDir, 'index.html'),
  };
}

export function resolveDefaultAdminConsoleAssetsDir(): string {
  return fileURLToPath(new URL('../../../admin', import.meta.url));
}

function isAdminApiPath(pathname: string): boolean {
  return (
    pathname === '/api' || pathname.startsWith('/api/') || pathname === '/cli/v1' || pathname.startsWith('/cli/v1/')
  );
}

function sendAdminConsoleIndex(res: Response, indexPath: string): void {
  if (!fs.existsSync(indexPath)) {
    res.status(503).type('text/plain').send('Admin Console assets are not available. Run the package build first.');
    return;
  }

  res.status(200).sendFile(indexPath);
}

function unauthenticatedAdminApiResponse(options: AdminRoutesOptions): {
  authenticated: false;
  adminStatus?: 'setupRequired';
} {
  return options.adminService.hasAdminAccount()
    ? { authenticated: false }
    : { authenticated: false, adminStatus: 'setupRequired' };
}

async function handleCliConfiguredServerMutation(
  req: Request,
  res: Response,
  options: AdminRoutesOptions,
  operationName: 'enableConfiguredServer' | 'disableConfiguredServer',
): Promise<void> {
  if (!options.configuredServerService) {
    sendCliError(req, res, {
      status: 404,
      code: 'admin_configured_servers_unavailable',
      message: 'Configured server administration is unavailable',
      retryable: false,
    });
    return;
  }

  if (isMutationLocked(options)) {
    sendCliError(req, res, {
      status: 409,
      code: 'runtime_scope_locked',
      message: 'Runtime scope admin mutations are locked by another writer',
      retryable: true,
      details: {
        operationName,
        reason: 'writer_lock_unavailable',
      },
    });
    return;
  }

  const sessionToken = getBearerSessionToken(req);
  if (!sessionToken) {
    sendCliError(req, res, {
      status: 401,
      code: 'admin_session_required',
      message: 'A valid admin session bearer token is required',
      retryable: false,
    });
    return;
  }

  const session = options.adminService.validateSession(sessionToken);
  if (!session) {
    sendCliError(req, res, {
      status: 401,
      code: 'admin_session_required',
      message: 'A valid admin session bearer token is required',
      retryable: false,
    });
    return;
  }

  const targetName = getBodyString(req.body, 'targetName');
  if (!targetName) {
    sendCliError(req, res, {
      status: 400,
      code: 'validation_target_required',
      message: 'Configured server targetName is required',
      retryable: false,
    });
    return;
  }
  const dryRun = getBodyBoolean(req.body, 'dryRun');
  const context = buildCliAdminOperationContext(req, options, session.account, sessionToken, {
    type: 'configured_server',
    id: targetName,
  });
  const input = {
    context,
    targetName,
    ...(dryRun ? { dryRun: true } : {}),
    confirmationRequirements: dryRun
      ? []
      : cliConfiguredServerConfirmationRequirements(options, targetName, operationName),
  };
  const result =
    operationName === 'enableConfiguredServer'
      ? await options.configuredServerService.enableConfiguredServer(input)
      : await options.configuredServerService.disableConfiguredServer(input);

  sendCliAdminOperationResult(req, res, result);
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

  if (isMutationLocked(options)) {
    sendAdminOperationResult(res, {
      ok: false,
      status: 'runtime_scope_locked',
      code: 'runtime_scope_locked',
      retryable: true,
      operationName,
      reason: 'writer_lock_unavailable',
    });
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

function cliMutationAvailability(options: AdminRoutesOptions, setupRequired: boolean): AdminMutationAvailability {
  if (!options.configuredServerService) {
    return {
      available: false,
      reason: 'mutation_service_unavailable',
    };
  }

  if (setupRequired) {
    return {
      available: false,
      reason: 'setup_required',
    };
  }

  return options.adminMutationAvailability ?? { available: true };
}

function isMutationLocked(options: AdminRoutesOptions): boolean {
  return (
    options.adminMutationAvailability?.available === false &&
    options.adminMutationAvailability.reason === 'writer_lock_unavailable'
  );
}

function cliMcpReadinessStatus(mutationAvailability: AdminMutationAvailability): string {
  if (mutationAvailability.available) {
    return 'ready';
  }
  return mutationAvailability.reason === 'mutation_service_unavailable'
    ? 'unavailable'
    : (mutationAvailability.reason ?? 'unavailable');
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

function getBearerSessionToken(req: Request): string | undefined {
  const authorization = req.header('authorization')?.trim();
  if (!authorization) {
    return undefined;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token || undefined;
}

function isHttpsRuntime(externalUrl: string): boolean {
  try {
    return new URL(externalUrl).protocol === 'https:';
  } catch {
    return false;
  }
}

function sendCliSuccess<T>(req: Request, res: Response, result: T): void {
  const requestId = getRequestId(req);
  sendBoundedCliEnvelope(res, 200, {
    ok: true,
    cliProtocolVersion: CLI_ADMIN_PROTOCOL_VERSION,
    requestId,
    warnings: [],
    result,
  });
}

function sendCliAdminError(req: Request, res: Response, error: unknown): void {
  if (error instanceof AdminIdentityError) {
    const status = error.code === 'invalid_credentials' ? 401 : error.code === 'admin_account_not_found' ? 404 : 400;
    sendCliError(req, res, {
      status,
      code: error.code,
      message: error.message,
      retryable: false,
    });
    return;
  }

  sendCliError(req, res, {
    status: 500,
    code: 'admin_cli_request_failed',
    message: 'Admin CLI request failed',
    retryable: false,
  });
}

function sendCliError(
  req: Request,
  res: Response,
  error: {
    status: number;
    code: string;
    message: string;
    retryable: boolean;
    retryAfterMs?: number;
    recoveryCommand?: string;
    details?: unknown;
  },
): void {
  const requestId = getRequestId(req);
  sendBoundedCliEnvelope(res, error.status, {
    ok: false,
    cliProtocolVersion: CLI_ADMIN_PROTOCOL_VERSION,
    requestId,
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      requestId,
      ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
      ...(error.recoveryCommand ? { recoveryCommand: error.recoveryCommand } : {}),
      ...(error.details === undefined ? {} : { details: error.details }),
    },
    warnings: [],
  });
}

function sendBoundedCliEnvelope(res: Response, status: number, envelope: CliAdminEnvelope): void {
  if (Buffer.byteLength(JSON.stringify(envelope), 'utf8') > CLI_ADMIN_RESPONSE_MAX_BYTES) {
    res.status(422).json({
      ok: false,
      cliProtocolVersion: CLI_ADMIN_PROTOCOL_VERSION,
      requestId: envelope.requestId,
      error: {
        code: 'validation_response_too_large',
        message: CLI_ADMIN_RESPONSE_TOO_LARGE_MESSAGE,
        retryable: false,
        requestId: envelope.requestId,
        details: {
          maxBytes: CLI_ADMIN_RESPONSE_MAX_BYTES,
        },
      },
      warnings: [],
    });
    return;
  }

  res.status(status).json(envelope);
}

function sendCliAdminOperationResult<T>(req: Request, res: Response, result: AdminOperationResult<T>): void {
  if (result.ok) {
    sendCliSuccess(req, res, {
      operationId: result.operationId,
      operationName: result.operationName,
      replayed: result.replayed,
      ...(typeof result.result === 'object' && result.result !== null ? result.result : { value: result.result }),
    });
    return;
  }

  sendCliError(req, res, {
    status: cliOperationErrorStatus(result.status),
    code: result.code,
    message: cliOperationErrorMessage(result.status),
    retryable: result.retryable,
    retryAfterMs: result.status === 'operation_in_progress' ? result.retryAfterMs : undefined,
    details: cliOperationErrorDetails(result),
  });
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
    requestFingerprint: configuredServerRequestFingerprint(operationName, target.id),
    confirmationFacts: getBodyRecord(req.body, 'confirmationFacts'),
  };
}

function cliConfiguredServerConfirmationRequirements(
  options: AdminRoutesOptions,
  targetName: string,
  operationName: 'enableConfiguredServer' | 'disableConfiguredServer',
): AdminConfirmationRequirement[] {
  const identity = options.getRuntimeIdentity();
  if (isLoopbackRuntimeUrl(identity.externalUrl)) {
    return [];
  }

  return [
    {
      code: 'confirm_non_loopback_runtime',
      expected: true,
      target: {
        type: 'configured_server',
        id: targetName,
      },
    },
    {
      code: 'confirmedOperation',
      expected: operationName === 'enableConfiguredServer' ? 'mcp.enable' : 'mcp.disable',
      target: {
        type: 'configured_server',
        id: targetName,
      },
    },
    {
      code: 'confirmedRuntimeScopeId',
      expected: identity.runtimeScopeId,
      target: {
        type: 'configured_server',
        id: targetName,
      },
    },
    {
      code: 'confirmationSource',
      expected: 'cli_flag',
      target: {
        type: 'configured_server',
        id: targetName,
      },
    },
  ];
}

function buildCliAdminOperationContext(
  req: Request,
  options: AdminRoutesOptions,
  account: AdminAccount,
  sessionToken: string,
  target: AdminOperationContext['target'],
): AdminOperationContext {
  const runtimeIdentity = options.getRuntimeIdentity();
  const operationName = operationNameForRequest(req);
  return {
    actor: {
      type: 'admin_session',
      accountId: account.id,
      sessionId: sessionToken,
    },
    origin: 'cli',
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
    requestFingerprint: configuredServerRequestFingerprint(operationName, target.id),
    confirmationFacts: getBodyRecord(req.body, 'confirmationFacts'),
  };
}

function configuredServerRequestFingerprint(operationName: string, targetName: string | undefined): string {
  return stableJsonStringify({
    schemaVersion: 1,
    operationName,
    target: {
      type: 'configured_server',
      id: targetName ?? '',
    },
  });
}

function stableJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJsonStringify(entryValue)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function cliOperationErrorStatus(status: AdminOperationFailure['status']): number {
  switch (status) {
    case 'idempotency_key_required':
      return 400;
    case 'admin_operation_journal_unavailable':
      return 503;
    default:
      return 409;
  }
}

function cliOperationErrorMessage(status: AdminOperationFailure['status']): string {
  switch (status) {
    case 'idempotency_key_required':
      return 'Idempotency key is required';
    case 'idempotency_conflict':
      return 'Idempotency key conflicts with another request';
    case 'operation_in_progress':
      return 'Admin operation is still in progress';
    case 'operation_state_unknown':
      return 'Admin operation state is unknown';
    case 'mutation_confirmation_required':
      return 'Additional mutation confirmation is required';
    case 'mutation_failed':
      return 'Configured server mutation failed';
    case 'admin_operation_journal_unavailable':
      return 'Admin operation journal is unavailable';
    case 'runtime_scope_mismatch':
      return 'Runtime scope mismatch';
    case 'runtime_scope_locked':
      return 'Runtime scope admin mutations are locked by another writer';
    default:
      return 'Admin operation failed';
  }
}

function cliOperationErrorDetails(result: AdminOperationFailure): Record<string, unknown> {
  const details: Record<string, unknown> = {
    operationName: result.operationName,
  };

  if (result.status === 'operation_state_unknown') {
    details.target = result.target;
    details.reservedAt = result.reservedAt;
    details.recovery = result.recovery;
  }
  if (result.status === 'runtime_scope_locked') {
    details.reason = result.reason;
  }
  if (result.status === 'mutation_confirmation_required') {
    details.confirmationRequirements = result.confirmationRequirements;
  }
  if (result.status === 'mutation_failed') {
    details.error = result.error;
  }

  return details;
}

function operationNameForRequest(req: Request): string {
  if (req.path.endsWith('/enable') || req.path.endsWith('/enable-server')) {
    return 'enableConfiguredServer';
  }
  if (req.path.endsWith('/disable') || req.path.endsWith('/disable-server')) {
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

function toCliAdminAccount(account: AdminAccount): Pick<AdminAccount, 'username' | 'role'> {
  return {
    username: account.username,
    role: account.role,
  };
}

function toCliRuntimeIdentity(
  identity: RuntimeIdentity,
): Pick<RuntimeIdentity, 'identityProtocolVersion' | 'runtimeScopeId' | 'runtimeVersion'> {
  return {
    identityProtocolVersion: identity.identityProtocolVersion,
    runtimeScopeId: identity.runtimeScopeId,
    runtimeVersion: identity.runtimeVersion,
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

function getBodyBoolean(body: unknown, key: string): boolean {
  if (!body || typeof body !== 'object') {
    return false;
  }

  return (body as Record<string, unknown>)[key] === true;
}

function getBodyRecord(body: unknown, key: string): Record<string, unknown> | undefined {
  if (!body || typeof body !== 'object') {
    return undefined;
  }

  const value = (body as Record<string, unknown>)[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : undefined;
}

function isLoopbackRuntimeUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
  } catch {
    return false;
  }
}
