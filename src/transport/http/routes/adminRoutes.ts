import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BackendOAuthDashboardResult } from '@src/auth/oauthAuthorizationFlow.js';
import { MCP_PROJECT_METADATA } from '@src/constants.js';
import { RuntimeIdentity } from '@src/core/runtime/runtimeIdentityService.js';
import { parseTemplateConnectionKey } from '@src/core/server/templateIdentity.js';
import type {
  AdminBackendRestartOperations,
  BackendRestartOutcome,
  BackendRestartSelection,
  RuntimeBackendRestartResult,
} from '@src/domains/admin/adminBackendRestartService.js';
import {
  AdminConfiguredServerApplyError,
  AdminConfiguredServerNotFoundError,
  type AdminConfiguredServerOperations,
} from '@src/domains/admin/adminConfiguredServerService.js';
import {
  ADMIN_SESSION_COOKIE_NAME,
  AdminAccount,
  AdminIdentityError,
  AdminIdentityService,
} from '@src/domains/admin/adminIdentityService.js';
import {
  AdminInstructionTemplateNotFoundError,
  type AdminInstructionTemplateOperations,
} from '@src/domains/admin/adminInstructionTemplateService.js';
import type { AdminOAuthOperations } from '@src/domains/admin/adminOAuthService.js';
import type {
  AdminConfirmationRequirement,
  AdminOperationContext,
  AdminOperationResult,
} from '@src/domains/admin/adminOperationService.js';
import {
  AdminPresetConflictError,
  type AdminPresetDraft,
  AdminPresetNotFoundError,
  type AdminPresetOperations,
} from '@src/domains/admin/adminPresetService.js';
import type { AdminMutationAvailability } from '@src/domains/admin/runtimeScopeAdminLock.js';
import type { BackendLogBroker } from '@src/domains/backend-logs/backendLogBroker.js';
import type {
  BackendLogEntry,
  BackendLogSnapshot,
  BackendLogSource,
  BackendLogSourceUpdate,
} from '@src/domains/backend-logs/backendLogTypes.js';
import type { InstructionTemplateMutationResult } from '@src/domains/instruction-template/instructionTemplateManager.js';
import {
  createSensitiveOperationLimiter,
  DEFAULT_SENSITIVE_OPERATION_RATE_LIMIT_POLICY,
  type SensitiveOperationRateLimitPolicy,
} from '@src/transport/http/middlewares/securityMiddleware.js';
import { sanitizeErrorMessage } from '@src/utils/validation/sanitization.js';

