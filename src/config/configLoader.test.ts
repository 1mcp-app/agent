import { randomBytes } from 'crypto';
import { promises as fsPromises } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { ConfigLoader } from '@src/config/configLoader.js';

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

describe('ConfigLoader', () => {
  let tempConfigDir: string;
  let configFilePath: string;
  let loader: ConfigLoader;

  beforeEach(async () => {
    tempConfigDir = join(tmpdir(), `config-loader-test-${randomBytes(4).toString('hex')}`);
    await fsPromises.mkdir(tempConfigDir, { recursive: true });
    configFilePath = join(tempConfigDir, 'mcp.json');
    loader = new ConfigLoader(configFilePath);
  });

  afterEach(async () => {
    try {
      await fsPromises.rm(tempConfigDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    vi.clearAllMocks();
  });

  describe('loadRawConfig', () => {
    it('should load raw configuration from file', async () => {
      const config = {
        mcpServers: {
          'test-server': {
            command: 'node',
            args: ['server.js'],
            tags: ['test'],
          },
        },
      };
      await fsPromises.writeFile(configFilePath, JSON.stringify(config, null, 2));

      const rawConfig = loader.loadRawConfig();
      // loadRawConfig automatically adds $schema for IDE autocompletion
      expect(rawConfig).toEqual({
        $schema: 'https://docs.1mcp.app/schemas/v1.0.0/mcp-config.json',
        ...config,
      });
    });

    it('should create default config if file does not exist', () => {
      const nonExistentPath = join(tempConfigDir, 'nonexistent.json');
      const newLoader = new ConfigLoader(nonExistentPath);
      const rawConfig = newLoader.loadRawConfig();

      expect(rawConfig).toBeDefined();
      expect(typeof rawConfig).toBe('object');
    });

    it('should handle invalid JSON gracefully', async () => {
      await fsPromises.writeFile(configFilePath, 'invalid json content');

      expect(() => loader.loadRawConfig()).toThrow();
    });
  });

  describe('loadConfigWithEnvSubstitution', () => {
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

      const newLoader = new ConfigLoader(configFilePath);
      const config = newLoader.loadConfigWithEnvSubstitution();

      expect(config['test-server'].command).toBe('substituted-value');

      delete process.env.TEST_VAR;

      // Reset mock for other tests
      mockAgentConfig.get.mockReturnValue({
        features: { configReload: true, envSubstitution: true },
        configReload: { debounceMs: 100 },
      });
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

      const newLoader = new ConfigLoader(configFilePath);
      const config = newLoader.loadConfigWithEnvSubstitution();

      expect(config['test-server'].command).toBe('${TEST_VAR}');

      delete process.env.TEST_VAR;

      // Reset for other tests
      mockAgentConfig.get.mockReturnValue({
        features: { configReload: true, envSubstitution: true },
        configReload: { debounceMs: 100 },
      });
    });

    it('should handle missing mcpServers section', async () => {
      const configWithoutServers = { otherConfig: 'value' };
      await fsPromises.writeFile(configFilePath, JSON.stringify(configWithoutServers, null, 2));

      const config = loader.loadConfigWithEnvSubstitution();
      expect(typeof config).toBe('object');
      expect(Object.keys(config)).toHaveLength(0);
    });

    it('should throw on invalid JSON', async () => {
      await fsPromises.writeFile(configFilePath, 'invalid json content');

      expect(() => loader.loadConfigWithEnvSubstitution()).toThrow();
    });
  });

  describe('validateServerConfig', () => {
    it('should validate and load correct configuration', () => {
      const validConfig = {
        command: 'echo',
        args: ['hello'],
        tags: ['test'],
        disabled: false,
        timeout: 5000,
        connectionTimeout: 3000,
        requestTimeout: 10000,
        envFilter: ['TEST_VAR'],
      };

      const result = loader.validateServerConfig('valid-server', validConfig);

      expect(result.command).toBe('echo');
      expect(result.args).toEqual(['hello']);
      expect(result.tags).toEqual(['test']);
      expect(result.timeout).toBe(5000);
    });

    it('should skip invalid server configurations', () => {
      const invalidConfig = {
        command: 'echo',
        args: 'not-an-array', // Should be array
        timeout: 'not-a-number', // Should be number
        url: 'invalid-url', // Should be valid URL
        maxRestarts: -1, // Should be >= 0
      };

      expect(() => loader.validateServerConfig('invalid-server', invalidConfig)).toThrow();
      expect(() => loader.validateServerConfig('invalid-server', invalidConfig)).toThrow(
        /Invalid configuration for server 'invalid-server'/,
      );
    });

    it('should handle completely invalid server configuration', () => {
      expect(() => loader.validateServerConfig('bad-server', null)).toThrow();
      expect(() => loader.validateServerConfig('bad-server', null)).toThrow(
        /Invalid configuration for server 'bad-server'/,
      );
    });

    it('should validate HTTP transport configuration', () => {
      const httpConfig = {
        type: 'http' as const,
        url: 'https://example.com/mcp',
        headers: {
          Authorization: 'Bearer token',
          'Content-Type': 'application/json',
        },
        tags: ['http'],
      };

      const result = loader.validateServerConfig('http-server', httpConfig);

      expect(result.type).toBe('http');
      expect(result.url).toBe('https://example.com/mcp');
      expect(result.headers).toEqual({
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      });
    });

    it('should reject invalid HTTP URL', () => {
      const invalidHttpConfig = {
        type: 'http' as const,
        url: 'not-a-valid-url',
      };

      expect(() => loader.validateServerConfig('invalid-http', invalidHttpConfig)).toThrow();
      expect(() => loader.validateServerConfig('invalid-http', invalidHttpConfig)).toThrow(
        /Invalid configuration for server 'invalid-http'/,
      );
    });

    it('should validate OAuth configuration', () => {
      const oauthConfig = {
        type: 'http' as const,
        url: 'https://api.example.com/mcp',
        oauth: {
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
          scopes: ['read', 'write'],
          autoRegister: true,
        },
      };

      const result = loader.validateServerConfig('oauth-server', oauthConfig);

      expect(result.oauth?.clientId).toBe('test-client-id');
      expect(result.oauth?.clientSecret).toBe('test-client-secret');
      expect(result.oauth?.scopes).toEqual(['read', 'write']);
      expect(result.oauth?.autoRegister).toBe(true);
    });
  });

  describe('getTransportConfig', () => {
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

      const newLoader = new ConfigLoader(configFilePath);
      const transportConfig = newLoader.loadConfigWithEnvSubstitution();
      const config = newLoader.getTransportConfig(transportConfig);

      expect(config['test-server-1']).toBeDefined();
      expect(config['test-server-2']).toBeUndefined();
    });

    it('should filter out disabled servers from transport config', async () => {
      const mixedConfig = {
        mcpServers: {
          'server-1': {
            command: 'echo',
            args: ['test1'],
            tags: ['tag1'],
          },
          'server-2': {
            command: 'node',
            args: ['test2'],
            disabled: true,
          },
          'server-3': {
            command: 'python',
            args: ['test3'],
            tags: ['tag3'],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(mixedConfig, null, 2));

      const newLoader = new ConfigLoader(configFilePath);
      const transportConfig = newLoader.loadConfigWithEnvSubstitution();
      const config = newLoader.getTransportConfig(transportConfig);

      expect(Object.keys(config)).toHaveLength(2);
      expect(Object.keys(config)).toContain('server-1');
      expect(Object.keys(config)).toContain('server-3');
      expect(Object.keys(config)).not.toContain('server-2');
    });
  });

  describe('getAvailableTags', () => {
    it('should get available tags correctly', async () => {
      const config = {
        mcpServers: {
          'test-server-1': {
            command: 'node',
            args: ['server1.js'],
            tags: ['server1', 'tag1'],
          },
          'test-server-2': {
            command: 'node',
            args: ['server2.js'],
            tags: ['server2', 'tag2'],
          },
        },
      };

      await fsPromises.writeFile(configFilePath, JSON.stringify(config, null, 2));

      const newLoader = new ConfigLoader(configFilePath);
      const transportConfig = newLoader.loadConfigWithEnvSubstitution();
      const tags = newLoader.getAvailableTags(transportConfig);

      expect(tags).toContain('server1');
      expect(tags).toContain('server2');
      expect(tags).toContain('tag1');
      expect(tags).toContain('tag2');
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

      const newLoader = new ConfigLoader(configFilePath);
      const transportConfig = newLoader.loadConfigWithEnvSubstitution();
      const tags = newLoader.getAvailableTags(transportConfig);

      expect(tags).toContain('enabled');
      expect(tags).toContain('tag1');
      expect(tags).not.toContain('disabled');
      expect(tags).not.toContain('tag2');
    });
  });

  describe('isReloadEnabled', () => {
    it('should return true when config reload feature is enabled', () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        const config = {
          features: { configReload: true },
        };
        return key.split('.').reduce((obj: any, k: string) => obj?.[k], config);
      });

      const newLoader = new ConfigLoader(configFilePath);
      expect(newLoader.isReloadEnabled()).toBe(true);

      // Reset for other tests
      mockAgentConfig.get.mockImplementation((key: string) => {
        const config = {
          features: { configReload: true, envSubstitution: true },
          configReload: { debounceMs: 100 },
        };
        return key.split('.').reduce((obj: any, k: string) => obj?.[k], config);
      });
    });

    it('should return false when config reload feature is disabled', () => {
      mockAgentConfig.get.mockImplementation((key: string) => {
        const config = {
          features: { configReload: false },
        };
        return key.split('.').reduce((obj: any, k: string) => obj?.[k], config);
      });

      const newLoader = new ConfigLoader(configFilePath);
      expect(newLoader.isReloadEnabled()).toBe(false);

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

  describe('getConfigFilePath', () => {
    it('should return the config file path', () => {
      expect(loader.getConfigFilePath()).toBe(configFilePath);
    });
  });
});
