import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupSseRoutes } from './sseRoutes.js';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { SSE_ENDPOINT, MESSAGES_ENDPOINT } from '@src/constants.js';

// Mock all external dependencies
vi.mock('@modelcontextprotocol/sdk/server/sse.js', () => ({
  SSEServerTransport: vi.fn().mockImplementation((_endpoint, _res) => {
    const transport = {
      sessionId: 'test-session-123',
      onclose: null,
      onerror: null,
      handlePostMessage: vi.fn().mockResolvedValue(undefined),
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

vi.mock('../middlewares/scopeAuthMiddleware.js', () => ({
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

describe('SSE Routes', () => {
  let mockRouter: any;
  let mockServerManager: any;
  let _mockOAuthProvider: any;
  let mockRequest: any;
  let mockResponse: any;
  let getHandler: any;
  let postHandler: any;

  beforeEach(async () => {
    vi.resetAllMocks();

    // Mock router
    mockRouter = {
      get: vi.fn(),
      post: vi.fn(),
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

  describe('setupSseRoutes', () => {
    it('should setup SSE GET route', () => {
      const mockAuthMiddleware = vi.fn();
      setupSseRoutes(mockRouter, mockServerManager, mockAuthMiddleware);

      expect(mockRouter.get).toHaveBeenCalledWith(
        SSE_ENDPOINT,
        expect.any(Function), // tagsExtractor
        mockAuthMiddleware, // authMiddleware
        expect.any(Function), // handler
      );
    });

    it('should setup messages POST route', () => {
      const mockAuthMiddleware = vi.fn();
      setupSseRoutes(mockRouter, mockServerManager, mockAuthMiddleware);

      expect(mockRouter.post).toHaveBeenCalledWith(
        MESSAGES_ENDPOINT,
        expect.any(Function), // tagsExtractor
        mockAuthMiddleware, // authMiddleware
        expect.any(Function), // handler
      );
    });

    it('should setup routes without OAuth provider', () => {
      const mockAuthMiddleware = vi.fn((req, res, next) => next());
      setupSseRoutes(mockRouter, mockServerManager, mockAuthMiddleware);

      expect(mockRouter.get).toHaveBeenCalled();
      expect(mockRouter.post).toHaveBeenCalled();
    });
  });

  describe('SSE GET Handler', () => {
    beforeEach(() => {
      const mockAuthMiddleware = vi.fn((req, res, next) => next());
      setupSseRoutes(mockRouter, mockServerManager, mockAuthMiddleware);
      getHandler = mockRouter.get.mock.calls[0][3]; // Get the actual handler function

      // Reset the serverManager mock after getting the handler but keep it available
      vi.mocked(mockServerManager.connectTransport).mockClear();
    });

    it('should handle SSE connection successfully', async () => {
      const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js');
      const { getValidatedTags, getTagExpression, getTagFilterMode } = await import(
        '../middlewares/scopeAuthMiddleware.js'
      );

      const mockTransport = {
        sessionId: 'test-session-123',
        onclose: null,
        onerror: null,
        handlePostMessage: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(SSEServerTransport).mockReturnValue(mockTransport as any);
      vi.mocked(getValidatedTags).mockReturnValue(['test-tag']);
      vi.mocked(getTagExpression).mockReturnValue(undefined);
      vi.mocked(getTagFilterMode).mockReturnValue('none');

      mockRequest.query = { pagination: 'true' };
      mockResponse.locals = { validatedTags: ['test-tag'] };

      await getHandler(mockRequest, mockResponse);

      expect(SSEServerTransport).toHaveBeenCalledWith(MESSAGES_ENDPOINT, mockResponse);
      expect(mockServerManager.connectTransport).toHaveBeenCalledWith(mockTransport, 'test-session-123', {
        tags: ['test-tag'],
        tagExpression: undefined,
        tagFilterMode: 'none',
        enablePagination: true,
      });
    });

    it('should handle SSE connection with pagination disabled', async () => {
      const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js');
      const { getValidatedTags, getTagExpression, getTagFilterMode } = await import(
        '../middlewares/scopeAuthMiddleware.js'
      );

      const mockTransport = {
        sessionId: 'test-session-456',
        onclose: null,
        onerror: null,
        handlePostMessage: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(SSEServerTransport).mockReturnValue(mockTransport as any);
      vi.mocked(getValidatedTags).mockReturnValue(['another-tag']);
      vi.mocked(getTagExpression).mockReturnValue(undefined);
      vi.mocked(getTagFilterMode).mockReturnValue('none');

      mockRequest.query = { pagination: 'false' };
      mockResponse.locals = { validatedTags: ['another-tag'] };

      await getHandler(mockRequest, mockResponse);

      expect(mockServerManager.connectTransport).toHaveBeenCalledWith(mockTransport, 'test-session-456', {
        tags: ['another-tag'],
        tagExpression: undefined,
        tagFilterMode: 'none',
        enablePagination: false,
      });
    });

    it('should handle SSE connection error', async () => {
      const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js');
      vi.mocked(SSEServerTransport).mockImplementation(() => {
        throw new Error('Transport creation failed');
      });

      await getHandler(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.end).toHaveBeenCalled();
    });

    it('should handle server manager connection error', async () => {
      const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js');
      const mockTransport = {
        sessionId: 'test-session-789',
        onclose: null,
      };
      vi.mocked(SSEServerTransport).mockReturnValue(mockTransport as any);

      mockServerManager.connectTransport.mockRejectedValue(new Error('Connection failed'));

      await getHandler(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.end).toHaveBeenCalled();
    });

    it('should setup onclose handler for transport', async () => {
      const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js');
      const mockTransport = {
        sessionId: 'test-session-onclose',
        onclose: null,
        onerror: null,
        handlePostMessage: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(SSEServerTransport).mockReturnValue(mockTransport as any);

      await getHandler(mockRequest, mockResponse);

      expect(mockTransport.onclose).toBeTypeOf('function');

      // Test the onclose handler
      if (mockTransport.onclose) {
        (mockTransport.onclose as Function)();
        expect(mockServerManager.disconnectTransport).toHaveBeenCalledWith('test-session-onclose');
      }
    });

    it('should handle empty validated tags', async () => {
      const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js');
      const { getValidatedTags, getTagExpression, getTagFilterMode } = await import(
        '../middlewares/scopeAuthMiddleware.js'
      );

      const mockTransport = {
        sessionId: 'test-session-no-tags',
        onclose: null,
        onerror: null,
        handlePostMessage: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(SSEServerTransport).mockReturnValue(mockTransport as any);
      vi.mocked(getValidatedTags).mockReturnValue([]);
      vi.mocked(getTagExpression).mockReturnValue(undefined);
      vi.mocked(getTagFilterMode).mockReturnValue('none');

      mockResponse.locals = {};

      await getHandler(mockRequest, mockResponse);

      expect(mockServerManager.connectTransport).toHaveBeenCalledWith(mockTransport, 'test-session-no-tags', {
        tags: [],
        tagExpression: undefined,
        tagFilterMode: 'none',
        enablePagination: false,
      });
    });
  });

  describe('Messages POST Handler', () => {
    beforeEach(() => {
      const mockAuthMiddleware = vi.fn((req, res, next) => next());
      setupSseRoutes(mockRouter, mockServerManager, mockAuthMiddleware);
      postHandler = mockRouter.post.mock.calls[0][3]; // Get the actual handler function
    });

    it('should handle message with valid sessionId', async () => {
      const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js');
      const mockTransport = {
        handlePostMessage: vi.fn().mockResolvedValue(undefined),
      };

      mockRequest.query = { sessionId: 'valid-session' };
      mockRequest.body = { method: 'test', params: {} };
      mockServerManager.getTransport.mockReturnValue(mockTransport);

      // Mock instanceof check
      Object.setPrototypeOf(mockTransport, SSEServerTransport.prototype);

      await postHandler(mockRequest, mockResponse);

      expect(mockTransport.handlePostMessage).toHaveBeenCalledWith(mockRequest, mockResponse, mockRequest.body);
    });

    it('should return 400 when sessionId is missing', async () => {
      mockRequest.query = {}; // No sessionId

      await postHandler(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.InvalidParams,
          message: 'Invalid params: sessionId is required',
        },
      });
    });

    it('should return 404 when transport not found', async () => {
      mockRequest.query = { sessionId: 'non-existent' };
      mockServerManager.getTransport.mockReturnValue(null);

      await postHandler(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.InvalidParams,
          message: 'Transport not found',
        },
      });
    });

    it('should return 404 when transport is not SSEServerTransport', async () => {
      const mockTransport = {
        type: 'different-transport',
      };

      mockRequest.query = { sessionId: 'wrong-transport' };
      mockServerManager.getTransport.mockReturnValue(mockTransport);

      await postHandler(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.InvalidParams,
          message: 'Transport not found',
        },
      });
    });

    it('should handle message processing error', async () => {
      const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js');
      const mockTransport = {
        handlePostMessage: vi.fn().mockRejectedValue(new Error('Message processing failed')),
      };

      mockRequest.query = { sessionId: 'error-session' };
      mockRequest.body = { method: 'test' };
      mockServerManager.getTransport.mockReturnValue(mockTransport);

      // Mock instanceof check
      Object.setPrototypeOf(mockTransport, SSEServerTransport.prototype);

      await postHandler(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.InternalError,
          message: 'Internal server error',
        },
      });
    });

    it('should handle empty sessionId string', async () => {
      mockRequest.query = { sessionId: '' };

      await postHandler(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: {
          code: ErrorCode.InvalidParams,
          message: 'Invalid params: sessionId is required',
        },
      });
    });

    it('should handle complex message body', async () => {
      const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js');
      const mockTransport = {
        handlePostMessage: vi.fn().mockResolvedValue(undefined),
      };

      mockRequest.query = { sessionId: 'complex-session' };
      mockRequest.body = {
        method: 'resources/list',
        params: {
          cursor: 'next-page',
          filter: { type: 'file' },
        },
        id: 'req-123',
      };
      mockServerManager.getTransport.mockReturnValue(mockTransport);

      // Mock instanceof check
      Object.setPrototypeOf(mockTransport, SSEServerTransport.prototype);

      await postHandler(mockRequest, mockResponse);

      expect(mockTransport.handlePostMessage).toHaveBeenCalledWith(mockRequest, mockResponse, mockRequest.body);
    });
  });
});
