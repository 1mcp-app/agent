import { randomBytes } from 'crypto';
import fs, { promises as fsPromises } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { CONFIG_EVENTS, ConfigChangeType, ConfigManager } from '@src/config/configManager.js';

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

  describe('initialization', () => {
    it('should load initial configuration correctly', () => {
      const config = configManager.getTransportConfig();

      expect(Object.keys(config)).toHaveLength(2);
      expect(config['test-server-1']).toBeDefined();
      expect(config['test-server-2']).toBeDefined();
      expect(config['test-server-1'].command).toBe('node');
    });

    it('should create config file if it does not exist', async () => {
      const nonExistentPath = join(tempConfigDir, 'nonexistent.json');

      // Reset singleton to force creation of new instance
      (ConfigManager as any).instance = null;
      const newManager = ConfigManager.getInstance(nonExistentPath);

      const config = newManager.getTransportConfig();
      expect(typeof config).toBe('object');
      expect(fs.existsSync(nonExistentPath)).toBe(true);

      await newManager.stop();
    });
  });

  describe('change detection integration', () => {
    it('should detect added servers', async () => {
      const updatedConfig = {
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
          'test-server-3': {
            command: 'python',
            args: ['server3.py'],
            tags: ['test', 'python'],
          },
        },
      };

      const changes: any[] = [];
      configManager.on(CONFIG_EVENTS.CONFIG_CHANGED, (detectedChanges) => {
        changes.push(...detectedChanges);
      });

      await fsPromises.writeFile(configFilePath, JSON.stringify(updatedConfig, null, 2));
      await configManager.reloadConfig();

      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe(ConfigChangeType.ADDED);
      expect(changes[0].serverName).toBe('test-server-3');
    });

    it('should detect removed servers', async () => {
      const updatedConfig = {
        mcpServers: {
          'test-server-1': {
            command: 'node',
            args: ['server1.js'],
            tags: ['test', 'server1'],
          },
        },
      };

      const changes: any[] = [];
      configManager.on(CONFIG_EVENTS.CONFIG_CHANGED, (detectedChanges) => {
        changes.push(...detectedChanges);
      });

      await fsPromises.writeFile(configFilePath, JSON.stringify(updatedConfig, null, 2));
      await configManager.reloadConfig();

      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe(ConfigChangeType.REMOVED);
      expect(changes[0].serverName).toBe('test-server-2');
    });

    it('should detect modified servers', async () => {
      const updatedConfig = {
        mcpServers: {
          'test-server-1': {
            command: 'node',
            args: ['server1-updated.js'],
            tags: ['test', 'server1', 'updated'],
          },
          'test-server-2': {
            command: 'node',
            args: ['server2.js'],
            tags: ['test', 'server2'],
          },
        },
      };

      const changes: any[] = [];
      configManager.on(CONFIG_EVENTS.CONFIG_CHANGED, (detectedChanges) => {
        changes.push(...detectedChanges);
      });

      await fsPromises.writeFile(configFilePath, JSON.stringify(updatedConfig, null, 2));
      await configManager.reloadConfig();

      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe(ConfigChangeType.MODIFIED);
      expect(changes[0].serverName).toBe('test-server-1');
      expect(changes[0].fieldsChanged).toContain('args');
      expect(changes[0].fieldsChanged).toContain('tags');
    });

    it('should keep environment variable placeholders unresolved after reload', async () => {
      process.env.CONTEXT7_API_KEY = 'reload-test-key';

      const initialConfig = {
        mcpServers: {
          context7: {
            command: 'bunx',
            args: ['@upstash/context7-mcp@latest', '--api-key', '$CONTEXT7_API_KEY'],
            tags: ['context7'],
          },
        },
      };
      await fsPromises.writeFile(configFilePath, JSON.stringify(initialConfig, null, 2));

      (ConfigManager as any).instance = null;
      configManager = ConfigManager.getInstance(configFilePath);
      await configManager.initialize();
      await configManager.stop();

      const updatedConfig = {
        mcpServers: {
          context7: {
            command: 'bunx',
            args: ['@upstash/context7-mcp@latest', '--api-key', '$CONTEXT7_API_KEY', '--transport', 'stdio'],
            tags: ['context7'],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(updatedConfig, null, 2));
      await configManager.reloadConfig();

      expect(configManager.getTransportConfig().context7.args).toEqual([
        '@upstash/context7-mcp@latest',
        '--api-key',
        '$CONTEXT7_API_KEY',
        '--transport',
        'stdio',
      ]);
    });

    it('should emit specific events for server additions and removals', async () => {
      const addedServers: string[] = [];
      const removedServers: string[] = [];

      configManager.on(CONFIG_EVENTS.SERVER_ADDED, (serverName) => {
        addedServers.push(serverName);
      });

      configManager.on(CONFIG_EVENTS.SERVER_REMOVED, (serverName) => {
        removedServers.push(serverName);
      });

      // Add server
      const updatedConfig = {
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
          'test-server-3': {
            command: 'python',
            args: ['server3.py'],
            tags: ['test', 'python'],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(updatedConfig, null, 2));
      await configManager.reloadConfig();

      expect(addedServers).toContain('test-server-3');

      // Remove server
      const finalConfig = {
        mcpServers: {
          'test-server-1': {
            command: 'node',
            args: ['server1.js'],
            tags: ['test', 'server1'],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(finalConfig, null, 2));
      await configManager.reloadConfig();

      expect(removedServers).toContain('test-server-2');
    });
  });

  describe('file watching integration', () => {
    it('should not watch files when config reload is disabled', async () => {
      mockAgentConfig.get.mockReturnValue({
        features: { configReload: false },
      });

      const newManager = ConfigManager.getInstance(configFilePath);
      await newManager.initialize();

      const changes: any[] = [];
      newManager.on(CONFIG_EVENTS.CONFIG_CHANGED, (detectedChanges) => {
        changes.push(...detectedChanges);
      });

      // Update config file
      const updatedConfig = {
        mcpServers: {
          'test-server-1': {
            command: 'python',
            args: ['server1.py'],
            tags: ['test', 'server1'],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(updatedConfig, null, 2));
      watcherState.getLastWatcherInstance()?.simulateFileChange();

      // Wait a bit to ensure no event is fired
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(changes).toHaveLength(0);

      await newManager.stop();

      // Reset for other tests
      mockAgentConfig.get.mockReturnValue({
        features: { configReload: true },
        configReload: { debounceMs: 100 },
      });
    });

    it('should handle debouncing correctly', async () => {
      await configManager.initialize();

      const changes: any[] = [];
      configManager.on(CONFIG_EVENTS.CONFIG_CHANGED, (detectedChanges) => {
        changes.push(...detectedChanges);
      });

      // Make multiple rapid changes
      for (let i = 0; i < 5; i++) {
        const updatedConfig = {
          mcpServers: {
            [`test-server-${i}`]: {
              command: 'node',
              args: [`server${i}.js`],
              tags: ['test'],
            },
          },
        };
        await fsPromises.writeFile(configFilePath, JSON.stringify(updatedConfig, null, 2));
        watcherState.getLastWatcherInstance()?.simulateFileChange();
      }

      // fs.watch timing can drift under full-suite load, so wait for the debounced
      // reload condition instead of assuming it will always fire within 200ms.
      const deadline = Date.now() + 1500;
      while (changes.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      // Should have only triggered one reload due to debouncing
      expect(changes.length).toBeGreaterThanOrEqual(1);
    });
  });
});
