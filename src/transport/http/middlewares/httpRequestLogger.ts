import logger from '@src/logger/logger.js';
import { sanitizeHeaders } from '@src/utils/validation/sanitization.js';

import { NextFunction, Request, Response } from 'express';

/**
 * HTTP request logging middleware that provides comprehensive request/response logging
 *
 * Features:
 * - Logs all HTTP requests with method, URL, headers, query, and body
 * - Tracks request duration for performance monitoring
 * - Sanitizes sensitive headers for security
 * - Unified logging format replacing manual route-level logging
 *
 * @param req Express request object
 * @param res Express response object
 * @param next Express next function
 */
export function httpRequestLogger(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();

  // Log the incoming request
  logger.info(`[${req.method}] ${req.path}`, {
    query: req.query,
    body: req.body as unknown,
    headers: sanitizeHeaders(req.headers),
    userAgent: req.get('User-Agent'),
    ip: req.ip,
  });

  // Capture the original end method to log response details
  const originalEnd = res.end.bind(res);

  // Override the end method with proper typing
  // Reason: Express.js response.end() method has multiple overloads that are difficult to satisfy
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  (res as any).end = function (this: Response, ...args: any[]): Response {
    const duration = Date.now() - startTime;

    // Log response details
    const contentType = res.get('Content-Type');
    logger.info(`[${req.method}] ${req.path} completed`, {
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      contentType: Array.isArray(contentType) ? contentType.join(', ') : contentType || undefined,
    });

    // Call the original end method with proper argument typing
    // Reason: Express.js end method accepts variable arguments; any is required for compatibility
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    return originalEnd.apply(this, args as any);
  };

  next();
}
