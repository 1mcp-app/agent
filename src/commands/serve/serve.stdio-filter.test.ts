import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { PresetManager } from '@src/domains/preset/manager/presetManager.js';
import { setupServer } from '@src/server.js';

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
vi.mock('@src/core/server/runtimeScopeOwnership.js', () => ({
  claimRuntimeScope: vi.fn(() => ({ record: { claimId: 'test-claim' }, release: vi.fn() })),
  verifyRuntimeScopeOwnership: vi.fn(),
}));
vi.mock('@src/transport/http/server.js', () => ({
  ExpressServer: vi.fn(),
}));
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

function makeStdioOptions(overrides: Partial<ServeOptions> = {}): ServeOptions {
  return {
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
    'enable-internal-tools': false,
    ...overrides,
  };
}
describe('serveCommand - config-dir session isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset singleton
    (AgentConfigManager as any).instance = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('stdio filter selection', () => {
    const originalPresetEnv = process.env.ONE_MCP_PRESET;

    let connectTransport: ReturnType<typeof vi.fn>;
    let presetManager: {
      loadPresetsWithoutWatcher: ReturnType<typeof vi.fn>;
      hasPreset: ReturnType<typeof vi.fn>;
      getPreset: ReturnType<typeof vi.fn>;
      cleanup: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      connectTransport = vi.fn().mockResolvedValue(undefined);
      vi.mocked(setupServer).mockResolvedValue({
        serverManager: {
          connectTransport,
          getServer: vi.fn().mockReturnValue(undefined),
          getTransports: vi.fn().mockReturnValue(new Map()),
        },
        loadingManager: undefined,
        asyncOrchestrator: undefined,
        instructionAggregator: undefined,
      } as any);

      presetManager = {
        loadPresetsWithoutWatcher: vi.fn().mockResolvedValue(undefined),
        hasPreset: vi.fn().mockReturnValue(false),
        getPreset: vi.fn().mockReturnValue(undefined),
        cleanup: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(PresetManager.getInstance).mockReturnValue(presetManager as any);
    });

    afterEach(() => {
      if (originalPresetEnv === undefined) {
        delete process.env.ONE_MCP_PRESET;
      } else {
        process.env.ONE_MCP_PRESET = originalPresetEnv;
      }
    });

    it('uses parsed preset option before CLI filter fallback without reading env directly', async () => {
      const tagQuery = { $and: [{ tag: 'web' }, { $not: { tag: 'internal' } }] };
      process.env.ONE_MCP_PRESET = 'ignored-env';
      presetManager.hasPreset.mockReturnValue(true);
      presetManager.getPreset.mockImplementation((name: string) => {
        if (name !== 'production') {
          return undefined;
        }
        return {
          strategy: 'advanced',
          tagQuery,
        };
      });

      await serveCommand(makeStdioOptions({ preset: 'production', filter: 'ignored-cli' }));

      expect(connectTransport).toHaveBeenCalledWith(
        expect.anything(),
        'stdio',
        expect.objectContaining({
          tags: ['web', 'internal'],
          tagQuery,
          tagFilterMode: 'preset',
          presetName: 'production',
        }),
      );
    });

    it('exits for invalid legacy --filter instead of silently ignoring it', async () => {
      await serveCommand(makeStdioOptions({ filter: ',' }));

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(connectTransport).not.toHaveBeenCalled();
    });
  });
});
