import {
  CONTEXT_HEADERS,
  contextMiddleware,
  type ContextRequest,
  createContextHeaders,
  getContext,
  hasContext,
} from '@src/transport/http/middlewares/contextMiddleware.js';
import type { ContextData } from '@src/types/context.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the global context manager at the top level
const mockGlobalContextManager = {
  updateContext: vi.fn().mockImplementation(() => {
    // Do nothing - pure mock without side effects
  }),
};

vi.mock('@src/core/context/globalContextManager.js', () => ({
  getGlobalContextManager: () => mockGlobalContextManager,
}));

describe('Context Middleware', () => {
  let mockRequest: Partial<ContextRequest>;
  let mockResponse: any;
  let mockNext: any;

  beforeEach(() => {
    // Mock request object
    mockRequest = {
      headers: {},
      locals: {},
    };

    // Mock response object
    mockResponse = {};

    // Mock next function
    mockNext = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('contextMiddleware', () => {
    it('should pass through when no context headers are present', () => {
      const middleware = contextMiddleware();

      middleware(mockRequest as ContextRequest, mockResponse, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRequest.locals?.hasContext).toBe(false);
      expect(mockRequest.locals?.context).toBeUndefined();
      expect(mockGlobalContextManager.updateContext).not.toHaveBeenCalled();
    });

    it('should extract and validate context from headers', () => {
      const contextData: ContextData = {
        sessionId: 'test-session-123',
        version: '1.0.0',
        project: {
          name: 'test-project',
          path: '/path/to/project',
          environment: 'development',
        },
        user: {
          uid: 'user-456',
          username: 'testuser',
          email: 'test@example.com',
        },
        environment: {
          variables: {},
        },
        timestamp: '2024-01-15T10:30:00Z',
      };

      const contextJson = JSON.stringify(contextData);
      const contextEncoded = Buffer.from(contextJson, 'utf-8').toString('base64');

      // Create request with Express-like header behavior
      const testRequest = {
        headers: {},
        locals: {},
      } as any;

      // Simulate Express header normalization (headers are case-insensitive)
      testRequest.headers['x-1mcp-session-id'] = contextData.sessionId;
      testRequest.headers['x-1mcp-context-version'] = contextData.version;
      testRequest.headers['x-1mcp-context'] = contextEncoded;

      const testResponse = {} as any;
      const testNext = vi.fn();

      const middleware = contextMiddleware();
      middleware(testRequest, testResponse, testNext);

      expect(testNext).toHaveBeenCalled();

      expect(testRequest.locals.hasContext).toBe(true);
      expect(testRequest.locals.context).toEqual(contextData);
      expect(mockGlobalContextManager.updateContext).toHaveBeenCalledWith(contextData);
    });

    it('should handle invalid base64 context data', () => {
      mockRequest.headers = {
        [CONTEXT_HEADERS.SESSION_ID.toLowerCase()]: 'session-123',
        [CONTEXT_HEADERS.VERSION.toLowerCase()]: '1.0.0',
        [CONTEXT_HEADERS.DATA.toLowerCase()]: 'invalid-base64!',
      };

      const middleware = contextMiddleware();
      middleware(mockRequest as ContextRequest, mockResponse, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRequest.locals?.hasContext).toBe(false);
      expect(mockRequest.locals?.context).toBeUndefined();
      expect(mockGlobalContextManager.updateContext).not.toHaveBeenCalled();
    });

    it('should handle invalid JSON in context data', () => {
      const invalidJson = Buffer.from('invalid json', 'utf-8').toString('base64');

      mockRequest.headers = {
        [CONTEXT_HEADERS.SESSION_ID.toLowerCase()]: 'session-123',
        [CONTEXT_HEADERS.VERSION.toLowerCase()]: '1.0.0',
        [CONTEXT_HEADERS.DATA.toLowerCase()]: invalidJson,
      };

      const middleware = contextMiddleware();
      middleware(mockRequest as ContextRequest, mockResponse, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRequest.locals?.hasContext).toBe(false);
      expect(mockRequest.locals?.context).toBeUndefined();
      expect(mockGlobalContextManager.updateContext).not.toHaveBeenCalled();
    });

    it('should reject context with invalid structure', () => {
      const invalidContext = {
        // Missing required fields like project, user, sessionId
        invalid: 'data',
      };

      const contextJson = JSON.stringify(invalidContext);
      const contextEncoded = Buffer.from(contextJson, 'utf-8').toString('base64');

      mockRequest.headers = {
        [CONTEXT_HEADERS.SESSION_ID.toLowerCase()]: 'session-123',
        [CONTEXT_HEADERS.VERSION.toLowerCase()]: '1.0.0',
        [CONTEXT_HEADERS.DATA.toLowerCase()]: contextEncoded,
      };

      const middleware = contextMiddleware();
      middleware(mockRequest as ContextRequest, mockResponse, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRequest.locals?.hasContext).toBe(false);
      expect(mockRequest.locals?.context).toBeUndefined();
      expect(mockGlobalContextManager.updateContext).not.toHaveBeenCalled();
    });

    it('should reject context with mismatched session ID', () => {
      const contextData: ContextData = {
        sessionId: 'session-123',
        version: '1.0.0',
        project: {
          name: 'test-project',
          path: '/path/to/project',
          environment: 'development',
        },
        user: {
          uid: 'user-456',
          username: 'testuser',
          email: 'test@example.com',
        },
        environment: {
          variables: {},
        },
        timestamp: '2024-01-15T10:30:00Z',
      };

      const contextJson = JSON.stringify(contextData);
      const contextEncoded = Buffer.from(contextJson, 'utf-8').toString('base64');

      mockRequest.headers = {
        [CONTEXT_HEADERS.SESSION_ID.toLowerCase()]: 'different-session', // Mismatched
        [CONTEXT_HEADERS.VERSION.toLowerCase()]: contextData.version,
        [CONTEXT_HEADERS.DATA.toLowerCase()]: contextEncoded,
      };

      const middleware = contextMiddleware();
      middleware(mockRequest as ContextRequest, mockResponse, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRequest.locals?.hasContext).toBe(false);
      expect(mockRequest.locals?.context).toBeUndefined();
      expect(mockGlobalContextManager.updateContext).not.toHaveBeenCalled();
    });

    it('should handle missing individual headers', () => {
      mockRequest.headers = {
        [CONTEXT_HEADERS.SESSION_ID.toLowerCase()]: 'session-123',
        // Missing version and data headers
      };

      const middleware = contextMiddleware();
      middleware(mockRequest as ContextRequest, mockResponse, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRequest.locals?.hasContext).toBe(false);
    });

    it('should initialize req.locals if it does not exist', () => {
      delete mockRequest.locals;

      const middleware = contextMiddleware();
      middleware(mockRequest as ContextRequest, mockResponse, mockNext);

      expect(mockRequest.locals).toBeDefined();
      expect(typeof mockRequest.locals).toBe('object');
    });

    it('should handle middleware errors gracefully', () => {
      // Mock a scenario that causes an error
      mockRequest.headers = {
        [CONTEXT_HEADERS.DATA.toLowerCase()]: 'null', // This could cause issues
      } as any;

      const middleware = contextMiddleware();

      // Should not throw, should handle gracefully
      expect(() => {
        middleware(mockRequest as ContextRequest, mockResponse, mockNext);
      }).not.toThrow();

      expect(mockNext).toHaveBeenCalled();
      expect(mockRequest.locals?.hasContext).toBe(false);
    });
  });

  describe('createContextHeaders', () => {
    it('should create headers from valid context data', () => {
      const contextData: ContextData = {
        sessionId: 'test-session-123',
        version: '1.0.0',
        project: {
          name: 'test-project',
          path: '/path/to/project',
          environment: 'development',
        },
        user: {
          uid: 'user-456',
          username: 'testuser',
          email: 'test@example.com',
        },
        environment: {
          variables: {},
        },
        timestamp: '2024-01-15T10:30:00Z',
      };

      const headers = createContextHeaders(contextData);

      expect(headers[CONTEXT_HEADERS.SESSION_ID]).toBe(contextData.sessionId);
      expect(headers[CONTEXT_HEADERS.VERSION]).toBe(contextData.version);
      expect(headers[CONTEXT_HEADERS.DATA]).toBeDefined();

      // Verify the data is properly base64 encoded
      const decodedData = Buffer.from(headers[CONTEXT_HEADERS.DATA], 'base64').toString('utf-8');
      const parsedData = JSON.parse(decodedData);
      expect(parsedData).toEqual(contextData);
    });

    it('should handle context with missing optional fields', () => {
      const minimalContext: ContextData = {
        sessionId: 'session-123',
        version: '1.0.0',
        project: {
          name: 'test-project',
          path: '/path/to/project',
          environment: 'development',
        },
        user: {
          uid: 'user-456',
          username: 'testuser',
          email: 'test@example.com',
        },
        environment: {
          variables: {},
        },
        timestamp: '2024-01-15T10:30:00Z',
      };

      const headers = createContextHeaders(minimalContext);

      expect(headers[CONTEXT_HEADERS.SESSION_ID]).toBe(minimalContext.sessionId);
      expect(headers[CONTEXT_HEADERS.VERSION]).toBe(minimalContext.version);
      expect(headers[CONTEXT_HEADERS.DATA]).toBeDefined();
    });

    it('should handle empty context', () => {
      const headers = createContextHeaders({} as ContextData);

      expect(headers[CONTEXT_HEADERS.SESSION_ID]).toBeUndefined();
      expect(headers[CONTEXT_HEADERS.VERSION]).toBeUndefined();
      expect(headers[CONTEXT_HEADERS.DATA]).toBeDefined();
    });
  });

  describe('hasContext', () => {
    it('should return true when request has context', () => {
      mockRequest.locals = { hasContext: true };
      expect(hasContext(mockRequest as ContextRequest)).toBe(true);
    });

    it('should return false when request has no context', () => {
      mockRequest.locals = { hasContext: false };
      expect(hasContext(mockRequest as ContextRequest)).toBe(false);
    });

    it('should return false when locals is undefined', () => {
      mockRequest.locals = undefined;
      expect(hasContext(mockRequest as ContextRequest)).toBe(false);
    });

    it('should return false when hasContext is undefined', () => {
      mockRequest.locals = {};
      expect(hasContext(mockRequest as ContextRequest)).toBe(false);
    });
  });

  describe('getContext', () => {
    const mockContext: ContextData = {
      sessionId: 'session-123',
      version: '1.0.0',
      project: {
        name: 'test-project',
        path: '/path/to/project',
        environment: 'development',
      },
      user: {
        uid: 'user-456',
        username: 'testuser',
        email: 'test@example.com',
      },
      environment: {
        variables: {},
      },
      timestamp: '2024-01-15T10:30:00Z',
    };

    it('should return context when available', () => {
      mockRequest.locals = { context: mockContext };
      expect(getContext(mockRequest as ContextRequest)).toEqual(mockContext);
    });

    it('should return undefined when no context is available', () => {
      mockRequest.locals = {};
      expect(getContext(mockRequest as ContextRequest)).toBeUndefined();
    });

    it('should return undefined when locals is undefined', () => {
      mockRequest.locals = undefined;
      expect(getContext(mockRequest as ContextRequest)).toBeUndefined();
    });
  });

  describe('Header Constants', () => {
    it('should have correct header names', () => {
      expect(CONTEXT_HEADERS.SESSION_ID).toBe('x-1mcp-session-id');
      expect(CONTEXT_HEADERS.VERSION).toBe('x-1mcp-context-version');
      expect(CONTEXT_HEADERS.DATA).toBe('x-1mcp-context');
    });

    it('should use lowercase format for header access', () => {
      // Headers in Express are accessed in lowercase
      expect(CONTEXT_HEADERS.SESSION_ID.toLowerCase()).toBe('x-1mcp-session-id');
      expect(CONTEXT_HEADERS.VERSION.toLowerCase()).toBe('x-1mcp-context-version');
      expect(CONTEXT_HEADERS.DATA.toLowerCase()).toBe('x-1mcp-context');
    });
  });
});
