import { randomUUID } from 'node:crypto';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { AUTH_CONFIG, MCP_SERVER_NAME, MCP_SERVER_VERSION, STREAMABLE_HTTP_ENDPOINT } from '@src/constants.js';
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
import { sendBadRequest, sendInternalError, sendNotFound } from '@src/transport/http/utils/httpErrorHandler.js';
import { SessionService } from '@src/transport/http/utils/sessionService.js';
import { logError, logWarn } from '@src/transport/http/utils/unifiedLogger.js';

import { Request, RequestHandler, Response, Router } from 'express';

/**
 * Type guard to check if a request body is an initialize request.
 */
function isInitializeRequest(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    'method' in body &&
    body.method === 'initialize' &&
    'jsonrpc' in body &&
    body.jsonrpc === '2.0'
  );
}

/**
 * Extract protocol version from initialize request body.
 * Similar to contextExtractor pattern - extract directly from req.body.params
 */
function extractProtocolVersion(body: unknown): string | null {
  try {
    const reqBody = body as {
      params?: {
        protocolVersion?: unknown;
      };
    };

    if (reqBody?.params?.protocolVersion && typeof reqBody.params.protocolVersion === 'string') {
      return reqBody.params.protocolVersion;
    }
    return null;
  } catch (error) {
    logWarn('Failed to extract protocol version from request body', {
      reason: 'Request body structure incompatible',
      context: { error },
    });
    return null;
  }
}

/**
 * Wraps an Express response to log when status >= 400 is set.
 * This catches SDK responses that don't throw errors.
 */
function wrapResponseForLogging(req: Request, res: Response, sessionId: string | undefined): Response {
  const originalStatus = res.status.bind(res);
  const originalJson = res.json.bind(res);
  let logged = false;

  const logIfNeeded = (responseBody?: unknown) => {
    if (logged || res.statusCode < 400) return;
    logged = true;

    const level = res.statusCode >= 500 ? 'error' : 'warn';
    const logFn = level === 'error' ? logError : logWarn;
    logFn(`HTTP error ${res.statusCode}`, {
      method: req.method,
      path: req.path,
      sessionId,
      statusCode: res.statusCode,
      reason: 'SDK request validation failed',
    });
    // Log request/response details at debug level for troubleshooting
    logger.debug('SDK error details', {
      sessionId,
      requestBody: req.body as unknown,
      responseBody,
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

  // Intercept res.json() to capture response body for error logging
  res.json = function (body: unknown): Response {
    if (res.statusCode >= 400) {
      logIfNeeded(body);
    }
    return originalJson(body);
  };

  // Intercept res.writeHead() - SDK uses this via Hono adapter
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */
  const origWriteHead = res.writeHead.bind(res) as (...args: any[]) => Response;
  res.writeHead = function (statusCode: number, ...rest: any[]): Response {
    if (statusCode >= 400) {
      res.statusCode = statusCode;
      logIfNeeded();
    }
    return origWriteHead(statusCode, ...rest);
  };
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */

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
      let actualSessionId: string;
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      if (!sessionId) {
        // Generate new session ID
        const id = AUTH_CONFIG.SERVER.STREAMABLE_SESSION.ID_PREFIX + randomUUID();
        actualSessionId = id;

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
        actualSessionId = sessionId;
        transport = await sessionService.getSession(sessionId);

        if (!transport) {
          // Session doesn't exist - only allow creation via initialize request
          if (isInitializeRequest(req.body)) {
            // Allow creating new session with specific ID via initialize
            logger.info(`Creating new session ${sessionId} via initialize request`);

            const config = buildConfigFromRequest(res, req, customTemplate);

            // Extract context from _meta field (from STDIO proxy)
            const context = extractContextFromMeta(req);

            const createResult = await sessionService.createSession(config, context || undefined, sessionId);
            transport = createResult.transport;

            // Log warning if session was not persisted
            if (!createResult.persisted) {
              logger.warn(`New session ${sessionId} was created but not persisted: ${createResult.persistenceError}`);
            }
          } else {
            // Non-initialize request for non-existent session → 404
            sendNotFound(res, 'Session not found. Send an initialize request first to create a new session.', {
              sessionId,
            });
            return;
          }
        }
      }

      // Wrap response to catch SDK errors
      const wrappedRes = wrapResponseForLogging(req, res, actualSessionId);

      // Check if this is an initialize request
      const isInitialize = isInitializeRequest(req.body);
      const protocolVersion = isInitialize ? extractProtocolVersion(req.body) : null;

      // Log request details for debugging restored sessions
      if (transport instanceof RestorableStreamableHTTPServerTransport && transport.isRestored()) {
        logger.debug('Handling request for restored session', {
          sessionId: actualSessionId,
          isInitialize,
          method: (req.body as { method?: string })?.method,
        });
      }

      await transport.handleRequest(req, wrappedRes, req.body);

      // After handleRequest completes for initialize, store the response data
      if (isInitialize && protocolVersion) {
        try {
          // Store minimal initialize response data for session restoration
          // The exact capabilities don't matter for restoration - we just need protocol version and server info
          sessionService.storeInitializeResponse(actualSessionId, {
            protocolVersion,
            capabilities: {}, // Minimal capabilities - actual capabilities are aggregated dynamically
            serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
          });
          logger.debug(`Stored initialize response for session ${actualSessionId}`);
        } catch (err) {
          logger.warn(`Failed to store initialize response for ${actualSessionId}:`, err);
        }
      }
    } catch (error) {
      sendInternalError(res, error, {
        method: req.method,
        path: req.path,
        sessionId: req.headers['mcp-session-id'] as string | undefined,
        phase: 'handleRequest',
      });
    }
  });

  router.get(STREAMABLE_HTTP_ENDPOINT, ...middlewares, async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId) {
        sendBadRequest(res, 'Invalid params: sessionId is required');
        return;
      }

      const transport = await sessionService.getSession(sessionId);

      if (!transport) {
        sendNotFound(res, 'No active streamable HTTP session found for the provided sessionId', { sessionId });
        return;
      }

      // Set up disconnect detection for SSE stream (GET endpoint maintains persistent connection)
      setupDisconnectDetection(req, res, sessionId, serverManager);

      // Wrap response to catch SDK errors
      const wrappedRes = wrapResponseForLogging(req, res, sessionId);
      await transport.handleRequest(req, wrappedRes, req.body);
    } catch (error) {
      sendInternalError(res, error, {
        method: req.method,
        path: req.path,
        sessionId: req.headers['mcp-session-id'] as string | undefined,
        phase: 'handleRequest',
      });
    }
  });

  router.delete(STREAMABLE_HTTP_ENDPOINT, ...middlewares, async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId) {
        sendBadRequest(res, 'Invalid params: sessionId is required');
        return;
      }

      const transport = await sessionService.getSession(sessionId);

      if (!transport) {
        sendNotFound(res, 'No active streamable HTTP session found for the provided sessionId', { sessionId });
        return;
      }

      // Wrap response to catch SDK errors
      const wrappedRes = wrapResponseForLogging(req, res, sessionId);
      await transport.handleRequest(req, wrappedRes);
      // Delete session from storage after explicit delete request
      await sessionService.deleteSession(sessionId);
    } catch (error) {
      sendInternalError(res, error, {
        method: req.method,
        path: req.path,
        sessionId: req.headers['mcp-session-id'] as string | undefined,
        phase: 'handleRequest',
      });
    }
  });
}
