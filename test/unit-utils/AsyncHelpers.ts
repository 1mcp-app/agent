/**
 * Async testing utilities
 * Handles timing, promises, and asynchronous test patterns
 */
export class AsyncHelpers {
  /**
   * Wait for a condition to be true with timeout
   */
  static async waitFor(
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
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new Error(`Condition not met within ${timeout}ms`);
  }

  /**
   * Create a promise that resolves after a delay
   */
  static delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Create a mock implementation that can be resolved/rejected
   */
  static createControllablePromise<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: any) => void;
  } {
    let resolve: (value: T) => void;
    let reject: (reason?: any) => void;

    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    return {
      promise,
      resolve: resolve!,
      reject: reject!,
    };
  }

  /**
   * Measure execution time of a function
   */
  static async measureTime<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
    const start = performance.now();
    const result = await fn();
    const duration = performance.now() - start;
    return { result, duration };
  }
}
