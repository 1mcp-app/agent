import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { Options as RateLimitOptions } from 'express-rate-limit';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import logger from '../../logger/logger.js';
import errorHandler from './middlewares/errorHandler.js';
import { setupSecurityMiddleware } from './middlewares/securityMiddleware.js';
import { ServerManager } from '../../core/server/serverManager.js';
import { SDKOAuthServerProvider } from '../../auth/sdkOAuthServerProvider.js';
import { setupStreamableHttpRoutes } from './routes/streamableHttpRoutes.js';
import { setupSseRoutes } from './routes/sseRoutes.js';
import createOAuthRoutes from './routes/oauthRoutes.js';
import { AgentConfigManager } from '../../core/server/agentConfig.js';
import { RATE_LIMIT_CONFIG } from '../../constants.js';

/**
 * ExpressServer orchestrates the HTTP/SSE transport layer for the MCP server.
 *
 * This class manages the Express application, authentication, and route setup.
 * It provides both HTTP and SSE transport options with optional OAuth 2.1 authentication.
 *
 * @example
 * ```typescript
 * const serverManager = await setupServer();
 * const expressServer = new ExpressServer(serverManager);
 * expressServer.start(3050, 'localhost');
 * ```
 */
export class ExpressServer {
  private app: express.Application;
  private serverManager: ServerManager;
  private oauthProvider: SDKOAuthServerProvider;
  private configManager: AgentConfigManager;

  /**
   * Creates a new ExpressServer instance.
   *
   * Initializes the Express application, sets up middleware, authentication,
   * and configures all routes for MCP transport and OAuth endpoints.
   *
   * @param serverManager - The server manager instance for handling MCP operations
   */
  constructor(serverManager: ServerManager) {
    this.app = express();
    this.serverManager = serverManager;
    this.configManager = AgentConfigManager.getInstance();

    // Initialize OAuth provider with custom session storage path if configured
    const sessionStoragePath = this.configManager.getSessionStoragePath();
    this.oauthProvider = new SDKOAuthServerProvider(sessionStoragePath);

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Sets up Express middleware including CORS, body parsing, and error handling.
   *
   * Configures the basic middleware stack required for the MCP server:
   * - Enhanced security middleware (conditional based on feature flag)
   * - CORS for cross-origin requests
   * - JSON body parsing
   * - Global error handling
   */
  private setupMiddleware(): void {
    // Conditionally apply enhanced security middleware (must be first if enabled)
    if (this.configManager.isEnhancedSecurityEnabled()) {
      this.app.use(...setupSecurityMiddleware());
    }

    this.app.use(cors()); // Allow all origins for local dev
    this.app.use(bodyParser.json());
    this.app.use(bodyParser.urlencoded({ extended: true }));

    // Add error handling middleware
    this.app.use(errorHandler);
  }

  /**
   * Sets up all application routes including OAuth and MCP transport endpoints.
   *
   * Configures the following route groups:
   * - OAuth 2.1 endpoints (always available, auth can be disabled)
   * - Streamable HTTP transport routes with authentication middleware
   * - SSE transport routes with authentication middleware
   *
   * Logs the authentication status for debugging purposes.
   */
  private setupRoutes(): void {
    // Setup OAuth routes using SDK's mcpAuthRouter
    const { host, port } = this.configManager.getConfig();
    const issuerUrl = new URL(`http://${host}:${port}`);

    const rateLimitConfig: Partial<RateLimitOptions> = {
      windowMs: this.configManager.getRateLimitWindowMs(),
      max: this.configManager.getRateLimitMax(),
      message: RATE_LIMIT_CONFIG.OAUTH.MESSAGE,
      standardHeaders: true,
      legacyHeaders: false,
    };

    const authRouter = mcpAuthRouter({
      provider: this.oauthProvider,
      issuerUrl,
      authorizationOptions: {
        rateLimit: rateLimitConfig,
      },
      tokenOptions: {
        rateLimit: rateLimitConfig,
      },
      revocationOptions: {
        rateLimit: rateLimitConfig,
      },
      clientRegistrationOptions: {
        rateLimit: rateLimitConfig,
      },
    });
    this.app.use(authRouter);

    // Setup OAuth management routes (no auth required)
    this.app.use('/oauth', createOAuthRoutes(this.oauthProvider));

    // Setup MCP transport routes (auth is handled per-route via scopeAuthMiddleware)
    const router = express.Router();
    setupStreamableHttpRoutes(router, this.serverManager, this.oauthProvider);
    setupSseRoutes(router, this.serverManager, this.oauthProvider);
    this.app.use(router);

    // Log authentication status
    if (this.configManager.isAuthEnabled()) {
      logger.info('Authentication enabled - OAuth 2.1 endpoints available via SDK');
    } else {
      logger.info('Authentication disabled - all endpoints accessible without auth');
    }
  }

  /**
   * Starts the Express server on the specified port and host.
   *
   * Binds the Express application to the network interface and logs
   * the server status including authentication configuration.
   *
   * @param port - The port number to listen on
   * @param host - The host address to bind to
   */
  public start(): void {
    const { port, host } = this.configManager.getConfig();
    this.app.listen(port, host, () => {
      const authStatus = this.configManager.isAuthEnabled() ? 'with authentication' : 'without authentication';
      logger.info(`Server is running on port ${port} with HTTP/SSE and Streamable HTTP transport ${authStatus}`);
      logger.info(`📋 OAuth Management Dashboard: http://${host}:${port}/oauth`);
    });
  }

  /**
   * Performs graceful shutdown of the Express server.
   *
   * Cleans up resources including:
   * - Authentication manager shutdown
   * - Session cleanup
   * - Timer cleanup
   */
  public shutdown(): void {
    this.oauthProvider.shutdown();
  }
}
