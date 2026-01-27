import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import { MESSAGES_ENDPOINT, SSE_ENDPOINT } from '@src/constants.js';
import { AsyncLoadingOrchestrator } from '@src/core/capabilities/asyncLoadingOrchestrator.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import { ServerStatus } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';
import { LoggingSSEServerTransport } from '@src/transport/http/loggingSseTransport.js';
import {
  getPresetName,
  getTagExpression,
  getTagFilterMode,
  getTagQuery,
  getValidatedTags,
} from '@src/transport/http/middlewares/scopeAuthMiddleware.js';
import tagsExtractor from '@src/transport/http/middlewares/tagsExtractor.js';

import { Request, RequestHandler, Response, Router } from 'express';

export function setupSseRoutes(
  router: Router,
  serverManager: ServerManager,
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

  router.get(SSE_ENDPOINT, ...middlewares, async (req: Request, res: Response) => {
    try {
      const transport = new LoggingSSEServerTransport(MESSAGES_ENDPOINT, res);

      // Use validated tags and tag expression from scope auth middleware
      const tags = getValidatedTags(res);
      const tagExpression = getTagExpression(res);
      const tagFilterMode = getTagFilterMode(res);
      const tagQuery = getTagQuery(res);
      const presetName = getPresetName(res);

      // Connect the transport using the server manager
      await serverManager.connectTransport(transport, transport.sessionId, {
        tags,
        tagExpression,
        tagFilterMode,
        tagQuery,
        presetName,
        enablePagination: req.query.pagination === 'true',
        customTemplate,
      });

      // Initialize notifications for async loading if enabled
      if (asyncOrchestrator) {
        const inboundConnection = serverManager.getServer(transport.sessionId);
        if (inboundConnection) {
          asyncOrchestrator.initializeNotifications(inboundConnection);
          logger.debug(`Async loading notifications initialized for SSE session ${transport.sessionId}`);
        }
      }

      // Set up heartbeat to detect disconnected clients
      const heartbeatInterval = setInterval(() => {
        try {
          // Send a comment as heartbeat (SSE clients ignore comments)
          res.write(': heartbeat\n\n');
        } catch (_error) {
          // If write fails, the connection is likely broken
          logger.debug(`SSE heartbeat failed for session ${transport.sessionId}, closing connection`);
          clearInterval(heartbeatInterval);
          serverManager.disconnectTransport(transport.sessionId);
        }
      }, 30000); // Send heartbeat every 30 seconds

      transport.onclose = () => {
        clearInterval(heartbeatInterval);
        serverManager.disconnectTransport(transport.sessionId);
        // Note: ServerManager already logs the disconnection
      };

      transport.onerror = (error) => {
        clearInterval(heartbeatInterval);
        logger.error(`SSE transport error for session ${transport.sessionId}:`, error);
        const server = serverManager.getServer(transport.sessionId);
        if (server) {
          server.status = ServerStatus.Error;
          server.lastError = error instanceof Error ? error : new Error(String(error));
        }
      };
    } catch (error) {
      logger.error('SSE connection error:', error);
      res.status(500).end();
    }
  });

  router.post(MESSAGES_ENDPOINT, ...middlewares, async (req: Request, res: Response) => {
    try {
      const sessionId = req.query.sessionId as string;
      if (!sessionId) {
        res.status(400).json({
          error: {
            code: ErrorCode.InvalidParams,
            message: 'Invalid params: sessionId is required',
          },
        });
        return;
      }

      const transport = serverManager.getTransport(sessionId);

      if (transport instanceof SSEServerTransport) {
        await transport.handlePostMessage(req, res, req.body);
        return;
      }

      res.status(404).json({
        error: {
          code: ErrorCode.InvalidParams,
          message: 'Transport not found',
        },
      });
    } catch (error) {
      logger.error('Message handling error:', error);
      res.status(500).json({
        error: {
          code: ErrorCode.InternalError,
          message: 'Internal server error',
        },
      });
    }
  });
}
