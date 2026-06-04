import { randomBytes } from 'crypto';
import { promises as fsPromises } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { ConfigManager } from '@src/config/configManager.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock AgentConfigManager before any tests run
const mockAgentConfig = {
  get: vi.fn().mockImplementation((key: string) => {
    const config = {
      features: {
        configReload: true,
        envSubstitution: true,
      },
      configReload: {
        debounceMs: 100,
      },
    };
    return key.split('.').reduce((obj: any, k: string) => obj?.[k], config);
  }),
};

vi.mock('@src/core/server/agentConfig.js', () => ({
  AgentConfigManager: {
    getInstance: () => mockAgentConfig,
  },
}));

const watcherState = vi.hoisted(() => {
  class MockConfigWatcher {
    static instances: MockConfigWatcher[] = [];
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private listeners = new Map<string, Set<(...args: unknown[]) => void>>();

    constructor(
      _configFilePath: string,
      private loader: { isReloadEnabled: () => boolean },
    ) {
      MockConfigWatcher.instances.push(this);
    }

    on(event: string, listener: (...args: unknown[]) => void): this {
      const listeners = this.listeners.get(event) ?? new Set();
      listeners.add(listener);
      this.listeners.set(event, listeners);
      return this;
    }

    startWatching(): void {}

    stopWatching(): void {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
    }

    simulateFileChange(): void {
      if (!this.loader.isReloadEnabled()) {
        return;
      }

      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      this.debounceTimer = setTimeout(() => {
        const listeners = this.listeners.get('reload');
        if (listeners) {
          for (const listener of listeners) {
            listener();
          }
        }
        this.debounceTimer = null;
      }, 100);
    }
  }

  return {
    getLastWatcherInstance: () => MockConfigWatcher.instances.at(-1),
    MockConfigWatcher,
  };
});

vi.mock('./configWatcher.js', () => ({
  ConfigWatcher: watcherState.MockConfigWatcher,
}));

