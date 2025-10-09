import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupStreamableHttpRoutes } from './streamableHttpRoutes.js';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { STREAMABLE_HTTP_ENDPOINT } from '@src/constants.js';

// Mock all external dependencies
vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'mock-uuid-123'),
}));

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: vi.fn().mockImplementation((options) => {
    const transport = {
      sessionId: options?.sessionIdGenerator?.() || 'mock-session-id',
      onclose: null,
      onerror: null,
      handleRequest: vi.fn().mockResolvedValue(undefined),
    };
    return transport;
  }),
}));

vi.mock('@src/logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../middlewares/tagsExtractor.js', () => ({
  default: vi.fn((req: any, res: any, next: any) => {
    req.tags = ['test'];
    next();
  }),
}));

vi.mock('@src/transport/http/middlewares/scopeAuthMiddleware.js', () => ({
  createScopeAuthMiddleware: vi.fn(() => (req: any, res: any, next: any) => {
    res.locals = res.locals || {};
    res.locals.validatedTags = ['test'];
    next();
  }),
  getValidatedTags: vi.fn((res: any) => {
    return res.locals?.validatedTags || [];
  }),
  getTagExpression: vi.fn((res: any) => res?.locals?.tagExpression),
  getTagFilterMode: vi.fn((res: any) => res?.locals?.tagFilterMode || 'none'),
  getTagQuery: vi.fn((res: any) => res?.locals?.tagQuery),
  getPresetName: vi.fn((res: any) => res?.locals?.presetName),
}));

vi.mock('@src/utils/validation/sanitization.js', () => ({
  sanitizeHeaders: vi.fn((_headers: any) => ({ 'content-type': 'application/json' })),
}));

vi.mock('../../../core/server/serverManager.js', () => ({
  ServerManager: vi.fn(),
}));

vi.mock('../../../auth/sdkOAuthServerProvider.js', () => ({
  SDKOAuthServerProvider: vi.fn(),
}));

