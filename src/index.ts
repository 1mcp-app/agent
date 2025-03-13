#!/usr/bin/env node

import express from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

import { server } from './server.js';
import logger from './logger.js';
import { PORT, SSE_ENDPOINT, MESSAGES_ENDPOINT, ERROR_CODES } from './constants.js';

const app = express();

// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));

const transportMap = new Map<string, SSEServerTransport>();

// Add error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error('Express error:', err);
    res.status(500).json({
        error: {
            code: ERROR_CODES.INTERNAL_SERVER_ERROR,
            message: 'Internal server error',
        },
    });
});

app.get(SSE_ENDPOINT, async (req: express.Request, res: express.Response) => {
    try {
        logger.info('sse', { query: req.query, headers: req.headers });
        const transport = new SSEServerTransport(MESSAGES_ENDPOINT, res);
        await server.connect(transport);
        transportMap.set(transport.sessionId, transport);
        transport.onclose = () => {
            transportMap.delete(transport.sessionId);
            logger.info('transport closed', transport.sessionId);
        };
    } catch (error) {
        logger.error('SSE connection error:', error);
        res.status(500).end();
    }
});

app.post(MESSAGES_ENDPOINT, async (req: express.Request, res: express.Response) => {
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
        const transport = transportMap.get(sessionId);
        if (transport) {
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

/**
 * Start the server using stdio transport.
 * This allows the server to communicate via standard input/output streams.
 */
async function main() {
    // const transport = new StdioServerTransport();
    // await server.connect(transport);
    app.listen(PORT, () => {
        logger.info(`Server is running on port ${PORT}`);
    });
}

main().catch((error) => {
    logger.error('Server error:', error);
    process.exit(1);
});
