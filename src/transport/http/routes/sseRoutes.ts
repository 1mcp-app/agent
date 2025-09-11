import { Router, Request, Response } from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import logger from '../../../logger/logger.js';
import { SSE_ENDPOINT, MESSAGES_ENDPOINT } from '../../../constants.js';
import { ServerManager } from '../../../core/server/serverManager.js';
import { ServerStatus } from '../../../core/types/index.js';
import { AsyncLoadingOrchestrator } from '../../../core/capabilities/asyncLoadingOrchestrator.js';
import tagsExtractor from '../middlewares/tagsExtractor.js';
import {
  getValidatedTags,
  getTagExpression,
  getTagFilterMode,
  getTagQuery,
  getPresetName,
} from '../middlewares/scopeAuthMiddleware.js';

export function setupSseRoutes(
  router: Router,
  serverManager: ServerManager,
  authMiddleware: any,
  availabilityMiddleware?: any,
  asyncOrchestrator?: AsyncLoadingOrchestrator,
): void {
  const middlewares = [tagsExtractor, authMiddleware];

  // Add availability middleware if provided
  if (availabilityMiddleware) {
    middlewares.push(availabilityMiddleware);
  }

  router.get(SSE_ENDPOINT, ...middlewares, async (req: Request, res: Response) => {
    try {
      const transport = new SSEServerTransport(MESSAGES_ENDPOINT, res);

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
      });

      // Initialize notifications for async loading if enabled
      if (asyncOrchestrator) {
        const inboundConnection = serverManager.getServer(transport.sessionId);
        if (inboundConnection) {
          asyncOrchestrator.initializeNotifications(inboundConnection);
          logger.debug(`Async loading notifications initialized for SSE session ${transport.sessionId}`);
        }
      }

      transport.onclose = () => {
        serverManager.disconnectTransport(transport.sessionId);
        // Note: ServerManager already logs the disconnection
      };

      transport.onerror = (error) => {
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
