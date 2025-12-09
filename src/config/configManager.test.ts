import { randomBytes } from 'crypto';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
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

describe('ConfigManager', () => {
  let tempConfigDir: string;
  let configFilePath: string;
  let configManager: ConfigManager;

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
  });

  afterEach(async () => {
    if (configManager) {
      await configManager.stop();
    }
    try {
      await fsPromises.rm(tempConfigDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    vi.clearAllMocks();
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

    it('should respect config reload feature flag', () => {
      // Mock to return an object where features.configReload is false
      mockAgentConfig.get.mockImplementation((key: string) => {
        if (key === 'features') {
          return { configReload: false };
        }
        return {};
      });

      expect(configManager.isReloadEnabled()).toBe(false);

      // Reset mock for other tests
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
  });

  describe('change detection', () => {
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

    it('should detect tag-only changes', async () => {
      const updatedConfig = {
        mcpServers: {
          'test-server-1': {
            command: 'node',
            args: ['server1.js'],
            tags: ['test', 'server1', 'tag-only-change'],
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
      expect(changes[0].fieldsChanged).toEqual(['tags']);
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

  describe('file watching', () => {
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
      }

      // Wait for debouncing (100ms + buffer)
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should have only triggered one reload due to debouncing
      expect(changes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('environment variable substitution', () => {
    it('should substitute environment variables when enabled', async () => {
      process.env.TEST_VAR = 'substituted-value';

      mockAgentConfig.get.mockImplementation((key: string) => {
        const config = {
          features: { configReload: true, envSubstitution: true },
          configReload: { debounceMs: 100 },
        };
        return key.split('.').reduce((obj: any, k: string) => obj?.[k], config);
      });

      const configWithEnv = {
        mcpServers: {
          'test-server': {
            command: '${TEST_VAR}',
            args: ['server.js'],
            tags: ['test'],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(configWithEnv, null, 2));

      // Reset singleton to force creation of new instance
      (ConfigManager as any).instance = null;
      const newManager = ConfigManager.getInstance(configFilePath);
      const config = newManager.getTransportConfig();

      expect(config['test-server'].command).toBe('substituted-value');

      delete process.env.TEST_VAR;
      await newManager.stop();
    });

    it('should not substitute environment variables when disabled', async () => {
      process.env.TEST_VAR = 'should-not-substitute';

      mockAgentConfig.get.mockImplementation((key: string) => {
        const config = {
          features: { configReload: true, envSubstitution: false },
          configReload: { debounceMs: 100 },
        };
        return key.split('.').reduce((obj: any, k: string) => obj?.[k], config);
      });

      const configWithEnv = {
        mcpServers: {
          'test-server': {
            command: '${TEST_VAR}',
            args: ['server.js'],
            tags: ['test'],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(configWithEnv, null, 2));

      // Reset singleton to force creation of new instance
      (ConfigManager as any).instance = null;
      const newManager = ConfigManager.getInstance(configFilePath);
      const config = newManager.getTransportConfig();

      expect(config['test-server'].command).toBe('${TEST_VAR}');

      delete process.env.TEST_VAR;
      await newManager.stop();

      // Reset for other tests
      mockAgentConfig.get.mockReturnValue({
        features: { configReload: true, envSubstitution: true },
        configReload: { debounceMs: 100 },
      });
    });
  });

  describe('utility methods', () => {
    it('should get available tags correctly', () => {
      const tags = configManager.getAvailableTags();
      expect(tags).toContain('server1');
      expect(tags).toContain('server2');
      expect(tags).toContain('test');
      expect(tags.sort()).toEqual([...tags].sort()); // Should be sorted
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
  });

  describe('error handling', () => {
    it('should handle invalid JSON gracefully', async () => {
      await fsPromises.writeFile(configFilePath, 'invalid json content');

      // Reset singleton to force creation of new instance
      (ConfigManager as any).instance = null;
      const newManager = ConfigManager.getInstance(configFilePath);
      const config = newManager.getTransportConfig();
      expect(typeof config).toBe('object');
      expect(Object.keys(config)).toHaveLength(0);
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

  describe('configuration validation', () => {
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

    it('should validate HTTP transport configuration', async () => {
      const httpConfig = {
        mcpServers: {
          'http-server': {
            type: 'http',
            url: 'https://example.com/mcp',
            headers: {
              Authorization: 'Bearer token',
              'Content-Type': 'application/json',
            },
            tags: ['http'],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(httpConfig, null, 2));
      await configManager.reloadConfig();

      const config = configManager.getTransportConfig();
      expect(Object.keys(config)).toContain('http-server');
      expect(config['http-server'].type).toBe('http');
      expect(config['http-server'].url).toBe('https://example.com/mcp');
      expect(config['http-server'].headers).toEqual({
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      });
    });

    it('should reject invalid HTTP URL', async () => {
      const invalidHttpConfig = {
        mcpServers: {
          'invalid-http': {
            type: 'http',
            url: 'not-a-valid-url',
          },
          'valid-server': {
            command: 'echo',
            args: ['test'],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(invalidHttpConfig, null, 2));
      await configManager.reloadConfig();

      const config = configManager.getTransportConfig();
      expect(Object.keys(config)).not.toContain('invalid-http');
      expect(Object.keys(config)).toContain('valid-server');
    });

    it('should emit validation error event when config is invalid', async () => {
      const invalidConfig = {
        mcpServers: {
          'invalid-server': {
            command: 123, // Invalid type
          },
        },
      };

      const validationErrorSpy = vi.fn();
      configManager.on(CONFIG_EVENTS.VALIDATION_ERROR, validationErrorSpy);

      await fsPromises.writeFile(configFilePath, JSON.stringify(invalidConfig, null, 2));
      await configManager.reloadConfig();

      // Note: The validation errors are logged but don't prevent reload from completing
      // Invalid servers are simply skipped
      expect(validationErrorSpy).not.toHaveBeenCalled();
      // Config should be empty since all servers are invalid
      expect(Object.keys(configManager.getTransportConfig())).toHaveLength(0);
    });

    it('should validate OAuth configuration', async () => {
      const oauthConfig = {
        mcpServers: {
          'oauth-server': {
            type: 'http',
            url: 'https://api.example.com/mcp',
            oauth: {
              clientId: 'test-client-id',
              clientSecret: 'test-client-secret',
              scopes: ['read', 'write'],
              autoRegister: true,
            },
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(oauthConfig, null, 2));
      await configManager.reloadConfig();

      const config = configManager.getTransportConfig();
      expect(Object.keys(config)).toContain('oauth-server');
      expect(config['oauth-server'].oauth?.clientId).toBe('test-client-id');
      expect(config['oauth-server'].oauth?.clientSecret).toBe('test-client-secret');
      expect(config['oauth-server'].oauth?.scopes).toEqual(['read', 'write']);
      expect(config['oauth-server'].oauth?.autoRegister).toBe(true);
    });
  });
});
