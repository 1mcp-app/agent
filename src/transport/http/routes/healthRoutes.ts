import { LoadingState } from '@src/core/loading/loadingStateTracker.js';
import { McpLoadingManager } from '@src/core/loading/mcpLoadingManager.js';
import logger from '@src/logger/logger.js';
import { HealthService, HealthStatus } from '@src/services/healthService.js';

import { Request, RequestHandler, Response, Router } from 'express';
import rateLimit from 'express-rate-limit';

/**
 * Creates health check routes
 */
export function createHealthRoutes(loadingManager?: McpLoadingManager): Router {
  const router: Router = Router();
  const healthService = HealthService.getInstance();

  // Rate limiter for health endpoints - more permissive than OAuth endpoints
  const createHealthLimiter = () => {
    return rateLimit({
      windowMs: 5 * 60 * 1000, // 5 minutes
      max: 200, // max requests per window per IP (higher limit for monitoring)
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        error: 'Too many health check requests, please try again later.',
        status: 'rate_limited',
      },
    });
  };

  router.use(createHealthLimiter());

  /**
   * Health check endpoint
   * GET /health
   *
   * Returns comprehensive health status including:
   * - Overall system status
   * - MCP server connectivity status
   * - System metrics (uptime, memory)
   * - Configuration status
   */
  const healthHandler: RequestHandler = async (req: Request, res: Response) => {
    try {
      logger.debug('Health check requested');

      const healthData = await healthService.performHealthCheck();
      const httpStatusCode = healthService.getHttpStatusCode(healthData.status);

      // Set appropriate headers
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

      // Add custom headers for monitoring tools
      res.setHeader('X-Health-Status', healthData.status);
      res.setHeader('X-Service-Version', healthData.version);
      res.setHeader('X-Uptime-Seconds', healthData.system.uptime.toString());

      logger.debug(`Health check completed with status: ${healthData.status}`);

      res.status(httpStatusCode).json(healthData);
    } catch (error) {
      logger.error('Health check failed:', error);

      // Return error response with 500 status
      res.status(500).json({
        status: HealthStatus.UNHEALTHY,
        timestamp: new Date().toISOString(),
        error: 'Health check failed',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    }
  };

  router.get('/', healthHandler);

  /**
   * Simple liveness probe endpoint
   * GET /health/live
   *
   * Returns minimal response for basic liveness checking
   * Always returns 200 if the server is running
   */
  const livenessHandler: RequestHandler = (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache');

    res.status(200).json({
      status: 'alive',
      timestamp: new Date().toISOString(),
    });
  };

  router.get('/live', livenessHandler);

  /**
   * Readiness probe endpoint
   * GET /health/ready
   *
   * Returns 200 if service is ready to accept requests
   * Returns 503 if service is not ready (e.g., configuration not loaded)
   */
  const readinessHandler: RequestHandler = async (req: Request, res: Response) => {
    try {
      const healthData = await healthService.performHealthCheck();

      // Service is ready if configuration is loaded
      const isReady = healthData.configuration.loaded;
      const statusCode = isReady ? 200 : 503;

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-cache');

      res.status(statusCode).json({
        status: isReady ? 'ready' : 'not_ready',
        timestamp: new Date().toISOString(),
        configuration: healthData.configuration,
      });
    } catch (error) {
      logger.error('Readiness check failed:', error);

      res.status(503).json({
        status: 'not_ready',
        timestamp: new Date().toISOString(),
        error: 'Readiness check failed',
      });
    }
  };

  router.get('/ready', readinessHandler);

  /**
   * MCP servers loading status endpoint
   * GET /health/mcp
   *
   * Returns real-time status of MCP server loading process
   */
  const mcpLoadingHandler: RequestHandler = (req: Request, res: Response) => {
    try {
      if (!loadingManager) {
        res.status(404).json({
          error: 'MCP loading manager not available',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const summary = loadingManager.getSummary();
      const allStates = loadingManager.getStateTracker().getAllServerStates();

      // Group servers by state for better organization
      const serversByState = {
        pending: [] as string[],
        loading: [] as string[],
        ready: [] as string[],
        failed: [] as string[],
        awaitingOAuth: [] as string[],
        cancelled: [] as string[],
      };

      const serverDetails: Record<string, any> = {};

      for (const [name, info] of allStates) {
        // Add to state groups
        switch (info.state) {
          case LoadingState.Pending:
            serversByState.pending.push(name);
            break;
          case LoadingState.Loading:
            serversByState.loading.push(name);
            break;
          case LoadingState.Ready:
            serversByState.ready.push(name);
            break;
          case LoadingState.Failed:
            serversByState.failed.push(name);
            break;
          case LoadingState.AwaitingOAuth:
            serversByState.awaitingOAuth.push(name);
            break;
          case LoadingState.Cancelled:
            serversByState.cancelled.push(name);
            break;
        }

        // Add detailed info
        serverDetails[name] = {
          state: info.state,
          retryCount: info.retryCount,
          duration: info.duration,
          startTime: info.startTime,
          endTime: info.endTime,
          error: info.error?.message,
          progress: info.progress,
          authorizationUrl: info.authorizationUrl,
        };
      }

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('X-Loading-Complete', summary.isComplete.toString());
      res.setHeader('X-Success-Rate', summary.successRate.toFixed(1));

      const responseData = {
        loading: {
          isComplete: summary.isComplete,
          startTime: summary.startTime,
          successRate: summary.successRate,
          averageLoadTime: summary.averageLoadTime,
        },
        summary: {
          total: summary.totalServers,
          pending: summary.pending,
          loading: summary.loading,
          ready: summary.ready,
          failed: summary.failed,
          awaitingOAuth: summary.awaitingOAuth,
          cancelled: summary.cancelled,
        },
        servers: {
          byState: serversByState,
          details: serverDetails,
        },
        timestamp: new Date().toISOString(),
      };

      // Set status code based on loading state
      const statusCode = summary.isComplete ? 200 : 202; // 202 = Accepted (still processing)
      res.status(statusCode).json(responseData);
    } catch (error) {
      logger.error('MCP loading status check failed:', error);

      res.status(500).json({
        error: 'MCP loading status check failed',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        timestamp: new Date().toISOString(),
      });
    }
  };

  router.get('/mcp', mcpLoadingHandler);

  /**
   * Detailed server-specific loading status
   * GET /health/mcp/:serverName
   */
  const serverSpecificHandler: RequestHandler = (req: Request, res: Response) => {
    try {
      if (!loadingManager) {
        res.status(404).json({
          error: 'MCP loading manager not available',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const serverName = req.params.serverName;
      const serverInfo = loadingManager.getStateTracker().getServerState(serverName);

      if (!serverInfo) {
        res.status(404).json({
          error: `Server '${serverName}' not found`,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-Server-State', serverInfo.state);

      const responseData = {
        name: serverInfo.name,
        state: serverInfo.state,
        retryCount: serverInfo.retryCount,
        duration: serverInfo.duration,
        startTime: serverInfo.startTime,
        endTime: serverInfo.endTime,
        lastRetryTime: serverInfo.lastRetryTime,
        error: serverInfo.error
          ? {
              message: serverInfo.error.message,
              name: serverInfo.error.name,
            }
          : undefined,
        progress: serverInfo.progress,
        authorizationUrl: serverInfo.authorizationUrl,
        oauthStartTime: serverInfo.oauthStartTime,
        timestamp: new Date().toISOString(),
      };

      // Set status code based on server state
      let statusCode = 200;
      if (serverInfo.state === LoadingState.Loading) {
        statusCode = 202; // Still processing
      } else if (serverInfo.state === LoadingState.Failed) {
        statusCode = 503; // Service unavailable
      } else if (serverInfo.state === LoadingState.AwaitingOAuth) {
        statusCode = 401; // Unauthorized - needs OAuth
      }

      res.status(statusCode).json(responseData);
    } catch (error) {
      logger.error(`Server-specific loading status check failed for ${req.params.serverName}:`, error);

      res.status(500).json({
        error: 'Server-specific loading status check failed',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        timestamp: new Date().toISOString(),
      });
    }
  };

  router.get('/mcp/:serverName', serverSpecificHandler);

  return router;
}

// Export the factory function as default
export default createHealthRoutes;
