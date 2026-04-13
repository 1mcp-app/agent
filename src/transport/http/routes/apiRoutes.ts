import { ServerManager } from '@src/core/server/serverManager.js';
import tagsExtractor from '@src/transport/http/middlewares/tagsExtractor.js';

import { RequestHandler, Router } from 'express';

import { createInspectHandler, createServersHandler } from './inspectRoutes.js';
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

export function createApiRoutes(serverManager: ServerManager, scopeAuthMiddleware: RequestHandler): Router {
  const router = Router();

  router.get('/inspect', tagsExtractor, scopeAuthMiddleware, createInspectHandler(serverManager));
  router.get('/servers', tagsExtractor, scopeAuthMiddleware, createServersHandler(serverManager));
  router.get('/tools', tagsExtractor, scopeAuthMiddleware, createToolsHandler(serverManager));
  router.post('/tool-invocations', tagsExtractor, scopeAuthMiddleware, createToolInvocationsHandler(serverManager));

  return router;
}

export default createApiRoutes;
