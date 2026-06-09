import { MCP_SERVER_NAME, MCP_SERVER_VERSION, STREAMABLE_HTTP_ENDPOINT } from '@src/constants.js';
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
import { StreamableSessionRepository } from '@src/transport/http/storage/streamableSessionRepository.js';
import { StreamableSessionLifecycle, StreamableSessionStatus } from '@src/transport/http/streamableSessionLifecycle.js';
import { extractContextFromMeta } from '@src/transport/http/utils/contextExtractor.js';
import { sendBadRequest, sendInternalError, sendNotFound } from '@src/transport/http/utils/httpErrorHandler.js';
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
function setupDisconnectDetection(
  req: Request,
  res: Response,
  sessionId: string,
  lifecycle: StreamableSessionLifecycle,
): void {
  let responseClosed = false;

  // Mark response as closed when it ends normally
  res.on('finish', () => {
    responseClosed = true;
  });

  const cleanupTransport = () => {
    if (!responseClosed && !res.writableEnded) {
      logger.debug(`Client disconnected for session ${sessionId}, cleaning up transport`);
      void lifecycle.handleAbnormalDisconnect(sessionId);
    }
  };

  res.on('close', cleanupTransport);
  req.socket?.on('close', cleanupTransport);
}

export function setupStreamableHttpRoutes(
  router: Router,
  serverManager: ServerManager,
  sessionRepository: StreamableSessionRepository,
  authMiddleware: RequestHandler,
  availabilityMiddleware?: RequestHandler,
  asyncOrchestrator?: AsyncLoadingOrchestrator,
  customTemplate?: string,
  injectedLifecycle?: StreamableSessionLifecycle,
): void {
  const middlewares = [tagsExtractor, authMiddleware];

  // Add availability middleware if provided
  if (availabilityMiddleware) {
    middlewares.push(availabilityMiddleware);
  }

  const lifecycle =
    injectedLifecycle || new StreamableSessionLifecycle(serverManager, sessionRepository, asyncOrchestrator);

  router.post(STREAMABLE_HTTP_ENDPOINT, ...middlewares, async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      const isInitialize = isInitializeRequest(req.body);
      const result = await lifecycle.resolvePostSession({
        sessionId,
        isInitializeRequest: isInitialize,
        createSessionData: () => ({
          config: buildConfigFromRequest(res, req, customTemplate),
          context: extractContextFromMeta(req) || undefined,
        }),
      });

      if (result.status === StreamableSessionStatus.Missing) {
        sendNotFound(res, 'Session not found. Send an initialize request first to create a new session.', {
          sessionId: result.sessionId,
        });
        return;
      }

      if ('persisted' in result && !result.persisted) {
        logger.warn(`New session ${result.sessionId} was created but not persisted: ${result.persistenceError}`);
      }

      const actualSessionId = result.sessionId;
      const transport = result.transport;
      const wrappedRes = wrapResponseForLogging(req, res, actualSessionId);
      const protocolVersion = isInitialize ? extractProtocolVersion(req.body) : null;

      if ('isRestored' in transport && typeof transport.isRestored === 'function' && transport.isRestored()) {
        logger.debug('Handling request for restored session', {
          sessionId: actualSessionId,
          isInitialize,
          method: (req.body as { method?: string })?.method,
        });
      }

      await transport.handleRequest(req, wrappedRes, req.body);

      if (isInitialize && protocolVersion) {
        try {
          lifecycle.storeInitializeResponse(actualSessionId, {
            protocolVersion,
            capabilities: {},
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

      const result = await lifecycle.resolveExistingSession(sessionId);

      if (result.status === StreamableSessionStatus.Missing) {
        sendNotFound(res, 'No active streamable HTTP session found for the provided sessionId', { sessionId });
        return;
      }

      setupDisconnectDetection(req, res, sessionId, lifecycle);

      const wrappedRes = wrapResponseForLogging(req, res, sessionId);
      await result.transport.handleRequest(req, wrappedRes, req.body);
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

      const result = await lifecycle.resolveExistingSession(sessionId);

      if (result.status === StreamableSessionStatus.Missing) {
        sendNotFound(res, 'No active streamable HTTP session found for the provided sessionId', { sessionId });
        return;
      }

      const wrappedRes = wrapResponseForLogging(req, res, sessionId);
      await result.transport.handleRequest(req, wrappedRes);
      await lifecycle.completeExplicitDelete(sessionId);
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
