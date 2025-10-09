import { LoadingState } from '@src/core/loading/loadingStateTracker.js';
import { ClientStatus } from '@src/core/types/index.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock all dependencies
vi.mock('@src/logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@src/core/server/serverManager.js', () => ({
  ServerManager: {
    current: {
      getClients: vi.fn(),
      getClient: vi.fn(),
    },
  },
}));

vi.mock('../../../core/client/clientFactory.js', () => ({
  default: vi.fn(),
}));

vi.mock('@src/core/server/agentConfig.js', () => ({
  AgentConfigManager: {
    getInstance: vi.fn(() => ({
      getRateLimitWindowMs: () => 900000,
      getRateLimitMax: () => 100,
    })),
  },
}));

vi.mock('express-rate-limit', () => ({
  default: vi.fn(() => (req: any, res: any, next: any) => next()),
}));

vi.mock('../middlewares/securityMiddleware.js', () => ({
  sensitiveOperationLimiter: (req: any, res: any, next: any) => next(),
}));

vi.mock('@src/utils/validation/sanitization.js', () => ({
  escapeHtml: vi.fn((str: string) => str),
  sanitizeUrlParam: vi.fn((str: string) => str),
  sanitizeErrorMessage: vi.fn((str: string) => str),
  sanitizeServerNameForContext: vi.fn((str: string) => str),
}));

vi.mock('@src/utils/validation/scopeValidation.js', () => ({
  validateScopes: vi.fn(() => ({ isValid: true, validScopes: [], errors: [] })),
}));

