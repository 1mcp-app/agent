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
export interface SensitiveOperationRateLimitPolicy {
  windowMs: number;
  maxRequests: number;
}

export const DEFAULT_SENSITIVE_OPERATION_RATE_LIMIT_POLICY: SensitiveOperationRateLimitPolicy = {
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
};

export function createSensitiveOperationLimiter(
  policy: SensitiveOperationRateLimitPolicy = DEFAULT_SENSITIVE_OPERATION_RATE_LIMIT_POLICY,
) {
  return rateLimit({
    windowMs: policy.windowMs,
    max: policy.maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'rate_limit_exceeded',
      error_description: 'Too many sensitive operations. Please try again later.',
    },
    skip: (req: Request) => {
      // Skip rate limiting for health checks or non-sensitive endpoints.
      return req.path === '/health' || req.path === '/';
    },
    handler: (req: Request, res: Response) => {
      logger.warn('securityMiddleware.rate.limit.exceeded.for.sensitive.operation.a7edd8d0');

      res.status(429).json({
        error: 'rate_limit_exceeded',
        error_description: 'Too many sensitive operations. Please try again later.',
      });
    },
  });
}

// OAuth consent retains its fixed policy. Admin routes construct a separate,
// startup-captured limiter so the two surfaces never share process-local state.
export const sensitiveOperationLimiter = createSensitiveOperationLimiter();

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

  const checkForMaliciousContent = (value: string, _location: string): boolean => {
    return suspiciousPatterns.some((pattern) => {
      if (pattern.test(value)) {
        logger.warn('securityMiddleware.suspicious.content.detected.in.ead2ecd1');
        return true;
      }
      return false;
    });
  };

  // Check headers
  for (const [key, value] of Object.entries(req.headers as Record<string, unknown>)) {
    if (typeof value === 'string' && checkForMaliciousContent(value, `header:${key}`)) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'Request contains suspicious content',
      });
      return;
    }
  }

  // Check query parameters
  for (const [key, value] of Object.entries(req.query as Record<string, unknown>)) {
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
    for (const [key, value] of Object.entries(req.body as Record<string, unknown>)) {
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
    logger.info('securityMiddleware.security.relevant.request.0633a217', { method: req.method });
  }

  // Capture response details
  const originalSend = res.send.bind(res);
  res.send = function (this: Response, body: unknown) {
    if (isSecurityRelevant) {
      logger.info('securityMiddleware.security.relevant.response.9de4a676', {
        statusCode: res.statusCode,
        duration: Date.now() - startTime,
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
    const randomDelay = Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] / 4294967295) * 40) + 10;

    const originalSend = res.send.bind(res);
    res.send = function (this: Response, body: unknown) {
      const elapsed = Date.now() - startTime;
      const remainingDelay = Math.max(0, randomDelay - elapsed);

      setTimeout(() => {
        return originalSend.call(this, body);
      }, remainingDelay);

      return res;
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
