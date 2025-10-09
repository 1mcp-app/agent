import { expect, vi } from 'vitest';

/**
 * Utilities for testing asynchronous operations
 */
export class AsyncTestUtils {
  /**
   * Setup fake timers for testing
   */
  static setupFakeTimers(): void {
    vi.useFakeTimers();
  }

  /**
   * Restore real timers after testing
   */
  static restoreRealTimers(): void {
    vi.useRealTimers();
  }

  /**
   * Advance fake timers by a specific amount
   */
  static async advanceTimers(ms: number): Promise<void> {
    vi.advanceTimersByTime(ms);
    await vi.runAllTimersAsync();
  }

  /**
   * Run all pending timers
   */
  static async runAllTimers(): Promise<void> {
    await vi.runAllTimersAsync();
  }

  /**
   * Run only the next timer
   */
  static async runOnlyPendingTimers(): Promise<void> {
    await vi.runOnlyPendingTimersAsync();
  }

  /**
   * Wait for a promise to resolve with timeout
   */
  static async waitForPromise<T>(promise: Promise<T>, timeout: number = 5000): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Promise timed out after ${timeout}ms`)), timeout);
      }),
    ]);
  }

  /**
   * Wait for a condition to be true
   */
  static async waitForCondition(
    condition: () => boolean | Promise<boolean>,
    timeout: number = 5000,
    interval: number = 100,
  ): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const result = await condition();
      if (result) {
        return;
      }
      await AsyncTestUtils.sleep(interval);
    }

    throw new Error(`Condition not met within ${timeout}ms`);
  }

  /**
   * Wait for a specific value to be returned by a function
   */
  static async waitForValue<T>(
    getValue: () => T | Promise<T>,
    expectedValue: T,
    timeout: number = 5000,
    interval: number = 100,
  ): Promise<void> {
    await AsyncTestUtils.waitForCondition(
      async () => {
        const value = await getValue();
        return value === expectedValue;
      },
      timeout,
      interval,
    );
  }

  /**
   * Wait for a mock to be called
   */
  static async waitForMockCall(mock: any, timeout: number = 5000, interval: number = 100): Promise<void> {
    await AsyncTestUtils.waitForCondition(() => mock.mock.calls.length > 0, timeout, interval);
  }

  /**
   * Wait for a mock to be called a specific number of times
   */
  static async waitForMockCallCount(
    mock: any,
    expectedCount: number,
    timeout: number = 5000,
    interval: number = 100,
  ): Promise<void> {
    await AsyncTestUtils.waitForCondition(() => mock.mock.calls.length === expectedCount, timeout, interval);
  }

  /**
   * Create a promise that resolves after a delay
   */
  static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Create a promise that rejects after a delay
   */
  static rejectAfter(ms: number, error: Error = new Error('Timeout')): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(error), ms);
    });
  }

  /**
   * Test that a function completes within a specific time
   */
  static async expectCompletesWithin<T>(fn: () => Promise<T>, maxDuration: number): Promise<T> {
    const start = Date.now();
    const result = await fn();
    const duration = Date.now() - start;

    expect(duration).toBeLessThanOrEqual(maxDuration);
    return result;
  }

  /**
   * Test that a function takes at least a specific amount of time
   */
  static async expectTakesAtLeast<T>(fn: () => Promise<T>, minDuration: number): Promise<T> {
    const start = Date.now();
    const result = await fn();
    const duration = Date.now() - start;

    expect(duration).toBeGreaterThanOrEqual(minDuration);
    return result;
  }

  /**
   * Test that a promise resolves
   */
  static async expectResolves<T>(promise: Promise<T>): Promise<void> {
    await expect(promise).resolves.toBeDefined();
  }

  /**
   * Test that a promise rejects
   */
  static async expectRejects(promise: Promise<any>): Promise<any> {
    return expect(promise).rejects.toBeDefined();
  }

  /**
   * Test that a promise rejects with a specific error
   */
  static async expectRejectsWith(promise: Promise<any>, expectedError: string | RegExp | Error): Promise<any> {
    if (typeof expectedError === 'string') {
      return expect(promise).rejects.toThrow(expectedError);
    } else if (expectedError instanceof RegExp) {
      return expect(promise).rejects.toThrow(expectedError);
    } else {
      return expect(promise).rejects.toThrow(expectedError);
    }
  }

  /**
   * Create a controllable promise that can be resolved/rejected manually
   */
  static createControllablePromise<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: any) => void;
    isPending: () => boolean;
  } {
    let resolve: (value: T) => void;
    let reject: (reason?: any) => void;
    let isPending = true;

    const promise = new Promise<T>((res, rej) => {
      resolve = (value: T) => {
        isPending = false;
        res(value);
      };
      reject = (reason?: any) => {
        isPending = false;
        rej(reason);
      };
    });

    return {
      promise,
      resolve: resolve!,
      reject: reject!,
      isPending: () => isPending,
    };
  }

  /**
   * Create a promise that resolves to a specific value after a delay
   */
  static resolveAfter<T>(value: T, delay: number): Promise<T> {
    return new Promise((resolve) => {
      setTimeout(() => resolve(value), delay);
    });
  }

  /**
   * Create a sequence of promises that resolve in order
   */
  static createPromiseSequence<T>(values: T[], delay: number = 100): Promise<T>[] {
    return values.map((value, index) => AsyncTestUtils.resolveAfter(value, delay * (index + 1)));
  }

  /**
   * Test retry logic with exponential backoff
   */
  static async testRetryLogic<T>(
    fn: () => Promise<T>,
    maxAttempts: number = 3,
    baseDelay: number = 100,
    backoffFactor: number = 2,
  ): Promise<{
    result: T;
    attempts: number;
    totalTime: number;
  }> {
    const start = Date.now();
    let attempts = 0;
    let lastError: Error;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const result = await fn();
        return {
          result,
          attempts,
          totalTime: Date.now() - start,
        };
      } catch (error) {
        lastError = error as Error;

        if (attempts < maxAttempts) {
          const delay = baseDelay * Math.pow(backoffFactor, attempts - 1);
          await AsyncTestUtils.sleep(delay);
        }
      }
    }

    throw lastError!;
  }

  /**
   * Test concurrent operations
   */
  static async testConcurrency<T>(operations: (() => Promise<T>)[], maxConcurrency: number = 3): Promise<T[]> {
    const results: T[] = [];
    const executing: Promise<void>[] = [];

    for (let i = 0; i < operations.length; i++) {
      const operation = operations[i];

      const promise = operation().then((result) => {
        results[i] = result;
      });

      executing.push(promise);

      if (executing.length >= maxConcurrency) {
        await Promise.race(executing);
        executing.splice(
          executing.findIndex((p) => p === promise),
          1,
        );
      }
    }

    await Promise.all(executing);
    return results;
  }

  /**
   * Test that operations are executed in a specific order
   */
  static createOrderTracker(): {
    track: (id: string) => void;
    getOrder: () => string[];
    expectOrder: (expectedOrder: string[]) => void;
  } {
    const order: string[] = [];

    return {
      track: (id: string) => {
        order.push(id);
      },
      getOrder: () => [...order],
      expectOrder: (expectedOrder: string[]) => {
        expect(order).toEqual(expectedOrder);
      },
    };
  }

  /**
   * Test debouncing behavior
   */
  static async testDebounce<T>(
    debouncedFn: (...args: any[]) => Promise<T>,
    calls: { args: any[]; delay: number }[],
    _expectedCallCount: number,
  ): Promise<void> {
    const promises: Promise<T>[] = [];

    for (const call of calls) {
      await AsyncTestUtils.sleep(call.delay);
      promises.push(debouncedFn(...call.args));
    }

    await Promise.all(promises);

    // Additional assertions would need to be implemented based on the specific debounce implementation
    // This is a framework for testing debounce behavior
  }

  /**
   * Test throttling behavior
   */
  static async testThrottle<T>(
    throttledFn: (...args: any[]) => Promise<T>,
    calls: { args: any[]; delay: number }[],
    _expectedCallCount: number,
  ): Promise<void> {
    const promises: Promise<T>[] = [];

    for (const call of calls) {
      await AsyncTestUtils.sleep(call.delay);
      promises.push(throttledFn(...call.args));
    }

    await Promise.all(promises);

    // Additional assertions would need to be implemented based on the specific throttle implementation
    // This is a framework for testing throttle behavior
  }

  /**
   * Measure the performance of an async operation
   */
  static async measurePerformance<T>(
    operation: () => Promise<T>,
    iterations: number = 1,
  ): Promise<{
    result: T;
    averageTime: number;
    minTime: number;
    maxTime: number;
    times: number[];
  }> {
    const times: number[] = [];
    let result: T;

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      result = await operation();
      const duration = performance.now() - start;
      times.push(duration);
    }

    const averageTime = times.reduce((sum, time) => sum + time, 0) / times.length;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);

    return {
      result: result!,
      averageTime,
      minTime,
      maxTime,
      times,
    };
  }
}
