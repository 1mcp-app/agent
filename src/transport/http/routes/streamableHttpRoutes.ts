import { randomUUID } from 'node:crypto';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import { AUTH_CONFIG, STREAMABLE_HTTP_ENDPOINT } from '@src/constants.js';
import { AsyncLoadingOrchestrator } from '@src/core/capabilities/asyncLoadingOrchestrator.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { ServerStatus } from '@src/core/types/index.js';
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
import { extractContextFromHeadersOrQuery } from '@src/transport/http/utils/contextExtractor.js';
import type { ContextData } from '@src/types/context.js';

import { Request, RequestHandler, Response, Router } from 'express';

/**
 * Helper function to restore a streamable HTTP session from persistent storage
 * Uses RestorableStreamableHTTPServerTransport | RestorableStreamableHTTPServerTransport wrapper for proper initialization handling
 */
async function restoreSession(
  sessionId: string,
  serverManager: ServerManager,
  sessionRepository: StreamableSessionRepository,
  asyncOrchestrator?: AsyncLoadingOrchestrator,
): Promise<RestorableStreamableHTTPServerTransport | null> {
  try {
    // Try to retrieve session config from storage
    const sessionData = sessionRepository.get(sessionId);
    if (!sessionData) {
      logger.debug(`No persisted session found for: ${sessionId}`);
      return null;
    }

    const config = sessionData;

    logger.info(`Restoring streamable session: ${sessionId}`);

    // Create new transport with the original session ID using wrapper class
    const transport = new RestorableStreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
    });

    // Mark the transport as initialized for restored session
    // The wrapper class safely handles the SDK's internal _initialized flag
    transport.markAsInitialized();
    // Safely set sessionId if possible
    try {
      (transport as { sessionId?: string }).sessionId = sessionId;
    } catch (error) {
      logger.warn('Could not set sessionId on restored transport:', error);
    }

    // Convert config context to ContextData format if available
    const contextData = config.context
      ? {
          project: config.context.project || {},
          user: config.context.user || {},
          environment: config.context.environment || {},
          timestamp: config.context.timestamp,
          sessionId: sessionId,
          version: config.context.version,
        }
      : undefined;

    // Reconnect with the original configuration and context
    await serverManager.connectTransport(transport, sessionId, config, contextData);

    // Initialize notifications for async loading if enabled
    if (asyncOrchestrator) {
      const inboundConnection = serverManager.getServer(sessionId);
      if (inboundConnection) {
        asyncOrchestrator.initializeNotifications(inboundConnection);
        logger.debug(`Async loading notifications initialized for restored session ${sessionId}`);
      }
    }

    // Set up handlers for the restored transport
    transport.onclose = () => {
      serverManager.disconnectTransport(sessionId);
      sessionRepository.delete(sessionId);
    };

    transport.onerror = (error) => {
      logger.error(`Streamable HTTP transport error for session ${sessionId}:`, error);
      const server = serverManager.getServer(sessionId);
      if (server) {
        server.status = ServerStatus.Error;
        server.lastError = error instanceof Error ? error : new Error(String(error));
      }
    };

    // Update last accessed time with dual-trigger persistence
    sessionRepository.updateAccess(sessionId);

    logger.info(`Successfully restored streamable session: ${sessionId} (restored: ${transport.isRestored()})`);
    return transport;
  } catch (error) {
    logger.error(`Failed to restore streamable session ${sessionId}:`, error);
    return null;
  }
}

