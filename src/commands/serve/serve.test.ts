import path from 'path';

import { AgentConfigManager } from '@src/core/server/agentConfig.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { serveCommand, ServeOptions } from './serve.js';

// Mock dependencies
vi.mock('@src/logger/configureGlobalLogger.js');
vi.mock('@src/config/mcpConfigManager.js', () => ({
  McpConfigManager: {
    getInstance: vi.fn().mockReturnValue({
      getTransportConfig: vi.fn().mockReturnValue({}),
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
vi.mock('@src/application/services/configReloadService.js');
vi.mock('@src/core/server/pidFileManager.js');
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
      'enable-config-reload': true,
      'config-reload-debounce': 500,
      'enable-env-substitution': true,
      'enable-session-persistence': true,
      'session-persist-requests': 100,
      'session-persist-interval': 5,
      'session-background-flush': 60,
      'enable-client-notifications': true,
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
      'enable-config-reload': true,
      'config-reload-debounce': 500,
      'enable-env-substitution': true,
      'enable-session-persistence': true,
      'session-persist-requests': 100,
      'session-persist-interval': 5,
      'session-background-flush': 60,
      'enable-client-notifications': true,
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
      'enable-config-reload': true,
      'config-reload-debounce': 500,
      'enable-env-substitution': true,
      'enable-session-persistence': true,
      'session-persist-requests': 100,
      'session-persist-interval': 5,
      'session-background-flush': 60,
      'enable-client-notifications': true,
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
});
