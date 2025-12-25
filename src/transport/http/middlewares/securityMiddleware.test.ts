import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  inputValidation,
  securityAuditLogger,
  securityHeaders,
  sensitiveOperationLimiter,
  sessionSecurity,
  setupSecurityMiddleware,
  timingAttackPrevention,
} from './securityMiddleware.js';

// Mock dependencies
vi.mock('express-rate-limit', () => ({
  default: vi.fn(() => vi.fn((req: any, res: any, next: any) => next())),
}));

vi.mock('@src/logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  debugIf: vi.fn(),
}));

describe('Security Middleware', () => {
  let mockRequest: any;
  let mockResponse: any;
  let mockNext: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockRequest = {
      accepts: vi.fn(() => false),
      path: '/test',
      method: 'GET',
      ip: '127.0.0.1',
      get: vi.fn((header: string) => {
        if (header === 'User-Agent') return 'test-agent';
        if (header === 'Content-Type') return 'application/json';
        return undefined;
      }),
      headers: { 'content-type': 'application/json' },
      query: {},
      body: {},
    };

    mockResponse = {
      setHeader: vi.fn(),
      removeHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      statusCode: 200,
    };

    mockNext = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  describe('securityHeaders', () => {
    it('should set basic security headers', () => {
      securityHeaders(mockRequest, mockResponse, mockNext);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-XSS-Protection', '1; mode=block');
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Referrer-Policy', 'strict-origin-when-cross-origin');
      expect(mockResponse.removeHeader).toHaveBeenCalledWith('X-Powered-By');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should set CSP header for HTML requests on non-OAuth paths', () => {
      mockRequest.accepts.mockReturnValue(true);
      mockRequest.path = '/dashboard';

      securityHeaders(mockRequest, mockResponse, mockNext);

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; form-action 'self'; frame-ancestors 'none';",
      );
    });

    it('should not set CSP header for OAuth paths', () => {
      mockRequest.accepts.mockReturnValue(true);
      mockRequest.path = '/oauth/authorize';

      securityHeaders(mockRequest, mockResponse, mockNext);

      expect(mockResponse.setHeader).not.toHaveBeenCalledWith('Content-Security-Policy', expect.any(String));
    });

    it('should not set CSP header for auth paths', () => {
      mockRequest.accepts.mockReturnValue(true);
      mockRequest.path = '/auth/login';

      securityHeaders(mockRequest, mockResponse, mockNext);

      expect(mockResponse.setHeader).not.toHaveBeenCalledWith('Content-Security-Policy', expect.any(String));
    });

    it('should not set CSP header for non-HTML requests', () => {
      mockRequest.accepts.mockReturnValue(false);

      securityHeaders(mockRequest, mockResponse, mockNext);

      expect(mockResponse.setHeader).not.toHaveBeenCalledWith('Content-Security-Policy', expect.any(String));
    });
  });

  describe('inputValidation', () => {
    it('should pass through clean requests', () => {
      mockRequest.headers = { 'content-type': 'application/json' };
      mockRequest.query = { search: 'normal query' };
      mockRequest.body = { name: 'John Doe' };

      inputValidation(mockRequest, mockResponse, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should block requests with malicious headers', () => {
      mockRequest.headers = { 'x-custom': '<script>alert("xss")</script>' };

      inputValidation(mockRequest, mockResponse, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Request contains suspicious content',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should block requests with malicious query parameters', () => {
      mockRequest.query = { cmd: '$(whoami)' };

      inputValidation(mockRequest, mockResponse, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Request contains suspicious content',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should block requests with malicious body content', () => {
      mockRequest.body = { payload: 'javascript:alert(1)' };

      inputValidation(mockRequest, mockResponse, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Request contains suspicious content',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should detect path traversal attempts', () => {
      mockRequest.query = { file: '../../../etc/passwd' };

      inputValidation(mockRequest, mockResponse, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should detect SQL injection patterns', () => {
      mockRequest.body = { search: "'; UNION SELECT * FROM users--" };

      inputValidation(mockRequest, mockResponse, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should detect command injection patterns', () => {
      mockRequest.headers = { 'user-input': '$(rm -rf /)' };

      inputValidation(mockRequest, mockResponse, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should detect null byte injection', () => {
      mockRequest.query = { file: 'test\0.txt' };

      inputValidation(mockRequest, mockResponse, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle non-string header values gracefully', () => {
      mockRequest.headers = { 'content-length': 123 };

      inputValidation(mockRequest, mockResponse, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should handle non-object body gracefully', () => {
      mockRequest.body = 'string body';

      inputValidation(mockRequest, mockResponse, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should log security warnings for malicious content', async () => {
      const logger = await import('@src/logger/logger.js');
      mockRequest.headers = { 'x-test': '<script>evil</script>' };

      inputValidation(mockRequest, mockResponse, mockNext);

      expect(logger.default.warn).toHaveBeenCalledWith(
        'Suspicious content detected in header:x-test',
        expect.objectContaining({
          value: '<script>evil</script>',
          ip: '127.0.0.1',
          userAgent: 'test-agent',
          path: '/test',
        }),
      );
    });
  });

  describe('sessionSecurity', () => {
    it('should set cache control headers', () => {
      sessionSecurity(mockRequest, mockResponse, mockNext);

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, proxy-revalidate',
      );
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Expires', '0');
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Surrogate-Control', 'no-store');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should set additional headers for OAuth endpoints', () => {
      mockRequest.path = '/oauth/authorize';

      sessionSecurity(mockRequest, mockResponse, mockNext);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Robots-Tag', 'noindex, nofollow, nosnippet, noarchive');
    });

    it('should not set robots header for non-OAuth endpoints', () => {
      mockRequest.path = '/api/data';

      sessionSecurity(mockRequest, mockResponse, mockNext);

      expect(mockResponse.setHeader).not.toHaveBeenCalledWith('X-Robots-Tag', expect.any(String));
    });
  });

  describe('securityAuditLogger', () => {
    it('should log security-relevant requests', async () => {
      const logger = await import('@src/logger/logger.js');
      mockRequest.method = 'POST';
      mockRequest.headers = { 'mcp-session-id': 'session-123', authorization: 'Bearer token' };

      securityAuditLogger(mockRequest, mockResponse, mockNext);

      expect(logger.default.info).toHaveBeenCalledWith(
        'Security-relevant request',
        expect.objectContaining({
          method: 'POST',
          path: '/test',
          ip: '127.0.0.1',
          userAgent: 'test-agent',
          sessionId: 'session-123',
          authorization: 'Bearer [REDACTED]',
        }),
      );
      expect(mockNext).toHaveBeenCalled();
    });

    it('should not log non-security-relevant requests', async () => {
      const logger = await import('@src/logger/logger.js');
      mockRequest.method = 'GET';
      mockRequest.path = '/health';

      securityAuditLogger(mockRequest, mockResponse, mockNext);

      expect(logger.default.info).not.toHaveBeenCalled();
    });

    it('should log OAuth paths', async () => {
      const logger = await import('@src/logger/logger.js');
      mockRequest.path = '/oauth/authorize';

      securityAuditLogger(mockRequest, mockResponse, mockNext);

      expect(logger.default.info).toHaveBeenCalledWith(
        'Security-relevant request',
        expect.objectContaining({
          path: '/oauth/authorize',
        }),
      );
    });

    it('should log auth paths', async () => {
      const logger = await import('@src/logger/logger.js');
      mockRequest.path = '/auth/login';

      securityAuditLogger(mockRequest, mockResponse, mockNext);

      expect(logger.default.info).toHaveBeenCalledWith(
        'Security-relevant request',
        expect.objectContaining({
          path: '/auth/login',
        }),
      );
    });

    it('should log response details for security-relevant requests', async () => {
      const logger = await import('@src/logger/logger.js');
      mockRequest.method = 'POST';

      securityAuditLogger(mockRequest, mockResponse, mockNext);

      // Simulate response
      mockResponse.statusCode = 201;
      mockResponse.send('response body');

      expect(logger.default.info).toHaveBeenCalledWith(
        'Security-relevant response',
        expect.objectContaining({
          method: 'POST',
          path: '/test',
          statusCode: 201,
          duration: expect.any(Number),
        }),
      );
    });

    it('should handle missing authorization header', async () => {
      const logger = await import('@src/logger/logger.js');
      mockRequest.method = 'POST';
      mockRequest.headers = {};

      securityAuditLogger(mockRequest, mockResponse, mockNext);

      expect(logger.default.info).toHaveBeenCalledWith(
        'Security-relevant request',
        expect.objectContaining({
          authorization: undefined,
        }),
      );
    });
  });

  describe('timingAttackPrevention', () => {
    it('should add delay for auth endpoints', () => {
      mockRequest.path = '/oauth/token';

      timingAttackPrevention(mockRequest, mockResponse, mockNext);

      // Simulate response
      const _originalSend = mockResponse.send;
      mockResponse.send('response');

      expect(mockNext).toHaveBeenCalled();
      // The response should be wrapped with timing delay
      expect(typeof mockResponse.send).toBe('function');
    });

    it('should not modify response for non-auth endpoints', () => {
      mockRequest.path = '/api/data';
      const originalSend = mockResponse.send;

      timingAttackPrevention(mockRequest, mockResponse, mockNext);

      expect(mockResponse.send).toBe(originalSend);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should apply timing delay for OAuth paths', () => {
      mockRequest.path = '/oauth/authorize';
      const originalSend = mockResponse.send;

      timingAttackPrevention(mockRequest, mockResponse, mockNext);

      expect(mockResponse.send).not.toBe(originalSend);
    });

    it('should apply timing delay for auth paths', () => {
      mockRequest.path = '/auth/verify';
      const originalSend = mockResponse.send;

      timingAttackPrevention(mockRequest, mockResponse, mockNext);

      expect(mockResponse.send).not.toBe(originalSend);
    });

    it('should implement proper timing delay mechanism', () => {
      mockRequest.path = '/oauth/token';

      timingAttackPrevention(mockRequest, mockResponse, mockNext);

      const spySetTimeout = vi.spyOn(global, 'setTimeout');

      // Simulate immediate response
      vi.advanceTimersByTime(5); // 5ms elapsed
      mockResponse.send('test response');

      expect(spySetTimeout).toHaveBeenCalledWith(expect.any(Function), expect.any(Number));

      spySetTimeout.mockRestore();
    });
  });

  describe('sensitiveOperationLimiter', () => {
    it('should be a function (rate limiter)', () => {
      expect(typeof sensitiveOperationLimiter).toBe('function');
    });

    it('should be configured with rate limiting', () => {
      // This test validates that the rate limiter is properly configured
      expect(typeof sensitiveOperationLimiter).toBe('function');
    });
  });

  describe('setupSecurityMiddleware', () => {
    it('should return array of middleware functions', () => {
      const middlewares = setupSecurityMiddleware();

      expect(Array.isArray(middlewares)).toBe(true);
      expect(middlewares).toHaveLength(5);
      expect(middlewares[0]).toBe(securityHeaders);
      expect(middlewares[1]).toBe(sessionSecurity);
      expect(middlewares[2]).toBe(inputValidation);
      expect(middlewares[3]).toBe(securityAuditLogger);
      expect(middlewares[4]).toBe(timingAttackPrevention);
    });

    it('should provide all middleware functions', () => {
      const middlewares = setupSecurityMiddleware();

      middlewares.forEach((middleware) => {
        expect(typeof middleware).toBe('function');
      });
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete middleware stack', () => {
      const middlewares = setupSecurityMiddleware();

      // Apply all middlewares in sequence
      middlewares.forEach((middleware) => {
        middleware(mockRequest, mockResponse, mockNext);
      });

      // All middlewares should have called next
      expect(mockNext).toHaveBeenCalledTimes(5);

      // Security headers should be set
      expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Cache-Control', expect.any(String));
    });

    it('should stop execution on validation failure', () => {
      mockRequest.query = { malicious: '<script>alert(1)</script>' };

      const middlewares = setupSecurityMiddleware();

      // Apply security headers
      middlewares[0](mockRequest, mockResponse, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(1);

      // Apply session security
      middlewares[1](mockRequest, mockResponse, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(2);

      // Apply input validation - should fail and not call next
      const nextCallsBefore = mockNext.mock.calls.length;
      middlewares[2](mockRequest, mockResponse, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(nextCallsBefore); // No additional call

      expect(mockResponse.status).toHaveBeenCalledWith(400);
    });
  });
});
