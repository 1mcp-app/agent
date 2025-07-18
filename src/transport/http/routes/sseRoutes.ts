import { Router, Request, Response } from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import logger from '../../../logger/logger.js';
import { SSE_ENDPOINT, MESSAGES_ENDPOINT } from '../../../constants.js';
import { ServerManager } from '../../../core/server/serverManager.js';
import tagsExtractor from '../middlewares/tagsExtractor.js';
import { createScopeAuthMiddleware, getValidatedTags } from '../middlewares/scopeAuthMiddleware.js';
import { sanitizeHeaders } from '../../../utils/sanitization.js';
import { SDKOAuthServerProvider } from '../../../auth/sdkOAuthServerProvider.js';

export function setupSseRoutes(
  router: Router,
  serverManager: ServerManager,
  oauthProvider?: SDKOAuthServerProvider,
): void {
  const scopeAuthMiddleware = createScopeAuthMiddleware(oauthProvider);
  router.get(SSE_ENDPOINT, tagsExtractor, scopeAuthMiddleware, async (req: Request, res: Response) => {
    try {
      logger.info('[GET] sse', { query: req.query, headers: sanitizeHeaders(req.headers) });
      const transport = new SSEServerTransport(MESSAGES_ENDPOINT, res);

      // Use validated tags from scope auth middleware
      const tags = getValidatedTags(res);

      // Connect the transport using the server manager
      await serverManager.connectTransport(transport, transport.sessionId, {
        tags,
        enablePagination: req.query.pagination === 'true',
      });

      transport.onclose = () => {
        serverManager.disconnectTransport(transport.sessionId);
        // Note: ServerManager already logs the disconnection
      };
    } catch (error) {
      logger.error('SSE connection error:', error);
      res.status(500).end();
    }
  });

  router.post(MESSAGES_ENDPOINT, async (req: Request, res: Response) => {
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

      logger.info('message', { body: req.body, sessionId });
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
