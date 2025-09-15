import { describe, it, beforeEach, afterEach } from 'vitest';
import { CommandTestEnvironment, CliTestRunner } from '../../utils/index.js';
import { TestFixtures } from '../../fixtures/TestFixtures.js';
import { join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';

describe('MCP Config Context E2E Tests', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;
  let customConfigDir: string;

  beforeEach(async () => {
    environment = new CommandTestEnvironment(TestFixtures.createTestScenario('config-context-test', 'basic'));
    await environment.setup();
    runner = new CliTestRunner(environment);

    // Create a custom config directory for testing
    customConfigDir = join(environment.getTempDir(), 'custom-config');
    mkdirSync(customConfigDir, { recursive: true });

    // Create a test mcp.json in the custom directory with a unique server
    const customConfigPath = join(customConfigDir, 'mcp.json');
    const testConfig = {
      mcpServers: {
        'config-context-test-server': {
          command: 'echo',
          args: ['config-test'],
          enabled: true,
        },
      },
    };
    writeFileSync(customConfigPath, JSON.stringify(testConfig, null, 2));
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  describe('--config-dir CLI flag', () => {
    it('should use config directory specified via --config-dir flag', async () => {
      const result = await runner.runCommand('mcp', 'status', {
        args: ['--config-dir', customConfigDir],
      });

      runner.assertSuccess(result);
      // Should find the unique test server we created in the custom config
      runner.assertOutputContains(result, 'config-context-test-server');
    });

    it('should work with -d short flag', async () => {
      const result = await runner.runCommand('mcp', 'status', {
        args: ['-d', customConfigDir],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'config-context-test-server');
    });

    it('should prioritize --config-dir over default config', async () => {
      // First, get status from default config (should show echo-server from basic fixture)
      const defaultResult = await runner.runMcpCommand('status');
      runner.assertSuccess(defaultResult);
      runner.assertOutputContains(defaultResult, 'echo-server'); // From basic fixture

      // Then get status from custom config dir (should show different server)
      const customResult = await runner.runCommand('mcp', 'status', {
        args: ['--config-dir', customConfigDir],
      });
      runner.assertSuccess(customResult);
      runner.assertOutputContains(customResult, 'config-context-test-server'); // From custom config
      runner.assertOutputDoesNotContain(customResult, 'echo-server'); // Should not show default
    });
  });

  describe('ONE_MCP_CONFIG_DIR environment variable', () => {
    it('should use config directory from ONE_MCP_CONFIG_DIR environment variable', async () => {
      const result = await runner.runCommandWithCustomEnv('mcp', 'status', {
        ONE_MCP_CONFIG_DIR: customConfigDir,
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'config-context-test-server');
    });

    it('should prioritize --config-dir over ONE_MCP_CONFIG_DIR', async () => {
      // Create another config directory for CLI flag
      const anotherConfigDir = join(environment.getTempDir(), 'another-config');
      mkdirSync(anotherConfigDir, { recursive: true });

      const anotherConfigPath = join(anotherConfigDir, 'mcp.json');
      const anotherTestConfig = {
        mcpServers: {
          'cli-flag-server': {
            command: 'echo',
            args: ['cli-flag'],
            enabled: true,
          },
        },
      };
      writeFileSync(anotherConfigPath, JSON.stringify(anotherTestConfig, null, 2));

      // Use environment variable pointing to one dir, but CLI flag pointing to another
      const result = await runner.runCommandWithCustomEnv(
        'mcp',
        'status',
        {
          ONE_MCP_CONFIG_DIR: customConfigDir, // Should be overridden by CLI flag
        },
        {
          args: ['--config-dir', anotherConfigDir],
        },
      );

      runner.assertSuccess(result);
      // Should use the CLI flag directory (anotherConfigDir), not env var
      runner.assertOutputContains(result, 'cli-flag-server');
      runner.assertOutputDoesNotContain(result, 'config-context-test-server');
    });
  });

  describe('Config file vs directory priority', () => {
    it('should prioritize --config file over --config-dir', async () => {
      // Create a specific config file
      const specificConfigPath = join(environment.getTempDir(), 'specific.json');
      const specificConfig = {
        mcpServers: {
          'specific-file-server': {
            command: 'echo',
            args: ['specific-file'],
            enabled: true,
          },
        },
      };
      writeFileSync(specificConfigPath, JSON.stringify(specificConfig, null, 2));

      const result = await runner.runCommand('mcp', 'status', {
        args: ['--config', specificConfigPath, '--config-dir', customConfigDir],
      });

      runner.assertSuccess(result);
      // Should use the specific config file, not the directory
      runner.assertOutputContains(result, 'specific-file-server');
      runner.assertOutputDoesNotContain(result, 'config-context-test-server');
    });
  });
});
