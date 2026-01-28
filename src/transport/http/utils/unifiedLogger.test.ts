import logger from '@src/logger/logger.js';

import { describe, expect, it, vi } from 'vitest';

import { logError, logJsonRpc, logWarn } from './unifiedLogger.js';

// Mock the logger module - the actual logger takes a single object parameter
vi.mock('@src/logger/logger.js', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn((_msg: string, _meta?: object) => {}),
    warn: vi.fn((_msg: string, _meta?: object) => {}),
    error: vi.fn((_msg: string, _meta?: object) => {}),
  },
}));

describe('unifiedLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('logError', () => {
    it('should log Error objects with stack traces', () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.js:10:15';

      logError('Test message', {
        method: 'POST',
        path: '/test',
        error,
      });

      expect(logger.error).toHaveBeenCalled();
    });

    it('should log non-Error objects with errorType and errorContext', () => {
      const error = { code: 'TEST_ERROR', details: 'Some details' };

      logError('Test message', {
        method: 'POST',
        path: '/test',
        error,
      });

      expect(logger.error).toHaveBeenCalled();
    });

    it('should log string errors', () => {
      const error = 'String error message';

      logError('Test message', {
        method: 'POST',
        path: '/test',
        error,
      });

      expect(logger.error).toHaveBeenCalled();
    });

    it('should log number errors', () => {
      const error = 404;

      logError('Test message', {
        method: 'POST',
        path: '/test',
        error,
      });

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('logJsonRpc', () => {
    it('should use error level when errorCode is present', () => {
      logJsonRpc('warn', 'JSON-RPC message', {
        errorCode: -32700,
        errorMessage: 'Parse error',
        sessionId: 'test-session',
      });

      expect(logger.error).toHaveBeenCalled();
    });

    it('should use specified level when errorCode is absent', () => {
      logJsonRpc('info', 'JSON-RPC message', {
        sessionId: 'test-session',
      });

      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe('logWarn', () => {
    it('should log warnings without error parameter', () => {
      logWarn('Test warning', {
        method: 'GET',
        path: '/test',
        statusCode: 400,
        reason: 'Invalid input',
      });

      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
