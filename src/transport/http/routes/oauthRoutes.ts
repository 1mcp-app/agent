import { SDKOAuthServerProvider } from '@src/auth/sdkOAuthServerProvider.js';
import { AUTH_CONFIG, RATE_LIMIT_CONFIG } from '@src/constants.js';
import { ClientManager, OAuthRequiredError } from '@src/core/client/clientManager.js';
import { LoadingState } from '@src/core/loading/loadingStateTracker.js';
import { McpLoadingManager } from '@src/core/loading/mcpLoadingManager.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { ClientStatus } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';
import { sensitiveOperationLimiter } from '@src/transport/http/middlewares/securityMiddleware.js';
import {
  escapeHtml,
  sanitizeErrorMessage,
  sanitizeServerNameForContext,
  sanitizeUrlParam,
} from '@src/utils/validation/sanitization.js';
import { validateScopes } from '@src/utils/validation/scopeValidation.js';

import { Request, RequestHandler, Response, Router } from 'express';
import rateLimit from 'express-rate-limit';

/**
 * Service information interface for OAuth dashboard
 */
interface ServiceInfo {
  name: string;
  status: string;
  authorizationUrl?: string;
  oauthStartTime?: Date;
  lastError?: string;
  lastConnected?: Date;
}

/**
 * Creates OAuth routes with the provided OAuth provider
 */
