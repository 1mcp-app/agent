import { randomUUID } from 'node:crypto';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import { AUTH_CONFIG, STREAMABLE_HTTP_ENDPOINT } from '@src/constants.js';
import { AsyncLoadingOrchestrator } from '@src/core/capabilities/asyncLoadingOrchestrator.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import logger from '@src/logger/logger.js';
import {
  getPresetName,
  getTagExpression,
  getTagFilterMode,
  getTagQuery,
  getValidatedTags,
} from '@src/transport/http/middlewares/scopeAuthMiddleware.js';
import tagsExtractor from '@src/transport/http/middlewares/tagsExtractor.js';
import { RestorableStreamableHTTPServerTransport } from '@src/transport/http/restorableStreamableTransport.js';
import { StreamableSessionRepository } from '@src/transport/http/storage/streamableSessionRepository.js';
import { extractContextFromMeta } from '@src/transport/http/utils/contextExtractor.js';
import { SessionService } from '@src/transport/http/utils/sessionService.js';
import { logError, logWarn } from '@src/transport/http/utils/unifiedLogger.js';

import { Request, RequestHandler, Response, Router } from 'express';

/**
 * Wraps an Express response to log when status >= 400 is set.
 * This catches SDK responses that don't throw errors.
 */
function wrapResponseForLogging(req: Request, res: Response): Response {
  const originalJson = res.json.bind(res);
  const originalStatus = res.status.bind(res);
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);
  let logged = false;

  const logIfNeeded = () => {
    if (logged || res.statusCode < 400) return;
    logged = true;

    const level = res.statusCode >= 500 ? 'error' : 'warn';
    const logFn = level === 'error' ? logError : logWarn;
    logFn(`HTTP error ${res.statusCode}`, {
      method: req.method,
      path: req.path,
      sessionId: req.headers['mcp-session-id'] as string | undefined,
      statusCode: res.statusCode,
      reason: 'SDK request validation failed',
    });
  };

  // Intercept res.status() to detect when error codes are set
  res.status = function (code: number): Response {
    const result = originalStatus(code);
    if (code >= 400) {
      logIfNeeded();
    }
    return result;
  };

  // Intercept res.json()
  res.json = function (body: unknown): Response {
    logIfNeeded();
    return originalJson(body);
  };

  // Intercept res.write() for SSE and streaming responses
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res.write = function (...args: any[]): boolean {
    // Only log on first write to avoid duplicate logs
    logIfNeeded();
    // Handle different overloads of res.write()
    if (args.length === 1) {
      return originalWrite(args[0]);
    } else if (args.length === 2 && typeof args[1] === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      return originalWrite(args[0], args[1]);
    } else if (args.length >= 2) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      return originalWrite(args[0], args[1] || 'utf8', args[2]);
    }
    // Fallback: return false (write failed)
    return false;
  };

  // Intercept res.end()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res.end = function (...args: any[]): Response {
    logIfNeeded();
    // Handle different overloads of res.end()
    if (args.length === 0 || (args.length === 1 && args[0] === undefined)) {
      return originalEnd();
    } else if (args.length === 1) {
      return originalEnd(args[0]);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      return originalEnd(args[0], args[1]);
    }
  };

  return res;
}

/**
 * Builds the inbound connection config from request data.
 *
 * @param res - Express response object containing validated middleware data
 * @param req - Express request object
 * @param customTemplate - Optional custom template to include
 * @returns The inbound connection configuration
 */
function buildConfigFromRequest(res: Response, req: Request, customTemplate?: string) {
  return {
    tags: getValidatedTags(res),
    tagExpression: getTagExpression(res),
    tagFilterMode: getTagFilterMode(res),
    tagQuery: getTagQuery(res),
    presetName: getPresetName(res),
    enablePagination: req.query.pagination === 'true',
    customTemplate,
  };
}

/**
 * Sets up client disconnect detection for a request/response pair.
 * Cleans up the transport when the client disconnects, but preserves the session.
 */
function setupDisconnectDetection(req: Request, res: Response, sessionId: string, serverManager: ServerManager): void {
  let responseClosed = false;

  // Mark response as closed when it ends normally
  res.on('finish', () => {
    responseClosed = true;
  });

  // Detect abnormal client disconnect (connection closed before response finished)
  res.on('close', () => {
    if (!responseClosed && !res.writableEnded) {
      // Client disconnected without calling DELETE
      logger.debug(`Client disconnected for session ${sessionId}, cleaning up transport`);
      serverManager.disconnectTransport(sessionId);
      // Note: Session persists in repository for reconnection
    }
  });

  // Also detect socket-level close
  req.socket?.on('close', () => {
    if (!responseClosed && !res.writableEnded) {
      logger.debug(`Socket closed for session ${sessionId}, cleaning up transport`);
      serverManager.disconnectTransport(sessionId);
      // Note: Session persists in repository for reconnection
    }
  });
}