describe('Streamable HTTP Routes', () => {
  let mockRouter: any;
  let mockServerManager: any;
  let _mockOAuthProvider: any;
  let mockRequest: any;
  let mockResponse: any;
  let postHandler: any;
  let getHandler: any;
  let deleteHandler: any;

  beforeEach(async () => {
    vi.resetAllMocks();

    // Mock router
    mockRouter = {
      post: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
    };

    // Mock server manager
    mockServerManager = {
      connectTransport: vi.fn().mockResolvedValue(undefined),
      disconnectTransport: vi.fn(),
      getTransport: vi.fn(),
    };

    // Mock OAuth provider
    _mockOAuthProvider = {
      validateScope: vi.fn().mockReturnValue(true),
    };

    // Mock request/response
    mockRequest = {
      query: {},
      headers: { 'content-type': 'application/json' },
      body: {},
    };

    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      end: vi.fn().mockReturnThis(),
      locals: {},
    };
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('setupStreamableHttpRoutes', () => {
    it('should setup POST route', () => {
      const mockAuthMiddleware = vi.fn();
      setupStreamableHttpRoutes(mockRouter, mockServerManager, mockAuthMiddleware);

      expect(mockRouter.post).toHaveBeenCalledWith(
        STREAMABLE_HTTP_ENDPOINT,
        expect.any(Function), // tagsExtractor
        mockAuthMiddleware, // authMiddleware
        expect.any(Function), // handler
      );
    });

    it('should setup GET route', () => {
      const mockAuthMiddleware = vi.fn();
      setupStreamableHttpRoutes(mockRouter, mockServerManager, mockAuthMiddleware);

      expect(mockRouter.get).toHaveBeenCalledWith(
        STREAMABLE_HTTP_ENDPOINT,
        expect.any(Function), // tagsExtractor
        mockAuthMiddleware, // authMiddleware
        expect.any(Function), // handler
      );
    });

    it('should setup DELETE route', () => {
      const mockAuthMiddleware = vi.fn();
      setupStreamableHttpRoutes(mockRouter, mockServerManager, mockAuthMiddleware);

      expect(mockRouter.delete).toHaveBeenCalledWith(
        STREAMABLE_HTTP_ENDPOINT,
        expect.any(Function), // tagsExtractor
        mockAuthMiddleware, // authMiddleware
        expect.any(Function), // handler
      );
    });

    it('should setup routes without OAuth provider', () => {
      const mockAuthMiddleware = vi.fn((req, res, next) => next());
      setupStreamableHttpRoutes(mockRouter, mockServerManager, mockAuthMiddleware);

      expect(mockRouter.post).toHaveBeenCalled();
      expect(mockRouter.get).toHaveBeenCalled();
      expect(mockRouter.delete).toHaveBeenCalled();
    });
  });

  describe('POST Handler - New Session', () => {
    beforeEach(() => {
      const mockAuthMiddleware = vi.fn((req, res, next) => next());
      setupStreamableHttpRoutes(mockRouter, mockServerManager, mockAuthMiddleware);
      postHandler = mockRouter.post.mock.calls[0][3]; // Get the actual handler function (4th arg after endpoint, tagsExtractor, authMiddleware)

      // Reset the serverManager mock after getting the handler but keep it available
      vi.mocked(mockServerManager.connectTransport).mockClear();
    });

    it('should create new session when no sessionId header', async () => {
      const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
      const { getValidatedTags, getTagExpression, getTagFilterMode } = await import(
        '@src/transport/http/middlewares/scopeAuthMiddleware.js'
      );
      const { randomUUID } = await import('node:crypto');

      vi.mocked(getValidatedTags).mockReturnValue(['test-tag']);
      vi.mocked(getTagExpression).mockReturnValue(undefined);
      vi.mocked(getTagFilterMode).mockReturnValue('none');
      vi.mocked(randomUUID).mockReturnValue('550e8400-e29b-41d4-a716-446655440000');

      const mockTransport = {
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        onclose: null,
        handleRequest: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(StreamableHTTPServerTransport).mockReturnValue(mockTransport as any);

      mockRequest.query = { pagination: 'true' };
      mockRequest.body = { method: 'test', params: {} };
      mockResponse.locals = { validatedTags: ['test-tag'] };

      await postHandler(mockRequest, mockResponse);

      expect(StreamableHTTPServerTransport).toHaveBeenCalledWith({
        sessionIdGenerator: expect.any(Function),
      });
      expect(mockServerManager.connectTransport).toHaveBeenCalledWith(
        mockTransport,
        '550e8400-e29b-41d4-a716-446655440000',
        {
          tags: ['test-tag'],
          tagExpression: undefined,
          tagFilterMode: 'none',
          enablePagination: true,
        },
      );
      expect(mockTransport.handleRequest).toHaveBeenCalledWith(mockRequest, mockResponse, mockRequest.body);
    });

    it('should setup onclose handler for new transport', async () => {
      const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
      const { getValidatedTags } = await import('../middlewares/scopeAuthMiddleware.js');
      const { randomUUID } = await import('node:crypto');

      vi.mocked(getValidatedTags).mockReturnValue([]);
      vi.mocked(randomUUID).mockReturnValue('550e8400-e29b-41d4-a716-446655440001');

      const mockTransport = {
        sessionId: '550e8400-e29b-41d4-a716-446655440001',
        onclose: null,
        handleRequest: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(StreamableHTTPServerTransport).mockReturnValue(mockTransport as any);

      await postHandler(mockRequest, mockResponse);

      expect(mockTransport.onclose).toBeTypeOf('function');

      // Test the onclose handler
      if (mockTransport.onclose) {
        (mockTransport.onclose as Function)();
        expect(mockServerManager.disconnectTransport).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440001');
      }
    });

    it('should handle pagination disabled', async () => {
      const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
      const { getValidatedTags, getTagExpression, getTagFilterMode } = await import(
        '../middlewares/scopeAuthMiddleware.js'
      );
      const { randomUUID } = await import('node:crypto');

      vi.mocked(getValidatedTags).mockReturnValue(['tag1', 'tag2']);
      vi.mocked(getTagExpression).mockReturnValue(undefined);
      vi.mocked(getTagFilterMode).mockReturnValue('none');
      vi.mocked(randomUUID).mockReturnValue('550e8400-e29b-41d4-a716-446655440002');

      const mockTransport = {
        sessionId: '550e8400-e29b-41d4-a716-446655440002',
        onclose: null,
        handleRequest: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(StreamableHTTPServerTransport).mockReturnValue(mockTransport as any);

      mockRequest.query = { pagination: 'false' };

      await postHandler(mockRequest, mockResponse);

      expect(mockServerManager.connectTransport).toHaveBeenCalledWith(
        mockTransport,
        '550e8400-e29b-41d4-a716-446655440002',
        {
          tags: ['tag1', 'tag2'],
          tagExpression: undefined,
          tagFilterMode: 'none',
          enablePagination: false,
        },
      );
    });
  });

  describe('POST Handler - Existing Session', () => {
    beforeEach(() => {
      const mockAuthMiddleware = vi.fn((req, res, next) => next());
      setupStreamableHttpRoutes(mockRouter, mockServerManager, mockAuthMiddleware);
      postHandler = mockRouter.post.mock.calls[0][3];
    });

    it('should use existing transport when sessionId provided', async () => {
      const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');

      const mockTransport = {
        handleRequest: vi.fn().mockResolvedValue(undefined),
      };

      mockRequest.headers = { 'mcp-session-id': 'existing-session' };
      mockRequest.body = { method: 'test' };
      mockServerManager.getTransport.mockReturnValue(mockTransport);

      // Mock instanceof check
      Object.setPrototypeOf(mockTransport, StreamableHTTPServerTransport.prototype);

      await postHandler(mockRequest, mockResponse);

      expect(mockServerManager.getTransport).toHaveBeenCalledWith('existing-session');
      expect(mockTransport.handleRequest).toHaveBeenCalledWith(mockRequest, mockResponse, mockRequest.body);
    });

    it('should return 404 when session not found', async () => {
      mockRequest.headers = { 'mcp-session-id': 'non-existent' };
      mockServerManager.getTransport.mockReturnValue(null);

      await postHandler(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.InvalidParams,
          message: 'No active streamable HTTP session found for the provided sessionId',
        },
      });
    });

    it('should return 400 when session uses different transport', async () => {
      const mockTransport = {
        type: 'different-transport',
      };

      mockRequest.headers = { 'mcp-session-id': 'wrong-transport' };
      mockServerManager.getTransport.mockReturnValue(mockTransport);

      await postHandler(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.InvalidParams,
          message: 'Session already exists but uses a different transport protocol',
        },
      });
    });
  });

  describe('POST Handler - Error Handling', () => {
    beforeEach(() => {
      const mockAuthMiddleware = vi.fn((req, res, next) => next());
      setupStreamableHttpRoutes(mockRouter, mockServerManager, mockAuthMiddleware);
      postHandler = mockRouter.post.mock.calls[0][3];
    });

    it('should handle transport creation error', async () => {
      const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');

      vi.mocked(StreamableHTTPServerTransport).mockImplementation(() => {
        throw new Error('Transport creation failed');
      });

      await postHandler(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.end).toHaveBeenCalled();
    });

    it('should handle server manager connection error', async () => {
      const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
      const { getValidatedTags } = await import('../middlewares/scopeAuthMiddleware.js');

      vi.mocked(getValidatedTags).mockReturnValue([]);

      const mockTransport = {
        sessionId: 'error-test',
        onclose: null,
        handleRequest: vi.fn(),
      };
      vi.mocked(StreamableHTTPServerTransport).mockReturnValue(mockTransport as any);

      mockServerManager.connectTransport.mockRejectedValue(new Error('Connection failed'));

      await postHandler(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.end).toHaveBeenCalled();
    });

    it('should handle request processing error', async () => {
      const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');

      const mockTransport = {
        handleRequest: vi.fn().mockRejectedValue(new Error('Request processing failed')),
      };

      mockRequest.headers = { 'mcp-session-id': 'error-session' };
      mockServerManager.getTransport.mockReturnValue(mockTransport);

      // Mock instanceof check
      Object.setPrototypeOf(mockTransport, StreamableHTTPServerTransport.prototype);

      await postHandler(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.end).toHaveBeenCalled();
    });
  });

  describe('GET Handler', () => {
    beforeEach(() => {
      const mockAuthMiddleware = vi.fn((req, res, next) => next());
      setupStreamableHttpRoutes(mockRouter, mockServerManager, mockAuthMiddleware);
      getHandler = mockRouter.get.mock.calls[0][3]; // Get the actual handler function
    });

    it('should handle GET request with valid sessionId', async () => {
      const mockTransport = {
        handleRequest: vi.fn().mockResolvedValue(undefined),
      };

      mockRequest.headers = { 'mcp-session-id': 'valid-session' };
      mockRequest.body = {};
      mockServerManager.getTransport.mockReturnValue(mockTransport);

      await getHandler(mockRequest, mockResponse);

      expect(mockServerManager.getTransport).toHaveBeenCalledWith('valid-session');
      expect(mockTransport.handleRequest).toHaveBeenCalledWith(mockRequest, mockResponse, mockRequest.body);
    });

    it('should return 400 when sessionId header missing', async () => {
      mockRequest.headers = {}; // No sessionId

      await getHandler(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.InvalidParams,
          message: 'Invalid params: sessionId is required',
        },
      });
    });

    it('should return 404 when transport not found', async () => {
      mockRequest.headers = { 'mcp-session-id': 'non-existent' };
      mockServerManager.getTransport.mockReturnValue(null);

      await getHandler(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.InvalidParams,
          message: 'No active streamable HTTP session found for the provided sessionId',
        },
      });
    });

    it('should handle request processing error', async () => {
      const mockTransport = {
        handleRequest: vi.fn().mockRejectedValue(new Error('GET processing failed')),
      };

      mockRequest.headers = { 'mcp-session-id': 'error-get' };
      mockServerManager.getTransport.mockReturnValue(mockTransport);

      await getHandler(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.end).toHaveBeenCalled();
    });
  });

  describe('DELETE Handler', () => {
    beforeEach(() => {
      const mockAuthMiddleware = vi.fn((req, res, next) => next());
      setupStreamableHttpRoutes(mockRouter, mockServerManager, mockAuthMiddleware);
      deleteHandler = mockRouter.delete.mock.calls[0][3]; // Get the actual handler function
    });

    it('should handle DELETE request with valid sessionId', async () => {
      const mockTransport = {
        handleRequest: vi.fn().mockResolvedValue(undefined),
      };

      mockRequest.headers = { 'mcp-session-id': 'delete-session' };
      mockServerManager.getTransport.mockReturnValue(mockTransport);

      await deleteHandler(mockRequest, mockResponse);

      expect(mockServerManager.getTransport).toHaveBeenCalledWith('delete-session');
      expect(mockTransport.handleRequest).toHaveBeenCalledWith(mockRequest, mockResponse);
    });

    it('should return 400 when sessionId header missing for DELETE', async () => {
      mockRequest.headers = {}; // No sessionId

      await deleteHandler(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.InvalidParams,
          message: 'Invalid params: sessionId is required',
        },
      });
    });

    it('should return 404 when transport not found for DELETE', async () => {
      mockRequest.headers = { 'mcp-session-id': 'non-existent-delete' };
      mockServerManager.getTransport.mockReturnValue(null);

      await deleteHandler(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.InvalidParams,
          message: 'No active streamable HTTP session found for the provided sessionId',
        },
      });
    });

    it('should handle DELETE processing error', async () => {
      const mockTransport = {
        handleRequest: vi.fn().mockRejectedValue(new Error('DELETE processing failed')),
      };

      mockRequest.headers = { 'mcp-session-id': 'error-delete' };
      mockServerManager.getTransport.mockReturnValue(mockTransport);

      await deleteHandler(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.end).toHaveBeenCalled();
    });
  });
});
