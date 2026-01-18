import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import { STREAMABLE_HTTP_ENDPOINT } from '@src/constants.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setupStreamableHttpRoutes } from './streamableHttpRoutes.js';

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
  debugIf: vi.fn(),
}));

vi.mock('@src/transport/http/middlewares/tagsExtractor.js', () => ({
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

describe('Streamable HTTP Routes', () => {
  let mockRouter: any;
  let mockServerManager: any;
  let mockSessionRepository: any;
  let mockRequest: any;
  let mockResponse: any;
  let mockSessionService: any;
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
      getServer: vi.fn(),
    };

    // Mock session repository
    mockSessionRepository = {};

    // Mock session service
    mockSessionService = {
      getSession: vi.fn(),
      createSession: vi.fn(),
      deleteSession: vi.fn(),
      restoreSession: vi.fn(),
    };

    // Mock request/response
    mockRequest = {
      query: {},
      headers: { 'content-type': 'application/json' },
      body: {},
      socket: {
        on: vi.fn(),
      },
    };

    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      end: vi.fn().mockReturnThis(),
      locals: {},
      writableEnded: false,
      on: vi.fn(),
    };

    // Default mock implementations for SessionService
    mockSessionService.createSession.mockResolvedValue({
      sessionId: 'mock-session-id',
      handleRequest: vi.fn().mockResolvedValue(undefined),
      onclose: null,
      onerror: null,
    });
    mockSessionService.getSession.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('setupStreamableHttpRoutes', () => {
    it('should setup POST route', () => {
      const mockAuthMiddleware = vi.fn();
      setupStreamableHttpRoutes(
        mockRouter,
        mockServerManager,
        mockSessionRepository,
        mockAuthMiddleware,
        undefined,
        undefined,
        undefined,
        mockSessionService,
      );

      expect(mockRouter.post).toHaveBeenCalledWith(
        STREAMABLE_HTTP_ENDPOINT,
        expect.any(Function), // tagsExtractor
        mockAuthMiddleware, // authMiddleware
        expect.any(Function), // handler
      );
    });

    it('should setup GET route', () => {
      const mockAuthMiddleware = vi.fn();
      setupStreamableHttpRoutes(
        mockRouter,
        mockServerManager,
        mockSessionRepository,
        mockAuthMiddleware,
        undefined,
        undefined,
        undefined,
        mockSessionService,
      );

      expect(mockRouter.get).toHaveBeenCalledWith(
        STREAMABLE_HTTP_ENDPOINT,
        expect.any(Function), // tagsExtractor
        mockAuthMiddleware, // authMiddleware
        expect.any(Function), // handler
      );
    });

    it('should setup DELETE route', () => {
      const mockAuthMiddleware = vi.fn();
      setupStreamableHttpRoutes(
        mockRouter,
        mockServerManager,
        mockSessionRepository,
        mockAuthMiddleware,
        undefined,
        undefined,
        undefined,
        mockSessionService,
      );

      expect(mockRouter.delete).toHaveBeenCalledWith(
        STREAMABLE_HTTP_ENDPOINT,
        expect.any(Function), // tagsExtractor
        mockAuthMiddleware, // authMiddleware
        expect.any(Function), // handler
      );
    });
  });

  describe('POST Handler', () => {
    beforeEach(() => {
      const mockAuthMiddleware = vi.fn((req, res, next) => next());
      setupStreamableHttpRoutes(
        mockRouter,
        mockServerManager,
        mockSessionRepository,
        mockAuthMiddleware,
        undefined,
        undefined,
        undefined,
        mockSessionService,
      );
      postHandler = mockRouter.post.mock.calls[0][3];
    });

    it('should create new session when no sessionId header', async () => {
      const mockTransport = {
        sessionId: 'new-session-id',
        handleRequest: vi.fn().mockResolvedValue(undefined),
      };
      mockSessionService.createSession.mockResolvedValue({
        transport: mockTransport,
        persisted: true,
      });

      mockRequest.headers = {};
      await postHandler(mockRequest, mockResponse);

      expect(mockSessionService.createSession).toHaveBeenCalled();
      expect(mockTransport.handleRequest).toHaveBeenCalledWith(mockRequest, mockResponse, mockRequest.body);
    });

    it('should use existing session when sessionId header provided and session found', async () => {
      const mockTransport = {
        sessionId: 'existing-session-id',
        handleRequest: vi.fn().mockResolvedValue(undefined),
      };
      mockSessionService.getSession.mockResolvedValue(mockTransport);

      mockRequest.headers = { 'mcp-session-id': 'existing-session-id' };
      await postHandler(mockRequest, mockResponse);

      expect(mockSessionService.getSession).toHaveBeenCalledWith('existing-session-id');
      expect(mockTransport.handleRequest).toHaveBeenCalledWith(mockRequest, mockResponse, mockRequest.body);
    });

    it('should create new session (restoration failed behavior) when session not found', async () => {
      mockSessionService.getSession.mockResolvedValue(null);
      const mockTransport = {
        sessionId: 'restored-failed-new-session',
        handleRequest: vi.fn().mockResolvedValue(undefined),
      };
      mockSessionService.createSession.mockResolvedValue({
        transport: mockTransport,
        persisted: true,
      });

      mockRequest.headers = { 'mcp-session-id': 'unknown-session-id' };
      await postHandler(mockRequest, mockResponse);

      expect(mockSessionService.getSession).toHaveBeenCalledWith('unknown-session-id');
      expect(mockSessionService.createSession).toHaveBeenCalled(); // Should attempt to create/restore with provided ID
      expect(mockTransport.handleRequest).toHaveBeenCalledWith(mockRequest, mockResponse, mockRequest.body);
    });

    it('should handle errors gracefully', async () => {
      mockSessionService.createSession.mockRejectedValue(new Error('Creation failed'));

      mockRequest.headers = {};
      await postHandler(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: ErrorCode.InternalError,
          }),
        }),
      );
    });
  });

  describe('GET Handler', () => {
    beforeEach(() => {
      const mockAuthMiddleware = vi.fn((req, res, next) => next());
      setupStreamableHttpRoutes(
        mockRouter,
        mockServerManager,
        mockSessionRepository,
        mockAuthMiddleware,
        undefined,
        undefined,
        undefined,
        mockSessionService,
      );
      getHandler = mockRouter.get.mock.calls[0][3];
    });

    it('should return 400 when sessionId header missing', async () => {
      mockRequest.headers = {};
      await getHandler(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.objectContaining({ code: ErrorCode.InvalidParams }) }),
      );
    });

    it('should return 404 when session not found (or restoration failed)', async () => {
      mockSessionService.getSession.mockResolvedValue(null);

      mockRequest.headers = { 'mcp-session-id': 'unknown-session' };
      await getHandler(mockRequest, mockResponse);

      expect(mockSessionService.getSession).toHaveBeenCalledWith('unknown-session');
      expect(mockResponse.status).toHaveBeenCalledWith(404);
    });

    it('should handle request when session exists', async () => {
      const mockTransport = {
        sessionId: 'valid-session',
        handleRequest: vi.fn().mockResolvedValue(undefined),
      };
      mockSessionService.getSession.mockResolvedValue(mockTransport);

      mockRequest.headers = { 'mcp-session-id': 'valid-session' };
      await getHandler(mockRequest, mockResponse);

      expect(mockSessionService.getSession).toHaveBeenCalledWith('valid-session');
      expect(mockTransport.handleRequest).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockSessionService.getSession.mockRejectedValue(new Error('Get session failed'));

      mockRequest.headers = { 'mcp-session-id': 'error-session' };
      await getHandler(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
    });
  });

  describe('DELETE Handler', () => {
    beforeEach(() => {
      const mockAuthMiddleware = vi.fn((req, res, next) => next());
      setupStreamableHttpRoutes(
        mockRouter,
        mockServerManager,
        mockSessionRepository,
        mockAuthMiddleware,
        undefined,
        undefined,
        undefined,
        mockSessionService,
      );
      deleteHandler = mockRouter.delete.mock.calls[0][3];
    });

    it('should return 400 when sessionId header missing', async () => {
      mockRequest.headers = {};
      await deleteHandler(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
    });

    it('should return 404 when session not found', async () => {
      mockSessionService.getSession.mockResolvedValue(null);

      mockRequest.headers = { 'mcp-session-id': 'unknown-session' };
      await deleteHandler(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
    });

    it('should delete session when found', async () => {
      const mockTransport = {
        sessionId: 'delete-session',
        handleRequest: vi.fn().mockResolvedValue(undefined),
      };
      mockSessionService.getSession.mockResolvedValue(mockTransport);

      mockRequest.headers = { 'mcp-session-id': 'delete-session' };
      await deleteHandler(mockRequest, mockResponse);

      expect(mockTransport.handleRequest).toHaveBeenCalled();
      expect(mockSessionService.deleteSession).toHaveBeenCalledWith('delete-session');
    });

    it('should handle errors gracefully', async () => {
      mockSessionService.getSession.mockRejectedValue(new Error('Delete failed'));

      mockRequest.headers = { 'mcp-session-id': 'error-session' };
      await deleteHandler(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
    });
  });
});
