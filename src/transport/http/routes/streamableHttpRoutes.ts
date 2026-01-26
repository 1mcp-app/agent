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
import { StreamableSessionRepository } from '@src/transport/http/storage/streamableSessionRepository.js';
import { extractContextFromMeta } from '@src/transport/http/utils/contextExtractor.js';
import { SessionService } from '@src/transport/http/utils/sessionService.js';

import { Request, RequestHandler, Response, Router } from 'express';

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
      let transport: StreamableHTTPServerTransport | null;
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

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Streamable HTTP POST error:', { error: errorMessage, sessionId: req.headers['mcp-session-id'] });
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

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Streamable HTTP GET error:', { error: errorMessage, sessionId: req.headers['mcp-session-id'] });
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
        res.status(404).json({
          error: {
            code: ErrorCode.InvalidParams,
            message: 'No active streamable HTTP session found for the provided sessionId',
          },
        });
        return;
      }

      await transport.handleRequest(req, res);
      // Delete session from storage after explicit delete request
      await sessionService.deleteSession(sessionId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Streamable HTTP DELETE error:', { error: errorMessage, sessionId: req.headers['mcp-session-id'] });
      res.status(500).json({
        error: {
          code: ErrorCode.InternalError,
          message: 'An internal server error occurred while processing the request',
        },
      });
    }
  });
}
