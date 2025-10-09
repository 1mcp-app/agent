import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { serveCommand, ServeOptions } from './serve.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';

// Mock dependencies
vi.mock('@src/utils/core/configureGlobalLogger.js');
vi.mock('@src/config/mcpConfigManager.js');
vi.mock('@src/utils/config/presetManager.js');
vi.mock('../../core/server/serverManager.js');
vi.mock('../../transport/http/server.js');
vi.mock('../../transport/stdio/stdioServerTransport.js');

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
    };

    // Create a spy on AgentConfigManager.updateConfig
    const configManager = AgentConfigManager.getInstance();
    const updateConfigSpy = vi.spyOn(configManager, 'updateConfig');

    // Mock setupServer to prevent actual server initialization
    vi.doMock('../../core/server/serverManager.js', () => ({
      setupServer: vi.fn().mockResolvedValue({
        serverManager: {},
        loadingManager: undefined,
        asyncOrchestrator: undefined,
        instructionAggregator: {},
      }),
    }));

    try {
      await serveCommand(options);
    } catch {
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
    };

    const configManager = AgentConfigManager.getInstance();
    const updateConfigSpy = vi.spyOn(configManager, 'updateConfig');

    vi.doMock('../../core/server/serverManager.js', () => ({
      setupServer: vi.fn().mockResolvedValue({
        serverManager: {},
        loadingManager: undefined,
        asyncOrchestrator: undefined,
        instructionAggregator: {},
      }),
    }));

    try {
      await serveCommand(options);
    } catch {
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
    };

    const configManager = AgentConfigManager.getInstance();
    const updateConfigSpy = vi.spyOn(configManager, 'updateConfig');

    vi.doMock('../../core/server/serverManager.js', () => ({
      setupServer: vi.fn().mockResolvedValue({
        serverManager: {},
        loadingManager: undefined,
        asyncOrchestrator: undefined,
        instructionAggregator: {},
      }),
    }));

    try {
      await serveCommand(options);
    } catch {
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
