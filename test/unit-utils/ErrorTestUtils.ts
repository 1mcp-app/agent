import { ClientConnectionError, ClientNotFoundError, MCPError, ValidationError } from '@src/utils/core/errorTypes.js';

import { expect, vi } from 'vitest';

/**
 * Utilities for testing error handling and error scenarios
 */
export class ErrorTestUtils {
  /**
   * Test that a function throws a specific error type
   */
  static expectThrows<T extends Error>(
    fn: () => any,
    errorType: new (...args: any[]) => T,
    message?: string | RegExp,
  ): void {
    let thrownError: Error | undefined;

    try {
      fn();
    } catch (_error) {
      thrownError = _error as Error;
    }

    expect(thrownError).toBeDefined();
    expect(thrownError).toBeInstanceOf(errorType);

    if (message) {
      if (typeof message === 'string') {
        expect(thrownError!.message).toContain(message);
      } else {
        expect(thrownError!.message).toMatch(message);
      }
    }
  }

  /**
   * Test that an async function throws a specific error type
   */
  static async expectAsyncThrows<T extends Error>(
    fn: () => Promise<any>,
    errorType: new (...args: any[]) => T,
    message?: string | RegExp,
  ): Promise<void> {
    let thrownError: Error | undefined;

    try {
      await fn();
    } catch (_error) {
      thrownError = _error as Error;
    }

    expect(thrownError).toBeDefined();
    expect(thrownError).toBeInstanceOf(errorType);

    if (message) {
      if (typeof message === 'string') {
        expect(thrownError!.message).toContain(message);
      } else {
        expect(thrownError!.message).toMatch(message);
      }
    }
  }

  /**
   * Test that a function does not throw any error
   */
  static expectDoesNotThrow(fn: () => any): void {
    expect(fn).not.toThrow();
  }

  /**
   * Test that an async function does not throw any error
   */
  static async expectAsyncDoesNotThrow(fn: () => Promise<any>): Promise<void> {
    await expect(fn()).resolves.not.toThrow();
  }

  /**
   * Create a mock error with specific properties
   */
  static createMockError(message: string, code?: string, details?: any): Error {
    const error = new Error(message);
    if (code) {
      (error as any).code = code;
    }
    if (details) {
      (error as any).details = details;
    }
    return error;
  }

  /**
   * Create a mock MCP error
   */
  static createMockMCPError(message: string, code: number = -1, details?: any): MCPError {
    return new MCPError(message, code, details);
  }

  /**
   * Create a mock client connection error
   */
  static createMockClientConnectionError(
    clientName: string,
    reason: string = 'Connection failed',
  ): ClientConnectionError {
    return new ClientConnectionError(clientName, new Error(reason));
  }

  /**
   * Create a mock client not found error
   */
  static createMockClientNotFoundError(clientName: string): ClientNotFoundError {
    return new ClientNotFoundError(clientName);
  }

  /**
   * Create a mock validation error
   */
  static createMockValidationError(message: string, field?: string): ValidationError {
    return new ValidationError(message, field);
  }

