import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';

import { SDKOAuthServerProvider } from '@src/auth/sdkOAuthServerProvider.js';
import { FileStorageService } from '@src/auth/storage/fileStorageService.js';
import { McpConfigManager } from '@src/config/mcpConfigManager.js';
import { RATE_LIMIT_CONFIG, STORAGE_SUBDIRS } from '@src/constants.js';
import { AsyncLoadingOrchestrator } from '@src/core/capabilities/asyncLoadingOrchestrator.js';
import { McpLoadingManager } from '@src/core/loading/mcpLoadingManager.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import logger from '@src/logger/logger.js';

import bodyParser from 'body-parser';
import cors from 'cors';
import express from 'express';

import errorHandler from './middlewares/errorHandler.js';
import { httpRequestLogger } from './middlewares/httpRequestLogger.js';
import { createMcpAvailabilityMiddleware } from './middlewares/mcpAvailabilityMiddleware.js';
import { createScopeAuthMiddleware } from './middlewares/scopeAuthMiddleware.js';
import { setupSecurityMiddleware } from './middlewares/securityMiddleware.js';
import createHealthRoutes from './routes/healthRoutes.js';
import createOAuthRoutes from './routes/oauthRoutes.js';
import { setupSseRoutes } from './routes/sseRoutes.js';
import { setupStreamableHttpRoutes } from './routes/streamableHttpRoutes.js';
import { StreamableSessionRepository } from './storage/streamableSessionRepository.js';

// Interface compatible with both v7 and v8 of express-rate-limit
interface CompatibleRateLimitOptions {
  windowMs?: number;
  max?: number;
  message?: string | { error: string };
  standardHeaders?: boolean;
  legacyHeaders?: boolean;
  handler?: (req: express.Request, res: express.Response) => void;
}

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
  private loadingManager?: McpLoadingManager;
  private asyncOrchestrator?: AsyncLoadingOrchestrator;
  private oauthProvider: SDKOAuthServerProvider;
  private configManager: AgentConfigManager;
  private customTemplate?: string;
  private streamableSessionRepository: StreamableSessionRepository;

  /**
   * Creates a new ExpressServer instance.
   *
   * Initializes the Express application, sets up middleware, authentication,
   * and configures all routes for MCP transport and OAuth endpoints.
   *
   * @param serverManager - The server manager instance for handling MCP operations
   * @param loadingManager - Optional loading manager for async MCP server initialization
   * @param asyncOrchestrator - Optional async loading orchestrator for listChanged notifications
   * @param customTemplate - Optional custom template for instructions
   */
  constructor(
    serverManager: ServerManager,
    loadingManager?: McpLoadingManager,
    asyncOrchestrator?: AsyncLoadingOrchestrator,
    customTemplate?: string,
  ) {
    this.app = express();

    this.serverManager = serverManager;
    this.loadingManager = loadingManager;
    this.asyncOrchestrator = asyncOrchestrator;
    this.customTemplate = customTemplate;
    this.configManager = AgentConfigManager.getInstance();

    // Configure trust proxy setting before any middleware
    this.app.set('trust proxy', this.configManager.get('trustProxy'));

    // Initialize OAuth provider with custom session storage path if configured
    const sessionStoragePath = this.configManager.get('auth').sessionStoragePath;
    this.oauthProvider = new SDKOAuthServerProvider(sessionStoragePath);

    // Initialize streamable session repository with 'transport' subdirectory
    const fileStorageService = new FileStorageService(sessionStoragePath, STORAGE_SUBDIRS.TRANSPORT);
    this.streamableSessionRepository = new StreamableSessionRepository(fileStorageService);

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Sets up Express middleware including CORS, body parsing, and error handling.
   *
   * Configures the basic middleware stack required for the MCP server:
   * - Enhanced security middleware (conditional based on feature flag)
   * - HTTP request logging for all requests
   * - Context extraction middleware for template processing
   * - CORS for cross-origin requests
   * - JSON body parsing
   * - Global error handling
   */
  private setupMiddleware(): void {
    // Conditionally apply enhanced security middleware (must be first if enabled)
    if (this.configManager.get('features').enhancedSecurity) {
      this.app.use(...setupSecurityMiddleware());
    }

    // Add HTTP request logging middleware (early in the stack for complete coverage)
    this.app.use(httpRequestLogger);

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
    const issuerUrl = new URL(this.configManager.getUrl());

    const rateLimitConfig: CompatibleRateLimitOptions = {
      windowMs: this.configManager.get('rateLimit').windowMs,
      max: this.configManager.get('rateLimit').max,
      message: RATE_LIMIT_CONFIG.OAUTH.MESSAGE,
      standardHeaders: true,
      legacyHeaders: false,
    };

    // Get available scopes from MCP config
    const mcpConfigManager = McpConfigManager.getInstance();
    const availableTags = mcpConfigManager.getAvailableTags();

    // Convert tags to supported scopes
    const scopesSupported = availableTags.map((tag: string) => `tag:${tag}`);

    const authRouter = mcpAuthRouter({
      provider: this.oauthProvider,
      issuerUrl,
      baseUrl: issuerUrl,
      scopesSupported,
      resourceName: '1MCP Agent - Universal MCP Server Proxy',
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
    this.app.use('/oauth', createOAuthRoutes(this.oauthProvider, this.loadingManager));

    // Setup health check routes (no auth required for monitoring)
    this.app.use('/health', createHealthRoutes(this.loadingManager));

    // Setup MCP transport routes (auth is handled per-route via scopeAuthMiddleware)
    const router = express.Router();

    const scopeAuthMiddleware = createScopeAuthMiddleware(this.oauthProvider);
    const availabilityMiddleware = createMcpAvailabilityMiddleware(this.loadingManager, {
      allowPartialAvailability: true,
      includeOAuthServers: false,
    });

    setupStreamableHttpRoutes(
      router,
      this.serverManager,
      this.streamableSessionRepository,
      scopeAuthMiddleware,
      availabilityMiddleware,
      this.asyncOrchestrator,
      this.customTemplate,
    );
    setupSseRoutes(
      router,
      this.serverManager,
      scopeAuthMiddleware,
      availabilityMiddleware,
      this.asyncOrchestrator,
      this.customTemplate,
    );
    this.app.use(router);

    // Log authentication status
    if (this.configManager.get('features').auth) {
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
      const authStatus = this.configManager.get('features').auth ? 'with authentication' : 'without authentication';
      logger.info(`Server is running on port ${port} with HTTP/SSE and Streamable HTTP transport ${authStatus}`);
      logger.info(`📋 OAuth Management Dashboard: ${this.configManager.getUrl()}/oauth`);
    });
  }

  /**
   * Performs graceful shutdown of the Express server.
   *
   * Cleans up resources including:
   * - Authentication manager shutdown
   * - Session cleanup
   * - Timer cleanup
   * - Streamable session repository flush
   */
  public shutdown(): void {
    this.oauthProvider.shutdown();
    this.streamableSessionRepository.stopPeriodicFlush();
  }
}
