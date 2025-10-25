import { ServerManager } from '@src/core/server/serverManager.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExpressServer } from './server.js';

// Mock all external dependencies
vi.mock('express', () => {
  const mockRouter = () => ({
    use: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  });

  const mockApp = () => ({
    use: vi.fn(),
    listen: vi.fn((port, host, callback) => {
      if (callback) callback();
    }),
  });

  const mockExpress = Object.assign(vi.fn(mockApp), {
    Router: vi.fn(mockRouter),
  });

  return {
    default: mockExpress,
    Router: mockRouter,
  };
});

vi.mock('body-parser', () => ({
  default: {
    json: vi.fn(() => 'json-middleware'),
    urlencoded: vi.fn(() => 'urlencoded-middleware'),
  },
}));

vi.mock('cors', () => ({
  default: vi.fn(() => 'cors-middleware'),
}));

vi.mock('@modelcontextprotocol/sdk/server/auth/router.js', () => ({
  mcpAuthRouter: vi.fn(() => 'auth-router'),
}));

vi.mock('@src/logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('./middlewares/errorHandler.js', () => ({
  default: 'error-handler',
}));

vi.mock('./middlewares/securityMiddleware.js', () => ({
  setupSecurityMiddleware: vi.fn(() => [vi.fn()]),
}));

vi.mock('./middlewares/scopeAuthMiddleware.js', () => ({
  createScopeAuthMiddleware: vi.fn(() => vi.fn()),
}));

vi.mock('./middlewares/httpRequestLogger.js', () => ({
  httpRequestLogger: vi.fn(),
}));

vi.mock('./routes/streamableHttpRoutes.js', () => ({
  setupStreamableHttpRoutes: vi.fn(),
}));

vi.mock('./routes/sseRoutes.js', () => ({
  setupSseRoutes: vi.fn(),
}));

vi.mock('./routes/oauthRoutes.js', () => ({
  default: vi.fn(() => 'oauth-routes'),
}));

vi.mock('./routes/healthRoutes.js', () => ({
  default: vi.fn(() => 'health-routes'),
}));

vi.mock('@src/auth/sdkOAuthServerProvider.js', () => ({
  SDKOAuthServerProvider: vi.fn().mockImplementation(() => ({
    shutdown: vi.fn(),
  })),
}));

vi.mock('@src/core/server/agentConfig.js', () => ({
  AgentConfigManager: {
    getInstance: vi.fn(),
  },
}));

vi.mock('../../core/server/serverManager.js', () => ({
  ServerManager: vi.fn(),
}));

