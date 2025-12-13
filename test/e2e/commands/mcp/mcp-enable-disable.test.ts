import { TestFixtures } from '@test/e2e/fixtures/TestFixtures.js';
import { CliTestRunner, CommandTestEnvironment } from '@test/e2e/utils/index.js';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('MCP Enable/Disable Commands E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
    environment = new CommandTestEnvironment(TestFixtures.createTestScenario('mcp-enable-disable-test', 'mixed'));
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  describe('Enable Command', () => {
    it('should enable a disabled server', async () => {
      // First verify the server is disabled
      const initialStatus = await runner.runMcpCommand('list', { args: ['--show-disabled'] });
      runner.assertOutputContains(initialStatus, 'disabled-server');
      runner.assertOutputContains(initialStatus, '🔴'); // Disabled icon

      // Enable the server
      const result = await runner.runMcpCommand('enable', {
        args: ['disabled-server'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, '✅ Successfully enabled server');
      runner.assertOutputContains(result, 'disabled-server');

      // Verify the server is now enabled
      const finalStatus = await runner.runMcpCommand('list');
      runner.assertOutputContains(finalStatus, 'disabled-server');
      runner.assertOutputContains(finalStatus, '🟢'); // Enabled icon
    });

    it('should handle enabling an already enabled server', async () => {
      const result = await runner.runMcpCommand('enable', {
        args: ['echo-server'], // This server should already be enabled
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'is already enabled');
    });

    it('should handle non-existent server', async () => {
      const result = await runner.runMcpCommand('enable', {
        args: ['nonexistent-server'],
        expectError: true,
      });

      runner.assertFailure(result, 1);
      runner.assertOutputContains(result, 'does not exist', true);
    });

    it('should enable multiple servers', async () => {
      // First add another disabled server
      await runner.runMcpCommand('add', {
        args: ['another-disabled', '--type', 'stdio', '--command', 'echo', '--args', 'test', '--disabled'],
      });

      // Enable first server
      const result1 = await runner.runMcpCommand('enable', {
        args: ['disabled-server'],
      });

      // Enable second server
      const result2 = await runner.runMcpCommand('enable', {
        args: ['another-disabled'],
      });

      runner.assertSuccess(result1);
      runner.assertSuccess(result2);
      runner.assertOutputContains(result1, '✅ Successfully enabled server');
      runner.assertOutputContains(result2, '✅ Successfully enabled server');

      // Verify both servers are enabled
      const listResult = await runner.runMcpCommand('list');
      runner.assertOutputContains(listResult, 'disabled-server');
      runner.assertOutputContains(listResult, 'another-disabled');
    });
  });

  describe('Disable Command', () => {
    it('should disable an enabled server', async () => {
      // Verify the server is initially enabled
      const initialStatus = await runner.runMcpCommand('list');
      runner.assertOutputContains(initialStatus, 'echo-server');
      runner.assertOutputContains(initialStatus, '🟢'); // Enabled icon

      // Disable the server
      const result = await runner.runMcpCommand('disable', {
        args: ['echo-server'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, '✅ Successfully disabled server');
      runner.assertOutputContains(result, 'echo-server');

      // Verify the server is now disabled (not shown in default list)
      const finalStatus = await runner.runMcpCommand('list');
      expect(finalStatus.stdout).not.toContain('echo-server');

      // But should be shown with --show-disabled
      const disabledStatus = await runner.runMcpCommand('list', { args: ['--show-disabled'] });
      runner.assertOutputContains(disabledStatus, 'echo-server');
      runner.assertOutputContains(disabledStatus, '🔴'); // Disabled icon
    });

    it('should handle disabling an already disabled server', async () => {
      const result = await runner.runMcpCommand('disable', {
        args: ['disabled-server'], // This server should already be disabled
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'is already disabled');
    });

    it('should handle non-existent server', async () => {
      const result = await runner.runMcpCommand('disable', {
        args: ['nonexistent-server'],
        expectError: true,
      });

      runner.assertFailure(result, 1);
      runner.assertOutputContains(result, 'does not exist', true);
    });

    it('should disable multiple servers', async () => {
      // Add another enabled server first
      await runner.runMcpCommand('add', {
        args: ['another-enabled', '--type', 'stdio', '--command', 'echo', '--args', 'test'],
      });

      // Disable first server
      const result1 = await runner.runMcpCommand('disable', {
        args: ['echo-server'],
      });

      // Disable second server
      const result2 = await runner.runMcpCommand('disable', {
        args: ['another-enabled'],
      });

      runner.assertSuccess(result1);
      runner.assertSuccess(result2);
      runner.assertOutputContains(result1, '✅ Successfully disabled server');
      runner.assertOutputContains(result2, '✅ Successfully disabled server');

      // Verify both servers are disabled
      const listResult = await runner.runMcpCommand('list');
      expect(listResult.stdout).not.toContain('echo-server');
      expect(listResult.stdout).not.toContain('another-enabled');
    });
  });

  describe('State Persistence', () => {
    it('should persist enable state to configuration', async () => {
      // Enable a disabled server
      await runner.runMcpCommand('enable', { args: ['disabled-server'] });

      // Verify persistence by checking config file
      const fs = await import('fs/promises');
      const configContent = await fs.readFile(environment.getConfigPath(), 'utf-8');
      const config = JSON.parse(configContent);

      expect(config.mcpServers['disabled-server']).toBeDefined();
      expect(config.mcpServers['disabled-server'].disabled).toBeFalsy();
    });

    it('should persist disable state to configuration', async () => {
      // Disable an enabled server
      await runner.runMcpCommand('disable', { args: ['echo-server'] });

      // Verify persistence by checking config file
      const fs = await import('fs/promises');
      const configContent = await fs.readFile(environment.getConfigPath(), 'utf-8');
      const config = JSON.parse(configContent);

      expect(config.mcpServers['echo-server']).toBeDefined();
      expect(config.mcpServers['echo-server'].disabled).toBe(true);
    });

    it('should maintain server configuration when changing state', async () => {
      // Get initial server configuration
      const initialList = await runner.runMcpCommand('list', { args: ['--verbose'] });
      const initialTags = initialList.stdout.match(/Tags: ([^\n]+)/)?.[1];

      // Disable and re-enable server
      await runner.runMcpCommand('disable', { args: ['echo-server'] });
      await runner.runMcpCommand('enable', { args: ['echo-server'] });

      // Verify configuration is maintained
      const finalList = await runner.runMcpCommand('list', { args: ['--verbose'] });
      if (initialTags) {
        runner.assertOutputContains(finalList, initialTags);
      }
      runner.assertOutputContains(finalList, 'Command: echo');
    });
  });

  describe('Batch Operations', () => {
    it('should handle mixed enable/disable operations gracefully', async () => {
      // Try to enable an enabled server and disable a disabled server
      const enableResult = await runner.runMcpCommand('enable', {
        args: ['echo-server'], // Already enabled
      });

      const disableResult = await runner.runMcpCommand('disable', {
        args: ['disabled-server'], // Already disabled
      });

      runner.assertSuccess(enableResult);
      runner.assertSuccess(disableResult);
      runner.assertOutputContains(enableResult, 'already enabled');
      runner.assertOutputContains(disableResult, 'already disabled');
    });

    it('should provide clear feedback for batch operations', async () => {
      // Add a few servers for testing
      await runner.runMcpCommand('add', {
        args: ['batch-test-1', '--type', 'stdio', '--command', 'echo', '--args', 'test1'],
      });
      await runner.runMcpCommand('add', {
        args: ['batch-test-2', '--type', 'stdio', '--command', 'echo', '--args', 'test2', '--disabled'],
      });

      // Test enable one server
      const enableResult = await runner.runMcpCommand('enable', {
        args: ['batch-test-2'],
      });

      runner.assertSuccess(enableResult);
      runner.assertOutputContains(enableResult, 'batch-test-2');
    });
  });

  describe('Error Scenarios', () => {
    it('should handle invalid config file', async () => {
      const result = await runner.runMcpCommand('enable', {
        args: ['echo-server', '--config', '/nonexistent/config.json'],
        expectError: true,
      });

      runner.assertFailure(result, 1);
      runner.assertOutputContains(result, 'Failed to enable server', true);
    });

    it('should validate server name arguments', async () => {
      const result = await runner.runMcpCommand('enable', {
        args: [], // Missing server name
        expectError: true,
      });

      runner.assertFailure(result, 1);
      runner.assertOutputContains(result, 'Not enough non-option arguments', true);
    });

    it('should handle partial failures in batch operations', async () => {
      const result = await runner.runMcpCommand('enable', {
        args: ['nonexistent-server'],
        expectError: true,
      });

      // Should fail due to nonexistent server
      runner.assertFailure(result, 1);
      runner.assertOutputContains(result, 'does not exist', true);
    });
  });

  describe('Help and Usage', () => {
    it('should show help for enable command', async () => {
      const result = await runner.runMcpCommand('enable', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Enable a disabled MCP server');
    });

    it('should show help for disable command', async () => {
      const result = await runner.runMcpCommand('disable', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Disable a MCP server');
    });
  });

  describe('Integration with List Command', () => {
    it('should show correct counts after enable/disable operations', async () => {
      // Get initial counts
      const initial = await runner.runMcpCommand('list', { args: ['--show-disabled'] });
      const initialEnabled = (initial.stdout.match(/🟢/g) || []).length;
      const initialDisabled = (initial.stdout.match(/🔴/g) || []).length;

      // Disable an enabled server
      await runner.runMcpCommand('disable', { args: ['echo-server'] });

      // Check new counts
      const afterDisable = await runner.runMcpCommand('list', { args: ['--show-disabled'] });
      const afterDisableEnabled = (afterDisable.stdout.match(/🟢/g) || []).length;
      const afterDisableDisabled = (afterDisable.stdout.match(/🔴/g) || []).length;

      expect(afterDisableEnabled).toBe(initialEnabled - 1);
      expect(afterDisableDisabled).toBe(initialDisabled + 1);

      // Enable the server back
      await runner.runMcpCommand('enable', { args: ['echo-server'] });

      // Check counts are back to initial
      const final = await runner.runMcpCommand('list', { args: ['--show-disabled'] });
      const finalEnabled = (final.stdout.match(/🟢/g) || []).length;
      const finalDisabled = (final.stdout.match(/🔴/g) || []).length;

      expect(finalEnabled).toBe(initialEnabled);
      expect(finalDisabled).toBe(initialDisabled);
    });
  });
});