describe('ConfigManager (Integration)', () => {
  let tempConfigDir: string;
  let configFilePath: string;
  let configManager: ConfigManager;
  const originalContext7ApiKey = process.env.CONTEXT7_API_KEY;

  beforeEach(async () => {
    // Create temporary config directory
    tempConfigDir = join(tmpdir(), `config-test-${randomBytes(4).toString('hex')}`);
    await fsPromises.mkdir(tempConfigDir, { recursive: true });
    configFilePath = join(tempConfigDir, 'mcp.json');

    // Reset singleton instances
    (ConfigManager as any).instance = null;

    // Create initial config
    const initialConfig = {
      mcpServers: {
        'test-server-1': {
          command: 'node',
          args: ['server1.js'],
          tags: ['test', 'server1'],
        },
        'test-server-2': {
          command: 'node',
          args: ['server2.js'],
          tags: ['test', 'server2'],
        },
      },
    };
    await fsPromises.writeFile(configFilePath, JSON.stringify(initialConfig, null, 2));

    configManager = ConfigManager.getInstance(configFilePath);
    await configManager.initialize();
    await configManager.stop();
  });

  afterEach(async () => {
    if (originalContext7ApiKey === undefined) {
      delete process.env.CONTEXT7_API_KEY;
    } else {
      process.env.CONTEXT7_API_KEY = originalContext7ApiKey;
    }

    if (configManager) {
      await configManager.stop();
    }
    try {
      await fsPromises.rm(tempConfigDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    vi.clearAllMocks();

    // Restore mock for other tests
    mockAgentConfig.get.mockImplementation((key: string) => {
      const config = {
        features: {
          configReload: true,
          envSubstitution: true,
        },
        configReload: {
          debounceMs: 100,
        },
      };
      return key.split('.').reduce((obj: any, k: string) => obj?.[k], config);
    });
  });

  describe('error handling integration', () => {
    it('should throw on invalid JSON', async () => {
      await fsPromises.writeFile(configFilePath, 'invalid json content');

      // Reset singleton to force creation of new instance
      (ConfigManager as any).instance = null;

      // getInstance should work, but initialize should fail
      const newManager = ConfigManager.getInstance(configFilePath);
      await expect(newManager.initialize()).rejects.toThrow();
    });

    it('should handle missing mcpServers section', async () => {
      const configWithoutServers = { otherConfig: 'value' };
      await fsPromises.writeFile(configFilePath, JSON.stringify(configWithoutServers, null, 2));

      // Reset singleton to force creation of new instance
      (ConfigManager as any).instance = null;
      const newManager = ConfigManager.getInstance(configFilePath);
      const config = newManager.getTransportConfig();
      expect(typeof config).toBe('object');
      expect(Object.keys(config)).toHaveLength(0);
    });
  });

  describe('configuration validation integration', () => {
    it('should validate and load correct configuration', async () => {
      const validConfig = {
        mcpServers: {
          'valid-server': {
            command: 'echo',
            args: ['hello'],
            tags: ['test'],
            disabled: false,
            timeout: 5000,
            connectionTimeout: 3000,
            requestTimeout: 10000,
            envFilter: ['TEST_VAR'],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(validConfig, null, 2));
      await configManager.reloadConfig();

      const config = configManager.getTransportConfig();
      expect(Object.keys(config)).toContain('valid-server');
      expect(config['valid-server'].command).toBe('echo');
      expect(config['valid-server'].args).toEqual(['hello']);
      expect(config['valid-server'].tags).toEqual(['test']);
      expect(config['valid-server'].timeout).toBe(5000);
    });

    it('should skip invalid server configurations', async () => {
      const invalidConfig = {
        mcpServers: {
          'invalid-server': {
            command: 'echo',
            args: 'not-an-array', // Should be array
            timeout: 'not-a-number', // Should be number
            url: 'invalid-url', // Should be valid URL
            maxRestarts: -1, // Should be >= 0
          },
          'valid-server': {
            command: 'node',
            args: ['server.js'],
            tags: ['valid'],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(invalidConfig, null, 2));
      await configManager.reloadConfig();

      const config = configManager.getTransportConfig();
      expect(Object.keys(config)).not.toContain('invalid-server');
      expect(Object.keys(config)).toContain('valid-server');
      expect(config['valid-server'].command).toBe('node');
    });

    it('should handle completely invalid server configuration', async () => {
      const completelyInvalidConfig = {
        mcpServers: {
          'bad-server': null, // Completely invalid
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(completelyInvalidConfig, null, 2));
      await configManager.reloadConfig();

      const config = configManager.getTransportConfig();
      expect(Object.keys(config)).toHaveLength(0);
    });

    it('should handle mixed valid and invalid configurations', async () => {
      const mixedConfig = {
        mcpServers: {
          'server-1': {
            command: 'echo',
            args: ['test1'],
            tags: ['tag1'],
          },
          'server-2': {
            command: 123, // Invalid - should be string
            args: ['test2'],
          },
          'server-3': {
            command: 'node',
            args: ['test3'],
            restartDelay: -100, // Invalid - should be >= 0
          },
          'server-4': {
            command: 'python',
            args: ['test4'],
            tags: ['tag4'],
            env: ['VALID_ENV'], // Valid - array of strings
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(mixedConfig, null, 2));
      await configManager.reloadConfig();

      const config = configManager.getTransportConfig();
      expect(Object.keys(config)).toHaveLength(2);
      expect(Object.keys(config)).toContain('server-1');
      expect(Object.keys(config)).toContain('server-4');
      expect(Object.keys(config)).not.toContain('server-2');
      expect(Object.keys(config)).not.toContain('server-3');
    });
  });

  describe('reloadConfig', () => {
    it('should reload configuration on demand', async () => {
      const updatedConfig = {
        mcpServers: {
          'new-server': {
            command: 'node',
            args: ['new.js'],
            tags: ['new'],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(updatedConfig, null, 2));
      await configManager.reloadConfig();

      const config = configManager.getTransportConfig();
      expect(Object.keys(config)).toContain('new-server');
    });
  });
});
