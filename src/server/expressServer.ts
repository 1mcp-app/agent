import { randomUUID } from 'node:crypto';
import express from 'express';
import bodyParser from 'body-parser';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ServerManager } from '../serverManager.js';
import logger from '../logger/logger.js';
import { SSE_ENDPOINT, MESSAGES_ENDPOINT, ERROR_CODES, STREAMABLE_HTTP_ENDPOINT } from '../constants.js';
import tagsExtractor from './tagsExtractor.js';
import errorHandler from './errorHandler.js';

export class ExpressServer {
  private app: express.Application;
  private serverManager: ServerManager;

  constructor(serverManager: ServerManager) {
    this.app = express();
    this.serverManager = serverManager;
    this.setupMiddleware();
    this.setupStreamableHttpRoutes();
    this.setupSseRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(bodyParser.json());

    // Add error handling middleware
    this.app.use(errorHandler);
  }

  private setupStreamableHttpRoutes(): void {
    this.app.post(STREAMABLE_HTTP_ENDPOINT, tagsExtractor, async (req: express.Request, res: express.Response) => {
      try {
        logger.info('[POST] streamable-http', { query: req.query, body: req.body, headers: req.headers });

        let transport: StreamableHTTPServerTransport;
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (!sessionId) {
          const id = randomUUID();
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => id,
          });

          // Use tags from middleware
          const tags = res.locals.tags;

          await this.serverManager.connectTransport(transport, id, tags);

          transport.onclose = () => {
            this.serverManager.disconnectTransport(id);
            logger.info('transport closed', transport.sessionId);
          };
        } else {
          const existingTransport = this.serverManager.getTransport(sessionId);
          if (existingTransport instanceof StreamableHTTPServerTransport) {
            transport = existingTransport;
          } else {
            res.status(400).json({
              error: {
                code: ERROR_CODES.INVALID_PARAMS,
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

    this.app.get(STREAMABLE_HTTP_ENDPOINT, async (req: express.Request, res: express.Response) => {
      try {
        logger.info('[GET] streamable-http', { query: req.query, headers: req.headers });
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (!sessionId) {
          res.status(400).json({
            error: {
              code: ERROR_CODES.INVALID_PARAMS,
              message: 'Invalid params: sessionId is required',
            },
          });
          return;
        }
        const transport = this.serverManager.getTransport(sessionId) as StreamableHTTPServerTransport;
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        logger.error('Streamable HTTP error:', error);
        res.status(500).end();
      }
    });

    this.app.delete(STREAMABLE_HTTP_ENDPOINT, async (req: express.Request, res: express.Response) => {
      try {
        logger.info('[DELETE] streamable-http', { query: req.query, headers: req.headers });
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (!sessionId) {
          res.status(400).json({
            error: {
              code: ERROR_CODES.INVALID_PARAMS,
              message: 'Invalid params: sessionId is required',
            },
          });
          return;
        }
        const transport = this.serverManager.getTransport(sessionId) as StreamableHTTPServerTransport;
        await transport.handleRequest(req, res);
      } catch (error) {
        logger.error('Streamable HTTP error:', error);
        res.status(500).end();
      }
    });
  }

  private setupSseRoutes(): void {
    this.app.get(SSE_ENDPOINT, tagsExtractor, async (req: express.Request, res: express.Response) => {
      try {
        logger.info('[GET] sse', { query: req.query, headers: req.headers });
        const transport = new SSEServerTransport(MESSAGES_ENDPOINT, res);

        // Use tags from middleware
        const tags = res.locals.tags;

        // Connect the transport using the server manager
        await this.serverManager.connectTransport(transport, transport.sessionId, tags);

        transport.onclose = () => {
          this.serverManager.disconnectTransport(transport.sessionId);
          logger.info('transport closed', transport.sessionId);
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
          await transport.handlePostMessage(req, res, req.body);
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

  public start(port: number, host: string): void {
    this.app.listen(port, host, () => {
      logger.info(`Server is running on port ${port} with HTTP/SSE and Streamable HTTP transport`);
    });
  }
}
