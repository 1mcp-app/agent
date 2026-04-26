import { randomBytes } from 'crypto';
import { promises as fsPromises } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  getAllEffectiveServers,
  getEffectiveServerConfig,
  getInheritedKeys,
  loadConfig,
} from '@src/commands/shared/baseConfigUtils.js';
import ConfigContext from '@src/config/configContext.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockAgentConfig = {
  get: vi.fn().mockImplementation((key: string) => {
    const config = {
      features: {
        configReload: true,
        envSubstitution: true,
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

describe('baseConfigUtils', () => {
  let tempConfigDir: string;
  let configFilePath: string;

  beforeEach(async () => {
    tempConfigDir = join(tmpdir(), `base-config-utils-test-${randomBytes(4).toString('hex')}`);
    await fsPromises.mkdir(tempConfigDir, { recursive: true });
    configFilePath = join(tempConfigDir, 'mcp.json');
    ConfigContext.getInstance().setConfigPath(configFilePath);
  });

  afterEach(async () => {
    ConfigContext.getInstance().reset();
    delete process.env.TEST_RAW_VALUE;
    vi.clearAllMocks();

    try {
      await fsPromises.rm(tempConfigDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('preserves missing config behavior', () => {
    expect(() => loadConfig()).toThrow(`Configuration file not found: ${configFilePath}`);
  });

  it('preserves malformed JSON behavior', async () => {
    await fsPromises.writeFile(configFilePath, '{ invalid json');

    expect(() => loadConfig()).toThrow(`Invalid JSON in configuration file: ${configFilePath}`);
  });

  it('returns validated global defaults while preserving raw server entries', async () => {
    process.env.TEST_RAW_VALUE = 'substituted';

    await fsPromises.writeFile(
      configFilePath,
      JSON.stringify(
        {
          serverDefaults: {
            timeout: 5000,
            env: { SHARED: 'global' },
          },
          mcpServers: {
            stdioServer: {
              type: 'stdio',
              command: 'node',
              args: ['${TEST_RAW_VALUE}'],
              env: { LOCAL: 'server' },
            },
            ignoredServer: 'not-an-object',
          },
        },
        null,
        2,
      ),
    );

    const config = loadConfig();

    expect(config.serverDefaults).toEqual({
      timeout: 5000,
      env: { SHARED: 'global' },
    });
    expect(config.mcpServers).toEqual({
      stdioServer: {
        type: 'stdio',
        command: 'node',
        args: ['${TEST_RAW_VALUE}'],
        env: { LOCAL: 'server' },
      },
    });
  });

  it('preserves effective merge semantics across transport types', async () => {
    await fsPromises.writeFile(
      configFilePath,
      JSON.stringify(
        {
          serverDefaults: {
            timeout: 3000,
            headers: { Authorization: 'Bearer global' },
            inheritParentEnv: true,
            envFilter: ['PATH'],
            env: { SHARED: 'global', KEEP: 'global-only' },
          },
          mcpServers: {
            stdioServer: {
              type: 'stdio',
              command: 'node',
              env: { SHARED: 'server' },
            },
            httpServer: {
              type: 'http',
              url: 'https://example.com/mcp',
            },
            streamableServer: {
              type: 'streamableHttp',
              url: 'https://example.com/stream',
            },
          },
        },
        null,
        2,
      ),
    );

    expect(getEffectiveServerConfig('stdioServer')).toEqual({
      type: 'stdio',
      command: 'node',
      timeout: 3000,
      inheritParentEnv: true,
      envFilter: ['PATH'],
      env: {
        SHARED: 'server',
        KEEP: 'global-only',
      },
    });

    expect(getEffectiveServerConfig('httpServer')).toEqual({
      type: 'http',
      url: 'https://example.com/mcp',
      timeout: 3000,
      headers: { Authorization: 'Bearer global' },
      env: {
        SHARED: 'global',
        KEEP: 'global-only',
      },
    });

    expect(getEffectiveServerConfig('streamableServer')).toEqual({
      type: 'streamableHttp',
      url: 'https://example.com/stream',
      timeout: 3000,
      headers: { Authorization: 'Bearer global' },
      env: {
        SHARED: 'global',
        KEEP: 'global-only',
      },
    });

    expect(getAllEffectiveServers()).toEqual({
      stdioServer: {
        type: 'stdio',
        command: 'node',
        timeout: 3000,
        inheritParentEnv: true,
        envFilter: ['PATH'],
        env: {
          SHARED: 'server',
          KEEP: 'global-only',
        },
      },
      httpServer: {
        type: 'http',
        url: 'https://example.com/mcp',
        timeout: 3000,
        headers: { Authorization: 'Bearer global' },
        env: {
          SHARED: 'global',
          KEEP: 'global-only',
        },
      },
      streamableServer: {
        type: 'streamableHttp',
        url: 'https://example.com/stream',
        timeout: 3000,
        headers: { Authorization: 'Bearer global' },
        env: {
          SHARED: 'global',
          KEEP: 'global-only',
        },
      },
    });
  });

  it('reports inherited envFilter for stdio servers', () => {
    expect(
      getInheritedKeys(
        {
          type: 'stdio',
          command: 'node',
        },
        {
          type: 'stdio',
          command: 'node',
          envFilter: ['PATH'],
        },
        {
          envFilter: ['PATH'],
        },
      ),
    ).toContain('envFilter');
  });
});
