import { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { extractContextFromMeta } from './contextExtractor.js';

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

  describe('extractContextFromMeta - _meta field support', () => {
    it('should extract context from _meta field in request body', () => {
      mockRequest.body = {
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          _meta: {
            context: {
              project: {
                path: '/Users/x/workplace/project',
                name: 'test-project',
                environment: 'development',
              },
              user: {
                username: 'testuser',
                home: '/Users/testuser',
              },
              environment: {
                variables: {
                  NODE_VERSION: 'v20.0.0',
                  PLATFORM: 'darwin',
                  PWD: '/Users/x/workplace/project',
                },
              },
              timestamp: '2024-01-01T00:00:00Z',
              version: 'v1.0.0',
              sessionId: 'session-123',
              transport: {
                type: 'stdio-proxy',
                connectionTimestamp: '2024-01-01T00:00:00Z',
                client: {
                  name: 'claude-code',
                  version: '1.0.0',
                  title: 'Claude Code',
                },
              },
            },
          },
        },
      };

      const context = extractContextFromMeta(mockRequest as Request);

      expect(context).toEqual({
        project: {
          path: '/Users/x/workplace/project',
          name: 'test-project',
          environment: 'development',
        },
        user: {
          username: 'testuser',
          home: '/Users/testuser',
        },
        environment: {
          variables: {
            NODE_VERSION: 'v20.0.0',
            PLATFORM: 'darwin',
            PWD: '/Users/x/workplace/project',
          },
        },
        timestamp: '2024-01-01T00:00:00Z',
        version: 'v1.0.0',
        sessionId: 'session-123',
        transport: {
          type: 'stdio-proxy',
          connectionTimestamp: '2024-01-01T00:00:00Z',
          client: {
            name: 'claude-code',
            version: '1.0.0',
            title: 'Claude Code',
          },
        },
      });
    });

    it('should return null when _meta field is missing', () => {
      mockRequest.body = {
        jsonrpc: '2.0',
        method: 'initialize',
        params: {},
      };

      const context = extractContextFromMeta(mockRequest as Request);
      expect(context).toBeNull();
    });

    it('should return null when _meta.context field is missing', () => {
      mockRequest.body = {
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          _meta: {
            otherField: 'value',
          },
        },
      };

      const context = extractContextFromMeta(mockRequest as Request);
      expect(context).toBeNull();
    });

    it('should return null when request body is missing', () => {
      mockRequest.body = undefined;

      const context = extractContextFromMeta(mockRequest as Request);
      expect(context).toBeNull();
    });

    it('should handle malformed _meta context gracefully', () => {
      mockRequest.body = {
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          _meta: {
            context: {
              // Missing required fields
              invalid: 'data',
            },
          },
        },
      };

      const context = extractContextFromMeta(mockRequest as Request);
      expect(context).toBeNull();
    });

    it('should preserve existing _meta fields when extracting context', () => {
      mockRequest.body = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          _meta: {
            progressToken: 'token-123',
            context: {
              project: {
                path: '/Users/x/workplace/project',
                name: 'test-project',
              },
              user: {
                username: 'testuser',
              },
              environment: {
                variables: {},
              },
              sessionId: 'session-123',
            },
          },
        },
      };

      const context = extractContextFromMeta(mockRequest as Request);

      expect(context).toMatchObject({
        project: {
          path: '/Users/x/workplace/project',
          name: 'test-project',
        },
        user: {
          username: 'testuser',
        },
        sessionId: 'session-123',
      });
    });
  });

  describe('client information edge cases and error handling', () => {
    it('should handle malformed _meta context gracefully', () => {
      mockRequest.body = {
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          _meta: {
            context: null,
          },
        },
      };

      const context = extractContextFromMeta(mockRequest as Request);
      expect(context).toBeNull();
    });

    it('should handle missing params in request body', () => {
      mockRequest.body = {
        jsonrpc: '2.0',
        method: 'initialize',
        // Missing params
      };

      const context = extractContextFromMeta(mockRequest as Request);
      expect(context).toBeNull();
    });
  });
});
