import express from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ServerManager } from '../serverManager.js';
import logger, { setMCPTransportConnected } from '../logger/logger.js';
import { PORT, SSE_ENDPOINT, MESSAGES_ENDPOINT, ERROR_CODES } from '../constants.js';

export class ExpressServer {
  private app: express.Application;
  private serverManager: ServerManager;

  constructor(serverManager: ServerManager) {
    this.app = express();
    this.serverManager = serverManager;
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    // Add error handling middleware
    this.app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
      logger.error('Express error:', err);
      res.status(500).json({
        error: {
          code: ERROR_CODES.INTERNAL_SERVER_ERROR,
          message: 'Internal server error',
        },
      });
    });
  }

  private setupRoutes(): void {
    this.app.get(SSE_ENDPOINT, async (req: express.Request, res: express.Response) => {
      try {
        logger.info('sse', { query: req.query, headers: req.headers });
        const transport = new SSEServerTransport(MESSAGES_ENDPOINT, res);

        // Extract and validate tags from query parameters
        let tags: string[] | undefined;
        if (req.query.tags) {
          const tagsStr = req.query.tags as string;
          if (typeof tagsStr !== 'string') {
            res.status(400).json({
              error: {
                code: ERROR_CODES.INVALID_PARAMS,
                message: 'Invalid params: tags must be a string',
              },
            });
            return;
          }
          tags = tagsStr.split(',').filter((tag) => tag.trim().length > 0);
        }

        // Connect the transport using the server manager
        await this.serverManager.connectTransport(transport, transport.sessionId, tags);

        // Update MCP transport connection status when a client connects
        if (this.serverManager.getActiveTransportsCount() === 1) {
          setMCPTransportConnected(true);
          logger.info('First client connected, enabling MCP logging transport');
        }

        transport.onclose = () => {
          this.serverManager.disconnectTransport(transport.sessionId);
          logger.info('transport closed', transport.sessionId);

          // Update MCP transport connection status when all clients disconnect
          if (this.serverManager.getActiveTransportsCount() === 0) {
            setMCPTransportConnected(false);
            logger.info('All clients disconnected, disabling MCP logging transport');
          }
        };
      } catch (error) {
        logger.error('SSE connection error:', error);
        res.status(500).end();
      }
    });

    this.app.post(MESSAGES_ENDPOINT, async (req: express.Request, res: express.Response) => {
      try {
        const sessionId = req.query.sessionId as string;
        if (!sessionId) {
          res.status(400).json({
            error: {
              code: ERROR_CODES.INVALID_PARAMS,
              message: 'Invalid params: sessionId is required',
            },
          });
          return;
        }

        logger.info('message', { body: req.body, sessionId });
        const transport = this.serverManager.getTransport(sessionId);
        if (transport instanceof SSEServerTransport) {
          await transport.handlePostMessage(req, res);
          return;
        }
        res.status(404).json({
          error: {
            code: ERROR_CODES.TRANSPORT_NOT_FOUND,
            message: 'Transport not found',
          },
        });
      } catch (error) {
        logger.error('Message handling error:', error);
        res.status(500).json({
          error: {
            code: ERROR_CODES.INTERNAL_SERVER_ERROR,
            message: 'Internal server error',
          },
        });
      }
    });
  }

  public start(): void {
    this.app.listen(PORT, () => {
      logger.info(`Server is running on port ${PORT} with HTTP/SSE transport`);
    });
  }
}