describe('OAuth Routes', () => {
  let mockOAuthProvider: any;
  let mockRequest: any;
  let mockResponse: any;
  let createOAuthRoutes: any;

  beforeEach(async () => {
    // Dynamic import
    const module = await import('./oauthRoutes.js');
    createOAuthRoutes = module.default;

    // Create mock OAuth provider
    mockOAuthProvider = {
      oauthStorage: {
        getAuthorizationRequest: vi.fn(),
        clientDataRepository: {
          get: vi.fn(),
        },
        processConsentDenial: vi.fn(),
        processConsentApproval: vi.fn(),
      },
    };

    // Create mock request/response
    mockRequest = {
      params: {},
      query: {},
      body: {},
    };

    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
      redirect: vi.fn().mockReturnThis(),
    };

    vi.clearAllMocks();
  });

  describe('Route Creation', () => {
    it('should create OAuth routes with provider', () => {
      const router = createOAuthRoutes(mockOAuthProvider);

      expect(router).toBeDefined();
      expect(router.stack).toBeDefined();
      expect(router.stack.length).toBeGreaterThan(0);
    });

    it('should configure rate limiting', () => {
      const router = createOAuthRoutes(mockOAuthProvider);

      // Should have middleware (rate limiter)
      const hasMiddleware = router.stack.some((layer: any) => !layer.route);
      expect(hasMiddleware).toBe(true);
    });
  });

  describe('Route Handlers', () => {
    it('should handle dashboard route', async () => {
      const router = createOAuthRoutes(mockOAuthProvider);

      // Find dashboard route
      const dashboardRoute = router.stack.find((layer: any) => layer.route?.path === '/' && layer.route?.methods?.get);

      expect(dashboardRoute).toBeDefined();
      expect(dashboardRoute?.route?.stack).toBeDefined();
      expect(dashboardRoute?.route?.stack.length).toBeGreaterThan(0);
    });

    it('should handle authorize route', async () => {
      const router = createOAuthRoutes(mockOAuthProvider);

      // Find authorize route
      const authorizeRoute = router.stack.find(
        (layer: any) => layer.route?.path === '/authorize/:serverName' && layer.route?.methods?.get,
      );

      expect(authorizeRoute).toBeDefined();
      expect(authorizeRoute?.route?.stack).toBeDefined();
    });

    it('should handle callback route', async () => {
      const router = createOAuthRoutes(mockOAuthProvider);

      // Find callback route
      const callbackRoute = router.stack.find(
        (layer: any) => layer.route?.path === '/callback/:serverName' && layer.route?.methods?.get,
      );

      expect(callbackRoute).toBeDefined();
      expect(callbackRoute?.route?.stack).toBeDefined();
    });

    it('should handle restart route', async () => {
      const router = createOAuthRoutes(mockOAuthProvider);

      // Find restart route
      const restartRoute = router.stack.find(
        (layer: any) => layer.route?.path === '/restart/:serverName' && layer.route?.methods?.post,
      );

      expect(restartRoute).toBeDefined();
      expect(restartRoute?.route?.stack).toBeDefined();
    });

    it('should handle consent route', async () => {
      const router = createOAuthRoutes(mockOAuthProvider);

      // Find consent route
      const consentRoute = router.stack.find(
        (layer: any) => layer.route?.path === '/consent' && layer.route?.methods?.post,
      );

      expect(consentRoute).toBeDefined();
      expect(consentRoute?.route?.stack).toBeDefined();
    });
  });

  describe('Dashboard Rendering', () => {
    it('should handle empty services list', async () => {
      const { ServerManager } = await import('@src/core/server/serverManager.js');
      vi.mocked(ServerManager.current.getClients).mockReturnValue(new Map());

      const router = createOAuthRoutes(mockOAuthProvider);
      const dashboardRoute = router.stack.find((layer: any) => layer.route?.path === '/' && layer.route?.methods?.get);

      await dashboardRoute?.route?.stack[0].handle(mockRequest, mockResponse);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html');
      expect(mockResponse.send).toHaveBeenCalled();
    });

    it('should handle services with different statuses', async () => {
      const { ServerManager } = await import('@src/core/server/serverManager.js');
      const mockClients = new Map([
        [
          'connected-service',
          {
            name: 'connected-service',
            transport: {} as any,
            client: {} as any,
            status: ClientStatus.Connected,
            lastConnected: new Date(),
          },
        ],
        [
          'awaiting-service',
          {
            name: 'awaiting-service',
            transport: {} as any,
            client: {} as any,
            status: ClientStatus.AwaitingOAuth,
            authorizationUrl: 'https://example.com/auth',
          },
        ],
      ]);

      vi.mocked(ServerManager.current.getClients).mockReturnValue(mockClients);

      const router = createOAuthRoutes(mockOAuthProvider);
      const dashboardRoute = router.stack.find((layer: any) => layer.route?.path === '/' && layer.route?.methods?.get);

      await dashboardRoute?.route?.stack[0].handle(mockRequest, mockResponse);

      expect(mockResponse.send).toHaveBeenCalled();
      const htmlContent = mockResponse.send.mock.calls[0][0];
      expect(htmlContent).toContain('connected-service');
      expect(htmlContent).toContain('awaiting-service');
    });
  });

  describe('OAuth Flow', () => {
    it('should handle authorization request for existing service', async () => {
      const { ServerManager } = await import('@src/core/server/serverManager.js');
      mockRequest.params = { serverName: 'test-server' };

      const clientInfo = {
        name: 'test-server',
        transport: {} as any,
        client: {} as any,
        status: ClientStatus.AwaitingOAuth,
        authorizationUrl: 'https://example.com/auth',
      };

      vi.mocked(ServerManager.current.getClient).mockReturnValue(clientInfo);

      const router = createOAuthRoutes(mockOAuthProvider);
      const authorizeRoute = router.stack.find(
        (layer: any) => layer.route?.path === '/authorize/:serverName' && layer.route?.methods?.get,
      );

      await authorizeRoute?.route?.stack[0].handle(mockRequest, mockResponse);

      expect(mockResponse.redirect).toHaveBeenCalledWith('https://example.com/auth');
    });

    it('should handle non-existent service', async () => {
      const { ServerManager } = await import('../../../core/server/serverManager.js');
      mockRequest.params = { serverName: 'non-existent' };

      vi.mocked(ServerManager.current.getClient).mockReturnValue(undefined);

      const router = createOAuthRoutes(mockOAuthProvider);
      const authorizeRoute = router.stack.find(
        (layer: any) => layer.route?.path === '/authorize/:serverName' && layer.route?.methods?.get,
      );

      await authorizeRoute?.route?.stack[0].handle(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Service not found' });
    });
  });

  describe('Consent Flow', () => {
    it('should handle consent approval', async () => {
      mockRequest.body = {
        auth_request_id: 'req-123',
        action: 'approve',
        scopes: ['read'],
      };

      const authRequest = { clientId: 'client-123' };
      const client = { id: 'client-123' };

      mockOAuthProvider.oauthStorage.getAuthorizationRequest.mockReturnValue(authRequest);
      mockOAuthProvider.oauthStorage.clientDataRepository.get.mockReturnValue(client);
      mockOAuthProvider.oauthStorage.processConsentApproval.mockResolvedValue({
        redirectUrl: new URL('https://example.com/callback'),
      });

      const router = createOAuthRoutes(mockOAuthProvider);
      const consentRoute = router.stack.find(
        (layer: any) => layer.route?.path === '/consent' && layer.route?.methods?.post,
      );

      // Skip sensitive operation limiter middleware
      await consentRoute?.route?.stack[1].handle(mockRequest, mockResponse);

      expect(mockResponse.redirect).toHaveBeenCalledWith('https://example.com/callback');
    });

    it('should handle consent denial', async () => {
      mockRequest.body = {
        auth_request_id: 'req-123',
        action: 'deny',
      };

      const authRequest = { clientId: 'client-123' };
      const client = { id: 'client-123' };

      mockOAuthProvider.oauthStorage.getAuthorizationRequest.mockReturnValue(authRequest);
      mockOAuthProvider.oauthStorage.clientDataRepository.get.mockReturnValue(client);
      mockOAuthProvider.oauthStorage.processConsentDenial.mockResolvedValue(
        new URL('https://example.com/callback?error=access_denied'),
      );

      const router = createOAuthRoutes(mockOAuthProvider);
      const consentRoute = router.stack.find(
        (layer: any) => layer.route?.path === '/consent' && layer.route?.methods?.post,
      );

      await consentRoute?.route?.stack[1].handle(mockRequest, mockResponse);

      expect(mockResponse.redirect).toHaveBeenCalledWith('https://example.com/callback?error=access_denied');
    });

    it('should handle missing parameters', async () => {
      mockRequest.body = { action: 'approve' }; // Missing auth_request_id

      const router = createOAuthRoutes(mockOAuthProvider);
      const consentRoute = router.stack.find(
        (layer: any) => layer.route?.path === '/consent' && layer.route?.methods?.post,
      );

      await consentRoute?.route?.stack[1].handle(mockRequest, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Missing required parameters',
      });
    });
  });

  describe('Callback Handling', () => {
    it('should handle successful OAuth callback', async () => {
      mockRequest.params = { serverName: 'test-server' };
      mockRequest.query = { code: 'auth-code-123' };

      // Mock ClientManager to handle OAuth reconnection
      const { ClientManager } = await import('@src/core/client/clientManager.js');
      const mockCompleteOAuth = vi.fn().mockResolvedValue(undefined);
      const mockClientManager = {
        completeOAuthAndReconnect: mockCompleteOAuth,
      };
      ClientManager.getOrCreateInstance = vi.fn().mockReturnValue(mockClientManager as any);

      const router = createOAuthRoutes(mockOAuthProvider);
      const callbackRoute = router.stack.find(
        (layer: any) => layer.route?.path === '/callback/:serverName' && layer.route?.methods?.get,
      );

      await callbackRoute?.route?.stack[0].handle(mockRequest, mockResponse);

      // Verify ClientManager method was called with correct parameters
      expect(mockCompleteOAuth).toHaveBeenCalledWith('test-server', 'auth-code-123');
      expect(mockResponse.redirect).toHaveBeenCalledWith('/oauth?success=1');
    });

    it('should update loading state tracker after OAuth completion', async () => {
      mockRequest.params = { serverName: 'test-server' };
      mockRequest.query = { code: 'auth-code-123' };

      // Mock loading manager with state tracker
      const mockStateTracker = {
        getServerState: vi.fn().mockReturnValue({ name: 'test-server', state: LoadingState.Loading }),
        updateServerState: vi.fn(),
      };
      const mockLoadingManager = {
        getStateTracker: vi.fn().mockReturnValue(mockStateTracker),
      } as any;

      // Mock ClientManager to handle OAuth reconnection
      const { ClientManager } = await import('@src/core/client/clientManager.js');
      const mockCompleteOAuth = vi.fn().mockResolvedValue(undefined);
      const mockClientManager = {
        completeOAuthAndReconnect: mockCompleteOAuth,
      };
      ClientManager.getOrCreateInstance = vi.fn().mockReturnValue(mockClientManager as any);

      const router = createOAuthRoutes(mockOAuthProvider, mockLoadingManager);
      const callbackRoute = router.stack.find(
        (layer: any) => layer.route?.path === '/callback/:serverName' && layer.route?.methods?.get,
      );

      await callbackRoute?.route?.stack[0].handle(mockRequest, mockResponse);

      // Verify ClientManager method was called
      expect(mockCompleteOAuth).toHaveBeenCalledWith('test-server', 'auth-code-123');

      // Verify state tracker is updated
      expect(mockStateTracker.updateServerState).toHaveBeenCalledWith('test-server', LoadingState.Ready);

      expect(mockResponse.redirect).toHaveBeenCalledWith('/oauth?success=1');
    });

    it('should handle OAuth error', async () => {
      mockRequest.params = { serverName: 'test-server' };
      mockRequest.query = { error: 'access_denied' };

      const router = createOAuthRoutes(mockOAuthProvider);
      const callbackRoute = router.stack.find(
        (layer: any) => layer.route?.path === '/callback/:serverName' && layer.route?.methods?.get,
      );

      await callbackRoute?.route?.stack[0].handle(mockRequest, mockResponse);

      expect(mockResponse.redirect).toHaveBeenCalledWith('/oauth?error=access_denied');
    });
  });
});
