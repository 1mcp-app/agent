import logger from '@src/logger/logger.js';

import { NextFunction, Request, Response } from 'express';

/** Log request lifecycle with approved numeric facts; request payloads never enter logging. */
export function httpRequestLogger(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();

  // Log the incoming request
  logger.info('httpRequestLogger.diagnostic.ed4616ea', { method: req.method });

  // Capture the original end method to log response details
  const originalEnd = res.end.bind(res);

  // Override the end method with proper typing
  // Reason: Express.js response.end() method has multiple overloads that are difficult to satisfy
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  (res as any).end = function (this: Response, ...args: any[]): Response {
    const duration = Date.now() - startTime;

    // Log response details

    logger.info('httpRequestLogger.completed.0faf4b4c', { statusCode: res.statusCode, duration });

    // Call the original end method with proper argument typing
    // Reason: Express.js end method accepts variable arguments; any is required for compatibility
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    return originalEnd.apply(this, args as any);
  };

  next();
}
