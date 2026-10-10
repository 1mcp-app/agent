import {
  createPreparationOwnerIdentity,
  revalidatePreparationAuthentication,
} from '@src/application/backendPreparationAdmission.js';
import {
  BackendPreparationCoordinator,
  getBackendPreparationCoordinator,
  PreparationAuthorizationChangedError,
} from '@src/application/backendPreparationCoordinator.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import type { ServerManager } from '@src/core/server/serverManager.js';
import { requireProjectTarget } from '@src/domains/project-selection/projectSelection.js';
import {
  getAuthInfo,
  getTagFilterMode,
  revalidateAuthInfo,
} from '@src/transport/http/middlewares/scopeAuthMiddleware.js';
import { CONTEXT_HEADERS, extractTemplateContextRequest } from '@src/transport/http/utils/contextExtractor.js';
import { authorizeRequestTemplateContext } from '@src/transport/http/utils/templateContextAuthority.js';

import type { RequestHandler } from 'express';
import { z } from 'zod';

import { buildFilterConfig } from './inspectHelpers.js';

export const preparationRequestSchema = z
  .object({
    action: z.enum(['inspect', 'prepare', 'status', 'wait', 'cancel', 'retry']),
    backend: z.string().trim().min(1).max(256),
    id: z.string().uuid().optional(),
    operation: z.string().min(1).max(256).optional(),
    waitMs: z.number().int().min(0).max(3_600_000).optional(),
    _meta: z.object({ context: z.unknown().optional(), contextProof: z.unknown().optional() }).strict().optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (['wait', 'cancel'].includes(request.action) && !request.id)
      context.addIssue({ code: 'custom', path: ['id'], message: 'An operation id is required' });
    if (['inspect', 'prepare'].includes(request.action) && request.id)
      context.addIssue({ code: 'custom', path: ['id'], message: 'This action does not accept an operation id' });
    if (request.waitMs !== undefined && request.action !== 'wait')
      context.addIssue({ code: 'custom', path: ['waitMs'], message: 'waitMs is only accepted for wait' });
  });

export function createPreparationHandler(
  serverManager: ServerManager,
  ports: { coordinator?: () => Pick<BackendPreparationCoordinator, 'resolveGrant' | 'control'> } = {},
): RequestHandler {
  return async (req, res): Promise<void> => {
    const parsed = preparationRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid preparation request', issues: parsed.error.issues });
      return;
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    req.once?.('aborted', abort);
    res.once?.('close', abort);
    try {
      const extracted = extractTemplateContextRequest(req);
      const sessionHeader = req.headers[CONTEXT_HEADERS.SESSION_ID];
      const transportSessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
      const authorization = extracted
        ? authorizeRequestTemplateContext({ ...extracted, transportSessionId })
        : undefined;
      const revalidateLocalProof = () => {
        const current = extracted ? authorizeRequestTemplateContext({ ...extracted, transportSessionId }) : undefined;
        return (
          current?.status === 'trusted' &&
          current.provenance === 'verified-local' &&
          current.runtimeScopeId === authorization?.runtimeScopeId &&
          current.contextHash === authorization?.contextHash
        );
      };
      // Legacy template trust permits no new local filesystem authority. Remote contexts cannot issue local proofs.
      if (authorization?.status !== 'trusted' || authorization.provenance !== 'verified-local') {
        res
          .status(403)
          .json({ error: 'Preparation requires a verified local checkout context for this Runtime Scope' });
        return;
      }
      const checkoutPath = requireProjectTarget(authorization.context, 'single')[0].path;
      const auth = getAuthInfo(res);
      const revalidateAuthorization = async () => {
        if (!revalidateLocalProof()) return false;
        if (!(await revalidatePreparationAuthentication(auth, () => revalidateAuthInfo(auth)))) return false;
        return revalidateLocalProof() && (Boolean(auth) || !AgentConfigManager.getInstance().isAuthEnabled());
      };
      if (!revalidateLocalProof() || !(await revalidateAuthorization())) {
        res.status(401).json({ error: 'Authorization is no longer valid' });
        return;
      }
      const filterConfig = { ...buildFilterConfig(res), projectFilterMode: getTagFilterMode(res) };
      const owner = createPreparationOwnerIdentity(
        authorization.runtimeScopeId,
        auth ? [auth.clientId, auth.token, [...auth.grantedScopes].sort(), [...auth.grantedTags].sort()] : undefined,
        filterConfig,
      );
      const coordinator = ports.coordinator?.() ?? getBackendPreparationCoordinator(serverManager);
      const grant = await coordinator.resolveGrant({
        backendName: parsed.data.backend,
        checkoutPath,
        owner,
        filterConfig,
      });
      // Configuration/project reads may have taken time; revalidate before admission or process control.
      if (!revalidateLocalProof() || !(await revalidateAuthorization())) {
        res.status(401).json({ error: 'Authorization is no longer valid' });
        return;
      }
      const result = await coordinator.control(grant, {
        ...parsed.data,
        signal: controller.signal,
        validateAdmission: revalidateAuthorization,
        assertAdmission: () => {
          if (!revalidateLocalProof() || (!auth && AgentConfigManager.getInstance().isAuthEnabled()))
            throw new PreparationAuthorizationChangedError();
        },
      });
      if (result === undefined) {
        res.status(404).json({ error: 'Unknown preparation operation' });
        return;
      }
      if (transportSessionId) res.setHeader(CONTEXT_HEADERS.SESSION_ID, transportSessionId);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Preparation request failed';
      const known = [
        'Project Selection',
        'This backend accepts one',
        'Backend is unavailable',
        'Unknown preparation operation',
        'This action requires',
        'Job id is not accepted',
        'Project Checkout is not a directory',
        'Project filter configuration is invalid',
        'Preparation authorization changed',
      ];
      if (known.some((prefix) => message.startsWith(prefix))) {
        res.status(400).json({ error: message });
        return;
      }
      res.status(503).json({
        error: 'Preparation controls are unavailable; inspect runtime configuration and backend prerequisites',
      });
    } finally {
      req.off?.('aborted', abort);
      res.off?.('close', abort);
    }
  };
}
