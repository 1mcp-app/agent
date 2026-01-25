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
 * Validates a CORS origin URL for security.
 * Rejects invalid protocols, malformed URLs, and potential security risks.
 *
 * @param origin - The origin URL to validate
 * @returns True if the origin is valid and safe
 */
function isValidCorsOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    // Only allow http and https protocols
    if (!['http:', 'https:'].includes(url.protocol)) {
      return false;
    }
    // Reject localhost with non-standard ports that could be confused
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      const port = url.port;
      // Allow standard ports and common dev ports (including Vite, Next.js, Angular, etc.)
      const allowedPorts = ['', '80', '443', '3000', '4000', '5000', '5173', '5174', '5500', '6000', '7000', '8080', '8081', '9000', '9001', '9090', '9200'];
      if (port && !allowedPorts.includes(port)) {
        return false;
      }
    }
    // Reject origins with credentials embedded
    if (url.username || url.password) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates and sanitizes a list of CORS origins.
 * Filters out invalid origins and logs warnings for removed entries.
 *
 * @param origins - Array of origin URLs
 * @returns Array of valid origins
 */
export function validateCorsOrigins(origins: string[]): string[] {
  const validOrigins: string[] = [];
  const invalidOrigins: string[] = [];

  for (const origin of origins) {
    if (isValidCorsOrigin(origin)) {
      validOrigins.push(origin);
    } else {
      invalidOrigins.push(origin);
    }
  }

  if (invalidOrigins.length > 0) {
    logger.warn(`Invalid CORS origins removed: ${invalidOrigins.join(', ')}`);
  }

  return validOrigins;
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
    // Pass encryption key if token encryption is configured
    const encryptionKey = this.configManager.isTokenEncryptionEnabled() ? this.configManager.getTokenEncryptionKey() : undefined;
    const fileStorageService = new FileStorageService(sessionStoragePath, STORAGE_SUBDIRS.TRANSPORT, encryptionKey);
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

    // CORS configuration - use validated whitelist if configured, otherwise allow all for local dev
    const configuredOrigins = this.configManager.getCorsOrigins();
    if (configuredOrigins.length > 0) {
      // Validate and sanitize CORS origins
      const validOrigins = validateCorsOrigins(configuredOrigins);
      if (validOrigins.length > 0) {
        this.app.use(
          cors({
            origin: validOrigins,
            credentials: true,
          }),
        );
      } else if (this.configManager.isStrictCORSEnabled()) {
        // In strict mode, fail on invalid origins instead of falling back
        const invalidCount = configuredOrigins.length;
        logger.error(`Strict CORS mode: All ${invalidCount} configured CORS origins are invalid`);
        throw new Error(`Invalid CORS configuration: All ${invalidCount} configured origins were rejected. Check your configuration.`);
      } else {
        // Fall back to allow all if all origins were invalid (default behavior for backwards compatibility)
        logger.warn(`All configured CORS origins were invalid (${configuredOrigins.join(', ')}) - allowing all origins`);
        this.app.use(cors());
      }
    } else {
      // Allow all origins for local development
      this.app.use(cors());
    }
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
