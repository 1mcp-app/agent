import { vi } from 'vitest';

/**
 * Test data generation and utility functions
 * Handles data creation, validation, console capture, and other test utilities
 */
export class DataHelpers {
  /**
   * Validate that an object matches a schema
   */
  static validateSchema(obj: any, schema: any): boolean {
    try {
      // Simple schema validation - could be extended with a proper schema validator
      if (typeof schema === 'object' && schema !== null) {
        for (const key in schema) {
          if (Object.hasOwn(schema, key)) {
            if (!(key in obj)) {
              return false;
            }
            if (typeof schema[key] === 'object' && schema[key] !== null) {
              if (!DataHelpers.validateSchema(obj[key], schema[key])) {
                return false;
              }
            } else if (typeof obj[key] !== schema[key]) {
              return false;
            }
          }
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generate a random string for testing
   */
  static randomString(length: number = 10): string {
    return Math.random().toString(36).substr(2, length);
  }

  /**
   * Generate a random number within a range
   */
  static randomNumber(min: number = 0, max: number = 100): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Create test data with incremental IDs
   */
  static createTestSeries<T>(factory: (index: number) => T, count: number): T[] {
    return Array.from({ length: count }, (_, i) => factory(i));
  }

  /**
   * Capture console output for testing
   */
  static captureConsole(): {
    log: string[];
    error: string[];
    warn: string[];
    restore: () => void;
  } {
    const originalConsole = {
      log: console.log,
      error: console.error,
      warn: console.warn,
    };

    const captured = {
      log: [] as string[],
      error: [] as string[],
      warn: [] as string[],
    };

    console.log = vi.fn((...args: any[]) => {
      captured.log.push(args.join(' '));
    });

    console.error = vi.fn((...args: any[]) => {
      captured.error.push(args.join(' '));
    });

    console.warn = vi.fn((...args: any[]) => {
      captured.warn.push(args.join(' '));
    });

    return {
      ...captured,
      restore: () => {
        console.log = originalConsole.log;
        console.error = originalConsole.error;
        console.warn = originalConsole.warn;
      },
    };
  }

  /**
   * Create a repeating function call for testing
   */
  static repeat(fn: () => any, times: number): void {
    for (let i = 0; i < times; i++) {
      fn();
    }
  }
}
