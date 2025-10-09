import { Request, Response, NextFunction } from 'express';
import logger from '@src/logger/logger.js';
import { sanitizeHeaders } from '@src/utils/validation/sanitization.js';

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
    body: req.body,
    headers: sanitizeHeaders(req.headers),
    userAgent: req.get('User-Agent'),
    ip: req.ip || req.connection.remoteAddress,
  });

  // Capture the original end method to log response details
  const originalEnd = res.end;
  res.end = function (chunk?: any, encoding?: any): Response {
    const duration = Date.now() - startTime;

    // Log response details
    logger.info(`[${req.method}] ${req.path} completed`, {
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      contentType: res.get('Content-Type'),
    });

    // Call the original end method
    return originalEnd.call(this, chunk, encoding);
  };

  next();
}
