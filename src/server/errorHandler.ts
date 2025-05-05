import { NextFunction, Request, Response } from 'express';
import logger from '../logger/logger.js';
import { ERROR_CODES } from '../constants.js';

export default function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  logger.error('Express error:', err);
  res.status(500).json({
    error: {
      code: ERROR_CODES.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    },
  });
}
