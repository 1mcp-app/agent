import { RATE_LIMIT_CONFIG } from '@src/constants.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import tagsExtractor from '@src/transport/http/middlewares/tagsExtractor.js';

import { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import rateLimit from 'express-rate-limit';

import { createInspectHandler, createServersHandler } from './inspectRoutes.js';
import { createInstructionsHandler } from './instructionsRoutes.js';
import { createToolInvocationsHandler, createToolsHandler } from './toolRoutes.js';

// Re-export types and handlers so existing imports keep working
export type {
  InspectServerPayload,
  InspectServersPayload,
  InspectToolPayload,
  ServerSummary,
} from './inspectRoutes.js';
export {
  buildFilterConfig,
  createInspectHandler,
  createServersHandler,
  matchesFilterConfig,
  parseTarget,
  resolveConnectionByServerName,
} from './inspectRoutes.js';
export { createToolInvocationsHandler, createToolsHandler } from './toolRoutes.js';
export { createCliTokenRoute } from './cliTokenRoute.js';
export type { SDKOAuthServerProvider } from '@src/auth/sdkOAuthServerProvider.js';

// ---- Route factory ----

export interface ToolInvocationRateLimitPolicy {
  windowMs: number;
  max: number;
}

const DEFAULT_TOOL_INVOCATION_RATE_LIMIT_POLICY: ToolInvocationRateLimitPolicy = {
  windowMs: RATE_LIMIT_CONFIG.TOOL_INVOCATIONS.WINDOW_MS,
  max: RATE_LIMIT_CONFIG.TOOL_INVOCATIONS.MAX,
};

export function rejectBrowserOriginRequests(req: Request, res: Response, next: NextFunction): void {
  if (req.headers.origin) {
    res.status(403).json({ error: 'Cross-origin requests are not allowed for this endpoint' });
    return;
  }

  next();
}

export function createApiRoutes(
  serverManager: ServerManager,
  scopeAuthMiddleware: RequestHandler,
  rateLimitPolicy: ToolInvocationRateLimitPolicy = DEFAULT_TOOL_INVOCATION_RATE_LIMIT_POLICY,
): Router {
  const router = Router();
  const toolInvocationLimiter = rateLimit({
    windowMs: rateLimitPolicy.windowMs,
    max: rateLimitPolicy.max,
    message: RATE_LIMIT_CONFIG.TOOL_INVOCATIONS.MESSAGE,
    standardHeaders: true,
    legacyHeaders: false,
  });

  router.get('/inspect', tagsExtractor, scopeAuthMiddleware, createInspectHandler(serverManager));
  router.get('/instructions', tagsExtractor, scopeAuthMiddleware, createInstructionsHandler(serverManager));
  router.get('/servers', tagsExtractor, scopeAuthMiddleware, createServersHandler(serverManager));
  router.get('/tools', tagsExtractor, scopeAuthMiddleware, createToolsHandler(serverManager));
  router.post(
    '/tool-invocations',
    rejectBrowserOriginRequests,
    toolInvocationLimiter,
    tagsExtractor,
    scopeAuthMiddleware,
    createToolInvocationsHandler(serverManager),
  );

  return router;
}

export default createApiRoutes;
