import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import logger from '@src/logger/logger.js';

import { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import errorHandler from './errorHandler.js';

// Mock logger
vi.mock('@src/logger/logger.ts', () => ({
  default: {
    error: vi.fn(),
  },
}));

describe('errorHandler', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRequest = {
      method: 'GET',
      url: '/test',
      headers: {},
    };

    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    mockNext = vi.fn() as any;
  });

  describe('error handling', () => {
    it('should log the error', () => {
      const error = new Error('Test error');

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(logger.error).toHaveBeenCalledWith('Express error:', error);
    });

    it('should return 500 status code', () => {
      const error = new Error('Test error');

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
    });

    it('should return standardized error response', () => {
      const error = new Error('Test error');

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.InternalError,
          message: 'Internal server error',
        },
      });
    });

    it('should handle errors without message', () => {
      const error = new Error();

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(logger.error).toHaveBeenCalledWith('Express error:', error);
      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.InternalError,
          message: 'Internal server error',
        },
      });
    });

    it('should handle different error types', () => {
      const error = new TypeError('Type error');

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(logger.error).toHaveBeenCalledWith('Express error:', error);
      expect(mockResponse.status).toHaveBeenCalledWith(500);
    });

    it('should handle custom error objects', () => {
      const error = {
        name: 'CustomError',
        message: 'Custom error message',
        stack: 'Error stack trace',
      } as Error;

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(logger.error).toHaveBeenCalledWith('Express error:', error);
      expect(mockResponse.status).toHaveBeenCalledWith(500);
    });

    it('should not call next function', () => {
      const error = new Error('Test error');

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('request context', () => {
    it('should handle errors for different HTTP methods', () => {
      const error = new Error('Test error');
      mockRequest.method = 'POST';

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(logger.error).toHaveBeenCalledWith('Express error:', error);
      expect(mockResponse.status).toHaveBeenCalledWith(500);
    });

    it('should handle errors for different URLs', () => {
      const error = new Error('Test error');
      mockRequest.url = '/api/test';

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(logger.error).toHaveBeenCalledWith('Express error:', error);
      expect(mockResponse.status).toHaveBeenCalledWith(500);
    });

    it('should handle errors with request headers', () => {
      const error = new Error('Test error');
      mockRequest.headers = {
        'content-type': 'application/json',
        authorization: 'Bearer token',
      };

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(logger.error).toHaveBeenCalledWith('Express error:', error);
      expect(mockResponse.status).toHaveBeenCalledWith(500);
    });
  });

  describe('response handling', () => {
    it('should chain response methods correctly', () => {
      const error = new Error('Test error');

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveReturnedWith(mockResponse);
      expect(mockResponse.json).toHaveBeenCalledTimes(1);
    });

    it('should handle response method failures gracefully', () => {
      const error = new Error('Test error');
      mockResponse.status = vi.fn().mockImplementation(() => {
        throw new Error('Response status failed');
      });

      expect(() => {
        errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);
      }).toThrow('Response status failed');

      expect(logger.error).toHaveBeenCalledWith('Express error:', error);
    });

    it('should use correct MCP error code', () => {
      const error = new Error('Test error');

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.InternalError,
          message: 'Internal server error',
        },
      });
    });
  });

  describe('error types', () => {
    it('should handle syntax errors', () => {
      const error = new SyntaxError('Invalid JSON');

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(logger.error).toHaveBeenCalledWith('Express error:', error);
      expect(mockResponse.status).toHaveBeenCalledWith(500);
    });

    it('should handle reference errors', () => {
      const error = new ReferenceError('Variable not defined');

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(logger.error).toHaveBeenCalledWith('Express error:', error);
      expect(mockResponse.status).toHaveBeenCalledWith(500);
    });

    it('should handle range errors', () => {
      const error = new RangeError('Value out of range');

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(logger.error).toHaveBeenCalledWith('Express error:', error);
      expect(mockResponse.status).toHaveBeenCalledWith(500);
    });
  });

  describe('integration', () => {
    it('should maintain consistent error response format', () => {
      const errors = [
        new Error('Generic error'),
        new TypeError('Type error'),
        new SyntaxError('Syntax error'),
        new RangeError('Range error'),
      ];

      errors.forEach((error) => {
        vi.clearAllMocks();

        errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

        expect(mockResponse.json).toHaveBeenCalledWith({
          error: {
            code: ErrorCode.InternalError,
            message: 'Internal server error',
          },
        });
      });
    });

    it('should not expose internal error details to client', () => {
      const error = new Error('Internal database connection failed');

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.InternalError,
          message: 'Internal server error', // Generic message, not the actual error
        },
      });
    });
  });
});