import express, { Request, Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

const FAILED_LOGIN_LIMIT = 5;
const FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const FAILED_LOGIN_MAX_ACTIVE_KEYS = 10_000;
const ADMIN_AUTH_RATE_LIMIT = 30;
const ADMIN_AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_STATUS_RATE_LIMIT = 120;
const ADMIN_STATUS_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const ADMIN_USERNAME_MAX_LENGTH = 256;
const ADMIN_PASSWORD_MAX_LENGTH = 4096;
const CLI_ADMIN_PROTOCOL_VERSION = '1';
const CLI_ADMIN_RESPONSE_MAX_BYTES = 256 * 1024;
const CLI_ADMIN_RESPONSE_TOO_LARGE_MESSAGE =
  'CLI Admin response exceeded the maximum supported size; use a narrower or paginated request.';
const CLI_SESSION_OPERATIONS = ['admin.login', 'admin.status', 'admin.logout'] as const;
const ADMIN_API_PROTOCOL_VERSION = '1';
const TEMPLATE_INSTANCE_ID_DISPLAY_LENGTH = 12;
const CLI_CONFIGURED_SERVER_OPERATIONS = ['mcp.enable', 'mcp.disable'] as const;
const CLI_BACKEND_RESTART_OPERATION = 'mcp.restart' as const;
const SEA_ADMIN_CONSOLE_ASSETS_KEY = '__1MCP_SEA_ADMIN_CONSOLE_ASSETS__';
const adminLoginBodySchema = z.object({
  username: z.string().trim().min(1).max(ADMIN_USERNAME_MAX_LENGTH),
  password: z.string().min(1).max(ADMIN_PASSWORD_MAX_LENGTH),
});
const adminOAuthServiceParamsSchema = z.object({
  serviceId: z.string().trim().min(1).max(256),
});
const backendLogSnapshotQuerySchema = z.object({
  sourceId: z.string().trim().min(1).max(256).optional(),
});
const configuredServerModelSchema = z.string().trim().min(1).max(64);
const configuredToolInventoryRefreshSchema = z.object({ model: configuredServerModelSchema.optional() }).strict();
const cliConfiguredServerMutationBodySchema = z.object({
  targetName: z.string().trim().min(1).max(256),
  dryRun: z.boolean().optional(),
});
const cliBackendRestartBodySchema = z
  .object({
    targetName: z.string().trim().min(1).max(256),
    instance: z.string().trim().min(1).max(64).optional(),
    allInstances: z.boolean().optional(),
  })
  .refine((value) => !(value.instance !== undefined && value.allInstances === true), {
    message: 'instance and allInstances are mutually exclusive',
  });
const instructionTemplateIdentitySchema = z.string().trim().min(1).max(128);
const instructionTemplateVariantsSchema = z.object({ initialization: z.string(), cli: z.string() }).strict();
const instructionPreviewSelectionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }).strict(),
  z.object({ mode: z.literal('preset'), preset: z.string().trim().min(1).max(128) }).strict(),
  z.object({ mode: z.literal('tags'), tags: z.array(z.string().trim().min(1).max(128)).max(256) }).strict(),
  z.object({ mode: z.literal('tag-filter'), expression: z.string().trim().min(1).max(4096) }).strict(),
]);
const requestContextSchema = z
  .object({
    project: z
      .object({
        path: z.string().optional(),
        cwd: z.string().optional(),
        name: z.string().optional(),
        environment: z.string().optional(),
        custom: z.record(z.string(), z.unknown()).optional(),
        git: z
          .object({
            branch: z.string().optional(),
            commit: z.string().optional(),
            repository: z.string().optional(),
            isRepo: z.boolean().optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    user: z
      .object({
        name: z.string().optional(),
        email: z.string().optional(),
        home: z.string().optional(),
        username: z.string().optional(),
        uid: z.string().optional(),
        gid: z.string().optional(),
        shell: z.string().optional(),
      })
      .strict(),
    environment: z
      .object({
        variables: z.record(z.string(), z.string()).optional(),
        prefixes: z.array(z.string()).optional(),
      })
      .strict(),
    timestamp: z.string().optional(),
    sessionId: z.string().optional(),
    version: z.string().optional(),
    transport: z
      .object({
        type: z.string(),
        url: z.string().optional(),
        connectionId: z.string().optional(),
        connectionTimestamp: z.string().optional(),
        client: z.object({ name: z.string(), version: z.string(), title: z.string().optional() }).strict().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const configuredServerSourceSchema = z.enum(['mcpServers', 'mcpTemplates']);
const configuredServerDeleteApplySchema = z
  .object({
    previewFingerprint: z.string().trim().min(1).max(256),
    confirmationFacts: z
      .object({
        previewConfirmed: z.string().trim().min(1).max(256),
        targetIdentityConfirmed: z.string().trim().min(1).max(512),
      })
      .strict(),
  })
  .strict();
const configuredServerLifecyclePreviewSchema = z.object({ enabled: z.boolean() }).strict();
const configuredServerLifecycleApplySchema = configuredServerDeleteApplySchema.extend({ enabled: z.boolean() }).strict();
type AdminOperationFailure = Extract<AdminOperationResult, { ok: false }>;
interface CliAdminEnvelope {
  ok: boolean;
  cliProtocolVersion: typeof CLI_ADMIN_PROTOCOL_VERSION;
  requestId: string;
  warnings: unknown[];
  [key: string]: unknown;
}

export interface AdminRateLimitPolicy {
  login: {
    windowMs: number;
    maxRequests: number;
    maxFailedAttempts: number;
  };
  status: {
    windowMs: number;
    maxRequests: number;
  };
  sensitive: SensitiveOperationRateLimitPolicy;
}

export const DEFAULT_ADMIN_RATE_LIMIT_POLICY: AdminRateLimitPolicy = {
  login: {
    windowMs: ADMIN_AUTH_RATE_LIMIT_WINDOW_MS,
    maxRequests: ADMIN_AUTH_RATE_LIMIT,
    maxFailedAttempts: FAILED_LOGIN_LIMIT,
  },
  status: {
    windowMs: ADMIN_STATUS_RATE_LIMIT_WINDOW_MS,
    maxRequests: ADMIN_STATUS_RATE_LIMIT,
  },
  sensitive: { ...DEFAULT_SENSITIVE_OPERATION_RATE_LIMIT_POLICY },
};

interface AdminRoutesOptions {
  adminEnabled: boolean;
  adminService: AdminIdentityService;
  configuredServerService?: AdminConfiguredServerOperations;
  instructionTemplateService?: AdminInstructionTemplateOperations;
  backendRestartService?: AdminBackendRestartOperations;
  presetService?: AdminPresetOperations;
  oauthService?: AdminOAuthOperations;
  adminMutationAvailability?: AdminMutationAvailability;
  getRuntimeIdentity: () => RuntimeIdentity;
  getOAuthDashboard?: () => BackendOAuthDashboardResult;
  adminConsoleAssetsDir?: string;
  getBackendLogBroker?: () => BackendLogBroker;
  rateLimit?: AdminRateLimitPolicy;
}

export function createAdminRoutes(options: AdminRoutesOptions): Router | null {
  if (!options.adminEnabled) {
    options.adminService.revokeAllSessions();
    return null;
  }

  const router = Router();
  const rateLimitPolicy = options.rateLimit ?? DEFAULT_ADMIN_RATE_LIMIT_POLICY;
  const failedLoginLimiter = new FailedLoginLimiter(
    Date.now,
    FAILED_LOGIN_MAX_ACTIVE_KEYS,
    rateLimitPolicy.login.windowMs,
    rateLimitPolicy.login.maxFailedAttempts,
  );
  const authenticationLimiter = rateLimit({
    windowMs: rateLimitPolicy.login.windowMs,
    max: rateLimitPolicy.login.maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
  });
  const statusLimiter = rateLimit({
    windowMs: rateLimitPolicy.status.windowMs,
    max: rateLimitPolicy.status.maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
  });
  const sensitiveOperationLimiter = createSensitiveOperationLimiter(rateLimitPolicy.sensitive);
  const adminConsoleAssets = resolveAdminConsoleAssets(options.adminConsoleAssetsDir);
  options.adminService.bootstrapFirstAdminFromEnvironment();

  router.get('/cli/v1/capabilities', (req, res) => {
    const identity = options.getRuntimeIdentity();
    const setupRequired = !options.adminService.hasAdminAccount();
    const mutationAvailability = cliMutationAvailability(options, setupRequired);
    const configuredServerOperationsSupported = Boolean(options.configuredServerService);
    const backendRestartSupported = Boolean(options.backendRestartService);
    const mcpMutationsReady =
      (configuredServerOperationsSupported || backendRestartSupported) && mutationAvailability.available;
    const mcpOperations = [
      ...(configuredServerOperationsSupported ? [...CLI_CONFIGURED_SERVER_OPERATIONS] : []),
      ...(backendRestartSupported ? [CLI_BACKEND_RESTART_OPERATION] : []),
    ];
    const mcpMutationOperations = mutationAvailability.available
      ? [
          ...(configuredServerOperationsSupported ? ['enable', 'disable'] : []),
          ...(backendRestartSupported ? ['restart'] : []),
        ]
      : [];
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
        mcpEnableDisable: configuredServerOperationsSupported && mutationAvailability.available,
        mcpRestart: backendRestartSupported && mutationAvailability.available,
      },
    });
  });

  router.post('/cli/v1/session/login', authenticationLimiter, async (req, res) => {
    const parsedBody = adminLoginBodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      sendCliError(req, res, {
        status: 400,
        code: 'admin_login_request_invalid',
        message: 'Admin username and password are required and must be valid strings',
        retryable: false,
      });
      return;
    }
    const { username, password } = parsedBody.data;
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
        password,
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

  router.post('/cli/v1/operations/restart-server', async (req, res) => {
    await handleCliBackendRestart(req, res, options);
  });

  router.post('/api/session/login', authenticationLimiter, async (req, res) => {
    const parsedBody = adminLoginBodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({ error: 'admin_login_request_invalid' });
      return;
    }
    const { username, password } = parsedBody.data;
    const source = getLoginSource(req);
    if (failedLoginLimiter.isLimited(username, source)) {
      res.status(429).json({ error: 'admin_login_rate_limited' });
      return;
    }

    try {
      const login = await options.adminService.login({
        username,
        password,
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

  router.get('/api/session', (req, res) => {
    const session = options.adminService.validateSession(getAdminSessionCookie(req));
    if (!session) {
      res.status(200).json(unauthenticatedAdminApiResponse(options));
      return;
    }

    res.status(200).json({
      authenticated: true,
      account: session.account,
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    });
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

  router.post('/api/session/logout', (req, res) => {
    options.adminService.revokeSession(getAdminSessionCookie(req));
    clearAdminSessionCookie(res, options.getRuntimeIdentity().externalUrl);
    res.status(200).json({ ok: true });
  });

  router.get('/api/status', statusLimiter, (req, res) => {
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
        facts:
          options.configuredServerService?.getRecentAuditFacts({ limit: 10 }) ??
          options.presetService?.getRecentAuditFacts({ limit: 10 }) ??
          [],
      },
      about: buildAboutMetadata(options.getRuntimeIdentity(), {
        buildVersion: req.header('X-Admin-UI-Build-Version'),
        protocolVersion: req.header('X-Admin-UI-Protocol-Version'),
      }),
    });
  });

  router.get('/api/logs/snapshot', statusLimiter, (req, res) => {
    const broker = options.getBackendLogBroker?.();
    if (!broker) {
      res.status(404).json({ error: 'admin_backend_logs_unavailable' });
      return;
    }
    const parsedQuery = backendLogSnapshotQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      res.status(400).json({ error: 'admin_backend_logs_query_invalid' });
      return;
    }
    res.status(200).json(broker.snapshot(parsedQuery.data.sourceId));
  });

  router.get('/api/logs/stream', (req, res) => {
    const broker = options.getBackendLogBroker?.();
    if (!broker) {
      res.status(404).json({ error: 'admin_backend_logs_unavailable' });
      return;
    }
    streamBackendLogs(req, res, broker, options.adminService);
  });

  router.post('/api/oauth/:serviceId/authorize', sensitiveOperationLimiter, async (req, res) => {
    if (!options.oauthService) {
      res.status(503).json({ error: 'backend_oauth_runtime_unavailable' });
      return;
    }

    const serviceId = parseAdminOAuthServiceId(req, res);
    if (!serviceId) return;
    const result = await options.oauthService.authorizeService({
      context: buildAdminOperationContext(req, options, { type: 'backend_oauth_service', id: serviceId }),
      serviceId,
    });
    sendAdminOAuthOperationResult(res, result);
  });

  router.post('/api/oauth/:serviceId/restart', sensitiveOperationLimiter, async (req, res) => {
    if (!options.oauthService) {
      res.status(503).json({ error: 'backend_oauth_runtime_unavailable' });
      return;
    }

    const serviceId = parseAdminOAuthServiceId(req, res);
    if (!serviceId) return;
    const result = await options.oauthService.restartService({
      context: buildAdminOperationContext(req, options, { type: 'backend_oauth_service', id: serviceId }),
      serviceId,
    });
    sendAdminOAuthOperationResult(res, result);
  });

  router.get('/api/presets', async (req, res) => {
    if (!options.presetService) return void res.status(404).json({ error: 'admin_presets_unavailable' });
    const result = await options.presetService.listPresets({
      context: buildAdminOperationContext(req, options, { type: 'preset_collection' }),
    });
    sendAdminOperationResult(res, result);
  });

  router.get('/api/presets/:name', async (req, res) => {
    if (!options.presetService) return void res.status(404).json({ error: 'admin_presets_unavailable' });
    try {
      sendAdminOperationResult(
        res,
        await options.presetService.getPreset({
          context: buildAdminOperationContext(req, options, { type: 'preset', id: req.params.name }),
          name: req.params.name,
        }),
      );
    } catch (error) {
      sendPresetError(res, error);
    }
  });

  router.post('/api/presets/preview', async (req, res) => {
    if (!options.presetService) return void res.status(404).json({ error: 'admin_presets_unavailable' });
    try {
      sendAdminOperationResult(
        res,
        await options.presetService.previewPreset({
          context: buildAdminOperationContext(req, options, {
            type: 'preset',
            id: getBodyString(req.body, 'sourceName') || getBodyString(getBodyValue(req.body, 'draft'), 'name'),
          }),
          draft: getPresetDraft(req.body),
          sourceName: getBodyString(req.body, 'sourceName') || undefined,
        }),
      );
    } catch (error) {
      sendPresetError(res, error);
    }
  });

  router.post('/api/presets', async (req, res) => {
    await handlePresetMutation(req, res, options, 'create');
  });
  router.post('/api/presets/:name/update', async (req, res) => {
    await handlePresetMutation(req, res, options, 'update');
  });
  router.post('/api/presets/:name/duplicate', async (req, res) => {
    await handlePresetMutation(req, res, options, 'duplicate');
  });
  router.post('/api/presets/:name/delete-preview', async (req, res) => {
    if (!options.presetService) return void res.status(404).json({ error: 'admin_presets_unavailable' });
    try {
      sendAdminOperationResult(
        res,
        await options.presetService.previewDeletePreset({
          context: buildAdminOperationContext(req, options, { type: 'preset', id: req.params.name }),
          name: req.params.name,
          revision: getBodyString(req.body, 'revision'),
        }),
      );
    } catch (error) {
      sendPresetError(res, error);
    }
  });
  router.delete('/api/presets/:name', async (req, res) => {
    if (!options.presetService) return void res.status(404).json({ error: 'admin_presets_unavailable' });
    try {
      sendAdminOperationResult(
        res,
        await options.presetService.deletePreset({
          context: buildAdminOperationContext(req, options, { type: 'preset', id: req.params.name }),
          name: req.params.name,
          revision: getBodyString(req.body, 'revision'),
          previewFingerprint: getBodyString(req.body, 'previewFingerprint'),
        }),
      );
    } catch (error) {
      sendPresetError(res, error);
    }
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
      configFingerprint: result.result.configFingerprint,
    });
  });

  router.get('/api/instruction-templates', async (req, res) => {
    const service = options.instructionTemplateService;
    if (!service) return void res.status(404).json({ error: 'admin_instruction_templates_unavailable' });
    sendAdminOperationResult(
      res,
      await service.listTemplates({
        context: buildAdminOperationContext(req, options, { type: 'instruction_template_collection' }),
      }),
    );
  });

  router.get('/api/instruction-templates/:identity', async (req, res) => {
    await handleInstructionTemplateRequest(req, res, options, 'get');
  });
  router.post('/api/instruction-templates', async (req, res) => {
    await handleInstructionTemplateRequest(req, res, options, 'create');
  });
  router.post('/api/instruction-templates/import-legacy', async (req, res) => {
    await handleInstructionTemplateRequest(req, res, options, 'import');
  });
  router.post('/api/instruction-templates/:identity/clone', async (req, res) => {
    await handleInstructionTemplateRequest(req, res, options, 'clone');
  });
  router.post('/api/instruction-templates/:identity/update', async (req, res) => {
    await handleInstructionTemplateRequest(req, res, options, 'update');
  });
  router.post('/api/instruction-templates/:identity/validate', async (req, res) => {
    await handleInstructionTemplateRequest(req, res, options, 'validate');
  });
  router.post('/api/instruction-templates/:identity/preview', async (req, res) => {
    await handleInstructionTemplateRequest(req, res, options, 'preview');
  });
  router.post('/api/instruction-templates/:identity/activate', async (req, res) => {
    await handleInstructionTemplateRequest(req, res, options, 'activate');
  });
  router.post('/api/instruction-templates/:identity/delete-preview', async (req, res) => {
    await handleInstructionTemplateRequest(req, res, options, 'delete-preview');
  });
  router.delete('/api/instruction-templates/:identity', async (req, res) => {
    await handleInstructionTemplateRequest(req, res, options, 'delete');
  });

  router.get('/api/configured-servers/create-contract', async (req, res) => {
    await handleConfiguredServerCreateContract(req, res, options);
  });

  router.post('/api/configured-servers/create-preview', async (req, res) => {
    await handleConfiguredServerCreatePreview(req, res, options);
  });

  router.post('/api/configured-servers', async (req, res) => {
    await handleConfiguredServerCreateApply(req, res, options);
  });

  router.get('/api/configured-servers/:source/:name', async (req, res) => {
    const source = configuredServerSourceSchema.safeParse(req.params.source);
    if (!source.success) return void res.status(400).json({ error: 'configured_server_source_invalid' });
    await handleConfiguredServerDetail(req, res, options, source.data);
  });

  router.get('/api/configured-servers/:name', async (req, res) => {
    await handleConfiguredServerDetail(req, res, options);
  });

  router.post('/api/configured-servers/:source/:name/tool-inventory/refresh', async (req, res) => {
    const source = configuredServerSourceSchema.safeParse(req.params.source);
    if (!source.success) return void res.status(400).json({ error: 'configured_server_source_invalid' });
    await handleConfiguredToolInventoryRefresh(req, res, options, source.data);
  });

  router.post('/api/configured-servers/:source/:name/preview', async (req, res) => {
    const source = configuredServerSourceSchema.safeParse(req.params.source);
    if (!source.success) return void res.status(400).json({ error: 'configured_server_source_invalid' });
    await handleConfiguredServerPreview(req, res, options, source.data);
  });

  router.post('/api/configured-servers/:source/:name/apply', async (req, res) => {
    const source = configuredServerSourceSchema.safeParse(req.params.source);
    if (!source.success) return void res.status(400).json({ error: 'configured_server_source_invalid' });
    await handleConfiguredServerApply(req, res, options, source.data);
  });

  router.post('/api/configured-servers/:source/:name/delete-preview', async (req, res) => {
    const source = configuredServerSourceSchema.safeParse(req.params.source);
    if (!source.success) return void res.status(400).json({ error: 'configured_server_source_invalid' });
    await handleConfiguredServerDeletePreview(req, res, options, source.data);
  });

  router.post('/api/configured-servers/mcpTemplates/:name/lifecycle-preview', async (req, res) => {
    await handleConfiguredServerLifecyclePreview(req, res, options);
  });

  router.post('/api/configured-servers/mcpTemplates/:name/lifecycle', async (req, res) => {
    await handleConfiguredServerLifecycleApply(req, res, options);
  });

  router.delete('/api/configured-servers/:source/:name', async (req, res) => {
    const source = configuredServerSourceSchema.safeParse(req.params.source);
    if (!source.success) return void res.status(400).json({ error: 'configured_server_source_invalid' });
    await handleConfiguredServerDelete(req, res, options, source.data);
  });

  router.post('/api/configured-servers/mcpServers/:name/enable', async (req, res) => {
    await handleConfiguredServerMutation(req, res, options, 'enableConfiguredServer', 'mcpServers');
  });

  router.post('/api/configured-servers/mcpServers/:name/disable', async (req, res) => {
    await handleConfiguredServerMutation(req, res, options, 'disableConfiguredServer', 'mcpServers');
  });

  router.post('/api/configured-servers/:name/preview', async (req, res) => {
    await handleConfiguredServerPreview(req, res, options);
  });

  router.post('/api/configured-servers/:name/apply', async (req, res) => {
    await handleConfiguredServerApply(req, res, options);
  });

  router.post('/api/configured-servers/:name/enable', async (req, res) => {
    await handleConfiguredServerMutation(req, res, options, 'enableConfiguredServer');
  });

  router.post('/api/configured-servers/:name/disable', async (req, res) => {
    await handleConfiguredServerMutation(req, res, options, 'disableConfiguredServer');
  });

  if (adminConsoleAssets.kind === 'filesystem') {
    router.use(
      '/assets',
      express.static(path.join(adminConsoleAssets.rootDir, 'assets'), {
        immutable: true,
        maxAge: '1y',
      }),
    );
  } else {
    router.use('/assets', (req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        next();
        return;
      }

      const asset = adminConsoleAssets.assets.get(`assets/${req.path.replace(/^\//u, '')}`);
      if (!asset) {
        next();
        return;
      }

      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      res.status(200).type(path.extname(req.path)).send(asset);
    });
  }

  router.use('/assets', (_req, res) => {
    res.status(404).type('text/plain').send('Admin Console asset not found');
  });

  router.get(['/', '/*splat'], (req, res, next) => {
    if (isAdminApiPath(req.path)) {
      next();
      return;
    }

    sendAdminConsoleIndex(res, adminConsoleAssets);
  });

  return router;
}

type InstructionTemplateRouteAction =
  'get' | 'create' | 'clone' | 'update' | 'validate' | 'preview' | 'activate' | 'import' | 'delete-preview' | 'delete';

async function handleInstructionTemplateRequest(
  req: Request,
  res: Response,
  options: AdminRoutesOptions,
  action: InstructionTemplateRouteAction,
): Promise<void> {
  const service = options.instructionTemplateService;
  if (!service) return void res.status(404).json({ error: 'admin_instruction_templates_unavailable' });
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const identityValue = action === 'create' || action === 'import' ? body.identity : req.params.identity;
  const identity = instructionTemplateIdentitySchema.safeParse(identityValue);
  if (!identity.success) return void res.status(400).json({ error: 'instruction_template_identity_invalid' });
  const context = buildAdminOperationContext(req, options, { type: 'instruction_template', id: identity.data });
  const expectedConfigFingerprint =
    typeof body.expectedConfigFingerprint === 'string' ? body.expectedConfigFingerprint : '';

  try {
    switch (action) {
      case 'get':
        return sendAdminOperationResult(res, await service.getTemplate({ context, identity: identity.data }));
      case 'create':
      case 'update': {
        const variants = instructionTemplateVariantsSchema.safeParse(body.variants);
        if (!variants.success || !expectedConfigFingerprint) {
          return void res.status(400).json({ error: 'instruction_template_request_invalid' });
        }
        return sendInstructionTemplateResult(
          res,
          await (action === 'create' ? service.createTemplate : service.updateTemplate).call(service, {
            context,
            identity: identity.data,
            variants: variants.data,
            expectedConfigFingerprint,
          }),
        );
      }
      case 'clone': {
        const destination = instructionTemplateIdentitySchema.safeParse(body.identity);
        if (!destination.success || !expectedConfigFingerprint) {
          return void res.status(400).json({ error: 'instruction_template_request_invalid' });
        }
        return sendInstructionTemplateResult(
          res,
          await service.cloneTemplate({
            context,
            sourceIdentity: identity.data,
            identity: destination.data,
            expectedConfigFingerprint,
          }),
        );
      }
      case 'validate':
        return sendAdminOperationResult(
          res,
          await service.validateTemplate({ context, identity: identity.data, expectedConfigFingerprint }),
        );
      case 'preview': {
        const preview = z
          .object({
            surface: z.enum(['initialize', 'cli']),
            selection: instructionPreviewSelectionSchema,
            requestContext: requestContextSchema.optional(),
          })
          .strict()
          .safeParse(body);
        if (!preview.success) return void res.status(400).json({ error: 'instruction_template_preview_invalid' });
        return sendAdminOperationResult(
          res,
          await service.previewTemplate({ context, identity: identity.data, ...preview.data }),
        );
      }
      case 'activate':
      case 'delete': {
        const previewFingerprint = typeof body.previewFingerprint === 'string' ? body.previewFingerprint : '';
        if (!expectedConfigFingerprint || !previewFingerprint) {
          return void res.status(400).json({ error: 'instruction_template_request_invalid' });
        }
        return sendInstructionTemplateResult(
          res,
          await (action === 'activate' ? service.activateTemplate : service.deleteTemplate).call(service, {
            context,
            identity: identity.data,
            expectedConfigFingerprint,
            previewFingerprint,
          }),
        );
      }
      case 'import':
        if (!expectedConfigFingerprint) {
          return void res.status(400).json({ error: 'instruction_template_request_invalid' });
        }
        return sendInstructionTemplateResult(
          res,
          await service.importLegacyTemplate({ context, identity: identity.data, expectedConfigFingerprint }),
        );
      case 'delete-preview':
        return sendAdminOperationResult(
          res,
          await service.previewDeleteTemplate({ context, identity: identity.data, expectedConfigFingerprint }),
        );
    }
  } catch (error) {
    if (error instanceof AdminInstructionTemplateNotFoundError) {
      res.status(404).json({ error: error.code });
      return;
    }
    throw error;
  }
}

function sendInstructionTemplateResult(
  res: Response,
  result: AdminOperationResult<InstructionTemplateMutationResult | { status: 'legacy_unavailable' }>,
): void {
  if (!result.ok) return sendAdminOperationResult(res, result);
  const status = result.result?.status;
  if (status === 'not_found') return void res.status(404).json({ ok: false, error: 'instruction_template_not_found' });
  if (status === 'invalid') {
    return void res
      .status(422)
      .json({ ok: false, error: 'instruction_template_invalid', validation: result.result.validation });
  }
  if (status === 'legacy_unavailable') {
    return void res.status(409).json({ ok: false, error: 'legacy_instruction_template_unavailable' });
  }
  if (
    status === 'conflict' ||
    status === 'identity_conflict' ||
    status === 'protected' ||
    status === 'active_conflict'
  ) {
    return void res.status(409).json({ ok: false, error: `instruction_template_${status}` });
  }
  sendAdminOperationResult(res, result);
}

function streamBackendLogs(
  req: Request,
  res: Response,
  broker: BackendLogBroker,
  adminService: AdminIdentityService,
): void {
  const sessionToken = getAdminSessionCookie(req);
  let closed = false;
  let unsubscribe: () => void = () => undefined;
  let sessionTimer: ReturnType<typeof setInterval> | null = null;
  const close = () => {
    if (closed) return;
    closed = true;
    if (sessionTimer) clearInterval(sessionTimer);
    unsubscribe();
    if (!res.writableEnded) res.end();
  };
  const writeFrame = (frame: string): boolean => {
    if (closed || res.writableEnded) return false;
    try {
      res.write(frame);
      return true;
    } catch {
      close();
      return false;
    }
  };
  const write = (
    event: string,
    data: BackendLogEntry | BackendLogSnapshot | BackendLogSource[] | BackendLogSourceUpdate,
    id?: number,
  ): boolean => {
    const frame = `${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    return writeFrame(frame);
  };

  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const requestedSequence = parseBackendLogSequence(req.header('Last-Event-ID'));
  if (requestedSequence === undefined) {
    const snapshot = broker.snapshot();
    if (!write('snapshot', snapshot, snapshot.sequence)) return;
  } else {
    const snapshot = broker.snapshot();
    if (!write('sources', snapshot.sources)) return;
    const replay = broker.replayAfter(requestedSequence);
    if (replay.kind === 'gap') {
      if (!write('gap', replay.snapshot, replay.snapshot.sequence)) return;
    } else {
      for (const entry of replay.entries) {
        if (!write('entry', entry, entry.sequence)) return;
      }
    }
  }

  unsubscribe = broker.subscribe({
    onEvent: (entry) => void write('entry', entry, entry.sequence),
    onSourceUpdate: (update) => void write('source', update),
    onDisconnect: close,
  });
  sessionTimer = setInterval(() => {
    if (!adminService.validateSession(sessionToken)) {
      close();
      return;
    }
    void writeFrame(': keep-alive\n\n');
  }, 10_000);
  sessionTimer.unref?.();
  req.on('close', close);
  res.on('close', close);
}

function parseBackendLogSequence(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const sequence = Number(value);
  return Number.isSafeInteger(sequence) ? sequence : undefined;
}

type AdminConsoleAssets =
  { kind: 'embedded'; assets: Map<string, Buffer> } | { kind: 'filesystem'; rootDir: string; indexPath: string };

function resolveAdminConsoleAssets(configuredDir?: string): AdminConsoleAssets {
  if (!configuredDir) {
    const embeddedAssets = readEmbeddedAdminConsoleAssets();
    if (embeddedAssets) {
      return { kind: 'embedded', assets: embeddedAssets };
    }
  }

  const rootDir = configuredDir ?? resolveDefaultAdminConsoleAssetsDir();
  return {
    kind: 'filesystem',
    rootDir,
    indexPath: path.join(rootDir, 'index.html'),
  };
}

function readEmbeddedAdminConsoleAssets(): Map<string, Buffer> | undefined {
  const rawAssets = (globalThis as Record<string, unknown>)[SEA_ADMIN_CONSOLE_ASSETS_KEY];
  if (!rawAssets || typeof rawAssets !== 'object' || Array.isArray(rawAssets)) {
    return undefined;
  }

  const assets = new Map<string, Buffer>();
  for (const [assetPath, encodedAsset] of Object.entries(rawAssets)) {
    if (typeof encodedAsset === 'string') {
      assets.set(assetPath, Buffer.from(encodedAsset, 'base64'));
    }
  }

  return assets.has('index.html') ? assets : undefined;
}

export function resolveDefaultAdminConsoleAssetsDir(): string {
  return fileURLToPath(new URL('../../../admin', import.meta.url));
}

function isAdminApiPath(pathname: string): boolean {
  return (
    pathname === '/api' || pathname.startsWith('/api/') || pathname === '/cli/v1' || pathname.startsWith('/cli/v1/')
  );
}

function sendAdminConsoleIndex(res: Response, adminConsoleAssets: AdminConsoleAssets): void {
  if (adminConsoleAssets.kind === 'embedded') {
    res.status(200).type('html').send(adminConsoleAssets.assets.get('index.html'));
    return;
  }

  if (!fs.existsSync(adminConsoleAssets.indexPath)) {
    res.status(503).type('text/plain').send('Admin Console assets are not available. Run the package build first.');
    return;
  }

  res.status(200).sendFile(adminConsoleAssets.indexPath, { dotfiles: 'allow' });
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

  const parsedBody = cliConfiguredServerMutationBodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    sendCliError(req, res, {
      status: 400,
      code: 'validation_request_invalid',
      message: 'Configured server targetName and dryRun must have valid types',
      retryable: false,
    });
    return;
  }
  const { targetName, dryRun = false } = parsedBody.data;
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

async function handleCliBackendRestart(req: Request, res: Response, options: AdminRoutesOptions): Promise<void> {
  if (!options.backendRestartService) {
    sendCliError(req, res, {
      status: 404,
      code: 'backend_restart_unavailable',
      message: 'Backend restart administration is unavailable',
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
      details: { operationName: 'restartBackend', reason: 'writer_lock_unavailable' },
    });
    return;
  }

  const sessionToken = getBearerSessionToken(req);
  const session = sessionToken ? options.adminService.validateSession(sessionToken) : null;
  if (!sessionToken || !session) {
    sendCliError(req, res, {
      status: 401,
      code: 'admin_session_required',
      message: 'A valid admin session bearer token is required',
      retryable: false,
    });
    return;
  }

  const parsedBody = cliBackendRestartBodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    sendCliError(req, res, {
      status: 400,
      code: 'validation_request_invalid',
      message: 'Backend targetName and restart selectors must have valid, mutually exclusive values',
      retryable: false,
    });
    return;
  }

  const { targetName, instance, allInstances = false } = parsedBody.data;
  const selection: BackendRestartSelection = instance
    ? { mode: 'instance', instanceIdOrPrefix: instance }
    : allInstances
      ? { mode: 'all_instances' }
      : { mode: 'target_default' };
  const context = buildCliAdminOperationContext(req, options, session.account, sessionToken, {
    type: 'backend',
    id: targetName,
  });
  const result = await options.backendRestartService.restartBackend({
    context,
    targetName,
    selection,
    confirmationRequirements: cliBackendRestartConfirmationRequirements(options, targetName),
  });

  if (result.ok && isBackendRestartFailureResult(result.result)) {
    sendCliBackendRestartOutcome(req, res, result.result);
    return;
  }
  sendCliAdminOperationResult(req, res, result);
}

function sendCliBackendRestartOutcome(
  req: Request,
  res: Response,
  result: RuntimeBackendRestartResult & { outcome: Exclude<BackendRestartOutcome, 'restarted'> },
): void {
  const response = backendRestartFailure(result.outcome);
  sendCliError(req, res, {
    status: response.status,
    code: response.code,
    message: response.message,
    retryable: false,
    details: {
      targetName: result.targetName,
      ...(result.candidateInstanceIds ? { candidateInstanceIds: result.candidateInstanceIds } : {}),
    },
  });
}

function isBackendRestartFailureResult(
  result: RuntimeBackendRestartResult,
): result is RuntimeBackendRestartResult & { outcome: Exclude<BackendRestartOutcome, 'restarted'> } {
  return result.outcome !== 'restarted';
}

function backendRestartFailure(outcome: Exclude<BackendRestartOutcome, 'restarted'>): {
  status: number;
  code: string;
  message: string;
} {
  switch (outcome) {
    case 'target_not_found':
      return { status: 404, code: 'backend_not_found', message: 'Backend target was not found' };
    case 'target_disabled':
      return { status: 409, code: 'backend_disabled', message: 'Backend target is disabled' };
    case 'instance_not_found':
      return { status: 404, code: 'backend_instance_not_found', message: 'Backend instance was not found' };
    case 'instance_ambiguous':
      return { status: 409, code: 'backend_instance_ambiguous', message: 'Backend instance prefix is ambiguous' };
    case 'no_active_instances':
      return {
        status: 409,
        code: 'backend_no_active_instances',
        message: 'Backend has no active instances to restart',
      };
    case 'no_unhealthy_instances':
      return {
        status: 409,
        code: 'backend_no_unhealthy_instances',
        message: 'Backend has no unhealthy active instances to restart by default',
      };
  }
}

async function handleConfiguredServerDetail(
  req: Request,
  res: Response,
  options: AdminRoutesOptions,
  targetSource?: 'mcpServers' | 'mcpTemplates',
): Promise<void> {
  if (!options.configuredServerService) {
    res.status(404).json({ error: 'admin_configured_servers_unavailable' });
    return;
  }

  const targetName = req.params.name;
  try {
    const model = configuredServerModelSchema.safeParse(req.query.model);
    const result = await options.configuredServerService.getConfiguredServerDetail({
      context: buildAdminOperationContext(req, options, {
        type: 'configured_server',
        id: `${targetSource ?? 'mcpServers'}/${targetName}`,
      }),
      targetName,
      ...(targetSource ? { targetSource } : {}),
      ...(model.success ? { model: model.data } : {}),
    });
    if (!result.ok) {
      sendAdminOperationResult(res, result);
      return;
    }

    res.status(200).json({
      ok: true,
      operationId: result.operationId,
      server: result.result.server,
      editContract: result.result.editContract,
      ...(result.result.toolInventory ? { toolInventory: result.result.toolInventory } : {}),
    });
  } catch (error) {
    if (error instanceof AdminConfiguredServerNotFoundError) {
      res.status(404).json({
        ok: false,
        error: error.code,
        code: error.code,
        message: 'Configured server target was not found',
        target: { type: 'configured_server', id: `${targetSource ?? 'mcpServers'}/${error.targetName}` },
      });
      return;
    }
    throw error;
  }
}

async function handleConfiguredToolInventoryRefresh(
  req: Request,
  res: Response,
  options: AdminRoutesOptions,
  targetSource: 'mcpServers' | 'mcpTemplates',
): Promise<void> {
  if (!options.configuredServerService?.refreshConfiguredToolInventory) {
    res.status(404).json({ error: 'admin_configured_servers_unavailable' });
    return;
  }

  const body = configuredToolInventoryRefreshSchema.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: 'configured_tool_inventory_refresh_invalid' });
    return;
  }
  const targetName = req.params.name;
  try {
    const result = await options.configuredServerService.refreshConfiguredToolInventory({
      context: buildAdminOperationContext(req, options, {
        type: 'configured_server',
        id: `${targetSource}/${targetName}`,
      }),
      targetName,
      targetSource,
      ...(body.data.model ? { model: body.data.model } : {}),
    });
    if (!result.ok) {
      sendAdminOperationResult(res, result);
      return;
    }
    res.status(200).json({
      ok: true,
      operationId: result.operationId,
      toolInventory: result.result,
    });
  } catch (error) {
    if (error instanceof AdminConfiguredServerNotFoundError) {
      res.status(404).json({
        ok: false,
        error: error.code,
        code: error.code,
        message: 'Configured server target was not found',
        target: { type: 'configured_server', id: `${targetSource}/${targetName}` },
      });
      return;
    }
    throw error;
  }
}

async function handleConfiguredServerCreateContract(
  req: Request,
  res: Response,
  options: AdminRoutesOptions,
): Promise<void> {
  if (!options.configuredServerService) {
    res.status(404).json({ error: 'admin_configured_servers_unavailable' });
    return;
  }
  const result = await options.configuredServerService.getConfiguredServerCreateContract({
    context: buildAdminOperationContext(req, options, { type: 'configured_server_collection' }),
  });
  if (!result.ok) {
    sendAdminOperationResult(res, result);
    return;
  }
  res.status(200).json({ ok: true, operationId: result.operationId, createContract: result.result });
}

async function handleConfiguredServerCreatePreview(
  req: Request,
  res: Response,
  options: AdminRoutesOptions,
): Promise<void> {
  if (!options.configuredServerService) {
    res.status(404).json({ error: 'admin_configured_servers_unavailable' });
    return;
  }
  const draft = getBodyValue(req.body, 'draft') ?? {};
  const result = await options.configuredServerService.previewConfiguredServerCreate({
    context: buildAdminOperationContext(req, options, {
      type: 'configured_server',
      id: configuredServerCreateDraftName(draft),
    }),
    draft,
    connectivityCheck: getBodyString(req.body, 'connectivityCheck') === 'manual' ? 'manual' : 'auto',
  });
  if (!result.ok) {
    sendAdminOperationResult(res, result);
    return;
  }
  res.status(200).json({ ok: true, operationId: result.operationId, preview: result.result });
}

async function handleConfiguredServerCreateApply(
  req: Request,
  res: Response,
  options: AdminRoutesOptions,
): Promise<void> {
  if (!options.configuredServerService) {
    res.status(404).json({ error: 'admin_configured_servers_unavailable' });
    return;
  }
  if (!req.header('Idempotency-Key')?.trim()) {
    res.status(400).json({ ok: false, error: 'idempotency_key_required', code: 'idempotency_key_required' });
    return;
  }
  if (isMutationLocked(options)) {
    sendAdminOperationResult(res, {
      ok: false,
      status: 'runtime_scope_locked',
      code: 'runtime_scope_locked',
      retryable: true,
      operationName: 'applyConfiguredServerCreate',
      reason: 'writer_lock_unavailable',
    });
    return;
  }
  const draft = getBodyValue(req.body, 'draft') ?? {};
  try {
    const result = await options.configuredServerService.applyConfiguredServerCreate({
      context: buildAdminOperationContext(req, options, {
        type: 'configured_server',
        id: configuredServerCreateDraftName(draft),
      }),
      draft,
      previewFingerprint: getBodyString(req.body, 'previewFingerprint'),
    });
    if (!result.ok && result.status === 'mutation_failed' && isConfiguredServerApplyErrorCode(result.error)) {
      sendConfiguredServerApplyError(res, result.error);
      return;
    }
    sendAdminOperationResult(res, result);
  } catch (error) {
    if (error instanceof AdminConfiguredServerApplyError) {
      sendConfiguredServerApplyError(res, error.code);
      return;
    }
    throw error;
  }
}

function configuredServerCreateDraftName(draft: unknown): string {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return '';
  const name = (draft as Record<string, unknown>).name;
  return typeof name === 'string' ? name : '';
}

async function handleConfiguredServerPreview(
  req: Request,
  res: Response,
  options: AdminRoutesOptions,
  targetSource?: 'mcpServers' | 'mcpTemplates',
): Promise<void> {
  if (!options.configuredServerService) {
    res.status(404).json({ error: 'admin_configured_servers_unavailable' });
    return;
  }

  const targetName = req.params.name;
  const edit = getBodyValue(req.body, 'edit');
  try {
    const model = configuredServerModelSchema.safeParse(getBodyString(req.body, 'model'));
    const result = await options.configuredServerService.previewConfiguredServerEdit({
      context: buildAdminOperationContext(req, options, {
        type: 'configured_server',
        id: `${targetSource ?? 'mcpServers'}/${targetName}`,
      }),
      targetName,
      ...(targetSource ? { targetSource } : {}),
      edit: edit === undefined ? {} : edit,
      connectivityCheck: getBodyString(req.body, 'connectivityCheck') === 'manual' ? 'manual' : 'auto',
      ...(model.success ? { model: model.data } : {}),
    });
    if (!result.ok) {
      sendAdminOperationResult(res, result);
      return;
    }

    res.status(200).json({
      ok: true,
      operationId: result.operationId,
      preview: result.result,
    });
  } catch (error) {
    if (error instanceof AdminConfiguredServerNotFoundError) {
      res.status(404).json({
        ok: false,
        error: error.code,
        code: error.code,
        message: 'Configured server target was not found',
        target: { type: 'configured_server', id: `${targetSource ?? 'mcpServers'}/${error.targetName}` },
      });
      return;
    }
    throw error;
  }
}

async function handleConfiguredServerApply(
  req: Request,
  res: Response,
  options: AdminRoutesOptions,
  targetSource?: 'mcpServers' | 'mcpTemplates',
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
      operationName: 'applyConfiguredServerEdit',
      reason: 'writer_lock_unavailable',
    });
    return;
  }

  const targetName = req.params.name;
  try {
    const model = configuredServerModelSchema.safeParse(getBodyString(req.body, 'model'));
    const result = await options.configuredServerService.applyConfiguredServerEdit({
      context: buildAdminOperationContext(req, options, {
        type: 'configured_server',
        id: `${targetSource ?? 'mcpServers'}/${targetName}`,
      }),
      targetName,
      ...(targetSource ? { targetSource } : {}),
      edit: getBodyValue(req.body, 'edit') ?? {},
      previewFingerprint: getBodyString(req.body, 'previewFingerprint'),
      ...(model.success ? { model: model.data } : {}),
    });
    if (!result.ok && result.status === 'mutation_failed' && isConfiguredServerApplyErrorCode(result.error)) {
      sendConfiguredServerApplyError(res, result.error);
      return;
    }
    sendAdminOperationResult(res, result);
  } catch (error) {
    if (error instanceof AdminConfiguredServerNotFoundError) {
      sendConfiguredServerApplyError(res, error.code);
      return;
    }
    if (error instanceof AdminConfiguredServerApplyError) {
      sendConfiguredServerApplyError(res, error.code);
      return;
    }
    throw error;
  }
}

async function handleConfiguredServerDeletePreview(
  req: Request,
  res: Response,
  options: AdminRoutesOptions,
  targetSource: 'mcpServers' | 'mcpTemplates',
): Promise<void> {
  if (!options.configuredServerService?.previewConfiguredServerDelete) {
    res.status(404).json({ error: 'admin_configured_server_delete_unavailable' });
    return;
  }
  const targetName = req.params.name;
  try {
    const result = await options.configuredServerService.previewConfiguredServerDelete({
      context: buildAdminOperationContext(req, options, {
        type: 'configured_server',
        id: `${targetSource}/${targetName}`,
      }),
      targetName,
      targetSource,
    });
    if (!result.ok) {
      if (result.status === 'mutation_failed' && isConfiguredServerApplyErrorCode(result.error)) {
        sendConfiguredServerApplyError(res, result.error);
        return;
      }
      sendAdminOperationResult(res, result);
      return;
    }
    res.status(200).json({ ok: true, operationId: result.operationId, preview: result.result });
  } catch (error) {
    if (error instanceof AdminConfiguredServerNotFoundError) {
      sendConfiguredServerApplyError(res, error.code);
      return;
    }
    if (error instanceof AdminConfiguredServerApplyError) {
      sendConfiguredServerApplyError(res, error.code);
      return;
    }
    throw error;
  }
}

async function handleConfiguredServerDelete(
  req: Request,
  res: Response,
  options: AdminRoutesOptions,
  targetSource: 'mcpServers' | 'mcpTemplates',
): Promise<void> {
  if (!options.configuredServerService?.deleteConfiguredServer) {
    res.status(404).json({ error: 'admin_configured_server_delete_unavailable' });
    return;
  }
  if (!req.header('Idempotency-Key')?.trim()) {
    res.status(400).json({ ok: false, error: 'idempotency_key_required', code: 'idempotency_key_required' });
    return;
  }
  if (isMutationLocked(options)) {
    sendAdminOperationResult(res, {
      ok: false,
      status: 'runtime_scope_locked',
      code: 'runtime_scope_locked',
      retryable: true,
      operationName: 'deleteConfiguredServer',
      reason: 'writer_lock_unavailable',
    });
    return;
  }
  const targetName = req.params.name;
  const parsedBody = configuredServerDeleteApplySchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({
      ok: false,
      error: 'configured_server_delete_request_invalid',
      code: 'configured_server_delete_request_invalid',
      message: 'Delete requires a current preview fingerprint and exact source-qualified confirmation facts.',
    });
    return;
  }
  try {
    const result = await options.configuredServerService.deleteConfiguredServer({
      context: buildAdminOperationContext(req, options, {
        type: 'configured_server',
        id: `${targetSource}/${targetName}`,
      }),
      targetName,
      targetSource,
      previewFingerprint: parsedBody.data.previewFingerprint,
    });
    if (!result.ok && result.status === 'mutation_failed' && isConfiguredServerApplyErrorCode(result.error)) {
      sendConfiguredServerApplyError(res, result.error);
      return;
    }
    sendAdminOperationResult(res, result);
  } catch (error) {
    if (error instanceof AdminConfiguredServerNotFoundError || error instanceof AdminConfiguredServerApplyError) {
      sendConfiguredServerApplyError(res, error.code);
      return;
    }
    throw error;
  }
}

async function handleConfiguredServerLifecyclePreview(
  req: Request,
  res: Response,
  options: AdminRoutesOptions,
): Promise<void> {
  if (!options.configuredServerService?.previewConfiguredServerLifecycle) {
    res.status(404).json({ error: 'admin_configured_server_lifecycle_unavailable' });
    return;
  }
  const body = configuredServerLifecyclePreviewSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ ok: false, error: 'configured_server_lifecycle_request_invalid' });
    return;
  }
  try {
    const result = await options.configuredServerService.previewConfiguredServerLifecycle({
      context: buildAdminOperationContext(req, options, {
        type: 'configured_server',
        id: `mcpTemplates/${req.params.name}`,
      }),
      targetName: req.params.name,
      targetSource: 'mcpTemplates',
      enabled: body.data.enabled,
    });
    if (!result.ok) return void sendAdminOperationResult(res, result);
    res.status(200).json({ ok: true, operationId: result.operationId, preview: result.result });
  } catch (error) {
    if (error instanceof AdminConfiguredServerNotFoundError || error instanceof AdminConfiguredServerApplyError) {
      sendConfiguredServerApplyError(res, error.code);
      return;
    }
    throw error;
  }
}

async function handleConfiguredServerLifecycleApply(
  req: Request,
  res: Response,
  options: AdminRoutesOptions,
): Promise<void> {
  if (!options.configuredServerService?.applyConfiguredServerLifecycle) {
    res.status(404).json({ error: 'admin_configured_server_lifecycle_unavailable' });
    return;
  }
  if (!req.header('Idempotency-Key')?.trim()) {
    res.status(400).json({ ok: false, error: 'idempotency_key_required', code: 'idempotency_key_required' });
    return;
  }
  if (isMutationLocked(options)) {
    sendAdminOperationResult(res, {
      ok: false,
      status: 'runtime_scope_locked',
      code: 'runtime_scope_locked',
      retryable: true,
      operationName: 'applyConfiguredServerLifecycle',
      reason: 'writer_lock_unavailable',
    });
    return;
  }
  const body = configuredServerLifecycleApplySchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ ok: false, error: 'configured_server_lifecycle_request_invalid' });
    return;
  }
  try {
    const result = await options.configuredServerService.applyConfiguredServerLifecycle({
      context: buildAdminOperationContext(req, options, {
        type: 'configured_server',
        id: `mcpTemplates/${req.params.name}`,
      }),
      targetName: req.params.name,
      targetSource: 'mcpTemplates',
      enabled: body.data.enabled,
      previewFingerprint: body.data.previewFingerprint,
    });
    if (!result.ok && result.status === 'mutation_failed' && isConfiguredServerApplyErrorCode(result.error)) {
      sendConfiguredServerApplyError(res, result.error);
      return;
    }
    sendAdminOperationResult(res, result);
  } catch (error) {
    if (error instanceof AdminConfiguredServerNotFoundError || error instanceof AdminConfiguredServerApplyError) {
      sendConfiguredServerApplyError(res, error.code);
      return;
    }
    throw error;
  }
}

function isConfiguredServerApplyErrorCode(value: string): boolean {
  return value.startsWith('configured_server_');
}

function sendConfiguredServerApplyError(res: Response, code: string): void {
  const status = code === 'configured_server_not_found' ? 404 : 409;
  res.status(status).json({
    ok: false,
    error: code,
    code,
    message: configuredServerApplyErrorMessage(code),
  });
}

function configuredServerApplyErrorMessage(code: string): string {
  switch (code) {
    case 'configured_server_stale_preview':
      return 'The Runtime Scope configuration changed after preview. Preview the server again.';
    case 'configured_server_destination_conflict':
      return 'The requested configured server target name is already in use.';
    case 'configured_server_connectivity_blocked':
      return 'Connectivity validation did not pass for the enabled remote server.';
    case 'configured_server_edit_invalid':
      return 'The configured server edit is invalid.';
    case 'configured_server_edit_unchanged':
      return 'The configured server edit does not contain any changes.';
    case 'configured_server_create_invalid':
      return 'The proposed configured server is invalid. Correct the fields and preview it again.';
    case 'configured_server_create_failed':
      return 'The configured server could not be persisted. Inspect the Runtime Scope configuration and retry with a new idempotency key.';
    case 'configured_server_not_found':
      return 'Configured server target was not found.';
    case 'configured_server_already_removed':
      return 'This source-qualified configured server target was already removed. Refresh the server inventory.';
    case 'configured_server_source_changed':
      return 'The requested source no longer owns this configured server target. Refresh the inventory; the same name in the other source was not changed.';
    case 'configured_server_delete_failed':
      return 'The configured server target could not be deleted. The recovery backup and original definition were preserved.';
    default:
      return 'The configured server edit could not be applied.';
  }
}

async function handleConfiguredServerMutation(
  req: Request,
  res: Response,
  options: AdminRoutesOptions,
  operationName: 'enableConfiguredServer' | 'disableConfiguredServer',
  targetSource?: 'mcpServers' | 'mcpTemplates',
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
  const context = buildAdminOperationContext(req, options, {
    type: 'configured_server',
    id: `${targetSource ?? 'mcpServers'}/${targetName}`,
  });
  const input = { context, targetName, ...(targetSource ? { targetSource } : {}) };
  const result =
    operationName === 'enableConfiguredServer'
      ? await options.configuredServerService.enableConfiguredServer(input)
      : await options.configuredServerService.disableConfiguredServer(input);

  sendAdminOperationResult(res, result);
}

function cliMutationAvailability(options: AdminRoutesOptions, setupRequired: boolean): AdminMutationAvailability {
  if (!options.configuredServerService && !options.backendRestartService) {
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

export class FailedLoginLimiter {
  private readonly attempts = new Map<string, { count: number; firstFailureAt: number }>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxActiveKeys = FAILED_LOGIN_MAX_ACTIVE_KEYS,
    private readonly windowMs = FAILED_LOGIN_WINDOW_MS,
    private readonly maxFailedAttempts = FAILED_LOGIN_LIMIT,
  ) {}

  isLimited(username: string, origin: string): boolean {
    this.pruneExpired();
    const attempt = this.getAttempt(username, origin);
    if (attempt) {
      return attempt.count >= this.maxFailedAttempts;
    }
    return this.attempts.size >= this.maxActiveKeys;
  }

  recordFailure(username: string, origin: string): void {
    const key = this.key(username, origin);
    this.pruneExpired();
    const now = this.now();
    const attempt = this.getAttempt(username, origin);
    if (!attempt && this.attempts.size >= this.maxActiveKeys) {
      return;
    }
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

    if (this.now() - attempt.firstFailureAt > this.windowMs) {
      this.attempts.delete(key);
      return null;
    }

    return attempt;
  }

  private key(username: string, origin: string): string {
    return `${username.trim() || '<missing>'}\0${origin}`;
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [key, attempt] of this.attempts) {
      if (now - attempt.firstFailureAt > this.windowMs) {
        this.attempts.delete(key);
      }
    }
  }
}

function isUnsafeMethod(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

function getLoginSource(req: Request): string {
  return req.ip ?? 'unknown';
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

  const bearerScheme = 'Bearer';
  if (
    authorization.length <= bearerScheme.length ||
    authorization.slice(0, bearerScheme.length).toLowerCase() !== bearerScheme.toLowerCase()
  ) {
    return undefined;
  }

  let tokenStart = bearerScheme.length;
  if (authorization.charCodeAt(tokenStart) !== 0x20) {
    return undefined;
  }
  while (authorization.charCodeAt(tokenStart) === 0x20) {
    tokenStart += 1;
  }

  const token = authorization.slice(tokenStart);
  return token && !/\s/u.test(token) ? token : undefined;
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

function sendAdminOAuthOperationResult<T>(res: Response, result: AdminOperationResult<T>): void {
  if (!result.ok && result.status === 'mutation_failed') {
    const status =
      result.error === 'backend_oauth_service_not_found'
        ? 404
        : result.error === 'backend_oauth_runtime_unavailable'
          ? 503
          : 502;
    res.status(status).json({ ok: false, error: result.error });
    return;
  }

  sendAdminOperationResult(res, result);
}

function parseAdminOAuthServiceId(req: Request, res: Response): string | null {
  const parsed = adminOAuthServiceParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: 'backend_oauth_service_id_invalid' });
    return null;
  }
  return parsed.data.serviceId;
}

async function handlePresetMutation(
  req: Request,
  res: Response,
  options: AdminRoutesOptions,
  action: 'create' | 'update' | 'duplicate',
): Promise<void> {
  if (!options.presetService) {
    res.status(404).json({ error: 'admin_presets_unavailable' });
    return;
  }
  const draft = getPresetDraft(req.body);
  const common = {
    context: buildAdminOperationContext(req, options, { type: 'preset', id: req.params.name || draft.name }),
    draft,
    revision: getBodyString(req.body, 'revision'),
    previewFingerprint: getBodyString(req.body, 'previewFingerprint'),
  };
  try {
    const result =
      action === 'create'
        ? await options.presetService.createPreset(common)
        : action === 'update'
          ? await options.presetService.updatePreset({ ...common, sourceName: req.params.name })
          : await options.presetService.duplicatePreset({ ...common, sourceName: req.params.name });
    if (!result.ok && result.status === 'mutation_failed' && result.error === 'preset_revision_conflict') {
      res.status(409).json({ error: 'preset_revision_conflict' });
      return;
    }
    sendAdminOperationResult(res, result);
  } catch (error) {
    sendPresetError(res, error);
  }
}

function sendPresetError(res: Response, error: unknown): void {
  if (error instanceof AdminPresetNotFoundError) {
    res.status(404).json({ error: error.code });
    return;
  }
  if (error instanceof AdminPresetConflictError) {
    res.status(409).json({ error: error.code });
    return;
  }
  if (error instanceof Error) {
    res.status(400).json({ error: 'preset_validation_failed', message: sanitizeErrorMessage(error.message) });
    return;
  }
  throw error;
}

function getPresetDraft(body: unknown): AdminPresetDraft {
  const value = getBodyValue(body, 'draft');
  const record = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const strategy = record.strategy;
  return {
    name: typeof record.name === 'string' ? record.name : '',
    description: typeof record.description === 'string' ? record.description : undefined,
    strategy: strategy === 'and' || strategy === 'advanced' ? strategy : 'or',
    tagQuery:
      record.tagQuery && typeof record.tagQuery === 'object' && !Array.isArray(record.tagQuery)
        ? (record.tagQuery as AdminPresetDraft['tagQuery'])
        : {},
  };
}

function buildAboutMetadata(runtime: RuntimeIdentity, ui: { buildVersion?: string; protocolVersion?: string }) {
  return {
    productName: '1MCP Agent',
    runtimeVersion: runtime.runtimeVersion,
    adminUiBuildVersion: ui.buildVersion || undefined,
    adminApiProtocolVersion: ADMIN_API_PROTOCOL_VERSION,
    adminUiProtocolVersion: ui.protocolVersion || undefined,
    protocolCompatible: ui.protocolVersion === ADMIN_API_PROTOCOL_VERSION,
    runtime: {
      runtimeScopeId: runtime.runtimeScopeId,
      externalUrl: runtime.externalUrl || undefined,
    },
    build: {
      commit: process.env.ADMIN_UI_BUILD_COMMIT || undefined,
      timestamp: process.env.ADMIN_UI_BUILD_TIMESTAMP || undefined,
    },
    project: {
      ...MCP_PROJECT_METADATA,
    },
  };
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
    requestFingerprint:
      target.type === 'backend_oauth_service'
        ? backendOAuthRequestFingerprint(operationName, target.id)
        : configuredServerRequestFingerprint(operationName, target.id, req.body),
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

function cliBackendRestartConfirmationRequirements(
  options: AdminRoutesOptions,
  targetName: string,
): AdminConfirmationRequirement[] {
  const identity = options.getRuntimeIdentity();
  if (isLoopbackRuntimeUrl(identity.externalUrl)) {
    return [];
  }
  const target = { type: 'backend', id: targetName };
  return [
    { code: 'confirm_non_loopback_runtime', expected: true, target },
    { code: 'confirmedOperation', expected: 'mcp.restart', target },
    { code: 'confirmedRuntimeScopeId', expected: identity.runtimeScopeId, target },
    { code: 'confirmationSource', expected: 'cli_flag', target },
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
    requestFingerprint: configuredServerRequestFingerprint(operationName, target.id, req.body),
    confirmationFacts: getBodyRecord(req.body, 'confirmationFacts'),
  };
}

function configuredServerRequestFingerprint(
  operationName: string,
  targetName: string | undefined,
  body?: unknown,
): string {
  const previewFingerprint = getBodyString(body, 'previewFingerprint');
  const normalized = stableJsonStringify({
    schemaVersion: 1,
    operationName,
    target: {
      type: operationName === 'restartBackend' ? 'backend' : 'configured_server',
      id: targetName ?? '',
    },
    ...(operationName === 'applyConfiguredServerEdit'
      ? {
          previewFingerprint,
          editDigest: keyedRequestFingerprint(
            previewFingerprint,
            'configured-server-edit',
            stableJsonStringify(getBodyValue(body, 'edit') ?? {}),
          ),
        }
      : {}),
    ...(operationName === 'applyConfiguredServerCreate'
      ? {
          previewFingerprint,
          draftDigest: keyedRequestFingerprint(
            previewFingerprint,
            'configured-server-create-draft',
            stableJsonStringify(getBodyValue(body, 'draft') ?? {}),
          ),
        }
      : {}),
    ...(operationName === 'deleteConfiguredServer'
      ? {
          previewFingerprint,
          deleteDigest: keyedRequestFingerprint(
            previewFingerprint,
            'configured-server-delete-body',
            stableJsonStringify({
              previewFingerprint,
              confirmationFacts: getBodyRecord(body, 'confirmationFacts') ?? {},
            }),
          ),
        }
      : {}),
    ...(operationName === 'applyConfiguredServerLifecycle'
      ? {
          previewFingerprint,
          lifecycleDigest: keyedRequestFingerprint(
            previewFingerprint,
            'configured-server-lifecycle-body',
            stableJsonStringify({
              enabled: getBodyValue(body, 'enabled') === true,
              previewFingerprint,
              confirmationFacts: getBodyRecord(body, 'confirmationFacts') ?? {},
            }),
          ),
        }
      : {}),
    ...(operationName === 'restartBackend'
      ? {
          restartSelection: {
            instance: getBodyString(body, 'instance'),
            allInstances: getBodyValue(body, 'allInstances') === true,
          },
        }
      : {}),
    ...(operationName.includes('InstructionTemplate') || operationName === 'applyConfiguredServerInstructionOverride'
      ? {
          bodyDigest: keyedRequestFingerprint(
            previewFingerprint || getBodyString(body, 'expectedConfigFingerprint') || operationName,
            'admin-instruction-operation',
            stableJsonStringify(body ?? {}),
          ),
        }
      : {}),
  });
  if (operationName === 'applyConfiguredServerCreate') {
    return `configured_server_create_${keyedRequestFingerprint(previewFingerprint, 'configured-server-create', normalized)}`;
  }
  if (operationName === 'deleteConfiguredServer') {
    return `configured_server_delete_${keyedRequestFingerprint(previewFingerprint, 'configured-server-delete', normalized)}`;
  }
  if (operationName === 'applyConfiguredServerLifecycle') {
    return `configured_server_lifecycle_${keyedRequestFingerprint(previewFingerprint, 'configured-server-lifecycle', normalized)}`;
  }
  return operationName === 'applyConfiguredServerEdit'
    ? `configured_server_apply_${keyedRequestFingerprint(previewFingerprint, 'configured-server-apply', normalized)}`
    : normalized;
}

function keyedRequestFingerprint(key: string, domain: string, value: string): string {
  return createHmac('sha256', key).update(domain).update('\0').update(value).digest('hex');
}

function backendOAuthRequestFingerprint(operationName: string, serviceId: string | undefined): string {
  return stableJsonStringify({
    schemaVersion: 1,
    operationName,
    target: {
      type: 'backend_oauth_service',
      id: serviceId ?? '',
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
  if (req.path.startsWith('/api/instruction-templates')) {
    if (req.path.endsWith('/clone')) return 'cloneInstructionTemplate';
    if (req.path.endsWith('/update')) return 'updateInstructionTemplate';
    if (req.path.endsWith('/validate')) return 'validateInstructionTemplate';
    if (req.path.endsWith('/preview')) return 'previewInstructionTemplate';
    if (req.path.endsWith('/activate')) return 'activateInstructionTemplate';
    if (req.path.endsWith('/delete-preview')) return 'previewDeleteInstructionTemplate';
    if (req.path.endsWith('/import-legacy')) return 'importLegacyInstructionTemplate';
    if (req.method === 'DELETE') return 'deleteInstructionTemplate';
    if (req.method === 'POST') return 'createInstructionTemplate';
    return req.path === '/api/instruction-templates' ? 'listInstructionTemplates' : 'getInstructionTemplate';
  }
  if (req.path.endsWith('/instruction-override')) {
    return 'applyConfiguredServerInstructionOverride';
  }
  if (req.path.startsWith('/api/oauth/')) {
    return req.path.endsWith('/restart') ? 'restartBackendOAuth' : 'authorizeBackendOAuth';
  }
  if (req.path.endsWith('/restart-server')) {
    return 'restartBackend';
  }
  if (req.path.endsWith('/enable') || req.path.endsWith('/enable-server')) {
    return 'enableConfiguredServer';
  }
  if (req.path.endsWith('/disable') || req.path.endsWith('/disable-server')) {
    return 'disableConfiguredServer';
  }
  if (req.path === '/api/configured-servers/create-preview') {
    return 'previewConfiguredServerCreate';
  }
  if (req.method === 'POST' && req.path === '/api/configured-servers') {
    return 'applyConfiguredServerCreate';
  }
  if (req.method === 'GET' && req.path === '/api/configured-servers/create-contract') {
    return 'getConfiguredServerCreateContract';
  }
  if (req.path.endsWith('/lifecycle-preview')) {
    return 'previewConfiguredServerLifecycle';
  }
  if (req.path.endsWith('/lifecycle')) {
    return 'applyConfiguredServerLifecycle';
  }
  if (req.path.endsWith('/preview')) {
    return 'previewConfiguredServerEdit';
  }
  if (req.path.endsWith('/delete-preview')) {
    return 'previewConfiguredServerDelete';
  }
  if (req.method === 'DELETE' && req.path.startsWith('/api/configured-servers/')) {
    return 'deleteConfiguredServer';
  }
  if (req.path.endsWith('/apply')) {
    return 'applyConfiguredServerEdit';
  }
  if (req.method === 'GET' && req.path.startsWith('/api/configured-servers/')) {
    return 'getConfiguredServerDetail';
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
      id: service.name,
      displayName: backendOAuthServiceDisplayName(service.name),
      lastError: service.lastError ? sanitizeErrorMessage(service.lastError) : undefined,
    })),
  };
}

function backendOAuthServiceDisplayName(serviceId: string): string {
  const identity = parseTemplateConnectionKey(serviceId);
  if (identity.kind !== 'rendered' || identity.renderedHash.length <= TEMPLATE_INSTANCE_ID_DISPLAY_LENGTH) {
    return serviceId;
  }

  return `${identity.templateName}:${identity.renderedHash.slice(0, TEMPLATE_INSTANCE_ID_DISPLAY_LENGTH)}`;
}

function getBodyValue(body: unknown, key: string): unknown {
  if (!body || typeof body !== 'object') {
    return undefined;
  }

  return (body as Record<string, unknown>)[key];
}

function getBodyString(body: unknown, key: string): string {
  if (!body || typeof body !== 'object') {
    return '';
  }

  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
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