  /**
   * Create a function that throws an error after a delay
   */
  static createDelayedErrorFunction(delay: number, error: Error): () => Promise<never> {
    return async () => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      throw error;
    };
  }

  /**
   * Create a function that throws an error on the nth call
   */
  static createNthCallErrorFunction(n: number, errorToThrow: Error, returnValue?: any): () => any {
    let callCount = 0;

    return () => {
      callCount++;
      if (callCount === n) {
        throw errorToThrow;
      }
      return returnValue;
    };
  }

  /**
   * Create a function that throws an error intermittently
   */
  static createIntermittentErrorFunction(errorProbability: number, errorToThrow: Error, returnValue?: any): () => any {
    return () => {
      if (Math.random() < errorProbability) {
        throw errorToThrow;
      }
      return returnValue;
    };
  }

  /**
   * Test error propagation through a chain of functions
   */
  static async testErrorPropagation(
    functions: Array<(arg: any) => Promise<any>>,
    initialValue: any,
    expectedError: Error,
  ): Promise<void> {
    let currentValue = initialValue;
    let caughtError: Error | undefined;

    try {
      for (const fn of functions) {
        currentValue = await fn(currentValue);
      }
    } catch (_error) {
      caughtError = _error as Error;
    }

    expect(caughtError).toBeDefined();
    expect(caughtError).toBeInstanceOf(expectedError.constructor);
    expect(caughtError!.message).toBe(expectedError.message);
  }

  /**
   * Test error handling with retry logic
   */
  static async testErrorRetry(
    fn: () => Promise<any>,
    maxRetries: number,
    expectedAttempts: number,
    shouldSucceed: boolean = false,
  ): Promise<void> {
    let attempts = 0;
    let lastError: Error | undefined;

    const wrappedFn = async () => {
      attempts++;
      return await fn();
    };

    try {
      for (let i = 0; i < maxRetries; i++) {
        try {
          await wrappedFn();
          if (shouldSucceed) {
            break;
          }
        } catch (_error) {
          lastError = _error as Error;
          if (i === maxRetries - 1) {
            throw _error;
          }
        }
      }
    } catch (_error) {
      // Expected if shouldSucceed is false
    }

    expect(attempts).toBe(expectedAttempts);

    if (!shouldSucceed) {
      expect(lastError).toBeDefined();
    }
  }

  /**
   * Test error handling with circuit breaker pattern
   */
  static testCircuitBreakerErrorHandling(
    fn: () => Promise<any>,
    errorThreshold: number,
    timeoutMs: number,
  ): {
    execute: () => Promise<any>;
    getState: () => 'closed' | 'open' | 'half-open';
    getFailureCount: () => number;
    reset: () => void;
  } {
    let failureCount = 0;
    let state: 'closed' | 'open' | 'half-open' = 'closed';
    let lastFailureTime = 0;

    const execute = async () => {
      if (state === 'open') {
        if (Date.now() - lastFailureTime > timeoutMs) {
          state = 'half-open';
        } else {
          throw new Error('Circuit breaker is open');
        }
      }

      try {
        const result = await fn();

        if (state === 'half-open') {
          state = 'closed';
          failureCount = 0;
        }

        return result;
      } catch (_error) {
        failureCount++;
        lastFailureTime = Date.now();

        if (failureCount >= errorThreshold) {
          state = 'open';
        }

        throw _error;
      }
    };

    return {
      execute,
      getState: () => state,
      getFailureCount: () => failureCount,
      reset: () => {
        failureCount = 0;
        state = 'closed';
        lastFailureTime = 0;
      },
    };
  }

  /**
   * Test error logging and reporting
   */
  static testErrorLogging(
    fn: () => any,
    mockLogger: any,
    expectedLogLevel: 'error' | 'warn' | 'info' | 'debug' = 'error',
  ): void {
    let caughtError: Error | undefined;

    try {
      fn();
    } catch (_error) {
      caughtError = _error as Error;
    }

    expect(caughtError).toBeDefined();
    expect(mockLogger[expectedLogLevel]).toHaveBeenCalledWith(expect.stringContaining(caughtError!.message));
  }

  /**
   * Test async error logging and reporting
   */
  static async testAsyncErrorLogging(
    fn: () => Promise<any>,
    mockLogger: any,
    expectedLogLevel: 'error' | 'warn' | 'info' | 'debug' = 'error',
  ): Promise<void> {
    let caughtError: Error | undefined;

    try {
      await fn();
    } catch (_error) {
      caughtError = _error as Error;
    }

    expect(caughtError).toBeDefined();
    expect(mockLogger[expectedLogLevel]).toHaveBeenCalledWith(expect.stringContaining(caughtError!.message));
  }

  /**
   * Mock console.error to capture error outputs
   */
  static mockConsoleError(): {
    mock: ReturnType<typeof vi.fn>;
    restore: () => void;
    getErrorMessages: () => string[];
  } {
    const originalConsoleError = console.error;
    const mockConsoleError = vi.fn();
    console.error = mockConsoleError;

    return {
      mock: mockConsoleError,
      restore: () => {
        console.error = originalConsoleError;
      },
      getErrorMessages: () => {
        return mockConsoleError.mock.calls.map((call) => call.join(' '));
      },
    };
  }

  /**
   * Test error boundary behavior
   */
  static testErrorBoundary(
    fn: () => any,
    errorBoundary: (error: Error) => any,
    expectedHandling: 'catch' | 'rethrow' | 'transform',
  ): void {
    let originalError: Error | undefined;
    let boundaryError: Error | undefined;
    let result: any;

    try {
      fn();
    } catch (_error) {
      originalError = _error as Error;

      try {
        result = errorBoundary(originalError);
      } catch (handledError) {
        boundaryError = handledError as Error;
      }
    }

    expect(originalError).toBeDefined();

    switch (expectedHandling) {
      case 'catch':
        expect(boundaryError).toBeUndefined();
        expect(result).toBeDefined();
        break;
      case 'rethrow':
        expect(boundaryError).toBeDefined();
        expect(boundaryError).toBe(originalError);
        break;
      case 'transform':
        expect(boundaryError).toBeDefined();
        expect(boundaryError).not.toBe(originalError);
        break;
    }
  }

  /**
   * Common error scenarios for testing
   */
  static readonly ERROR_SCENARIOS = {
    NETWORK_ERROR: () => ErrorTestUtils.createMockError('Network error', 'NETWORK_ERROR'),
    TIMEOUT_ERROR: () => ErrorTestUtils.createMockError('Timeout error', 'TIMEOUT_ERROR'),
    PERMISSION_ERROR: () => ErrorTestUtils.createMockError('Permission denied', 'PERMISSION_ERROR'),
    FILE_NOT_FOUND: () => ErrorTestUtils.createMockError('File not found', 'ENOENT'),
    INVALID_JSON: () => ErrorTestUtils.createMockError('Invalid JSON', 'JSON_PARSE_ERROR'),
    DATABASE_ERROR: () => ErrorTestUtils.createMockError('Database error', 'DATABASE_ERROR'),
    VALIDATION_ERROR: () => ErrorTestUtils.createMockValidationError('Validation failed', 'field'),
    AUTHENTICATION_ERROR: () => ErrorTestUtils.createMockError('Authentication failed', 'INVALID_TOKEN'),
    CONFIGURATION_ERROR: () => ErrorTestUtils.createMockError('Configuration error', 'missing_field'),
  };

  /**
   * Test error message formatting
   */
  static testErrorMessageFormatting(error: Error, expectedFormat: RegExp): void {
    expect(error.message).toMatch(expectedFormat);
  }

  /**
   * Test error stack trace presence
   */
  static testErrorStackTrace(error: Error): void {
    expect(error.stack).toBeDefined();
    expect(error.stack).toContain(error.message);
  }

  /**
   * Test error serialization
   */
  static testErrorSerialization(error: Error): void {
    const serialized = JSON.stringify(error);
    const deserialized = JSON.parse(serialized);

    expect(deserialized.message).toBe(error.message);
    expect(deserialized.name).toBe(error.name);
  }
}
