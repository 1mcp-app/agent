import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  formatErrorResponse,
  getErrorCause,
  getErrorCode,
  getErrorMessage,
  isMCPError,
  normalizeError,
  withErrorHandling,
} from './errorHandling.js';
import { InvalidRequestError, MCPError } from './errorTypes.js';

// Mock the logger
vi.mock('@src/logger/logger.js', () => ({
  default: {
    error: vi.fn(),
  },
  debugIf: vi.fn(),
}));

describe('withErrorHandling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return successful function result', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const wrappedFn = withErrorHandling(fn, 'Test operation');

    const result = await wrappedFn('arg1', 'arg2');

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
  });

  it('should rethrow MCPError as-is', async () => {
    const mcpError = new MCPError('MCP Error', ErrorCode.InvalidRequest);
    const fn = vi.fn().mockRejectedValue(mcpError);
    const wrappedFn = withErrorHandling(fn, 'Test operation');

    await expect(wrappedFn()).rejects.toThrow(mcpError);
  });

  it('should convert regular Error to MCPError', async () => {
    const originalError = new Error('Original error');
    const fn = vi.fn().mockRejectedValue(originalError);
    const wrappedFn = withErrorHandling(fn, 'Test operation');

    await expect(wrappedFn()).rejects.toThrow(MCPError);
    await expect(wrappedFn()).rejects.toThrow('Test operation');

    try {
      await wrappedFn();
    } catch (error) {
      expect(error).toBeInstanceOf(MCPError);
      expect((error as MCPError).code).toBe(ErrorCode.InternalError);
      expect(((error as MCPError).data as any)?.originalError).toBe(originalError);
    }
  });

  it('should convert non-Error objects to MCPError', async () => {
    const fn = vi.fn().mockRejectedValue('string error');
    const wrappedFn = withErrorHandling(fn, 'Test operation');

    await expect(wrappedFn()).rejects.toThrow(MCPError);
    await expect(wrappedFn()).rejects.toThrow('Test operation');

    try {
      await wrappedFn();
    } catch (error) {
      expect(error).toBeInstanceOf(MCPError);
      expect(((error as MCPError).data as any)?.originalError).toBeInstanceOf(Error);
      expect(((error as MCPError).data as any)?.originalError.message).toBe('string error');
    }
  });

  it('should preserve function arguments and return type', async () => {
    const fn = vi.fn().mockImplementation((a: string, b: number) => Promise.resolve(`${a}${b}`));
    const wrappedFn = withErrorHandling(fn, 'Test operation');

    const result = await wrappedFn('test', 42);

    expect(result).toBe('test42');
    expect(fn).toHaveBeenCalledWith('test', 42);
  });
});

describe('normalizeError', () => {
  it('should return MCPError as-is', () => {
    const mcpError = new MCPError('MCP Error', ErrorCode.InvalidRequest);
    const result = normalizeError(mcpError, 'fallback message');

    expect(result).toBe(mcpError);
  });

  it('should convert regular Error to MCPError', () => {
    const originalError = new Error('Original error');
    const result = normalizeError(originalError, 'fallback message');

    expect(result).toBeInstanceOf(MCPError);
    expect((result as MCPError).message).toBe('Original error');
    expect((result as MCPError).code).toBe(ErrorCode.InternalError);
  });

  it('should use fallback message for Error with empty message', () => {
    const originalError = new Error('');
    const result = normalizeError(originalError, 'fallback message');

    expect(result).toBeInstanceOf(MCPError);
    expect((result as MCPError).message).toBe('fallback message');
    expect((result as MCPError).code).toBe(ErrorCode.InternalError);
  });

  it('should convert non-Error objects to MCPError', () => {
    const result = normalizeError('string error', 'fallback message');

    expect(result).toBeInstanceOf(MCPError);
    expect((result as MCPError).message).toBe('fallback message');
    expect((result as MCPError).code).toBe(ErrorCode.InternalError);
  });

  it('should handle null and undefined', () => {
    const resultNull = normalizeError(null, 'fallback message');
    const resultUndefined = normalizeError(undefined, 'fallback message');

    expect(resultNull).toBeInstanceOf(MCPError);
    expect((resultNull as MCPError).message).toBe('fallback message');
    expect(resultUndefined).toBeInstanceOf(MCPError);
    expect((resultUndefined as MCPError).message).toBe('fallback message');
  });
});

