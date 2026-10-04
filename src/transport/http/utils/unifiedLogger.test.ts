import logger from '@src/logger/logger.js';

import { describe, expect, it, vi } from 'vitest';

import { logError, logJsonRpc, logWarn } from './unifiedLogger.js';

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

      logError('errorHandler.express.error.037179d1', {
        error,
      });

      expect(logger.error).toHaveBeenCalledWith('errorHandler.express.error.037179d1', { error });
    });

    it('should log non-Error objects with errorType and errorContext', () => {
      const error = { code: 'TEST_ERROR', details: 'Some details' };

      logError('errorHandler.express.error.037179d1', {
        error,
      });

      expect(logger.error).toHaveBeenCalledWith('errorHandler.express.error.037179d1', { error });
    });

    it('should log string errors', () => {
      const error = 'String error message';

      logError('errorHandler.express.error.037179d1', {
        error,
      });

      expect(logger.error).toHaveBeenCalledWith('errorHandler.express.error.037179d1', { error });
    });

    it('should log number errors', () => {
      const error = 404;

      logError('errorHandler.express.error.037179d1', {
        error,
      });

      expect(logger.error).toHaveBeenCalledWith('errorHandler.express.error.037179d1', { error });
    });
  });

  describe('logJsonRpc', () => {
    it('should use error level when errorCode is present', () => {
      logJsonRpc('error', 'loggingSseTransport.json.rpc.error.response.6ba80f1a', {
        error: { code: -32700, message: 'Parse error' },
      });

      expect(logger.error).toHaveBeenCalledWith('loggingSseTransport.json.rpc.error.response.6ba80f1a', {
        error: { code: -32700, message: 'Parse error' },
      });
    });

    it('should use specified level when errorCode is absent', () => {
      logJsonRpc('info', 'server.instruction.aggregator.initialized.e753c4c6');

      expect(logger.info).toHaveBeenCalledWith('server.instruction.aggregator.initialized.e753c4c6', undefined);
    });
  });

  describe('logWarn', () => {
    it('should log warnings without error parameter', () => {
      logWarn('serve.deprecated-sse');

      expect(logger.warn).toHaveBeenCalledWith('serve.deprecated-sse', undefined);
    });
  });
});
