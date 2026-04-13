import { ToolInvokeOutput, ToolListOutput } from '@src/core/capabilities/schemas/metaToolSchemas.js';
import { ServerManager } from '@src/core/server/serverManager.js';
import logger from '@src/logger/logger.js';

import { Request, RequestHandler, Response } from 'express';

import { parseTarget } from './inspectRoutes.js';

export function createToolsHandler(serverManager: ServerManager): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const lazyOrchestrator = serverManager.getLazyLoadingOrchestrator();
      if (!lazyOrchestrator) {
        res.status(503).json({ error: 'Tool listing not available' });
        return;
      }

      const server = typeof req.query.server === 'string' ? req.query.server : undefined;
      const pattern = typeof req.query.pattern === 'string' ? req.query.pattern : undefined;
      const limitParam = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;
      const limit = limitParam !== undefined && Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined;
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;

      const result = (await lazyOrchestrator.callMetaTool('tool_list', {
        server,
        pattern,
        limit,
        cursor,
      })) as ToolListOutput;

      if (result.error) {
        const status = result.error.type === 'validation' ? 400 : result.error.type === 'not_found' ? 404 : 500;
        res.status(status).json({ error: result.error.message });
        return;
      }

      res.json(result);
    } catch (error) {
      logger.error('API tools handler error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

export function createToolInvocationsHandler(serverManager: ServerManager): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body as unknown;
      if (
        !body ||
        typeof body !== 'object' ||
        !('tool' in body) ||
        typeof (body as Record<string, unknown>).tool !== 'string'
      ) {
        res.status(400).json({ error: 'Request body must include a "tool" field as a string.' });
        return;
      }

      const toolRef = (body as Record<string, unknown>).tool as string;
      const args = (body as Record<string, unknown>).args;
      const toolArgs =
        args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {};

      const target = parseTarget(toolRef);
      if (!target || target.kind !== 'tool') {
        res.status(400).json({ error: 'Invalid tool reference. Use "server/tool" format.' });
        return;
      }

      const lazyOrchestrator = serverManager.getLazyLoadingOrchestrator();
      if (!lazyOrchestrator) {
        res.status(503).json({ error: 'Tool invocation not available' });
        return;
      }

      const result = (await lazyOrchestrator.callMetaTool('tool_invoke', {
        server: target.serverName,
        toolName: target.toolName,
        args: toolArgs,
      })) as ToolInvokeOutput;

      if (result.error) {
        let status: number;
        if (result.error.type === 'validation') {
          status = 400;
        } else if (result.error.type === 'not_found') {
          status = 404;
        } else if (result.error.type === 'upstream' && result.error.message.toLowerCase().includes('not connected')) {
          status = 503;
        } else if (result.error.type === 'upstream') {
          status = 502;
        } else {
          status = 500;
        }
        res.status(status).json({ error: result.error.message });
        return;
      }

      res.json(result);
    } catch (error) {
      logger.error('API tool-invocations handler error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
