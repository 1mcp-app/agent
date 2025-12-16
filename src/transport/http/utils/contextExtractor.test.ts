import { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { extractContextFromHeadersOrQuery } from './contextExtractor.js';

// Mock logger to avoid console output during tests
vi.mock('@src/logger/logger.js', () => ({
  default: {
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('contextExtractor', () => {
  let mockRequest: Partial<Request>;

  beforeEach(() => {
    mockRequest = {
      query: {},
      headers: {},
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('extractContextFromHeadersOrQuery - Individual Headers Support', () => {
    it('should extract context from individual X-Context-* headers', () => {
      mockRequest.headers = {
        'x-context-project-name': 'test-project',
        'x-context-project-path': '/Users/x/workplace/project',
        'x-context-user-name': 'Test User',
        'x-context-user-email': 'test@example.com',
        'x-context-environment-name': 'development',
        'x-context-session-id': 'session-123',
        'x-context-timestamp': '2024-01-01T00:00:00Z',
        'x-context-version': 'v1.0.0',
      };

      const context = extractContextFromHeadersOrQuery(mockRequest as Request);

      expect(context).toEqual({
        project: {
          path: '/Users/x/workplace/project',
          name: 'test-project',
        },
        user: {
          name: 'Test User',
          email: 'test@example.com',
        },
        environment: {
          variables: {
            name: 'development',
          },
        },
        sessionId: 'session-123',
        timestamp: '2024-01-01T00:00:00Z',
        version: 'v1.0.0',
      });
    });

    it('should return null when required headers are missing', () => {
      mockRequest.headers = {
        'x-context-project-name': 'test-project',
        // Missing project-path and session-id
      };

      const context = extractContextFromHeadersOrQuery(mockRequest as Request);
      expect(context).toBeNull();
    });

    it('should handle missing optional headers gracefully', () => {
      mockRequest.headers = {
        'x-context-project-path': '/Users/x/workplace/project',
        'x-context-session-id': 'session-123',
        // Only required headers present
      };

      const context = extractContextFromHeadersOrQuery(mockRequest as Request);

      expect(context).toEqual({
        project: {
          path: '/Users/x/workplace/project',
        },
        user: undefined,
        environment: undefined,
        sessionId: 'session-123',
      });
    });

    it('should handle array header values', () => {
      mockRequest.headers = {
        'x-context-project-path': ['/Users/x/workplace/project'],
        'x-context-session-id': ['session-123'],
      };

      const context = extractContextFromHeadersOrQuery(mockRequest as Request);

      expect(context?.sessionId).toBe('session-123');
      expect(context?.project?.path).toBe('/Users/x/workplace/project');
    });

    it('should include environment variables when present', () => {
      mockRequest.headers = {
        'x-context-project-path': '/Users/x/workplace/project',
        'x-context-session-id': 'session-123',
        'x-context-environment-name': 'development',
        'x-context-environment-platform': 'node',
      };

      const context = extractContextFromHeadersOrQuery(mockRequest as Request);

      expect(context?.environment).toEqual({
        variables: {
          name: 'development',
          platform: 'node',
        },
      });
    });
  });

  describe('extractContextFromHeadersOrQuery', () => {
    it('should prioritize query parameters over headers', () => {
      mockRequest.query = {
        project_path: '/query/path',
        project_name: 'query-project',
        context_session_id: 'query-session',
      };

      mockRequest.headers = {
        'x-context-project-path': '/header/path',
        'x-context-project-name': 'header-project',
        'x-context-session-id': 'header-session',
      };

      const context = extractContextFromHeadersOrQuery(mockRequest as Request);

      // Should use query parameters (higher priority)
      expect(context?.project?.path).toBe('/query/path');
      expect(context?.project?.name).toBe('query-project');
      expect(context?.sessionId).toBe('query-session');
    });

    it('should fall back to individual headers when no query parameters', () => {
      mockRequest.headers = {
        'x-context-project-path': '/header/path',
        'x-context-project-name': 'header-project',
        'x-context-session-id': 'header-session',
      };

      const context = extractContextFromHeadersOrQuery(mockRequest as Request);

      expect(context?.project?.path).toBe('/header/path');
      expect(context?.project?.name).toBe('header-project');
      expect(context?.sessionId).toBe('header-session');
    });

    it('should return null when no context is found', () => {
      const context = extractContextFromHeadersOrQuery(mockRequest as Request);
      expect(context).toBeNull();
    });

    it('should fall back to combined headers when no query or individual headers', () => {
      mockRequest.headers = {
        'x-1mcp-context': Buffer.from(
          JSON.stringify({
            project: { name: 'test-project', path: '/test/path' },
            user: { name: 'Test User' },
            environment: { variables: { NODE_ENV: 'development' } },
            sessionId: 'session-123',
            timestamp: '2024-01-01T00:00:00Z',
            version: 'v1.0.0',
          }),
        ).toString('base64'),
        'mcp-session-id': 'session-123',
        'x-1mcp-context-version': 'v1.0.0',
      };

      const context = extractContextFromHeadersOrQuery(mockRequest as Request);

      expect(context).toEqual({
        project: { name: 'test-project', path: '/test/path' },
        user: { name: 'Test User' },
        environment: { variables: { NODE_ENV: 'development' } },
        sessionId: 'session-123',
        timestamp: '2024-01-01T00:00:00Z',
        version: 'v1.0.0',
      });
    });
  });

  describe('integration tests', () => {
    it('should extract complete context from all available sources', () => {
      mockRequest.headers = {
        'x-context-project-name': 'integration-test',
        'x-context-project-path': '/Users/x/workplace/integration',
        'x-context-user-name': 'Integration User',
        'x-context-user-email': 'integration@example.com',
        'x-context-environment-name': 'test',
        'x-context-session-id': 'integration-session-456',
        'x-context-timestamp': '2024-12-16T23:06:00Z',
        'x-context-version': 'v2.0.0',
      };

      const context = extractContextFromHeadersOrQuery(mockRequest as Request);

      // Verify complete context structure
      expect(context).toMatchObject({
        project: {
          path: '/Users/x/workplace/integration',
          name: 'integration-test',
        },
        user: {
          name: 'Integration User',
          email: 'integration@example.com',
        },
        environment: {
          variables: {
            name: 'test',
          },
        },
        sessionId: 'integration-session-456',
        timestamp: '2024-12-16T23:06:00Z',
        version: 'v2.0.0',
      });
    });

    it('should handle errors gracefully and return null', () => {
      // Mock a scenario that might cause errors
      mockRequest = {
        query: {},
        headers: {
          'x-context-project-path': '/valid/path',
          'x-context-session-id': 'session-123',
          // Simulate a problematic header value
          'invalid-header': 'some weird value',
        },
      };

      // Should not throw and should still extract valid context
      expect(() => {
        const context = extractContextFromHeadersOrQuery(mockRequest as Request);
        expect(context?.project?.path).toBe('/valid/path');
        expect(context?.sessionId).toBe('session-123');
      }).not.toThrow();
    });
  });
});