export function createOAuthRoutes(oauthProvider: SDKOAuthServerProvider, loadingManager?: McpLoadingManager): Router {
  const router: Router = Router();

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
   * Check if a server requires OAuth based on runtime behavior
   * A server requires OAuth if it has ever thrown UnauthorizedError (indicated by authorizationUrl or oauthStartTime)
   */
  function requiresOAuth(service: ServiceInfo): boolean {
    // The most reliable indicator: server has ever had an authorization URL
    // This means the server threw UnauthorizedError and we captured the OAuth URL
    if (service.authorizationUrl) {
      return true;
    }

    // Secondary indicator: server has ever been in AwaitingOAuth status
    // This means the server threw UnauthorizedError at some point
    if (service.oauthStartTime) {
      return true;
    }

    // If currently awaiting OAuth, it definitely requires OAuth
    if (service.status === ClientStatus.AwaitingOAuth) {
      return true;
    }

    return false;
  }

  /**
   * OAuth Dashboard - Shows all services and their OAuth status
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const serverManager = ServerManager.current;
      const clients = serverManager.getClients();

      const services: ServiceInfo[] = Array.from(clients.entries()).map(([name, clientInfo]) => ({
        name,
        status: clientInfo.status,
        authorizationUrl: clientInfo.authorizationUrl,
        oauthStartTime: clientInfo.oauthStartTime,
        lastError: clientInfo.lastError?.message,
        lastConnected: clientInfo.lastConnected,
      }));

      const html = generateOAuthDashboard(services, req);
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      logger.error('Error serving OAuth dashboard:', error);
      const errorResponse: Record<string, string> = { error: 'Internal server error' };
      res.status(500).json(errorResponse);
    }
  });

  /**
   * Start OAuth authorization for a specific service
   */
  const authorizeHandler: RequestHandler = async (req: Request, res: Response) => {
    try {
      const { serverName } = req.params;
      const serverManager = ServerManager.current;

      const clientInfo = serverManager.getClient(serverName);
      if (!clientInfo) {
        const errorResponse: Record<string, string> = { error: 'Service not found' };
        res.status(404).json(errorResponse);
        return;
      }

      if (clientInfo.authorizationUrl) {
        // Redirect to existing authorization URL
        res.redirect(clientInfo.authorizationUrl);
        return;
      } else {
        // Generate new authorization URL by attempting connection
        await initiateOAuth(serverName);

        // Get updated client info
        const updatedClients = serverManager.getClients();
        const updatedClientInfo = updatedClients.get(serverName);

        if (updatedClientInfo?.authorizationUrl) {
          res.redirect(updatedClientInfo.authorizationUrl);
          return;
        } else {
          const errorResponse: Record<string, string> = { error: 'Failed to generate OAuth URL' };
          res.status(500).json(errorResponse);
          return;
        }
      }
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
      if (error) {
        logger.error(`OAuth error for ${serverName}:`, error);
        return res.redirect(`/oauth?error=${encodeURIComponent(String(error))}`);
      }

      if (!code) {
        logger.error(`OAuth callback missing authorization code for ${serverName}`);
        return res.redirect(`/oauth?error=missing_code`);
      }

      // Complete OAuth and reconnect via ClientManager
      const clientManager = ClientManager.getOrCreateInstance();
      await clientManager.completeOAuthAndReconnect(serverName, String(code));

      // Notify the loading manager that the server is now ready
      if (loadingManager) {
        try {
          loadingManager.getStateTracker().updateServerState(serverName, LoadingState.Ready);
          logger.debug(`Updated LoadingStateTracker: ${serverName} is now Ready after OAuth completion`);
        } catch (stateError) {
          // If server wasn't tracked, log it but don't fail - this can happen in some edge cases
          logger.warn(`Could not update LoadingStateTracker for ${serverName}: ${stateError}`);
        }
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
      const serverManager = ServerManager.current;

      const clientInfo = serverManager.getClient(serverName);
      if (!clientInfo) {
        const errorResponse: Record<string, string> = { error: 'Service not found' };
        res.status(404).json(errorResponse);
        return;
      }

      // Clear existing OAuth data and restart flow
      await restartOAuthFlow(serverName);

      const successResponse: Record<string, string> = { success: 'true', message: 'OAuth flow restarted' };
      res.json(successResponse);
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
      // Extract and validate request body parameters
      const body = req.body as Record<string, unknown>;
      const auth_request_id = body.auth_request_id as string | undefined;
      const action = body.action as string | undefined;
      const scopes = body.scopes;

      // Validate required fields
      if (!auth_request_id || !action) {
        const errorResponse: Record<string, string> = {
          error: 'invalid_request',
          error_description: 'Missing required parameters',
        };
        res.status(400).json(errorResponse);
        return;
      }

      // Use the OAuth provider's storage service to ensure consistent storage directory
      const authRequest = oauthProvider.oauthStorage.getAuthorizationRequest(auth_request_id);

      if (!authRequest) {
        const errorResponse: Record<string, string> = {
          error: 'invalid_request',
          error_description: 'Invalid or expired authorization request',
        };
        res.status(400).json(errorResponse);
        return;
      }

      // Get client data using the OAuth provider's storage service
      const clientKey = `${AUTH_CONFIG.CLIENT.PREFIXES.CLIENT}${authRequest.clientId}`;
      const client = oauthProvider.oauthStorage.clientDataRepository.get(clientKey);

      if (!client) {
        const errorResponse: Record<string, string> = {
          error: 'invalid_client',
          error_description: 'Client not found',
        };
        res.status(400).json(errorResponse);
        return;
      }

      // Client validation passed - we have a valid client

      if (action === 'deny') {
        // Use the service layer for denial processing
        const redirectUrl = await oauthProvider.oauthStorage.processConsentDenial(auth_request_id);
        res.redirect(redirectUrl.toString());
        return;
      }

      if (action === 'approve') {
        // User approved the authorization
        let selectedScopes: string[];
        if (Array.isArray(scopes)) {
          // Ensure all items are strings
          selectedScopes = scopes.filter((scope): scope is string => typeof scope === 'string');
        } else if (typeof scopes === 'string') {
          selectedScopes = [scopes];
        } else if (scopes) {
          // Handle other types by converting to string
          selectedScopes = [String(scopes)];
        } else {
          selectedScopes = [];
        }

        // Validate selected scopes
        const validation = validateScopes(selectedScopes);
        if (!validation.isValid) {
          const errorResponse: Record<string, string> = {
            error: 'invalid_scope',
            error_description: `Invalid scopes: ${validation.errors.join(', ')}`,
          };
          res.status(400).json(errorResponse);
          return;
        }

        // Use the service layer for approval processing
        const { redirectUrl } = await oauthProvider.oauthStorage.processConsentApproval(
          auth_request_id,
          validation.validScopes,
        );
        res.redirect(redirectUrl.toString());
        return;
      }

      // Invalid action
      const errorResponse: Record<string, string> = {
        error: 'invalid_request',
        error_description: 'Invalid action',
      };
      res.status(400).json(errorResponse);
    } catch (error) {
      logger.error('Error handling consent form:', error);
      const errorResponse: Record<string, string> = {
        error: 'server_error',
        error_description: 'Internal server error',
      };
      res.status(500).json(errorResponse);
    }
  };

  router.post('/consent', sensitiveOperationLimiter, consentHandler);

  /**
   * Initiate OAuth flow for a service
   */
  async function initiateOAuth(serverName: string): Promise<void> {
    const serverManager = ServerManager.current;

    const clientInfo = serverManager.getClient(serverName);
    if (!clientInfo) {
      throw new Error(`Service ${serverName} not found`);
    }

    try {
      // Create new client and attempt connection to trigger OAuth
      const clientManager = ClientManager.getOrCreateInstance();
      const newClient = clientManager.createClientInstance();
      await newClient.connect(clientInfo.transport);
    } catch (error) {
      if (error instanceof OAuthRequiredError) {
        // Update client info with OAuth status
        clientInfo.status = ClientStatus.AwaitingOAuth;
        clientInfo.oauthStartTime = new Date();

        // Try to get authorization URL from OAuth provider
        try {
          const oauthProvider = clientInfo.transport.oauthProvider;
          if (oauthProvider && typeof oauthProvider.getAuthorizationUrl === 'function') {
            clientInfo.authorizationUrl = oauthProvider.getAuthorizationUrl();
          }
        } catch (urlError) {
          logger.warn(`Could not extract authorization URL for ${serverName}:`, urlError);
        }

        logger.info(`OAuth initiated for ${serverName}`);
      } else {
        throw error; // Re-throw non-OAuth errors
      }
    }
  }

  /**
   * Restart OAuth flow for a service
   */
  async function restartOAuthFlow(serverName: string): Promise<void> {
    const serverManager = ServerManager.current;

    const clientInfo = serverManager.getClient(serverName);
    if (!clientInfo) {
      throw new Error(`Service ${serverName} not found`);
    }

    // Clear OAuth state
    clientInfo.authorizationUrl = undefined;
    clientInfo.oauthStartTime = undefined;
    clientInfo.status = ClientStatus.Disconnected;

    // Initiate new OAuth flow
    await initiateOAuth(serverName);
  }

  /**
   * Generate OAuth dashboard HTML
   */
  function generateOAuthDashboard(services: ServiceInfo[], req: Request): string {
    const servicesHtml = services
      .map((service) => {
        const statusIcon = getStatusIcon(service.status);
        const statusText = getStatusText(service.status);
        const actionButton = getActionButton(service);

        return `
      <tr>
        <td>${sanitizeServerNameForContext(service.name, 'html')}</td>
        <td>${statusIcon} ${statusText}</td>
        <td>${service.lastConnected ? escapeHtml(new Date(service.lastConnected).toLocaleString()) : 'Never'}</td>
        <td>${service.lastError ? sanitizeErrorMessage(service.lastError) : '-'}</td>
        <td>${actionButton}</td>
      </tr>
    `;
      })
      .join('');

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>1MCP OAuth Management</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; background-color: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        h1 { color: #333; text-align: center; margin-bottom: 30px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: #f8f9fa; font-weight: bold; }
        .status-connected { color: #28a745; }
        .status-awaiting { color: #ffc107; }
        .status-error { color: #dc3545; }
        .status-disconnected { color: #6c757d; }
        .btn { padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; text-decoration: none; display: inline-block; font-size: 14px; }
        .btn-primary { background-color: #007bff; color: white; }
        .btn-warning { background-color: #ffc107; color: black; }
        .btn-success { background-color: #28a745; color: white; }
        .btn:hover { opacity: 0.8; }
        .alert { padding: 15px; margin: 20px 0; border-radius: 4px; }
        .alert-success { background-color: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
        .alert-error { background-color: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
        .refresh-btn { float: right; margin-bottom: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🔐 1MCP OAuth Management</h1>

        ${getAlertHtml(req)}

        <button class="btn btn-primary refresh-btn" onclick="window.location.reload()">🔄 Refresh</button>

        <table>
          <thead>
            <tr>
              <th>Service</th>
              <th>Status</th>
              <th>Last Connected</th>
              <th>Error</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${servicesHtml}
          </tbody>
        </table>

        <div style="margin-top: 30px; padding: 20px; background-color: #f8f9fa; border-radius: 4px;">
          <h3>Instructions:</h3>
          <ul>
            <li><strong>Connected:</strong> Service is working properly (no authentication required)</li>
            <li><strong>Authorized:</strong> Service is working properly (OAuth authentication completed)</li>
            <li><strong>Awaiting OAuth:</strong> Click "Authorize" to complete authentication</li>
            <li><strong>Error:</strong> Check error message and try "Restart OAuth" if needed</li>
            <li><strong>Disconnected:</strong> Service is not connected</li>
          </ul>
        </div>
      </div>

      <script>
        // Auto-refresh every 30 seconds
        setTimeout(() => window.location.reload(), 30000);

        function restartOAuth(serverName) {
          fetch(\`/oauth/restart/\${serverName}\`, { method: 'POST' })
            .then(response => response.json())
            .then(data => {
              if (data.success) {
                window.location.reload();
              } else {
                alert('Failed to restart OAuth: ' + (data.error || 'Unknown error'));
              }
            })
            .catch(error => {
              alert('Failed to restart OAuth: ' + error.message);
            });
        }
      </script>
    </body>
    </html>
  `;
  }

  function getStatusIcon(status: string): string {
    switch (status) {
      case ClientStatus.Connected:
        return '✅';
      case ClientStatus.AwaitingOAuth:
        return '⏳';
      case ClientStatus.Error:
        return '❌';
      case ClientStatus.Disconnected:
        return '🔌';
      default:
        return '❓';
    }
  }

  function getStatusText(status: string): string {
    switch (status) {
      case ClientStatus.Connected:
        return '<span class="status-connected">Connected</span>';
      case ClientStatus.AwaitingOAuth:
        return '<span class="status-awaiting">Awaiting OAuth</span>';
      case ClientStatus.Error:
        return '<span class="status-error">Error</span>';
      case ClientStatus.Disconnected:
        return '<span class="status-disconnected">Disconnected</span>';
      default:
        return '<span class="status-disconnected">Unknown</span>';
    }
  }

  function getActionButton(service: ServiceInfo): string {
    switch (service.status) {
      case ClientStatus.Connected:
        // Check if server requires OAuth based on runtime behavior
        if (requiresOAuth(service)) {
          return '<span class="status-connected">✓ Authorized</span>';
        } else {
          return '<span class="status-connected">✓ Connected</span>';
        }
      case ClientStatus.AwaitingOAuth:
        return `<a href="/oauth/authorize/${sanitizeUrlParam(service.name)}" class="btn btn-warning">🔐 Authorize</a>`;
      case ClientStatus.Error:
      case ClientStatus.Disconnected:
        return `<button onclick="restartOAuth('${sanitizeServerNameForContext(service.name, 'html')}')" class="btn btn-primary">🔄 Restart OAuth</button>`;
      default:
        return `<button onclick="restartOAuth('${sanitizeServerNameForContext(service.name, 'html')}')" class="btn btn-primary">🔄 Start OAuth</button>`;
    }
  }

  function getAlertHtml(req: Request): string {
    if (req.query.success) {
      return '<div class="alert alert-success">✅ OAuth authorization completed successfully!</div>';
    }
    if (req.query.error) {
      const error = req.query.error;
      return `<div class="alert alert-error">❌ OAuth error: ${sanitizeErrorMessage(String(error))}</div>`;
    }
    return '';
  }

  return router;
}

// Export the factory function as default
export default createOAuthRoutes;
