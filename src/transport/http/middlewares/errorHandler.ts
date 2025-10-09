import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import logger from '@src/logger/logger.js';

import { NextFunction, Request, Response } from 'express';

export default function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  logger.error('Express error:', err);
  res.status(500).json({
    error: {
      code: ErrorCode.InternalError,
      message: 'Internal server error',
    },
  });
}
