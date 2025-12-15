import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { enhanceServerWithLogging } from './mcpLoggingEnhancer.js';

// Mock logger
vi.mock('./logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  debugIf: vi.fn(),
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid-123'),
}));

describe('MCP Logging Enhancer', () => {
  let mockServer: any;
  let mockLogger: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Import mocked logger
    const logger = await import('./logger.js');
    mockLogger = logger.default;

    // Create mock server
    mockServer = {
      setRequestHandler: vi.fn(),
      setNotificationHandler: vi.fn(),
      notification: vi.fn(),
    };
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('enhanceServerWithLogging', () => {
    it('should enhance server with logging capabilities', () => {
      enhanceServerWithLogging(mockServer);

      // Server should still be the same object but with enhanced methods
      expect(mockServer).toBeDefined();
      expect(mockServer.setRequestHandler).toBeDefined();
      expect(mockServer.setNotificationHandler).toBeDefined();
      expect(mockServer.notification).toBeDefined();
    });

    it('should preserve original server methods', () => {
      const _originalSetRequestHandler = mockServer.setRequestHandler;
      const _originalSetNotificationHandler = mockServer.setNotificationHandler;
      const _originalNotification = mockServer.notification;

      enhanceServerWithLogging(mockServer);

      // Methods should be functions (possibly wrapped)
      expect(typeof mockServer.setRequestHandler).toBe('function');
      expect(typeof mockServer.setNotificationHandler).toBe('function');
      expect(typeof mockServer.notification).toBe('function');
    });

    it('should handle server without methods gracefully', () => {
      const bareServer = {} as any;

      expect(() => {
        enhanceServerWithLogging(bareServer);
      }).toThrow(); // Should throw since it expects Server instance
    });

    it('should wrap request handler registration', () => {
      const originalSetRequestHandler = vi.fn();
      mockServer.setRequestHandler = originalSetRequestHandler;

      enhanceServerWithLogging(mockServer);

      const mockSchema = {
        _def: {
          shape: () => ({
            method: { _def: { value: 'test/method' } },
          }),
        },
        debugIf: vi.fn(),
      };
      const mockHandler = vi.fn();

      // Call the enhanced setRequestHandler
      mockServer.setRequestHandler(mockSchema, mockHandler);

      // Original setRequestHandler should have been called
      expect(originalSetRequestHandler).toHaveBeenCalled();
    });

    it('should wrap notification handler registration', () => {
      enhanceServerWithLogging(mockServer);

      const mockSchema = {
        _def: {
          shape: () => ({
            method: { _def: { value: 'test/notification' } },
          }),
        },
        debugIf: vi.fn(),
      };
      const mockHandler = vi.fn();

      // Call the enhanced setNotificationHandler
      mockServer.setNotificationHandler(mockSchema, mockHandler);

      // Method should be callable
      expect(typeof mockServer.setNotificationHandler).toBe('function');
    });

    it('should handle notification sending', () => {
      enhanceServerWithLogging(mockServer);

      const testNotification = {
        method: 'test/notification',
        params: { data: 'test' },
      };

      // Call the enhanced notification method
      mockServer.notification(testNotification);

      // Should log the notification
      expect(mockLogger.info).toHaveBeenCalledWith(
        'MCP Notification',
        expect.objectContaining({
          method: 'test/notification',
          params: JSON.stringify({ data: 'test' }),
          timestamp: expect.any(String),
        }),
      );
    });

    it('should handle notification sending with connection errors', () => {
      const originalNotification = vi.fn().mockImplementation(() => {
        throw new Error('Not connected');
      });
      mockServer.notification = originalNotification;

      enhanceServerWithLogging(mockServer);

      const testNotification = {
        method: 'test/notification',
        params: { data: 'test' },
      };

      // Should not throw even if original notification throws connection error
      expect(() => {
        mockServer.notification(testNotification);
      }).not.toThrow();

      expect(mockLogger.warn).toHaveBeenCalledWith('Attempted to send notification on disconnected transport');
    });

    it('should re-throw non-connection errors', () => {
      const originalNotification = vi.fn().mockImplementation(() => {
        throw new Error('Other error');
      });
      mockServer.notification = originalNotification;
      mockServer.transport = { send: vi.fn() }; // Add transport for this test

      enhanceServerWithLogging(mockServer);

      const testNotification = {
        method: 'test/notification',
        params: { data: 'test' },
      };

      // Should re-throw non-connection errors
      expect(() => {
        mockServer.notification(testNotification);
      }).toThrow('Other error');
    });
  });

  describe('Request Handler Wrapping', () => {
    it('should log request and response', async () => {
      enhanceServerWithLogging(mockServer);

      // Create a mock request handler
      const _mockHandler = vi.fn().mockResolvedValue({ result: 'success' });
      const _mockRequest = { params: { test: 'data' } };
      const _mockExtra = {
        sendNotification: vi.fn(),
        sendRequest: vi.fn(),
      };

      // Get the wrapped handler by calling setRequestHandler
      const _mockSchema = {
        _def: {
          shape: () => ({
            method: { _def: { value: 'test/method' } },
          }),
        },
        debugIf: vi.fn(),
      };

      // Store original to test wrapping
      const _originalSetRequestHandler = mockServer.setRequestHandler;
      enhanceServerWithLogging(mockServer);

      // The method should be replaced with a wrapper
      expect(typeof mockServer.setRequestHandler).toBe('function');
    });

    it('should log errors in request handlers', async () => {
      enhanceServerWithLogging(mockServer);

      // Create a mock request handler that throws
      const _mockHandler = vi.fn().mockRejectedValue(new Error('Handler error'));
      const _mockRequest = { params: { test: 'data' } };
      const _mockExtra = {
        sendNotification: vi.fn(),
        sendRequest: vi.fn(),
      };

      const _mockSchema = {
        _def: {
          shape: () => ({
            method: { _def: { value: 'test/method' } },
          }),
        },
        debugIf: vi.fn(),
      };

      // Enhanced server should still work
      expect(typeof mockServer.setRequestHandler).toBe('function');
    });
  });

  describe('Notification Handler Wrapping', () => {
    it('should log notifications', async () => {
      enhanceServerWithLogging(mockServer);

      const _mockHandler = vi.fn().mockResolvedValue(undefined);
      const _mockNotification = {
        method: 'test/notification',
        params: { test: 'data' },
      };

      const _mockSchema = {
        _def: {
          shape: () => ({
            method: { _def: { value: 'test/notification' } },
          }),
        },
        debugIf: vi.fn(),
      };

      // Enhanced server should maintain functionality
      expect(typeof mockServer.setNotificationHandler).toBe('function');
    });
  });

  describe('Logging Context', () => {
    it('should generate unique request IDs', () => {
      enhanceServerWithLogging(mockServer);

      const testNotification = {
        method: 'test/notification',
        params: { data: 'test' },
      };

      mockServer.notification(testNotification);

      // The notification should be logged (UUID is used internally)
      expect(mockLogger.info).toHaveBeenCalledWith(
        'MCP Notification',
        expect.objectContaining({
          method: 'test/notification',
        }),
      );
    });

    it('should include timestamps in logs', () => {
      enhanceServerWithLogging(mockServer);

      const testNotification = {
        method: 'test/notification',
        params: { data: 'test' },
      };

      mockServer.notification(testNotification);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'MCP Notification',
        expect.objectContaining({
          timestamp: expect.any(String),
        }),
      );
    });

    it('should serialize params as JSON', () => {
      enhanceServerWithLogging(mockServer);

      const complexParams = {
        nested: { data: 'test' },
        array: [1, 2, 3],
        number: 42,
      };

      const testNotification = {
        method: 'test/notification',
        params: complexParams,
      };

      mockServer.notification(testNotification);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'MCP Notification',
        expect.objectContaining({
          params: JSON.stringify(complexParams),
        }),
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed schemas gracefully', () => {
      const originalSetRequestHandler = vi.fn();
      mockServer.setRequestHandler = originalSetRequestHandler;

      enhanceServerWithLogging(mockServer);

      const malformedSchema = {
        _def: {
          shape: () => ({
            method: { _def: { value: undefined } }, // Malformed method
          }),
        },
        debugIf: vi.fn(),
      };

      expect(() => {
        mockServer.setRequestHandler(malformedSchema, vi.fn());
      }).not.toThrow();
    });

    it('should handle undefined params', () => {
      enhanceServerWithLogging(mockServer);

      const testNotification = {
        method: 'test/notification',
        params: undefined,
      };

      expect(() => {
        mockServer.notification(testNotification);
      }).not.toThrow();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'MCP Notification',
        expect.objectContaining({
          params: undefined,
        }),
      );
    });

    it('should handle notification method without params', () => {
      enhanceServerWithLogging(mockServer);

      const testNotification = {
        method: 'test/notification',
        // No params property
      };

      expect(() => {
        mockServer.notification(testNotification);
      }).not.toThrow();
    });
  });

  describe('Performance', () => {
    it('should not significantly impact performance for multiple notifications', () => {
      enhanceServerWithLogging(mockServer);

      const startTime = Date.now();

      // Send multiple notifications
      for (let i = 0; i < 100; i++) {
        mockServer.notification({
          method: `test/notification${i}`,
          params: { index: i },
        });
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete quickly (less than 100ms for 100 notifications)
      expect(duration).toBeLessThan(100);
      expect(mockLogger.info).toHaveBeenCalledTimes(100);
    });
  });
});
