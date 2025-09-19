import { vi } from 'vitest';
import { createMockLogger } from './MockFactories.js';

/**
 * Mocking and spying utilities for tests
 * Handles test doubles, module mocking, and test isolation
 */
export class MockHelpers {
  /**
   * Setup common mocks for a test
   */
  static setupCommonMocks() {
    // Mock logger to avoid console output during tests
    vi.doMock('../../src/logger/logger.js', () => ({
      default: createMockLogger(),
    }));

    // Mock fs operations
    const mockFs = {
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
      rmSync: vi.fn(),
    };

    vi.doMock('fs', () => mockFs);

    return { mockFs };
  }

  /**
   * Reset all singleton instances (common pattern in tests)
   */
  static resetSingletons() {
    // Reset any singleton instances that might carry state between tests
    vi.clearAllMocks();
    vi.resetModules();
  }

  /**
   * Mock a module with specific implementation
   */
  static mockModule(modulePath: string, mockImplementation: any): void {
    vi.doMock(modulePath, () => mockImplementation);
  }

  /**
   * Create a spy on an object method
   */
  static spyOn<T extends Record<string, any>>(object: T, method: keyof T): any {
    return vi.spyOn(object, method as any);
  }

  /**
   * Create a mock HTTP request/response cycle
   */
  static createHttpMockCycle() {
    const req = {
      params: {},
      query: {},
      body: {},
      headers: {},
      method: 'GET',
      url: '/',
    };

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      redirect: vi.fn().mockReturnThis(),
      cookie: vi.fn().mockReturnThis(),
      clearCookie: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
      end: vi.fn().mockReturnThis(),
    };

    const next = vi.fn();

    return { req, res, next };
  }
}