export function setupStreamableHttpRoutes(
  router: Router,
  serverManager: ServerManager,
  sessionRepository: StreamableSessionRepository,
  authMiddleware: RequestHandler,
  availabilityMiddleware?: RequestHandler,
  asyncOrchestrator?: AsyncLoadingOrchestrator,
  customTemplate?: string,
  injectedSessionService?: SessionService,
): void {
  const middlewares = [tagsExtractor, authMiddleware];

  // Add availability middleware if provided
  if (availabilityMiddleware) {
    middlewares.push(availabilityMiddleware);
  }

  const sessionService =
    injectedSessionService || new SessionService(serverManager, sessionRepository, asyncOrchestrator);

  router.post(STREAMABLE_HTTP_ENDPOINT, ...middlewares, async (req: Request, res: Response) => {
    try {
      let transport: StreamableHTTPServerTransport | RestorableStreamableHTTPServerTransport | null;
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      if (!sessionId) {
        // Generate new session ID
        const id = AUTH_CONFIG.SERVER.STREAMABLE_SESSION.ID_PREFIX + randomUUID();

        const config = buildConfigFromRequest(res, req, customTemplate);

        // Extract context from _meta field (from STDIO proxy)
        const context = extractContextFromMeta(req);

        const createResult = await sessionService.createSession(config, context || undefined, id);
        transport = createResult.transport;

        // Log warning if session was not persisted
        if (!createResult.persisted) {
          logger.warn(`New session ${id} was created but not persisted: ${createResult.persistenceError}`);
        }
      } else {
        transport = await sessionService.getSession(sessionId);

        if (!transport) {
          // Session restoration failed - create new session with provided ID (handles proxy use case)
          logger.error(`Session restoration failed for ${sessionId}, creating new session as fallback`);

          const config = buildConfigFromRequest(res, req, customTemplate);

          // Extract context from _meta field (from STDIO proxy)
          const context = extractContextFromMeta(req);

          const createResult = await sessionService.createSession(config, context || undefined, sessionId);
          transport = createResult.transport;

          // Log warning if session was not persisted
          if (!createResult.persisted) {
            logger.warn(
              `Fallback session ${sessionId} was created but not persisted: ${createResult.persistenceError}`,
            );
          }
        }
      }

      // Wrap response to catch SDK errors
      const wrappedRes = wrapResponseForLogging(req, res);
      await transport.handleRequest(req, wrappedRes, req.body);
    } catch (error) {
      logError('HTTP error 500', {
        method: req.method,
        path: req.path,
        sessionId: req.headers['mcp-session-id'] as string | undefined,
        phase: 'handleRequest',
        error,
        headers: {
          'content-type': req.headers['content-type'],
          'user-agent': req.headers['user-agent'],
        },
      });
      res.status(500).json({
        error: {
          code: ErrorCode.InternalError,
          message: 'An internal server error occurred while processing the request',
        },
      });
    }
  });

  router.get(STREAMABLE_HTTP_ENDPOINT, ...middlewares, async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId) {
        logWarn('HTTP error 400', {
          method: req.method,
          path: req.path,
          statusCode: 400,
          reason: 'Missing sessionId header',
        });
        res.status(400).json({
          error: {
            code: ErrorCode.InvalidParams,
            message: 'Invalid params: sessionId is required',
          },
        });
        return;
      }

      const transport = await sessionService.getSession(sessionId);

      if (!transport) {
        logWarn('HTTP error 404', {
          method: req.method,
          path: req.path,
          sessionId,
          statusCode: 404,
          reason: 'Session not found',
        });
        res.status(404).json({
          error: {
            code: ErrorCode.InvalidParams,
            message: 'No active streamable HTTP session found for the provided sessionId',
          },
        });
        return;
      }

      // Set up disconnect detection for SSE stream (GET endpoint maintains persistent connection)
      setupDisconnectDetection(req, res, sessionId, serverManager);

      // Wrap response to catch SDK errors
      const wrappedRes = wrapResponseForLogging(req, res);
      await transport.handleRequest(req, wrappedRes, req.body);
    } catch (error) {
      logError('HTTP error 500', {
        method: req.method,
        path: req.path,
        sessionId: req.headers['mcp-session-id'] as string | undefined,
        statusCode: 500,
        phase: 'handleRequest',
        error,
      });
      res.status(500).json({
        error: {
          code: ErrorCode.InternalError,
          message: 'An internal server error occurred while processing the request',
        },
      });
    }
  });

  router.delete(STREAMABLE_HTTP_ENDPOINT, ...middlewares, async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId) {
        logWarn('HTTP error 400', {
          method: req.method,
          path: req.path,
          statusCode: 400,
          reason: 'Missing sessionId header',
        });
        res.status(400).json({
          error: {
            code: ErrorCode.InvalidParams,
            message: 'Invalid params: sessionId is required',
          },
        });
        return;
      }

      const transport = await sessionService.getSession(sessionId);

      if (!transport) {
        logWarn('HTTP error 404', {
          method: req.method,
          path: req.path,
          sessionId,
          statusCode: 404,
          reason: 'Session not found',
        });
        res.status(404).json({
          error: {
            code: ErrorCode.InvalidParams,
            message: 'No active streamable HTTP session found for the provided sessionId',
          },
        });
        return;
      }

      // Wrap response to catch SDK errors
      const wrappedRes = wrapResponseForLogging(req, res);
      await transport.handleRequest(req, wrappedRes);
      // Delete session from storage after explicit delete request
      await sessionService.deleteSession(sessionId);
    } catch (error) {
      logError('HTTP error 500', {
        method: req.method,
        path: req.path,
        sessionId: req.headers['mcp-session-id'] as string | undefined,
        statusCode: 500,
        phase: 'handleRequest',
        error,
      });
      res.status(500).json({
        error: {
          code: ErrorCode.InternalError,
          message: 'An internal server error occurred while processing the request',
        },
      });
    }
  });
}
