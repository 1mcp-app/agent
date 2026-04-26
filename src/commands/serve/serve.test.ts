import path from 'path';

import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { configureGlobalLogger } from '@src/logger/configureGlobalLogger.js';
import { displayLogo } from '@src/utils/ui/logo.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { serveCommand, ServeOptions } from './serve.js';

// Mock dependencies
vi.mock('@src/logger/configureGlobalLogger.js');
vi.mock('@src/config/configManager.js', () => ({
  ConfigManager: {
    getInstance: vi.fn().mockReturnValue({
      getTransportConfig: vi.fn().mockReturnValue({}),
      getAppConfig: vi.fn().mockReturnValue({}),
      initialize: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));
vi.mock('@src/domains/preset/manager/presetManager.js');
vi.mock('@src/server.js');
vi.mock('@src/config/configContext.js', () => ({
  default: {
    getInstance: vi.fn().mockReturnValue({
      setConfigPath: vi.fn(),
      setConfigDir: vi.fn(),
      reset: vi.fn(),
      getResolvedConfigPath: vi.fn().mockReturnValue('/test/config.json'),
    }),
  },
}));
vi.mock('@src/constants.js');
vi.mock('@src/core/instructions/instructionAggregator.js');
vi.mock('@src/core/instructions/templateValidator.js');
vi.mock('@src/core/loading/mcpLoadingManager.js');
vi.mock('@src/core/configChangeHandler.js', () => ({
  ConfigChangeHandler: {
    getInstance: vi.fn().mockReturnValue({
      initialize: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));
vi.mock('@src/core/server/pidFileManager.js', () => ({
  writePidFile: vi.fn(),
  registerPidFileCleanup: vi.fn(),
  cleanupPidFileOnExit: vi.fn(),
}));
vi.mock('@src/transport/http/server.js', () => ({
  ExpressServer: vi.fn(),
}));
vi.mock('@src/domains/preset/parsers/tagQueryParser.js');
vi.mock('@src/utils/ui/logo.js');
vi.mock('@src/logger/logger.js');

// Mock process.exit to prevent actual exit
const originalExit = process.exit;
beforeEach(() => {
  process.exit = vi.fn() as any;
});

afterEach(() => {
  process.exit = originalExit;
});
vi.mock('@src/core/server/agentConfig.js', () => ({
  AgentConfigManager: {
    getInstance: vi.fn().mockReturnValue({
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'features') return { scopeValidation: false, auth: false };
        return undefined;
      }),
      updateConfig: vi.fn(),
      isScopeValidationEnabled: vi.fn().mockReturnValue(false),
      isAuthEnabled: vi.fn().mockReturnValue(false),
      getConfig: vi.fn().mockReturnValue({}),
    }),
  },
}));

describe('serveCommand - config-dir session isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset singleton
    (AgentConfigManager as any).instance = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should use config-dir for session storage when config-dir is specified', async () => {
    const options: ServeOptions = {
      transport: 'stdio',
      port: 3050,
      host: '127.0.0.1',
      'config-dir': '.tmp-test',
      pagination: false,
      auth: false,
      'enable-auth': false,
      'enable-scope-validation': true,
      'enable-enhanced-security': false,
      'session-ttl': 1440,
      'trust-proxy': 'loopback',
      'health-info-level': 'minimal',
      'rate-limit-window': 15,
      'rate-limit-max': 100,
      'enable-async-loading': false,
      'async-min-servers': 1,
      'async-timeout': 30000,
      'async-batch-notifications': true,
      'async-batch-delay': 100,
      'async-notify-on-ready': true,
      'enable-lazy-loading': false,
      'lazy-mode': 'full',
      'lazy-inline-catalog': false,
      'lazy-catalog-format': 'grouped',
      'lazy-cache-max-entries': 1000,
      'lazy-cache-ttl': 300000,
      'lazy-preload': undefined,
      'lazy-preload-keywords': undefined,
      'lazy-fallback-on-error': undefined,
      'lazy-fallback-timeout': undefined,
      'enable-config-reload': true,
      'config-reload-debounce': 500,
      'enable-env-substitution': true,
      'enable-session-persistence': true,
      'session-persist-requests': 100,
      'session-persist-interval': 5,
      'session-background-flush': 60,
      'enable-client-notifications': true,
      'enable-jsonrpc-error-logging': true,
      // Internal tool flags (default values for tests)
      'enable-internal-tools': false,
    };

    // Get the mocked AgentConfigManager instance
    const configManager = AgentConfigManager.getInstance();
    const updateConfigSpy = vi.mocked(configManager.updateConfig);

    // Add debugging to see if updateConfig is called
    updateConfigSpy.mockImplementation((config) => {
      console.log('updateConfig called with:', config);
    });

    try {
      await serveCommand(options);
    } catch (error) {
      console.log('Error in serveCommand:', error);
      // Ignore errors from mocked dependencies
    }

    // Verify that sessionStoragePath was set to config-dir/sessions
    expect(updateConfigSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({
          sessionStoragePath: path.join('.tmp-test', 'sessions'),
        }),
      }),
    );
  });

  it('should use explicit session-storage-path when both config-dir and session-storage-path are specified', async () => {
    const options: ServeOptions = {
      transport: 'stdio',
      port: 3050,
      host: '127.0.0.1',
      'config-dir': '.tmp-test',
      'session-storage-path': '/custom/sessions',
      pagination: false,
      auth: false,
      'enable-auth': false,
      'enable-scope-validation': true,
      'enable-enhanced-security': false,
      'session-ttl': 1440,
      'trust-proxy': 'loopback',
      'health-info-level': 'minimal',
      'rate-limit-window': 15,
      'rate-limit-max': 100,
      'enable-async-loading': false,
      'async-min-servers': 1,
      'async-timeout': 30000,
      'async-batch-notifications': true,
      'async-batch-delay': 100,
      'async-notify-on-ready': true,
      'enable-lazy-loading': false,
      'lazy-mode': 'full',
      'lazy-inline-catalog': false,
      'lazy-catalog-format': 'grouped',
      'lazy-cache-max-entries': 1000,
      'lazy-cache-ttl': 300000,
      'lazy-preload': undefined,
      'lazy-preload-keywords': undefined,
      'lazy-fallback-on-error': undefined,
      'lazy-fallback-timeout': undefined,
      'enable-config-reload': true,
      'config-reload-debounce': 500,
      'enable-env-substitution': true,
      'enable-session-persistence': true,
      'session-persist-requests': 100,
      'session-persist-interval': 5,
      'session-background-flush': 60,
      'enable-client-notifications': true,
      'enable-jsonrpc-error-logging': true,
      // Internal tool flags (default values for tests)
      'enable-internal-tools': false,
    };

    // Get the mocked AgentConfigManager instance
    const configManager = AgentConfigManager.getInstance();
    const updateConfigSpy = vi.mocked(configManager.updateConfig);

    try {
      await serveCommand(options);
    } catch (error) {
      console.log('Error in serveCommand:', error);
      // Ignore errors from mocked dependencies
    }

    // Verify that explicit session-storage-path takes precedence
    expect(updateConfigSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({
          sessionStoragePath: '/custom/sessions',
        }),
      }),
    );
  });

  it('should use global default when neither config-dir nor session-storage-path is specified', async () => {
    const options: ServeOptions = {
      transport: 'stdio',
      port: 3050,
      host: '127.0.0.1',
      pagination: false,
      auth: false,
      'enable-auth': false,
      'enable-scope-validation': true,
      'enable-enhanced-security': false,
      'session-ttl': 1440,
      'trust-proxy': 'loopback',
      'health-info-level': 'minimal',
      'rate-limit-window': 15,
      'rate-limit-max': 100,
      'enable-async-loading': false,
      'async-min-servers': 1,
      'async-timeout': 30000,
      'async-batch-notifications': true,
      'async-batch-delay': 100,
      'async-notify-on-ready': true,
      'enable-lazy-loading': false,
      'lazy-mode': 'full',
      'lazy-inline-catalog': false,
      'lazy-catalog-format': 'grouped',
      'lazy-cache-max-entries': 1000,
      'lazy-cache-ttl': 300000,
      'lazy-preload': undefined,
      'lazy-preload-keywords': undefined,
      'lazy-fallback-on-error': undefined,
      'lazy-fallback-timeout': undefined,
      'enable-config-reload': true,
      'config-reload-debounce': 500,
      'enable-env-substitution': true,
      'enable-session-persistence': true,
      'session-persist-requests': 100,
      'session-persist-interval': 5,
      'session-background-flush': 60,
      'enable-client-notifications': true,
      'enable-jsonrpc-error-logging': true,
      // Internal tool flags (default values for tests)
      'enable-internal-tools': false,
    };

    // Get the mocked AgentConfigManager instance
    const configManager = AgentConfigManager.getInstance();
    const updateConfigSpy = vi.mocked(configManager.updateConfig);

    try {
      await serveCommand(options);
    } catch (error) {
      console.log('Error in serveCommand:', error);
      // Ignore errors from mocked dependencies
    }

    // Verify that sessionStoragePath is undefined (will use global default)
    expect(updateConfigSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({
          sessionStoragePath: undefined,
        }),
      }),
    );
  });

  describe('Graceful Shutdown with PID File Cleanup', () => {
    it('should import cleanupPidFileOnExit without errors', async () => {
      // Verify that the cleanupPidFileOnExit function is available
      const { cleanupPidFileOnExit } = await import('@src/core/server/pidFileManager.js');
      expect(typeof cleanupPidFileOnExit).toBe('function');
    });
  });

  describe('appConfig transport/port/host precedence', () => {
    const baseOptions: Omit<ServeOptions, 'transport' | 'port' | 'host'> = {
      pagination: false,
      auth: false,
      'enable-auth': false,
      'enable-scope-validation': true,
      'enable-enhanced-security': false,
      'session-ttl': 1440,
      'trust-proxy': 'loopback',
      'health-info-level': 'minimal',
      'rate-limit-window': 15,
      'rate-limit-max': 100,
      'enable-async-loading': false,
      'async-min-servers': 1,
      'async-timeout': 30000,
      'async-batch-notifications': true,
      'async-batch-delay': 100,
      'async-notify-on-ready': true,
      'enable-lazy-loading': false,
      'lazy-mode': 'full',
      'lazy-inline-catalog': false,
      'lazy-catalog-format': 'grouped',
      'lazy-cache-max-entries': 1000,
      'enable-config-reload': true,
      'config-reload-debounce': 500,
      'enable-env-substitution': true,
      'enable-session-persistence': true,
      'session-persist-requests': 100,
      'session-persist-interval': 5,
      'session-background-flush': 60,
      'enable-client-notifications': true,
      'enable-jsonrpc-error-logging': true,
      'enable-internal-tools': false,
    };

    it('uses appConfig.transport when CLI transport is absent', async () => {
      const { ConfigManager } = await import('@src/config/configManager.js');
      vi.mocked(ConfigManager.getInstance).mockReturnValue({
        getTransportConfig: vi.fn().mockReturnValue({}),
        getAppConfig: vi.fn().mockReturnValue({ transport: 'stdio' }),
        initialize: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
      } as any);

      const configManager = AgentConfigManager.getInstance();
      const updateConfigSpy = vi.mocked(configManager.updateConfig);

      const options: ServeOptions = {
        ...baseOptions,
        transport: undefined as any,
        port: undefined as any,
        host: undefined as any,
      };

      try {
        await serveCommand(options);
      } catch {
        // ignore mock errors
      }

      expect(updateConfigSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          port: 3050,
          host: '127.0.0.1',
        }),
      );
      expect(displayLogo).not.toHaveBeenCalled();
    });

    it('CLI transport overrides appConfig.transport', async () => {
      const { ConfigManager } = await import('@src/config/configManager.js');
      vi.mocked(ConfigManager.getInstance).mockReturnValue({
        getTransportConfig: vi.fn().mockReturnValue({}),
        getAppConfig: vi.fn().mockReturnValue({ transport: 'stdio' }),
        initialize: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
      } as any);

      const configManager = AgentConfigManager.getInstance();
      const updateConfigSpy = vi.mocked(configManager.updateConfig);

      const options: ServeOptions = { ...baseOptions, transport: 'http', port: 3050, host: '127.0.0.1' };

      try {
        await serveCommand(options);
      } catch {
        // ignore mock errors
      }

      // updateConfig should have been called (http path taken)
      expect(updateConfigSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          port: 3050,
          host: '127.0.0.1',
        }),
      );
      expect(displayLogo).toHaveBeenCalledWith(
        expect.objectContaining({
          transport: 'http',
          port: 3050,
          host: '127.0.0.1',
        }),
      );
    });

    it('uses config.toml app settings when matching CLI flags are omitted', async () => {
      const { ConfigManager } = await import('@src/config/configManager.js');
      vi.mocked(ConfigManager.getInstance).mockReturnValue({
        getTransportConfig: vi.fn().mockReturnValue({}),
        getAppConfig: vi.fn().mockReturnValue({
          transport: 'http',
          port: 4180,
          host: '0.0.0.0',
          logLevel: 'debug',
          logFile: '/tmp/1mcp.log',
          auth: {
            enabled: true,
            sessionTtl: 60,
            rateLimitWindow: 2,
            rateLimitMax: 7,
            trustProxy: 'uniquelocal',
            enableScopeValidation: false,
            enableEnhancedSecurity: true,
          },
          asyncLoading: {
            enabled: true,
            minServers: 3,
            timeout: 1234,
            batchNotifications: false,
            batchDelay: 55,
          },
          lazyLoading: {
            enabled: true,
            cacheMaxEntries: 42,
            inlineCatalog: true,
          },
          configReload: {
            enabled: false,
            debounce: 250,
          },
        }),
        initialize: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
      } as any);

      const configManager = AgentConfigManager.getInstance();
      const updateConfigSpy = vi.mocked(configManager.updateConfig);

      const options: ServeOptions = {
        pagination: false,
        'health-info-level': 'minimal',
        'async-notify-on-ready': true,
        'lazy-catalog-format': 'grouped',
        'enable-env-substitution': true,
        'enable-session-persistence': true,
        'session-persist-requests': 100,
        'session-persist-interval': 5,
        'session-background-flush': 60,
        'enable-client-notifications': true,
        'enable-jsonrpc-error-logging': true,
        'enable-internal-tools': false,
      };

      try {
        await serveCommand(options);
      } catch {
        // ignore mock errors
      }

      expect(configureGlobalLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          'log-level': 'debug',
          'log-file': '/tmp/1mcp.log',
        }),
        'http',
      );
      expect(displayLogo).not.toHaveBeenCalled();
      expect(updateConfigSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          host: '0.0.0.0',
          port: 4180,
          trustProxy: 'uniquelocal',
          auth: expect.objectContaining({
            enabled: true,
            sessionTtlMinutes: 60,
            oauthTokenTtlMs: 60 * 60 * 1000,
          }),
          rateLimit: {
            windowMs: 2 * 60 * 1000,
            max: 7,
          },
          features: expect.objectContaining({
            auth: true,
            scopeValidation: false,
            enhancedSecurity: true,
            configReload: false,
          }),
          asyncLoading: expect.objectContaining({
            enabled: true,
            waitForMinimumServers: 3,
            initialLoadTimeoutMs: 1234,
            batchNotifications: false,
            batchDelayMs: 55,
          }),
          lazyLoading: expect.objectContaining({
            enabled: true,
            inlineCatalog: true,
            cache: expect.objectContaining({
              maxEntries: 42,
            }),
          }),
          configReload: {
            debounceMs: 250,
          },
        }),
      );
    });

    it('CLI flags override config.toml app settings', async () => {
      const { ConfigManager } = await import('@src/config/configManager.js');
      vi.mocked(ConfigManager.getInstance).mockReturnValue({
        getTransportConfig: vi.fn().mockReturnValue({}),
        getAppConfig: vi.fn().mockReturnValue({
          transport: 'stdio',
          port: 4180,
          host: '0.0.0.0',
          logLevel: 'debug',
          logFile: '/tmp/1mcp.log',
          auth: {
            enabled: true,
            sessionTtl: 60,
            rateLimitWindow: 2,
            rateLimitMax: 7,
            trustProxy: 'uniquelocal',
          },
        }),
        initialize: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
      } as any);

      const configManager = AgentConfigManager.getInstance();
      const updateConfigSpy = vi.mocked(configManager.updateConfig);

      const options: ServeOptions = {
        pagination: false,
        transport: 'http',
        port: 3051,
        host: '127.0.0.2',
        'log-level': 'warn',
        'log-file': '/tmp/cli.log',
        'enable-auth': false,
        'session-ttl': 15,
        'rate-limit-window': 9,
        'rate-limit-max': 99,
        'trust-proxy': 'loopback',
        'health-info-level': 'minimal',
        'async-notify-on-ready': true,
        'lazy-catalog-format': 'grouped',
        'enable-env-substitution': true,
        'enable-session-persistence': true,
        'session-persist-requests': 100,
        'session-persist-interval': 5,
        'session-background-flush': 60,
        'enable-client-notifications': true,
        'enable-jsonrpc-error-logging': true,
        'enable-internal-tools': false,
      };

      try {
        await serveCommand(options);
      } catch {
        // ignore mock errors
      }

      expect(configureGlobalLogger).toHaveBeenCalledWith(expect.objectContaining({ 'log-level': 'warn' }), 'http');
      expect(updateConfigSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          host: '127.0.0.2',
          port: 3051,
          trustProxy: 'loopback',
          auth: expect.objectContaining({
            enabled: false,
            sessionTtlMinutes: 15,
          }),
          rateLimit: {
            windowMs: 9 * 60 * 1000,
            max: 99,
          },
        }),
      );
    });
  });
});
