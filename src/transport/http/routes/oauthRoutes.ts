import {
  getOAuthAuthorizationFlow,
  OAuthAuthorizationFlow,
  OAuthAuthorizationFlowProvider,
} from '@src/auth/oauthAuthorizationFlow.js';
import { SDKOAuthServerProvider } from '@src/auth/sdkOAuthServerProvider.js';
import { RATE_LIMIT_CONFIG } from '@src/constants.js';
import { ClientManager } from '@src/core/client/clientManager.js';
import { LoadingState } from '@src/core/loading/loadingStateTracker.js';
import { McpLoadingManager } from '@src/core/loading/mcpLoadingManager.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import logger from '@src/logger/logger.js';
import { sensitiveOperationLimiter } from '@src/transport/http/middlewares/securityMiddleware.js';

import { Request, RequestHandler, Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

const consentBodySchema = z.object({
  auth_request_id: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  scopes: z.union([z.string(), z.array(z.string())]).optional(),
});

/**
 * Creates OAuth routes with the provided OAuth provider
 */
export function createOAuthRoutes(oauthProvider: SDKOAuthServerProvider, loadingManager?: McpLoadingManager): Router {
  const router: Router = Router();
  const oauthFlow = getOAuthFlow(oauthProvider, loadingManager);

  // Rate limiter for OAuth endpoints
  const createOAuthLimiter = () => {
    const serverConfig = AgentConfigManager.getInstance();
    return rateLimit({
      windowMs: serverConfig.get('rateLimit').windowMs,
      max: serverConfig.get('rateLimit').max,
      standardHeaders: true,
      legacyHeaders: false,
      message: RATE_LIMIT_CONFIG.OAUTH.MESSAGE,
    });
  };

  router.use(createOAuthLimiter());

  /**
   * OAuth Dashboard - Shows all services and their OAuth status
   */
  router.get('/', (_req: Request, res: Response) => {
    res.redirect('/admin');
  });

  /**
   * Start OAuth authorization for a specific service
   */
  const authorizeHandler: RequestHandler = async (req: Request, res: Response) => {
    try {
      const { serverName } = req.params;

      const result = await oauthFlow.startBackendOAuth({ serverName });
      if (result.status === 'redirect') {
        res.redirect(result.redirectUrl);
        return;
      }

      const errorResponse: Record<string, string> = { error: result.errorDescription };
      if (result.status === 'service_not_found') {
        res.status(404).json(errorResponse);
        return;
      }

      res.status(500).json(errorResponse);
    } catch (error) {
      logger.error(`Error starting OAuth for ${req.params.serverName}:`, error);
      const errorResponse: Record<string, string> = { error: 'Failed to start OAuth flow' };
      res.status(500).json(errorResponse);
    }
  };

  router.get('/authorize/:serverName', authorizeHandler);

  /**
   * Handle OAuth callback and trigger reconnection
   */
  router.get('/callback/:serverName', async (req: Request, res: Response) => {
    const { serverName } = req.params;
    const { code, error } = req.query;
    try {
      const result = await oauthFlow.completeBackendOAuthCallback({
        serverName,
        code: code ? String(code) : undefined,
        error: error ? String(error) : undefined,
      });
      if (result.status !== 'completed') {
        logger.error(`OAuth callback failed for ${serverName}:`, result.errorDescription);
        const errorCode = result.status === 'provider_error' ? result.errorDescription : result.status;
        return res.redirect(`/oauth?error=${encodeURIComponent(errorCode)}`);
      }

      // Redirect back to dashboard with success
      res.redirect('/oauth?success=1');
    } catch (error) {
      logger.error(`Error handling OAuth callback for ${serverName}:`, error);
      res.redirect(`/oauth?error=callback_failed`);
    }
  });

  /**
   * Restart OAuth flow for a service
   */
  const restartHandler: RequestHandler = async (req: Request, res: Response) => {
    const { serverName } = req.params;
    try {
      const result = await oauthFlow.restartBackendOAuth({ serverName });
      if (result.status === 'restarted') {
        const successResponse: Record<string, string> = { success: 'true', message: 'OAuth flow restarted' };
        res.json(successResponse);
        return;
      }

      const errorResponse: Record<string, string> = { error: result.errorDescription };
      if (result.status === 'service_not_found') {
        res.status(404).json(errorResponse);
        return;
      }

      res.status(500).json(errorResponse);
    } catch (error) {
      logger.error(`Error restarting OAuth for ${serverName}:`, error);
      const errorResponse: Record<string, string> = { error: 'Failed to restart OAuth flow' };
      res.status(500).json(errorResponse);
    }
  };

  router.post('/restart/:serverName', restartHandler);

  /**
   * Handle consent form submission for OAuth authorization
   */
  const consentHandler: RequestHandler = async (req: Request, res: Response) => {
    try {
      const body = consentBodySchema.parse(req.body);
      const result = await oauthFlow.submitConsent({
        authRequestId: body.auth_request_id,
        action: body.action,
        scopes: body.scopes,
      });

      if (result.status === 'approved_redirect' || result.status === 'denied_redirect') {
        res.redirect(result.redirectUrl);
        return;
      }

      res.status(400).json({
        error: result.status,
        error_description: result.errorDescription,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'Invalid consent form submission',
        });
        return;
      }

      logger.error('Error handling consent form:', error);
      const errorResponse: Record<string, string> = {
        error: 'server_error',
        error_description: 'Internal server error',
      };
      res.status(500).json(errorResponse);
    }
  };

  router.post('/consent', sensitiveOperationLimiter, consentHandler);

  return router;
}

export function createBackendOAuthDashboardProvider(
  oauthProvider: SDKOAuthServerProvider & OAuthAuthorizationFlowProvider,
  loadingManager?: McpLoadingManager,
): () => ReturnType<OAuthAuthorizationFlow['getBackendOAuthDashboard']> {
  return () => getOAuthFlow(oauthProvider, loadingManager).getBackendOAuthDashboard();
}

function getOAuthFlow(
  oauthProvider: SDKOAuthServerProvider & OAuthAuthorizationFlowProvider,
  loadingManager?: McpLoadingManager,
): OAuthAuthorizationFlow {
  const agentConfig = AgentConfigManager.getInstance();
  return getOAuthAuthorizationFlow(oauthProvider, {
    serverRuntime: {
      getClient: (serverName) => ServerManager.current.getClient(serverName),
      getClients: () => ServerManager.current.getClients(),
    },
    clientRuntime: {
      createClientInstance: () => ClientManager.getOrCreateInstance().createClientInstance(),
      completeOAuthAndReconnect: (serverName, authorizationCode) =>
        ClientManager.getOrCreateInstance().completeOAuthAndReconnect(serverName, authorizationCode),
    },
    loadingRuntime: loadingManager
      ? {
          markReady: (serverName) => {
            try {
              loadingManager.getStateTracker().updateServerState(serverName, LoadingState.Ready);
              logger.debug(`Updated LoadingStateTracker: ${serverName} is now Ready after OAuth completion`);
            } catch (stateError) {
              logger.warn(`Could not update LoadingStateTracker for ${serverName}`, { error: stateError });
            }
          },
        }
      : undefined,
    createTokenId: () => '',
    getAuthConfig: () => ({
      enabled: agentConfig.get('features').auth,
      oauthTokenTtlMs: agentConfig.get('auth').oauthTokenTtlMs,
    }),
    getAvailableTags: () => [],
  });
}

// Export the factory function as default
export default createOAuthRoutes;