describe('isMCPError', () => {
  it('should return true for matching MCP error types', () => {
    const mcpError = new MCPError('MCP Error', ErrorCode.InvalidRequest);
    const invalidRequestError = new InvalidRequestError('Invalid request');

    expect(isMCPError(mcpError, MCPError)).toBe(true);
    expect(isMCPError(invalidRequestError, InvalidRequestError)).toBe(true);
    expect(isMCPError(invalidRequestError, MCPError)).toBe(true);
  });

  it('should return false for non-matching error types', () => {
    const regularError = new Error('Regular error');
    const mcpError = new MCPError('MCP Error', ErrorCode.InvalidRequest);

    expect(isMCPError(regularError, MCPError)).toBe(false);
    expect(isMCPError(mcpError, InvalidRequestError)).toBe(false);
    expect(isMCPError('string error', MCPError)).toBe(false);
    expect(isMCPError(null, MCPError)).toBe(false);
  });
});

describe('getErrorCode', () => {
  it('should return code from MCPError', () => {
    const mcpError = new MCPError('MCP Error', ErrorCode.InvalidRequest);
    expect(getErrorCode(mcpError)).toBe(ErrorCode.InvalidRequest);
  });

  it('should return InternalError for non-MCP errors', () => {
    const regularError = new Error('Regular error');
    expect(getErrorCode(regularError)).toBe(ErrorCode.InternalError);
    expect(getErrorCode('string error')).toBe(ErrorCode.InternalError);
    expect(getErrorCode(null)).toBe(ErrorCode.InternalError);
  });
});

describe('getErrorMessage', () => {
  it('should return message from Error objects', () => {
    const error = new Error('Error message');
    expect(getErrorMessage(error)).toBe('Error message');
  });

  it('should return message from MCPError', () => {
    const mcpError = new MCPError('MCP Error', ErrorCode.InvalidRequest);
    expect(getErrorMessage(mcpError)).toBe('MCP Error');
  });

  it('should convert non-Error objects to string', () => {
    expect(getErrorMessage('string error')).toBe('string error');
    expect(getErrorMessage(123)).toBe('123');
    expect(getErrorMessage(null)).toBe('null');
    expect(getErrorMessage(undefined)).toBe('undefined');
    expect(getErrorMessage({})).toBe('[object Object]');
  });
});

describe('getErrorCause', () => {
  it('should return cause from Error with cause', () => {
    const cause = new Error('Cause error');
    const error = new Error('Main error') as any;
    error.cause = cause;
    expect(getErrorCause(error)).toBe(cause);
  });

  it('should return undefined for Error without cause', () => {
    const error = new Error('Error without cause');
    expect(getErrorCause(error)).toBeUndefined();
  });

  it('should return undefined for non-Error objects', () => {
    expect(getErrorCause('string error')).toBeUndefined();
    expect(getErrorCause(null)).toBeUndefined();
    expect(getErrorCause({})).toBeUndefined();
  });

  it('should handle Error with non-Error cause', () => {
    const error = new Error('Main error') as any;
    error.cause = 'string cause';
    expect(getErrorCause(error)).toBe('string cause');
  });
});

describe('formatErrorResponse', () => {
  it('should format MCPError correctly', () => {
    const mcpError = new MCPError('MCP Error', ErrorCode.InvalidRequest, { extra: 'data' });
    const result = formatErrorResponse(mcpError);

    expect(result).toEqual({
      code: ErrorCode.InvalidRequest,
      message: 'MCP Error',
      data: { extra: 'data' },
    });
  });

  it('should format MCPError without data', () => {
    const mcpError = new MCPError('MCP Error', ErrorCode.InvalidRequest);
    const result = formatErrorResponse(mcpError);

    expect(result).toEqual({
      code: ErrorCode.InvalidRequest,
      message: 'MCP Error',
      data: undefined,
    });
  });

  it('should format regular Error as internal error', () => {
    const error = new Error('Regular error');
    const result = formatErrorResponse(error);

    expect(result).toEqual({
      code: ErrorCode.InternalError,
      message: 'Regular error',
    });
  });

  it('should format non-Error objects as internal error', () => {
    const result = formatErrorResponse('string error');

    expect(result).toEqual({
      code: ErrorCode.InternalError,
      message: 'string error',
    });
  });

  it('should handle null and undefined', () => {
    const resultNull = formatErrorResponse(null);
    const resultUndefined = formatErrorResponse(undefined);

    expect(resultNull).toEqual({
      code: ErrorCode.InternalError,
      message: 'null',
    });

    expect(resultUndefined).toEqual({
      code: ErrorCode.InternalError,
      message: 'undefined',
    });
  });

  it('should handle objects', () => {
    const result = formatErrorResponse({ error: 'custom error' });

    expect(result).toEqual({
      code: ErrorCode.InternalError,
      message: '[object Object]',
    });
  });
});