export function setupStreamableHttpRoutes(
  router: Router,
  serverManager: ServerManager,
  sessionRepository: StreamableSessionRepository,
  authMiddleware: RequestHandler,
  availabilityMiddleware?: RequestHandler,
  asyncOrchestrator?: AsyncLoadingOrchestrator,
  customTemplate?: string,
): void {
  const middlewares = [tagsExtractor, authMiddleware];

  // Add availability middleware if provided
  if (availabilityMiddleware) {
    middlewares.push(availabilityMiddleware);
  }

  router.post(STREAMABLE_HTTP_ENDPOINT, ...middlewares, async (req: Request, res: Response) => {
    try {
      let transport: StreamableHTTPServerTransport | RestorableStreamableHTTPServerTransport;
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      if (!sessionId) {
        // Generate new session ID
        const id = AUTH_CONFIG.SERVER.STREAMABLE_SESSION.ID_PREFIX + randomUUID();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => id,
        });

        // Use validated tags and tag expression from scope auth middleware
        const tags = getValidatedTags(res);
        const tagExpression = getTagExpression(res);
        const tagFilterMode = getTagFilterMode(res);
        const tagQuery = getTagQuery(res);
        const presetName = getPresetName(res);

        const config = {
          tags,
          tagExpression,
          tagFilterMode,
          tagQuery,
          presetName,
          enablePagination: req.query.pagination === 'true',
          customTemplate,
        };

        // Extract context from query parameters (proxy) or headers (direct HTTP)
        const context = extractContextFromHeadersOrQuery(req);

        if (context && context.project?.name && context.sessionId) {
          logger.info(`🔗 New session with context: ${context.project.name} (${context.sessionId})`);
        }

        // Pass context to ServerManager for template processing (only if valid)
        const validContext =
          context && context.project && context.user && context.environment ? (context as ContextData) : undefined;
        await serverManager.connectTransport(transport, id, config, validContext);

        // Persist session configuration for restoration with context
        sessionRepository.create(id, config);

        // Initialize notifications for async loading if enabled
        if (asyncOrchestrator) {
          const inboundConnection = serverManager.getServer(id);
          if (inboundConnection) {
            asyncOrchestrator.initializeNotifications(inboundConnection);
            logger.debug(`Async loading notifications initialized for Streamable HTTP session ${id}`);
          }
        }

        transport.onclose = () => {
          serverManager.disconnectTransport(id);
          sessionRepository.delete(id);
        };

        transport.onerror = (error) => {
          logger.error(`Streamable HTTP transport error for session ${id}:`, error);
          const server = serverManager.getServer(id);
          if (server) {
            server.status = ServerStatus.Error;
            server.lastError = error instanceof Error ? error : new Error(String(error));
          }
        };
      } else {
        const existingTransport = serverManager.getTransport(sessionId);
        if (!existingTransport) {
          // Extract context from query parameters (proxy) or headers (direct HTTP) for session restoration
          const context = extractContextFromHeadersOrQuery(req);

          if (context && context.project?.name && context.sessionId) {
            logger.info(`🔄 Restoring session with context: ${context.project.name} (${context.sessionId})`);
          }

          // Attempt to restore session from persistent storage
          const restoredTransport = await restoreSession(
            sessionId,
            serverManager,
            sessionRepository,
            asyncOrchestrator,
          );
          if (!restoredTransport) {
            res.status(404).json({
              error: {
                code: ErrorCode.InvalidParams,
                message: 'No active streamable HTTP session found for the provided sessionId',
              },
            });
            return;
          }
          transport = restoredTransport;
        } else if (
          existingTransport instanceof StreamableHTTPServerTransport ||
          existingTransport instanceof RestorableStreamableHTTPServerTransport
        ) {
          transport = existingTransport;
          // Update last accessed time for active sessions with dual-trigger persistence
          sessionRepository.updateAccess(sessionId);
        } else {
          res.status(400).json({
            error: {
              code: ErrorCode.InvalidParams,
              message: 'Session already exists but uses a different transport protocol',
            },
          });
          return;
        }
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error('Streamable HTTP error:', error);
      res.status(500).end();
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

      let transport = serverManager.getTransport(sessionId) as
        | StreamableHTTPServerTransport
        | RestorableStreamableHTTPServerTransport;
      if (!transport) {
        // Attempt to restore session from persistent storage
        const restoredTransport = await restoreSession(sessionId, serverManager, sessionRepository, asyncOrchestrator);
        if (!restoredTransport) {
          res.status(404).json({
            error: {
              code: ErrorCode.InvalidParams,
              message: 'No active streamable HTTP session found for the provided sessionId',
            },
          });
          return;
        }
        transport = restoredTransport;
      } else {
        // Update last accessed time for active sessions with dual-trigger persistence
        sessionRepository.updateAccess(sessionId);
      }
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error('Streamable HTTP error:', error);
      res.status(500).end();
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

      let transport = serverManager.getTransport(sessionId) as
        | StreamableHTTPServerTransport
        | RestorableStreamableHTTPServerTransport;
      if (!transport) {
        // Attempt to restore session from persistent storage
        const restoredTransport = await restoreSession(sessionId, serverManager, sessionRepository, asyncOrchestrator);
        if (!restoredTransport) {
          res.status(404).json({
            error: {
              code: ErrorCode.InvalidParams,
              message: 'No active streamable HTTP session found for the provided sessionId',
            },
          });
          return;
        }
        transport = restoredTransport;
      }
      await transport.handleRequest(req, res);
      // Delete session from storage after explicit delete request
      sessionRepository.delete(sessionId);
    } catch (error) {
      logger.error('Streamable HTTP error:', error);
      res.status(500).end();
    }
  });
}
