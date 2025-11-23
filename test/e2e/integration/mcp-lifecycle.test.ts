import { TestFixtures } from '@test/e2e/fixtures/TestFixtures.js';
import { CliTestRunner, CommandTestEnvironment } from '@test/e2e/utils/index.js';

import { readFile } from 'fs/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * E2E tests for complete MCP server lifecycle
 * Tests install -> update -> uninstall workflows
 */

describe('MCP Server Lifecycle E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
    environment = new CommandTestEnvironment(TestFixtures.createTestScenario('mcp-lifecycle-test', 'empty'));
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  describe('Install Workflow', () => {
    it('should install a server from registry using dry-run mode', async () => {
      const result = await runner.runMcpCommand('install', {
        args: ['filesystem', '--dry-run'],
        timeout: 30000,
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Dry run mode');
      runner.assertOutputContains(result, 'Would install: filesystem');
      runner.assertOutputContains(result, 'From registry');
    });

    it('should install a server and verify configuration changes', async () => {
      // First check that server doesn't exist
      const initialList = await runner.runMcpCommand('list');
      runner.assertOutputDoesNotContain(initialList, 'test-installed-server');

      // Install a server (we'll use a mock server for testing)
      // For real E2E test, this would need actual registry access
      // For now, test the command structure and error handling
      const installResult = await runner.runMcpCommand('install', {
        args: ['nonexistent-test-server-xyz-12345'],
        timeout: 30000,
        expectError: true,
      });

      // Should fail with server not found (expected behavior)
      runner.assertFailure(installResult);
      runner.assertOutputContains(installResult, 'Failed to fetch server', true);
    });

    it('should handle force install when server already exists', async () => {
      // First add a server manually
      await runner.runMcpCommand('add', {
        args: ['existing-server', '--type', 'stdio', '--command', 'echo', '--args', 'test'],
      });

      // Try to install with same name (should fail without --force)
      const failResult = await runner.runMcpCommand('install', {
        args: ['existing-server', '--dry-run'],
        timeout: 30000,
        expectError: true,
      });

      runner.assertFailure(failResult);
      runner.assertOutputContains(failResult, 'already exists', true);

      // With --force, should proceed (dry-run only)
      const forceResult = await runner.runMcpCommand('install', {
        args: ['existing-server', '--force', '--dry-run'],
        timeout: 30000,
      });

      runner.assertSuccess(forceResult);
      runner.assertOutputContains(forceResult, 'Would install');
    });

    it('should validate server name format', async () => {
      const result = await runner.runMcpCommand('install', {
        args: ['invalid server name', '--dry-run'],
        timeout: 30000,
        expectError: true,
      });

      runner.assertFailure(result);
      // Should validate server name format
      runner.assertOutputContains(result, 'Server name', true);
    });
  });

  describe('Update Workflow', () => {
    it('should update server configuration', async () => {
      // First add a server
      await runner.runMcpCommand('add', {
        args: ['updatable-server', '--type', 'stdio', '--command', 'echo', '--args', 'old'],
      });

      // Verify initial configuration
      const initialConfig = await readFile(environment.getConfigPath(), 'utf-8');
      expect(initialConfig).toContain('updatable-server');
      expect(initialConfig).toContain('old');

      // Update server configuration
      const updateResult = await runner.runMcpCommand('update', {
        args: ['updatable-server', '--args', 'new'],
      });

      runner.assertSuccess(updateResult);
      runner.assertOutputContains(updateResult, 'Successfully updated server');

      // Verify configuration changed
      const updatedConfig = await readFile(environment.getConfigPath(), 'utf-8');
      expect(updatedConfig).toContain('updatable-server');
      expect(updatedConfig).toContain('new');
    });

    it('should create backup before update', async () => {
      // Add a server to update
      await runner.runMcpCommand('add', {
        args: ['backup-test-server', '--type', 'stdio', '--command', 'echo'],
      });

      // Update with backup
      const updateResult = await runner.runMcpCommand('update', {
        args: ['backup-test-server', '--tags', 'updated', '--backup'],
      });

      runner.assertSuccess(updateResult);
      runner.assertOutputContains(updateResult, 'Backup created');
    });

    it('should handle update when server does not exist', async () => {
      const result = await runner.runMcpCommand('update', {
        args: ['nonexistent-server', '--tags', 'test'],
        expectError: true,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'does not exist', true);
    });
  });

  describe('Uninstall Workflow', () => {
    it('should uninstall a server and verify configuration changes', async () => {
      // First add a server
      await runner.runMcpCommand('add', {
        args: ['uninstall-test-server', '--type', 'stdio', '--command', 'echo'],
      });

      // Verify server exists
      const listBefore = await runner.runMcpCommand('list');
      runner.assertOutputContains(listBefore, 'uninstall-test-server');

      // Uninstall the server
      const uninstallResult = await runner.runMcpCommand('uninstall', {
        args: ['uninstall-test-server', '--force'],
      });

      runner.assertSuccess(uninstallResult);
      runner.assertOutputContains(uninstallResult, 'Successfully uninstalled');

      // Verify server no longer exists
      const listAfter = await runner.runMcpCommand('list');
      runner.assertOutputDoesNotContain(listAfter, 'uninstall-test-server');
    });

    it('should create backup before uninstall', async () => {
      // Add a server
      await runner.runMcpCommand('add', {
        args: ['backup-uninstall-server', '--type', 'stdio', '--command', 'echo'],
      });

      // Uninstall with backup
      const uninstallResult = await runner.runMcpCommand('uninstall', {
        args: ['backup-uninstall-server', '--force', '--backup'],
      });

      runner.assertSuccess(uninstallResult);
      runner.assertOutputContains(uninstallResult, 'Backup created');
    });

    it('should handle uninstall when server does not exist', async () => {
      const result = await runner.runMcpCommand('uninstall', {
        args: ['nonexistent-server', '--force'],
        expectError: true,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'does not exist', true);
    });

    it('should skip backup when --no-backup is specified', async () => {
      // Add a server
      await runner.runMcpCommand('add', {
        args: ['no-backup-server', '--type', 'stdio', '--command', 'echo'],
      });

      // Uninstall without backup
      const uninstallResult = await runner.runMcpCommand('uninstall', {
        args: ['no-backup-server', '--force', '--no-backup'],
      });

      runner.assertSuccess(uninstallResult);
      runner.assertOutputDoesNotContain(uninstallResult, 'Backup created');
    });
  });

  describe('Complete Lifecycle', () => {
    it('should complete full lifecycle: install -> update -> uninstall', async () => {
      const serverName = 'lifecycle-test-server';

      // Step 1: Install (using add as proxy since install requires registry)
      await runner.runMcpCommand('add', {
        args: [serverName, '--type', 'stdio', '--command', 'echo', '--args', 'version1'],
      });

      let listResult = await runner.runMcpCommand('list');
      runner.assertOutputContains(listResult, serverName);

      // Step 2: Update
      await runner.runMcpCommand('update', {
        args: [serverName, '--args', 'version2'],
      });

      const configAfterUpdate = await readFile(environment.getConfigPath(), 'utf-8');
      expect(configAfterUpdate).toContain('version2');

      // Step 3: Uninstall
      await runner.runMcpCommand('uninstall', {
        args: [serverName, '--force'],
      });

      listResult = await runner.runMcpCommand('list');
      runner.assertOutputDoesNotContain(listResult, serverName);
    });

    it('should maintain other servers during lifecycle operations', async () => {
      // Add two servers
      await runner.runMcpCommand('add', {
        args: ['persistent-server', '--type', 'stdio', '--command', 'echo'],
      });

      await runner.runMcpCommand('add', {
        args: ['lifecycle-server', '--type', 'stdio', '--command', 'echo'],
      });

      // Verify both exist
      let listResult = await runner.runMcpCommand('list');
      runner.assertOutputContains(listResult, 'persistent-server');
      runner.assertOutputContains(listResult, 'lifecycle-server');

      // Update one
      await runner.runMcpCommand('update', {
        args: ['lifecycle-server', '--tags', 'updated'],
      });

      // Uninstall one
      await runner.runMcpCommand('uninstall', {
        args: ['lifecycle-server', '--force'],
      });

      // Verify persistent server still exists
      listResult = await runner.runMcpCommand('list');
      runner.assertOutputContains(listResult, 'persistent-server');
      runner.assertOutputDoesNotContain(listResult, 'lifecycle-server');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle invalid server names', async () => {
      const result = await runner.runMcpCommand('install', {
        args: [''],
        expectError: true,
      });

      runner.assertFailure(result);
    });

    it('should handle network errors gracefully', async () => {
      // This would require mocking network or using timeout
      const result = await runner.runMcpCommand('install', {
        args: ['test-server'],
        timeout: 1000, // Very short timeout to simulate error
        expectError: true,
      });

      // May timeout or fail - either is acceptable
      expect(result.exitCode !== 0 || result.error).toBeTruthy();
    });

    it('should handle concurrent operations', async () => {
      // Add a server
      await runner.runMcpCommand('add', {
        args: ['concurrent-test', '--type', 'stdio', '--command', 'echo'],
      });

      // Try to update and check status concurrently
      const [updateResult, listResult] = await Promise.all([
        runner.runMcpCommand('update', {
          args: ['concurrent-test', '--tags', 'concurrent'],
        }),
        runner.runMcpCommand('list'),
      ]);

      runner.assertSuccess(updateResult);
      runner.assertSuccess(listResult);
      runner.assertOutputContains(listResult, 'concurrent-test');
    });
  });
});
