import { expect } from 'vitest';

/**
 * Enhanced assertion utilities for tests
 * Provides ergonomic wrappers around common assertion patterns
 */
export class AssertionHelpers {
  /**
   * Assert that a function throws an error with specific message
   */
  static expectError(fn: () => any, expectedMessage?: string | RegExp): void {
    let thrownError: Error | undefined;

    try {
      fn();
    } catch (error) {
      thrownError = error as Error;
    }

    expect(thrownError).toBeDefined();
    if (expectedMessage) {
      if (typeof expectedMessage === 'string') {
        expect(thrownError!.message).toContain(expectedMessage);
      } else {
        expect(thrownError!.message).toMatch(expectedMessage);
      }
    }
  }

  /**
   * Assert that an async function throws an error with specific message
   */
  static async expectAsyncError(fn: () => Promise<any>, expectedMessage?: string | RegExp): Promise<void> {
    let thrownError: Error | undefined;

    try {
      await fn();
    } catch (error) {
      thrownError = error as Error;
    }

    expect(thrownError).toBeDefined();
    if (expectedMessage) {
      if (typeof expectedMessage === 'string') {
        expect(thrownError!.message).toContain(expectedMessage);
      } else {
        expect(thrownError!.message).toMatch(expectedMessage);
      }
    }
  }

  /**
   * Assert that a mock was called with specific arguments
   */
  static expectCalledWith(mock: any, ...args: any[]): void {
    expect(mock).toHaveBeenCalledWith(...args);
  }

  /**
   * Assert that a mock was called a specific number of times
   */
  static expectCalledTimes(mock: any, times: number): void {
    expect(mock).toHaveBeenCalledTimes(times);
  }

  /**
   * Assert that a mock was called at least once
   */
  static expectCalled(mock: any): void {
    expect(mock).toHaveBeenCalled();
  }

  /**
   * Assert that a mock was never called
   */
  static expectNotCalled(mock: any): void {
    expect(mock).not.toHaveBeenCalled();
  }
}
