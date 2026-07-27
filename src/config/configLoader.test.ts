import { randomBytes } from 'crypto';
import { promises as fsPromises } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { ConfigLoader } from '@src/config/configLoader.js';
import { MCP_CONFIG_SCHEMA_URL } from '@src/constants/schema.js';
import logger from '@src/logger/logger.js';

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

function resetMockAgentConfig(): void {
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
}

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
    resetMockAgentConfig();
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
        $schema: MCP_CONFIG_SCHEMA_URL,
        ...config,
      });
    });

    it('should add $schema field for IDE autocompletion', async () => {
      const config = { mcpServers: {} };
      await fsPromises.writeFile(configFilePath, JSON.stringify(config, null, 2));

      const rawConfig = loader.loadRawConfig() as Record<string, unknown>;

      expect(rawConfig).toHaveProperty('$schema', MCP_CONFIG_SCHEMA_URL);
      expect(rawConfig.mcpServers).toEqual(config.mcpServers);
    });

    it('should preserve existing $schema field', async () => {
      const customSchemaUrl = 'https://example.com/custom-schema.json';
      const config = {
        $schema: customSchemaUrl,
        mcpServers: {},
      };
      await fsPromises.writeFile(configFilePath, JSON.stringify(config, null, 2));

      const rawConfig = loader.loadRawConfig() as Record<string, unknown>;

      expect(rawConfig).toHaveProperty('$schema', customSchemaUrl);
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
    it('should leave environment variables unresolved until transport environment processing', async () => {
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

      expect(config['test-server'].command).toBe('${TEST_VAR}');

      delete process.env.TEST_VAR;

      // Reset mock for other tests
      mockAgentConfig.get.mockReturnValue({
        features: { configReload: true, envSubstitution: true },
        configReload: { debounceMs: 100 },
      });
    });

    it('should not load variables from .env files during substitution', async () => {
      delete process.env.CONTEXT7_API_KEY;
      await fsPromises.writeFile(join(tempConfigDir, '.env'), 'CONTEXT7_API_KEY=dotenv-context7-key\n');

      const configWithEnv = {
        mcpServers: {
          context7: {
            command: 'bunx',
            args: ['@upstash/context7-mcp@latest', '--api-key', '$CONTEXT7_API_KEY'],
            tags: ['context7'],
          },
        },
      };
      await fsPromises.writeFile(configFilePath, JSON.stringify(configWithEnv, null, 2));

      const newLoader = new ConfigLoader(configFilePath);
      const config = newLoader.loadConfigWithEnvSubstitution();

      expect(config.context7.args).toEqual(['@upstash/context7-mcp@latest', '--api-key', '$CONTEXT7_API_KEY']);

      delete process.env.CONTEXT7_API_KEY;
    });

    it('should not warn for missing server placeholders before transport environment processing', async () => {
      delete process.env.CONTEXT7_API_KEY;
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

      const configWithEnv = {
        serverDefaults: {
          inheritParentEnv: true,
        },
        mcpServers: {
          context7: {
            command: 'bunx',
            args: ['@upstash/context7-mcp@latest', '--api-key', '${CONTEXT7_API_KEY}'],
            envFilter: ['CONTEXT7_API_KEY'],
            tags: ['context7'],
          },
        },
      };
      await fsPromises.writeFile(configFilePath, JSON.stringify(configWithEnv, null, 2));

      const newLoader = new ConfigLoader(configFilePath);
      const config = newLoader.loadConfigWithEnvSubstitution();

      expect(config.context7.args).toEqual(['@upstash/context7-mcp@latest', '--api-key', '${CONTEXT7_API_KEY}']);
      expect(warnSpy).not.toHaveBeenCalledWith(
        'Environment variable CONTEXT7_API_KEY not found, keeping placeholder: ${CONTEXT7_API_KEY}',
      );

      delete process.env.CONTEXT7_API_KEY;
      warnSpy.mockRestore();
    });

    it('should allow HTTP URL placeholders during config loading without substituting values', async () => {
      process.env.HTTP_MCP_URL = 'https://example.com/mcp';
      process.env.HTTP_AUTH_TOKEN = 'token-from-env';

      const configWithEnv = {
        mcpServers: {
          'http-server': {
            type: 'http',
            url: '$HTTP_MCP_URL',
            headers: {
              Authorization: 'Bearer ${HTTP_AUTH_TOKEN}',
            },
          },
        },
      };
      await fsPromises.writeFile(configFilePath, JSON.stringify(configWithEnv, null, 2));

      const newLoader = new ConfigLoader(configFilePath);
      const config = newLoader.loadConfigWithEnvSubstitution();

      expect(config['http-server'].url).toBe('$HTTP_MCP_URL');
      expect(config['http-server'].headers).toEqual({ Authorization: 'Bearer ${HTTP_AUTH_TOKEN}' });

      delete process.env.HTTP_MCP_URL;
      delete process.env.HTTP_AUTH_TOKEN;
    });

    it('should allow inferred HTTP URL placeholders during config loading', async () => {
      const configWithEnv = {
        mcpServers: {
          'http-server': {
            url: '$HTTP_MCP_URL',
          },
        },
      };
      await fsPromises.writeFile(configFilePath, JSON.stringify(configWithEnv, null, 2));

      const newLoader = new ConfigLoader(configFilePath);
      const config = newLoader.loadConfigWithEnvSubstitution();

      expect(config['http-server'].url).toBe('$HTTP_MCP_URL');
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

    it('maintains backward compatibility when global section is absent', async () => {
      const legacyConfig = {
        mcpServers: {
          'legacy-server': {
            type: 'stdio',
            command: 'node',
            timeout: 1234,
          },
        },
      };
      await fsPromises.writeFile(configFilePath, JSON.stringify(legacyConfig, null, 2));

      const config = loader.loadConfigWithEnvSubstitution();
      expect(config['legacy-server']).toEqual(legacyConfig.mcpServers['legacy-server']);
    });

    it('should apply serverDefaults and merge env for servers', async () => {
      const configWithGlobal = {
        serverDefaults: {
          timeout: 3000,
          connectionTimeout: 5000,
          requestTimeout: 10000,
          env: {
            SHARED: 'global',
            KEEP: 'global-only',
          },
          inheritParentEnv: true,
          envFilter: ['PATH', 'NODE_*'],
        },
        mcpServers: {
          'test-server': {
            type: 'stdio',
            command: 'node',
            envFilter: ['TEST_VAR', 'PATH'],
            env: {
              SHARED: 'server',
            },
          },
        },
      };
      await fsPromises.writeFile(configFilePath, JSON.stringify(configWithGlobal, null, 2));

      const config = loader.loadConfigWithEnvSubstitution();
      expect(config['test-server'].timeout).toBe(3000);
      expect(config['test-server'].connectionTimeout).toBe(5000);
      expect(config['test-server'].requestTimeout).toBe(10000);
      expect(config['test-server'].inheritParentEnv).toBe(true);
      expect(config['test-server'].envFilter).toEqual(['PATH', 'NODE_*', 'TEST_VAR']);
      expect(config['test-server'].env).toEqual({
        SHARED: 'server',
        KEEP: 'global-only',
      });
    });

    it('should apply restart settings from serverDefaults to stdio servers', async () => {
      const configWithGlobal = {
        serverDefaults: {
          restartOnExit: true,
          maxRestarts: 5,
          restartDelay: 1000,
        },
        mcpServers: {
          inherited: {
            type: 'stdio',
            command: 'node',
          },
          overridden: {
            type: 'stdio',
            command: 'node',
            restartOnExit: false,
            maxRestarts: 0,
            restartDelay: 0,
          },
        },
      };
      await fsPromises.writeFile(configFilePath, JSON.stringify(configWithGlobal, null, 2));

      const config = loader.loadConfigWithEnvSubstitution();

      expect(config.inherited).toMatchObject({
        restartOnExit: true,
        maxRestarts: 5,
        restartDelay: 1000,
      });
      expect(config.overridden).toMatchObject({
        restartOnExit: false,
        maxRestarts: 0,
        restartDelay: 0,
      });
    });

    it('should merge serverDefaults envFilter with server envFilter for stdio servers', async () => {
      const configWithGlobal = {
        serverDefaults: {
          inheritParentEnv: true,
          envFilter: ['UV_*', 'https_proxy', 'HTTP_PROXY', 'no_proxy'],
        },
        mcpServers: {
          context7: {
            command: 'bunx',
            args: ['@upstash/context7-mcp@latest', '--api-key', '$CONTEXT7_API_KEY'],
            envFilter: ['CONTEXT7_API_KEY', 'UV_*'],
          },
        },
      };
      await fsPromises.writeFile(configFilePath, JSON.stringify(configWithGlobal, null, 2));

      const config = loader.loadConfigWithEnvSubstitution();

      expect(config.context7.envFilter).toEqual(['UV_*', 'https_proxy', 'HTTP_PROXY', 'no_proxy', 'CONTEXT7_API_KEY']);
    });

    it('should allow envFilter in serverDefaults but ignore it for http servers', async () => {
      const configWithGlobal = {
        serverDefaults: {
          envFilter: ['PATH'],
        },
        mcpServers: {
          'test-server': {
            type: 'http',
            url: 'https://example.com/mcp',
          },
        },
      };
      await fsPromises.writeFile(configFilePath, JSON.stringify(configWithGlobal, null, 2));

      const config = loader.loadConfigWithEnvSubstitution();
      expect(config['test-server'].envFilter).toBeUndefined();
    });

    it('should ignore invalid serverDefaults configuration and keep valid servers', async () => {
      const invalidGlobalConfig = {
        serverDefaults: {
          timeout: 'invalid-timeout',
        },
        mcpServers: {
          'test-server': {
            type: 'stdio',
            command: 'node',
          },
        },
      };
      await fsPromises.writeFile(configFilePath, JSON.stringify(invalidGlobalConfig, null, 2));

      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

      const config = loader.loadConfigWithEnvSubstitution();

      expect(config['test-server']).toEqual({
        type: 'stdio',
        command: 'node',
      });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Ignoring invalid serverDefaults configuration: Invalid global configuration: timeout: Invalid input: expected number, received string',
        ),
      );
    });
  });
});
