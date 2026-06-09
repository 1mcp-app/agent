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

  describe('template integration', () => {
    it('should load static servers when no templates are present', async () => {
      const config = {
        version: '1.0.0',
        mcpServers: {
          filesystem: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
            env: {},
            tags: ['filesystem'],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(config, null, 2));

      const result = await configManager.loadConfigWithTemplates();

      expect(result.staticServers).toEqual(config.mcpServers);
      expect(result.templateServers).toEqual({});
      expect(result.errors).toEqual([]);
    });

    it('should return empty template servers when no context is provided', async () => {
      const config = {
        mcpServers: {
          filesystem: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
            env: {},
            tags: ['filesystem'],
          },
        },
        mcpTemplates: {
          'project-serena': {
            command: 'npx',
            args: ['-y', 'serena', '{{project.path}}'],
            env: { PROJECT_ID: '{{project.custom.projectId}}' } as Record<string, string>,
            tags: ['filesystem'],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(config, null, 2));

      const result = await configManager.loadConfigWithTemplates();

      expect(result.staticServers).toEqual(config.mcpServers);
      expect(result.templateServers).toEqual({});
      expect(result.errors).toEqual([]);
    });
  });

  describe('utility methods integration', () => {
    it('should get available tags correctly', () => {
      const tags = configManager.getAvailableTags();
      expect(tags).toContain('server1');
      expect(tags).toContain('server2');
      expect(tags).toContain('test');
      expect(tags).toEqual([...tags].sort());
    });

    it('should skip tags from disabled servers', async () => {
      const configWithDisabled = {
        mcpServers: {
          'test-server-1': {
            command: 'node',
            args: ['server1.js'],
            tags: ['enabled', 'tag1'],
          },
          'test-server-2': {
            command: 'node',
            args: ['server2.js'],
            tags: ['disabled', 'tag2'],
            disabled: true,
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(configWithDisabled, null, 2));
      await configManager.reloadConfig();

      const tags = configManager.getAvailableTags();
      expect(tags).toContain('enabled');
      expect(tags).toContain('tag1');
      expect(tags).not.toContain('disabled');
      expect(tags).not.toContain('tag2');
    });

    it('should clear template cache', () => {
      expect(() => configManager.clearTemplateCache()).not.toThrow();
    });

    it('should report template processing errors', () => {
      expect(configManager.hasTemplateProcessingErrors()).toBe(false);
      expect(configManager.getTemplateProcessingErrors()).toEqual([]);
    });
  });

  describe('isReloadEnabled', () => {
    it('should return true when config reload is enabled', () => {
      expect(configManager.isReloadEnabled()).toBe(true);
    });

    it('should return false when config reload feature is disabled', () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        const config = {
          features: { configReload: false },
        };
        return key.split('.').reduce((obj: any, k: string) => obj?.[k], config);
      });

      const newManager = ConfigManager.getInstance(configFilePath);
      expect(newManager.isReloadEnabled()).toBe(false);

      // Reset for other tests
      mockAgentConfig.get.mockImplementation((key: string) => {
        const config = {
          features: { configReload: true, envSubstitution: true },
          configReload: { debounceMs: 100 },
        };
        return key.split('.').reduce((obj: any, k: string) => obj?.[k], config);
      });
    });
  });
});
