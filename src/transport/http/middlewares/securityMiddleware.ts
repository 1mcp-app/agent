import logger from '@src/logger/logger.js';

import { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';

/**
 * Security headers middleware to protect against common attacks
 */
export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');

  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Enable XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Prevent referrer leakage
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Content Security Policy for HTML responses (disabled for OAuth/auth paths)
  if (req.accepts('html') && !req.path.includes('/oauth/') && !req.path.includes('/auth/')) {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; form-action 'self'; frame-ancestors 'none';",
    );
  }

  // Remove server information
  res.removeHeader('X-Powered-By');

  next();
}

/**
 * Rate limiter for sensitive operations (stricter than general OAuth)
 */
export const sensitiveOperationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'rate_limit_exceeded',
    error_description: 'Too many sensitive operations. Please try again later.',
  },
  skip: (req: Request) => {
    // Skip rate limiting for health checks or non-sensitive endpoints
    return req.path === '/health' || req.path === '/';
  },
  handler: (req: Request, res: Response) => {
    logger.warn(`Rate limit exceeded for sensitive operation`, {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path,
      method: req.method,
      timestamp: new Date().toISOString(),
    });

    res.status(429).json({
      error: 'rate_limit_exceeded',
      error_description: 'Too many sensitive operations. Please try again later.',
    });
  },
});

/**
 * Enhanced input validation middleware
 */
export function inputValidation(req: Request, res: Response, next: NextFunction): void {
  // Check for common injection patterns in headers
  const suspiciousPatterns = [
    /\$\(.*\)/, // Command injection
    /<script[\s\S]*?>/i, // XSS - matches across newlines
    /javascript:/i, // JavaScript protocol
    /\.\./, // Path traversal
    /\0/, // Null byte injection
    /union.*select/i, // SQL injection
    /exec\s*\(/i, // Code execution
  ];

  const checkForMaliciousContent = (value: string, location: string): boolean => {
    return suspiciousPatterns.some((pattern) => {
      if (pattern.test(value)) {
        logger.warn(`Suspicious content detected in ${location}`, {
          value: value.substring(0, 100), // Log only first 100 chars
          pattern: pattern.toString(),
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          path: req.path,
          timestamp: new Date().toISOString(),
        });
        return true;
      }
      return false;
    });
  };

  // Check headers
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string' && checkForMaliciousContent(value, `header:${key}`)) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'Request contains suspicious content',
      });
      return;
    }
  }

  // Check query parameters
  for (const [key, value] of Object.entries(req.query)) {
    if (typeof value === 'string' && checkForMaliciousContent(value, `query:${key}`)) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'Request contains suspicious content',
      });
      return;
    }
  }

  // Check body for POST requests
  if (req.body && typeof req.body === 'object') {
    for (const [key, value] of Object.entries(req.body)) {
      if (typeof value === 'string' && checkForMaliciousContent(value, `body:${key}`)) {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'Request contains suspicious content',
        });
        return;
      }
    }
  }

  next();
}

/**
 * Session security middleware
 */
export function sessionSecurity(req: Request, res: Response, next: NextFunction): void {
  // Add security-related headers for session management
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');

  // For OAuth endpoints, add additional security
  if (req.path.includes('/oauth/')) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, nosnippet, noarchive');
  }

  next();
}

/**
 * Request logging middleware for security audit trail
 */
export function securityAuditLogger(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();

  // Log high-value security events
  const isSecurityRelevant =
    req.path.includes('/oauth/') ||
    req.path.includes('/auth/') ||
    req.method === 'POST' ||
    req.method === 'PUT' ||
    req.method === 'DELETE';

  if (isSecurityRelevant) {
    logger.info('Security-relevant request', {
      method: req.method,
      path: req.path,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      contentType: req.get('Content-Type'),
      timestamp: new Date().toISOString(),
      sessionId: req.headers['mcp-session-id'] as string | undefined,
      authorization: req.headers.authorization ? 'Bearer [REDACTED]' : undefined,
    });
  }

  // Capture response details
  const originalSend = res.send;
  res.send = function (body: any) {
    const duration = Date.now() - startTime;

    if (isSecurityRelevant) {
      logger.info('Security-relevant response', {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration,
        ip: req.ip,
        timestamp: new Date().toISOString(),
      });
    }

    return originalSend.call(this, body);
  };

  next();
}

/**
 * Prevent common timing attacks
 */
export function timingAttackPrevention(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();

  // Add random delay for authentication-related endpoints to prevent timing attacks
  const isAuthEndpoint = req.path.includes('/oauth/') || req.path.includes('/auth/');

  if (isAuthEndpoint) {
    // Add random delay between 10-50ms to make timing attacks harder
    const randomDelay = Math.floor(Math.random() * 40) + 10;

    const originalSend = res.send;
    res.send = function (body: any) {
      const elapsed = Date.now() - startTime;
      const remainingDelay = Math.max(0, randomDelay - elapsed);

      setTimeout(() => {
        return originalSend.call(this, body);
      }, remainingDelay);

      return this;
    };
  }

  next();
}

/**
 * Comprehensive security middleware stack
 */
export function setupSecurityMiddleware() {
  return [securityHeaders, sessionSecurity, inputValidation, securityAuditLogger, timingAttackPrevention];
}
