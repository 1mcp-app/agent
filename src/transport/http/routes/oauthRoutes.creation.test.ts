import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@src/logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  debugIf: vi.fn(),
}));

vi.mock('@src/core/server/agentConfig.js', () => ({
  AgentConfigManager: {
    getInstance: vi.fn(() => ({
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'rateLimit') return { windowMs: 900000, max: 100 };
        return undefined;
      }),
      getRateLimitWindowMs: () => 900000,
      getRateLimitMax: () => 100,
    })),
  },
}));

vi.mock('express-rate-limit', () => ({
  default: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

vi.mock('../middlewares/securityMiddleware.js', () => ({
  sensitiveOperationLimiter: (_req: any, _res: any, next: any) => next(),
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

describe('OAuth Routes creation', () => {
  let mockOAuthProvider: any;
  let createOAuthRoutes: any;

  beforeEach(async () => {
    const module = await import('./oauthRoutes.js');
    createOAuthRoutes = module.default;
    mockOAuthProvider = {
      oauthFlow: {
        submitConsent: vi.fn(),
        startBackendOAuth: vi.fn(),
        restartBackendOAuth: vi.fn(),
        completeBackendOAuthCallback: vi.fn(),
        getBackendOAuthDashboard: vi.fn(),
      },
      oauthStorage: {
        getAuthorizationRequest: vi.fn(),
        clientDataRepository: {
          get: vi.fn(),
        },
        processConsentDenial: vi.fn(),
        processConsentApproval: vi.fn(),
      },
    };
    vi.clearAllMocks();
  });

  it('should create OAuth routes with provider', () => {
    const router = createOAuthRoutes(mockOAuthProvider);

    expect(router).toBeDefined();
    expect(router.stack).toBeDefined();
    expect(router.stack.length).toBeGreaterThan(0);
  });

  it('should configure rate limiting', () => {
    const router = createOAuthRoutes(mockOAuthProvider);

    const hasMiddleware = router.stack.some((layer: any) => !layer.route);
    expect(hasMiddleware).toBe(true);
  });
});
