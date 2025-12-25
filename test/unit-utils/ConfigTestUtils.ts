import { randomBytes } from 'crypto';
import { promises as fsPromises } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { ConfigManager } from '@src/config/configManager.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';

import { vi } from 'vitest';

/**
 * Options for creating a config test environment
 */
export interface ConfigTestEnvironmentOptions {
  /** Prefix for temporary directory name */
  tempDirPrefix?: string;
  /** Initial configuration to write */
  initialConfig?: any;
  /** Custom agent config mock overrides */
  agentConfigOverrides?: any;
  /** Config file name (default: 'mcp.json') */
  configFileName?: string;
}

/**
 * Result of creating a config test environment
 */
export interface ConfigTestEnvironment {
  /** Temporary directory path */
  tempDir: string;
  /** Full config file path */
  configFilePath: string;
  /** Config manager instance */
  configManager: ConfigManager;
  /** Cleanup function */
  cleanup: () => Promise<void>;
}

/**
 * Standard mock agent configuration for testing
 */
export const createMockAgentConfig = (overrides: any = {}) => ({
  get: vi.fn().mockImplementation((key: string) => {
    const config = {
      features: {
        configReload: true,
        envSubstitution: true,
        ...overrides.features,
      },
      configReload: {
        debounceMs: 100,
        ...overrides.configReload,
      },
      ...overrides,
    };
    return key.split('.').reduce((obj: any, k: string) => obj?.[k], config);
  }),
});

/**
 * Create a standardized test environment for config tests
 *
 * @param options - Configuration options for the test environment
 * @returns Promise<ConfigTestEnvironment> - Test environment with cleanup
 *
 * @example
 * ```typescript
 * describe('MyConfigTest', () => {
 *   let env: ConfigTestEnvironment;
 *
 *   beforeEach(async () => {
 *     env = await createConfigTestEnvironment({
 *       initialConfig: { mcpServers: { 'test': { command: 'echo' } } }
 *     });
 *   });
 *
 *   afterEach(async () => {
 *     await env.cleanup();
 *   });
 * });
 * ```
 */
export async function createConfigTestEnvironment(
  options: ConfigTestEnvironmentOptions = {},
): Promise<ConfigTestEnvironment> {
  const { tempDirPrefix = 'config-test', initialConfig, configFileName = 'mcp.json' } = options;

  // Create temporary config directory
  const tempDir = join(tmpdir(), `${tempDirPrefix}-${randomBytes(4).toString('hex')}`);
  await fsPromises.mkdir(tempDir, { recursive: true });
  const configFilePath = join(tempDir, configFileName);

  // Reset singleton instances
  (ConfigManager as any).instance = null;

  // Create config manager instance
  const configManager = ConfigManager.getInstance(configFilePath);

  // Write initial configuration if provided
  if (initialConfig) {
    await fsPromises.writeFile(configFilePath, JSON.stringify(initialConfig, null, 2));
  }

  // Cleanup function
  const cleanup = async () => {
    try {
      if (configManager) {
        await configManager.stop();
      }
      await fsPromises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  };

  return {
    tempDir,
    configFilePath,
    configManager,
    cleanup,
  };
}

/**
 * Mock AgentConfigManager for tests
 *
 * @param overrides - Optional config overrides
 * @returns Mock setup function
 *
 * @example
 * ```typescript
 * // Before describe blocks
 * const mockAgentConfig = setupAgentConfigMock({
 *   features: { configReload: false }
 * });
 *
 * vi.mock('@src/core/server/agentConfig.js', () => ({
 *   AgentConfigManager: {
 *     getInstance: () => mockAgentConfig,
 *   },
 * }));
 * ```
 */
export function setupAgentConfigMock(overrides: any = {}) {
  return createMockAgentConfig(overrides);
}

/**
 * Create a basic test configuration
 *
 * @param overrides - Optional config overrides
 * @returns Basic test configuration object
 */
export function createBasicTestConfig(overrides: any = {}) {
  return {
    version: '1.0.0',
    mcpServers: {
      'test-server-1': {
        command: 'echo',
        args: ['test1'],
        env: {
          TEST_VAR: 'test1',
        },
        tags: ['test'],
      },
      'test-server-2': {
        command: 'echo',
        args: ['test2'],
        env: {
          TEST_VAR: 'test2',
        },
        tags: ['test', 'secondary'],
        disabled: false,
      },
    },
    mcpTemplates: {},
    ...overrides,
  };
}

/**
 * Create a test configuration with templates
 *
 * @param overrides - Optional config overrides
 * @returns Test configuration with template examples
 */
export function createTemplateTestConfig(overrides: any = {}) {
  return {
    version: '1.0.0',
    templateSettings: {
      validateOnReload: true,
      failureMode: 'graceful',
      cacheContext: true,
    },
    mcpServers: {
      'static-server': {
        command: 'echo',
        args: ['static'],
        tags: ['static'],
      },
    },
    mcpTemplates: {
      'template-server': {
        command: 'npx',
        args: ['-y', 'test-package', '{project.name}'],
        env: {
          PROJECT_PATH: '{project.path}',
          SESSION_ID: '{context.sessionId}',
        },
        tags: ['template', 'dynamic'],
        disabled: '{?project.environment=production}',
      },
    },
    ...overrides,
  };
}

/**
 * Helper to reset ConfigManager singleton (useful for tests)
 */
export function resetConfigManagerSingleton(): void {
  (ConfigManager as any).instance = null;
}

/**
 * Helper to reset AgentConfigManager singleton (useful for tests)
 */
export function resetAgentConfigManagerSingleton(): void {
  (AgentConfigManager as any).instance = null;
}

/**
 * Helper to reset both configuration singletons
 */
export function resetAllConfigSingletons(): void {
  resetConfigManagerSingleton();
  resetAgentConfigManagerSingleton();
}
