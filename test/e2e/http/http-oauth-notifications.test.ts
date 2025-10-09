import { ConfigBuilder, TestProcessManager } from '@test/e2e/utils/index.js';

import { LoadingState } from '@src/core/loading/loadingStateTracker.js';
// Import after mocking to ensure mock is applied
import { createOAuthRoutes } from '@src/transport/http/routes/oauthRoutes.js';

import type { NextFunction } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the dependencies we need to test the OAuth callback logic
const mockUpdateServerState = vi.fn();
const mockLoadingManager = {
  getStateTracker: vi.fn(() => ({
    updateServerState: mockUpdateServerState,
  })),
};

// Mock ClientManager before any imports
const mockCompleteOAuthAndReconnect = vi.fn().mockResolvedValue(undefined);
const mockClientManagerInstance = {
  completeOAuthAndReconnect: mockCompleteOAuthAndReconnect,
};
vi.mock('../../../src/core/client/clientManager.js', () => ({
  ClientManager: {
    getOrCreateInstance: vi.fn(() => mockClientManagerInstance),
  },
}));

describe('HTTP OAuth Notifications E2E', () => {
  let processManager: TestProcessManager;
  let configBuilder: ConfigBuilder;

  // Test utilities
  const createMockRequest = (serverName: string, queryParams: Record<string, string>) => ({
    params: { serverName },
    query: queryParams,
  });

  const createMockResponse = () => ({
    redirect: vi.fn(),
  });

  const findOAuthCallbackRoute = (router: any) => {
    const callbackRoute = router.stack.find(
      (layer: any) => layer.route?.path === '/callback/:serverName' && layer.route?.methods?.get,
    );

    if (!callbackRoute?.route) {
      throw new Error('OAuth callback route not found');
    }

    return callbackRoute;
  };

  beforeEach(() => {
    // Arrange - Reset all test state
    processManager = new TestProcessManager();
    configBuilder = new ConfigBuilder();
    vi.clearAllMocks(); // Use clearAllMocks instead of resetAllMocks to preserve mock implementations

    // Reset the loading manager mock
    mockUpdateServerState.mockClear();
    mockLoadingManager.getStateTracker.mockReturnValue({
      updateServerState: mockUpdateServerState,
    });

    // Reset the ClientManager mock
    mockCompleteOAuthAndReconnect.mockClear();
  });

  afterEach(async () => {
    await processManager.cleanup();
    configBuilder.cleanup();
  });

  it('should trigger LoadingStateTracker update when OAuth callback succeeds', async () => {
    // Arrange
    const mockOAuthProvider = {} as any;
    const router = createOAuthRoutes(mockOAuthProvider, mockLoadingManager as any);
    const callbackRoute = findOAuthCallbackRoute(router);

    const mockRequest = createMockRequest('test-oauth-server', { code: 'auth-code-123' });
    const mockResponse = createMockResponse();

    // Act
    const mockNext = vi.fn() as unknown as NextFunction;
    await callbackRoute.route.stack[0].handle(mockRequest, mockResponse, mockNext);

    // Assert
    expect(mockCompleteOAuthAndReconnect).toHaveBeenCalledWith('test-oauth-server', 'auth-code-123');
    expect(mockResponse.redirect).toHaveBeenCalledWith('/oauth?success=1');
    expect(mockLoadingManager.getStateTracker).toHaveBeenCalled();
    expect(mockUpdateServerState).toHaveBeenCalledWith('test-oauth-server', LoadingState.Ready);
  });

  it('should not update LoadingStateTracker when OAuth callback fails', async () => {
    // Arrange
    const mockOAuthProvider = {} as any;
    const router = createOAuthRoutes(mockOAuthProvider, mockLoadingManager as any);
    const callbackRoute = findOAuthCallbackRoute(router);

    const mockRequest = createMockRequest('test-oauth-server', { error: 'access_denied' });
    const mockResponse = createMockResponse();

    // Act
    const mockNext = vi.fn() as unknown as NextFunction;
    await callbackRoute.route.stack[0].handle(mockRequest, mockResponse, mockNext);

    // Assert
    expect(mockResponse.redirect).toHaveBeenCalledWith('/oauth?error=access_denied');
    expect(mockUpdateServerState).not.toHaveBeenCalled();
  });

  it('should complete OAuth flow successfully without loading manager', async () => {
    // Arrange
    const mockOAuthProvider = {} as any;
    const router = createOAuthRoutes(mockOAuthProvider, undefined);
    const callbackRoute = findOAuthCallbackRoute(router);

    const mockRequest = createMockRequest('test-oauth-server', { code: 'auth-code-123' });
    const mockResponse = createMockResponse();

    // Act
    const mockNext = vi.fn() as unknown as NextFunction;
    await callbackRoute.route.stack[0].handle(mockRequest, mockResponse, mockNext);

    // Assert
    expect(mockCompleteOAuthAndReconnect).toHaveBeenCalledWith('test-oauth-server', 'auth-code-123');
    expect(mockResponse.redirect).toHaveBeenCalledWith('/oauth?success=1');
    expect(mockLoadingManager.getStateTracker).not.toHaveBeenCalled();
  });
});