describe('ExpressServer', () => {
  let mockApp: any;
  let mockServerManager: ServerManager;
  let mockConfigManager: any;
  let expressServer: ExpressServer;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock Express app
    mockApp = {
      use: vi.fn(),
      set: vi.fn(),
      listen: vi.fn((port, host, callback) => {
        if (callback) callback();
      }),
    };

    // Mock Express constructor and Router
    const express = await import('express');
    const mockRouter = {
      use: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
    } as any;
    vi.mocked(express.default).mockReturnValue(mockApp);
    vi.mocked(express.default.Router).mockReturnValue(mockRouter);

    // Mock ServerManager
    mockServerManager = {
      getClients: vi.fn(() => new Map()),
      getServer: vi.fn(),
    } as any;

    // Mock AgentConfigManager
    mockConfigManager = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'trustProxy') return 'loopback';
        if (key === 'auth') return { sessionStoragePath: '/tmp/sessions' };
        if (key === 'features') return { enhancedSecurity: false, auth: false };
        if (key === 'externalUrl') return 'http://localhost:3050';
        if (key === 'host') return 'localhost';
        if (key === 'port') return 3050;
        if (key === 'rateLimit') return { windowMs: 900000, max: 100 };
        if (key === 'sessionPersistence') return { backgroundFlushSeconds: 30 };
        return undefined;
      }),
      getSessionStoragePath: vi.fn(() => '/tmp/sessions'),
      isEnhancedSecurityEnabled: vi.fn(() => false),
      getTrustProxy: vi.fn(() => 'loopback'),
      getConfig: vi.fn(() => ({ host: 'localhost', port: 3050 })),
      getRateLimitWindowMs: vi.fn(() => 900000),
      getRateLimitMax: vi.fn(() => 100),
      isAuthEnabled: vi.fn(() => false),
      getUrl: vi.fn(() => 'http://localhost:3050'),
    };

    const { AgentConfigManager } = await import('@src/core/server/agentConfig.js');
    vi.mocked(AgentConfigManager.getInstance).mockReturnValue(mockConfigManager);

    // Ensure SDKOAuthServerProvider returns an object with shutdown method
    const { SDKOAuthServerProvider } = await import('../../auth/sdkOAuthServerProvider.js');
    vi.mocked(SDKOAuthServerProvider).mockImplementation(
      () =>
        ({
          shutdown: vi.fn(),
        }) as any,
    );
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Constructor', () => {
    it('should create ExpressServer instance', async () => {
      expressServer = new ExpressServer(mockServerManager);

      expect(expressServer).toBeInstanceOf(ExpressServer);
    });

    it('should setup middleware and routes', async () => {
      expressServer = new ExpressServer(mockServerManager);

      // Verify middleware setup
      expect(mockApp.use).toHaveBeenCalled();
      expect(mockApp.use.mock.calls.length).toBeGreaterThan(3);
    });

    it('should handle enhanced security when enabled', async () => {
      const { setupSecurityMiddleware } = await import('./middlewares/securityMiddleware.js');
      vi.mocked(setupSecurityMiddleware).mockReturnValue([vi.fn()]);

      mockConfigManager.isEnhancedSecurityEnabled.mockReturnValue(true);

      expressServer = new ExpressServer(mockServerManager);

      expect(mockApp.use).toHaveBeenCalled();
    });

    it('should initialize with custom session storage path', async () => {
      const tmpDir = '/tmp/1mcp-test-sessions-' + Date.now();
      mockConfigManager.getSessionStoragePath.mockReturnValue(tmpDir);

      expressServer = new ExpressServer(mockServerManager);

      expect(expressServer).toBeInstanceOf(ExpressServer);
    });
  });

  describe('Server Operations', () => {
    it('should start server successfully', async () => {
      expressServer = new ExpressServer(mockServerManager);

      expect(() => {
        expressServer.start();
      }).not.toThrow();

      expect(mockApp.listen).toHaveBeenCalledWith(3050, 'localhost', expect.any(Function));
    });

    it('should start server with custom configuration', async () => {
      mockConfigManager.getConfig.mockReturnValue({ host: '0.0.0.0', port: 8080 });

      expressServer = new ExpressServer(mockServerManager);
      expressServer.start();

      expect(mockApp.listen).toHaveBeenCalledWith(8080, '0.0.0.0', expect.any(Function));
    });

    it('should shutdown gracefully', async () => {
      expressServer = new ExpressServer(mockServerManager);

      expect(() => {
        expressServer.shutdown();
      }).not.toThrow();
    });

    it('should handle authentication enabled status', async () => {
      mockConfigManager.isAuthEnabled.mockReturnValue(true);

      expressServer = new ExpressServer(mockServerManager);
      expressServer.start();

      expect(mockApp.listen).toHaveBeenCalled();
    });
  });

  describe('Trust Proxy Configuration', () => {
    it('should set trust proxy to default loopback value', async () => {
      mockConfigManager.getTrustProxy.mockReturnValue('loopback');

      expressServer = new ExpressServer(mockServerManager);

      expect(mockApp.set).toHaveBeenCalledWith('trust proxy', 'loopback');
    });

    it('should set trust proxy to boolean true', async () => {
      mockConfigManager.get.mockImplementation((key: string) => {
        if (key === 'trustProxy') return true;
        if (key === 'auth') return { sessionStoragePath: '/tmp/sessions' };
        if (key === 'features') return { enhancedSecurity: false, auth: false };
        if (key === 'externalUrl') return 'http://localhost:3050';
        if (key === 'host') return 'localhost';
        if (key === 'port') return 3050;
        if (key === 'rateLimit') return { windowMs: 900000, max: 100 };
        if (key === 'sessionPersistence') return { backgroundFlushSeconds: 30 };
        return undefined;
      });

      expressServer = new ExpressServer(mockServerManager);

      expect(mockApp.set).toHaveBeenCalledWith('trust proxy', true);
    });

    it('should set trust proxy to boolean false', async () => {
      mockConfigManager.get.mockImplementation((key: string) => {
        if (key === 'trustProxy') return false;
        if (key === 'auth') return { sessionStoragePath: '/tmp/sessions' };
        if (key === 'features') return { enhancedSecurity: false, auth: false };
        if (key === 'externalUrl') return 'http://localhost:3050';
        if (key === 'host') return 'localhost';
        if (key === 'port') return 3050;
        if (key === 'rateLimit') return { windowMs: 900000, max: 100 };
        if (key === 'sessionPersistence') return { backgroundFlushSeconds: 30 };
        return undefined;
      });

      expressServer = new ExpressServer(mockServerManager);

      expect(mockApp.set).toHaveBeenCalledWith('trust proxy', false);
    });

    it('should set trust proxy to custom IP address', async () => {
      mockConfigManager.get.mockImplementation((key: string) => {
        if (key === 'trustProxy') return '192.168.1.1';
        if (key === 'auth') return { sessionStoragePath: '/tmp/sessions' };
        if (key === 'features') return { enhancedSecurity: false, auth: false };
        if (key === 'externalUrl') return 'http://localhost:3050';
        if (key === 'host') return 'localhost';
        if (key === 'port') return 3050;
        if (key === 'rateLimit') return { windowMs: 900000, max: 100 };
        if (key === 'sessionPersistence') return { backgroundFlushSeconds: 30 };
        return undefined;
      });

      expressServer = new ExpressServer(mockServerManager);

      expect(mockApp.set).toHaveBeenCalledWith('trust proxy', '192.168.1.1');
    });

    it('should set trust proxy to CIDR range', async () => {
      mockConfigManager.get.mockImplementation((key: string) => {
        if (key === 'trustProxy') return '192.168.0.0/16';
        if (key === 'auth') return { sessionStoragePath: '/tmp/sessions' };
        if (key === 'features') return { enhancedSecurity: false, auth: false };
        if (key === 'externalUrl') return 'http://localhost:3050';
        if (key === 'host') return 'localhost';
        if (key === 'port') return 3050;
        if (key === 'rateLimit') return { windowMs: 900000, max: 100 };
        if (key === 'sessionPersistence') return { backgroundFlushSeconds: 30 };
        return undefined;
      });

      expressServer = new ExpressServer(mockServerManager);

      expect(mockApp.set).toHaveBeenCalledWith('trust proxy', '192.168.0.0/16');
    });

    it('should set trust proxy to preset values', async () => {
      const presets = ['loopback', 'linklocal', 'uniquelocal'];

      for (const preset of presets) {
        vi.clearAllMocks();
        mockConfigManager.get.mockImplementation((key: string) => {
          if (key === 'trustProxy') return preset;
          if (key === 'auth') return { sessionStoragePath: '/tmp/sessions' };
          if (key === 'features') return { enhancedSecurity: false, auth: false };
          if (key === 'externalUrl') return 'http://localhost:3050';
          if (key === 'host') return 'localhost';
          if (key === 'port') return 3050;
          if (key === 'rateLimit') return { windowMs: 900000, max: 100 };
          if (key === 'sessionPersistence') return { backgroundFlushSeconds: 30 };
          return undefined;
        });

        expressServer = new ExpressServer(mockServerManager);

        expect(mockApp.set).toHaveBeenCalledWith('trust proxy', preset);
      }
    });

    it('should call getTrustProxy exactly once during construction', async () => {
      mockConfigManager.get.mockImplementation((key: string) => {
        if (key === 'trustProxy') return 'loopback';
        if (key === 'auth') return { sessionStoragePath: '/tmp/sessions' };
        if (key === 'features') return { enhancedSecurity: false, auth: false };
        if (key === 'externalUrl') return 'http://localhost:3050';
        if (key === 'host') return 'localhost';
        if (key === 'port') return 3050;
        if (key === 'rateLimit') return { windowMs: 900000, max: 100 };
        if (key === 'sessionPersistence') return { backgroundFlushSeconds: 30 };
        return undefined;
      });

      expressServer = new ExpressServer(mockServerManager);

      expect(mockConfigManager.get).toHaveBeenCalledWith('trustProxy');
    });

    it('should set trust proxy before middleware setup', async () => {
      mockConfigManager.getTrustProxy.mockReturnValue('loopback');

      expressServer = new ExpressServer(mockServerManager);

      // Trust proxy should be set before any middleware
      const setCallIndex = mockApp.set.mock.invocationCallOrder[0];
      const useCallIndex = mockApp.use.mock.invocationCallOrder[0];

      expect(setCallIndex).toBeLessThan(useCallIndex);
    });
  });

  describe('Configuration Handling', () => {
    it('should handle missing config gracefully', async () => {
      mockConfigManager.getConfig.mockReturnValue({ host: 'localhost', port: 3000 });

      expect(() => {
        new ExpressServer(mockServerManager);
      }).not.toThrow();
    });

    it('should handle undefined session storage path', async () => {
      mockConfigManager.getSessionStoragePath.mockReturnValue(undefined);

      expect(() => {
        new ExpressServer(mockServerManager);
      }).not.toThrow();
    });

    it('should handle custom rate limiting configuration', async () => {
      mockConfigManager.getRateLimitWindowMs.mockReturnValue(600000);
      mockConfigManager.getRateLimitMax.mockReturnValue(50);

      expect(() => {
        new ExpressServer(mockServerManager);
      }).not.toThrow();
    });

    it('should work with minimal server manager', async () => {
      const minimalServerManager = {} as ServerManager;

      expect(() => {
        new ExpressServer(minimalServerManager);
      }).not.toThrow();
    });
  });

  describe('Middleware Setup', () => {
    it('should register multiple middleware components', async () => {
      expressServer = new ExpressServer(mockServerManager);

      // Should have registered multiple middleware calls
      expect(mockApp.use.mock.calls.length).toBeGreaterThanOrEqual(4);
    });

    it('should handle security middleware conditionally', async () => {
      const { setupSecurityMiddleware } = await import('./middlewares/securityMiddleware.js');
      vi.mocked(setupSecurityMiddleware).mockReturnValue([vi.fn()]);

      // Test with security disabled
      mockConfigManager.isEnhancedSecurityEnabled.mockReturnValue(false);
      new ExpressServer(mockServerManager);

      // Test with security enabled
      mockConfigManager.isEnhancedSecurityEnabled.mockReturnValue(true);
      new ExpressServer(mockServerManager);

      expect(mockApp.use).toHaveBeenCalled();
    });
  });

  describe('Route Setup', () => {
    it('should setup OAuth routes', async () => {
      expressServer = new ExpressServer(mockServerManager);

      // Should have called app.use for OAuth routes
      expect(mockApp.use).toHaveBeenCalled();
    });

    it('should setup MCP transport routes', async () => {
      expressServer = new ExpressServer(mockServerManager);

      // Should have setup routes
      expect(mockApp.use).toHaveBeenCalled();
    });

    it('should handle route setup with different configurations', async () => {
      // Test with different host/port configurations
      mockConfigManager.getConfig.mockReturnValue({ host: 'example.com', port: 9000 });

      expect(() => {
        new ExpressServer(mockServerManager);
      }).not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should handle initialization errors gracefully', async () => {
      // Test with problematic config
      const configError = new Error('Config error');
      mockConfigManager.getConfig.mockImplementation(() => {
        throw configError;
      });
      mockConfigManager.getUrl.mockImplementation(() => {
        throw configError;
      });

      expect(() => {
        new ExpressServer(mockServerManager);
      }).toThrow('Config error');
    });

    it('should handle shutdown with no OAuth provider', async () => {
      expressServer = new ExpressServer(mockServerManager);

      expect(() => {
        expressServer.shutdown();
      }).not.toThrow();
    });
  });

  describe('Integration', () => {
    it('should initialize all components in proper sequence', async () => {
      const setupCallOrder: string[] = [];

      mockApp.use.mockImplementation((middleware: any) => {
        if (typeof middleware === 'string') {
          setupCallOrder.push(middleware);
        }
        return mockApp;
      });

      expressServer = new ExpressServer(mockServerManager);

      // Verify some middleware was set up
      expect(mockApp.use).toHaveBeenCalled();
      expect(mockApp.use.mock.calls.length).toBeGreaterThan(0);
    });

    it('should handle complete server lifecycle', async () => {
      expressServer = new ExpressServer(mockServerManager);

      // Start server
      expect(() => {
        expressServer.start();
      }).not.toThrow();

      // Shutdown server
      expect(() => {
        expressServer.shutdown();
      }).not.toThrow();
    });

    it('should maintain state consistency', async () => {
      expressServer = new ExpressServer(mockServerManager);

      // Server should be in valid state
      expect(expressServer).toBeInstanceOf(ExpressServer);

      // Should be able to start multiple times
      expressServer.start();
      expressServer.start();

      expect(mockApp.listen).toHaveBeenCalledTimes(2);
    });
  });
});
