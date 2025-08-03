import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CommandTestEnvironment, CliTestRunner } from '../../utils/index.js';
import { TestFixtures } from '../../fixtures/TestFixtures.js';

describe('Command Workflows Integration E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
    environment = new CommandTestEnvironment(
      TestFixtures.createTestScenario('command-workflows-test', 'basic', 'mixed-types'),
    );
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  describe('MCP Server Management Workflow', () => {
    it('should handle complete server lifecycle: add -> enable -> disable -> update -> remove', async () => {
      const serverName = 'workflow-test-server';

      // Step 1: Add a new server
      const addResult = await runner.runMcpCommand('add', {
        args: [serverName, '--command', 'echo', '--args', 'initial', '--tags', 'workflow,test'],
      });
      runner.assertSuccess(addResult);
      runner.assertOutputContains(addResult, 'Server added successfully');

      // Step 2: Verify server is in the list
      const listAfterAdd = await runner.runMcpCommand('list');
      runner.assertSuccess(listAfterAdd);
      runner.assertOutputContains(listAfterAdd, serverName);
      runner.assertOutputContains(listAfterAdd, '🟢'); // Should be enabled by default

      // Step 3: Check server status
      const statusAfterAdd = await runner.runMcpCommand('status', { args: [serverName] });
      runner.assertSuccess(statusAfterAdd);
      runner.assertOutputContains(statusAfterAdd, serverName);
      runner.assertOutputContains(statusAfterAdd, 'Enabled');

      // Step 4: Disable the server
      const disableResult = await runner.runMcpCommand('disable', { args: [serverName] });
      runner.assertSuccess(disableResult);
      runner.assertOutputContains(disableResult, 'Server disabled successfully');

      // Step 5: Verify server is disabled
      const listAfterDisable = await runner.runMcpCommand('list');
      expect(listAfterDisable.stdout).not.toContain(serverName); // Not in enabled list

      const listDisabled = await runner.runMcpCommand('list', { args: ['--show-disabled'] });
      runner.assertOutputContains(listDisabled, serverName);
      runner.assertOutputContains(listDisabled, '🔴'); // Should be disabled

      // Step 6: Update the server configuration
      const updateResult = await runner.runMcpCommand('update', {
        args: [serverName, '--command', 'node', '--args', '--version', '--tags', 'workflow,test,updated'],
      });
      runner.assertSuccess(updateResult);
      runner.assertOutputContains(updateResult, 'Server updated successfully');

      // Step 7: Re-enable the server
      const enableResult = await runner.runMcpCommand('enable', { args: [serverName] });
      runner.assertSuccess(enableResult);
      runner.assertOutputContains(enableResult, 'Server enabled successfully');

      // Step 8: Verify updates took effect
      const listAfterUpdate = await runner.runMcpCommand('list', { args: ['--verbose'] });
      runner.assertOutputContains(listAfterUpdate, serverName);
      runner.assertOutputContains(listAfterUpdate, 'Command: node');
      runner.assertOutputContains(listAfterUpdate, 'Args: --version');
      runner.assertOutputContains(listAfterUpdate, 'Tags: workflow, test, updated');

      // Step 9: Remove the server
      const removeResult = await runner.runMcpCommand('remove', { args: [serverName] });
      runner.assertSuccess(removeResult);
      runner.assertOutputContains(removeResult, 'Server removed successfully');

      // Step 10: Verify server is completely gone
      const finalList = await runner.runMcpCommand('list', { args: ['--show-disabled'] });
      expect(finalList.stdout).not.toContain(serverName);
    });

    it('should handle batch operations correctly', async () => {
      const serverNames = ['batch-server-1', 'batch-server-2', 'batch-server-3'];

      // Add multiple servers
      for (const name of serverNames) {
        const result = await runner.runMcpCommand('add', {
          args: [name, '--command', 'echo', '--args', `hello-${name}`, '--tags', 'batch'],
        });
        runner.assertSuccess(result);
      }

      // Verify all servers are added
      const listResult = await runner.runMcpCommand('list', { args: ['--tags', 'batch'] });
      runner.assertSuccess(listResult);
      serverNames.forEach((name) => {
        runner.assertOutputContains(listResult, name);
      });

      // Disable all batch servers
      const disableResult = await runner.runMcpCommand('disable', { args: serverNames });
      runner.assertSuccess(disableResult);
      runner.assertOutputContains(disableResult, 'Servers disabled successfully');

      // Verify all are disabled
      const disabledList = await runner.runMcpCommand('list', { args: ['--show-disabled', '--tags', 'batch'] });
      serverNames.forEach((name) => {
        runner.assertOutputContains(disabledList, name);
        runner.assertOutputContains(disabledList, '🔴');
      });

      // Re-enable all batch servers
      const enableResult = await runner.runMcpCommand('enable', { args: serverNames });
      runner.assertSuccess(enableResult);

      // Remove all batch servers
      const removeResult = await runner.runMcpCommand('remove', { args: serverNames });
      runner.assertSuccess(removeResult);
      runner.assertOutputContains(removeResult, 'Servers removed successfully');
    });
  });

  describe('App Discovery and Management Workflow', () => {
    it('should handle discovery -> list -> status -> consolidate workflow', async () => {
      // Step 1: Discover applications
      const discoverResult = await runner.runAppCommand('discover');
      runner.assertSuccess(discoverResult);
      runner.assertOutputContains(discoverResult, 'Found');
      runner.assertOutputContains(discoverResult, 'applications');

      // Step 2: List discovered applications
      const listResult = await runner.runAppCommand('list');
      runner.assertSuccess(listResult);
      runner.assertOutputContains(listResult, 'Applications');
      const appCount = (listResult.stdout.match(/🟢|📱/g) || []).length;
      expect(appCount).toBeGreaterThan(0);

      // Step 3: Check detailed status
      const statusResult = await runner.runAppCommand('status', { args: ['--verbose'] });
      runner.assertSuccess(statusResult);
      runner.assertOutputContains(statusResult, 'Application Status');
      runner.assertOutputContains(statusResult, 'Total applications:');

      // Step 4: Analyze consolidation opportunities
      const analyzeResult = await runner.runAppCommand('consolidate', { args: ['--analyze'] });
      runner.assertSuccess(analyzeResult);
      runner.assertOutputContains(analyzeResult, 'Consolidation Analysis');

      // Step 5: Perform dry-run consolidation
      const dryRunResult = await runner.runAppCommand('consolidate', { args: ['--dry-run'] });
      runner.assertSuccess(dryRunResult);
      runner.assertOutputContains(dryRunResult, 'Dry run - no changes made');
    });

    it('should handle backup -> consolidate -> restore workflow', async () => {
      // Step 1: Create initial backup
      const backupResult = await runner.runAppCommand('backups', {
        args: ['create', '--description', 'Pre-consolidation backup'],
      });
      runner.assertSuccess(backupResult);
      const backupIdMatch = backupResult.stdout.match(/Backup ID: ([a-f0-9-]+)/);
      expect(backupIdMatch).toBeTruthy();
      const backupId = backupIdMatch![1];

      // Step 2: List backups to verify creation
      const listBackupsResult = await runner.runAppCommand('backups', { args: ['list'] });
      runner.assertSuccess(listBackupsResult);
      runner.assertOutputContains(listBackupsResult, backupId);
      runner.assertOutputContains(listBackupsResult, 'Pre-consolidation backup');

      // Step 3: Perform consolidation with backup
      const consolidateResult = await runner.runAppCommand('consolidate', {
        args: ['--backup-before', '--force'],
      });
      runner.assertSuccess(consolidateResult);
      runner.assertOutputContains(consolidateResult, 'Backup created before consolidation');
      runner.assertOutputContains(consolidateResult, 'Consolidation completed');

      // Step 4: Verify consolidation worked
      const statusAfterConsolidate = await runner.runAppCommand('status', {
        args: ['--consolidation-info'],
      });
      runner.assertSuccess(statusAfterConsolidate);

      // Step 5: Test restore functionality
      const restoreResult = await runner.runAppCommand('restore', {
        args: [backupId, '--dry-run'],
      });
      runner.assertSuccess(restoreResult);
      runner.assertOutputContains(restoreResult, 'Dry run - no changes made');
      runner.assertOutputContains(restoreResult, 'Would restore:');
    });
  });

  describe('Mixed Command Integration', () => {
    it('should handle MCP and App commands together in a realistic workflow', async () => {
      // Step 1: Start with app discovery
      const discoverResult = await runner.runAppCommand('discover', { args: ['--analyze-config'] });
      runner.assertSuccess(discoverResult);

      // Step 2: Check current MCP server status
      const initialMcpStatus = await runner.runMcpCommand('status');
      runner.assertSuccess(initialMcpStatus);

      // Step 3: Add some new MCP servers
      const servers = [
        { name: 'integration-server-1', command: 'echo', args: ['server1'] },
        { name: 'integration-server-2', command: 'node', args: ['--version'] },
      ];

      for (const server of servers) {
        const addResult = await runner.runMcpCommand('add', {
          args: [server.name, '--command', server.command, '--args', server.args.join(',')],
        });
        runner.assertSuccess(addResult);
      }

      // Step 4: Verify servers were added
      const mcpListResult = await runner.runMcpCommand('list');
      runner.assertSuccess(mcpListResult);
      servers.forEach((server) => {
        runner.assertOutputContains(mcpListResult, server.name);
      });

      // Step 5: Create backup of current state
      const backupResult = await runner.runAppCommand('backups', {
        args: ['create', '--description', 'Integration test backup'],
      });
      runner.assertSuccess(backupResult);

      // Step 6: Check overall app status after changes
      const finalAppStatus = await runner.runAppCommand('status', { args: ['--config-stats'] });
      runner.assertSuccess(finalAppStatus);

      // Step 7: Analyze consolidation with new servers
      const consolidateAnalysis = await runner.runAppCommand('consolidate', {
        args: ['--analyze', '--verbose'],
      });
      runner.assertSuccess(consolidateAnalysis);

      // Step 8: Clean up by removing test servers
      for (const server of servers) {
        const removeResult = await runner.runMcpCommand('remove', { args: [server.name] });
        runner.assertSuccess(removeResult);
      }

      // Step 9: Verify cleanup
      const finalMcpList = await runner.runMcpCommand('list');
      servers.forEach((server) => {
        expect(finalMcpList.stdout).not.toContain(server.name);
      });
    });

    it('should handle error recovery across commands', async () => {
      // Step 1: Try to add server with invalid configuration
      const invalidAddResult = await runner.runMcpCommand('add', {
        args: ['invalid-server', '--command', '', '--args', 'test'],
        expectError: true,
      });
      runner.assertFailure(invalidAddResult, 1);

      // Step 2: Verify system state is consistent after error
      const statusAfterError = await runner.runMcpCommand('status');
      runner.assertSuccess(statusAfterError);

      // Step 3: Add valid server
      const validAddResult = await runner.runMcpCommand('add', {
        args: ['valid-server', '--command', 'echo', '--args', 'test'],
      });
      runner.assertSuccess(validAddResult);

      // Step 4: Try invalid app operation
      const invalidAppResult = await runner.runAppCommand('restore', {
        args: ['nonexistent-backup-id'],
        expectError: true,
      });
      runner.assertFailure(invalidAppResult, 1);

      // Step 5: Verify MCP server still exists after app error
      const mcpListAfterAppError = await runner.runMcpCommand('list');
      runner.assertOutputContains(mcpListAfterAppError, 'valid-server');

      // Step 6: Clean up
      const cleanupResult = await runner.runMcpCommand('remove', { args: ['valid-server'] });
      runner.assertSuccess(cleanupResult);
    });
  });

  describe('Configuration Consistency', () => {
    it('should maintain configuration consistency across operations', async () => {
      const testServer = 'consistency-test-server';

      // Step 1: Add server with specific configuration
      const addResult = await runner.runMcpCommand('add', {
        args: [
          testServer,
          '--command',
          'node',
          '--args',
          '--version,--help',
          '--tags',
          'consistency,test',
          '--timeout',
          '5000',
        ],
      });
      runner.assertSuccess(addResult);

      // Step 2: Verify configuration through list command
      const listResult = await runner.runMcpCommand('list', { args: ['--verbose'] });
      runner.assertOutputContains(listResult, testServer);
      runner.assertOutputContains(listResult, 'Command: node');
      runner.assertOutputContains(listResult, 'Args: --version --help');
      runner.assertOutputContains(listResult, 'Tags: consistency, test');
      runner.assertOutputContains(listResult, 'Timeout: 5000ms');

      // Step 3: Verify configuration through status command
      const statusResult = await runner.runMcpCommand('status', { args: [testServer, '--verbose'] });
      runner.assertOutputContains(statusResult, testServer);
      runner.assertOutputContains(statusResult, 'Command: node');

      // Step 4: Disable and re-enable, verify configuration preserved
      await runner.runMcpCommand('disable', { args: [testServer] });
      await runner.runMcpCommand('enable', { args: [testServer] });

      const listAfterToggle = await runner.runMcpCommand('list', { args: ['--verbose'] });
      runner.assertOutputContains(listAfterToggle, testServer);
      runner.assertOutputContains(listAfterToggle, 'Command: node');
      runner.assertOutputContains(listAfterToggle, 'Tags: consistency, test');

      // Step 5: Update configuration and verify changes
      const updateResult = await runner.runMcpCommand('update', {
        args: [testServer, '--tags', 'consistency,test,updated', '--timeout', '8000'],
      });
      runner.assertSuccess(updateResult);

      const listAfterUpdate = await runner.runMcpCommand('list', { args: ['--verbose'] });
      runner.assertOutputContains(listAfterUpdate, 'Tags: consistency, test, updated');
      runner.assertOutputContains(listAfterUpdate, 'Timeout: 8000ms');

      // Step 6: Clean up
      await runner.runMcpCommand('remove', { args: [testServer] });
    });

    it('should handle concurrent-like operations without corruption', async () => {
      const servers = ['concurrent-1', 'concurrent-2', 'concurrent-3'];

      // Add multiple servers in sequence (simulating potential concurrency issues)
      for (const server of servers) {
        const addResult = await runner.runMcpCommand('add', {
          args: [server, '--command', 'echo', '--args', `test-${server}`],
        });
        runner.assertSuccess(addResult);
      }

      // Perform various operations on different servers
      const operations = [
        () => runner.runMcpCommand('disable', { args: ['concurrent-1'] }),
        () => runner.runMcpCommand('update', { args: ['concurrent-2', '--tags', 'updated'] }),
        () => runner.runMcpCommand('status', { args: ['concurrent-3'] }),
      ];

      // Execute operations
      const results = await Promise.all(operations.map((op) => op()));
      results.forEach((result) => runner.assertSuccess(result));

      // Verify final state is consistent
      const finalList = await runner.runMcpCommand('list', { args: ['--show-disabled', '--verbose'] });
      runner.assertOutputContains(finalList, 'concurrent-1');
      runner.assertOutputContains(finalList, 'concurrent-2');
      runner.assertOutputContains(finalList, 'concurrent-3');
      runner.assertOutputContains(finalList, '🔴'); // concurrent-1 should be disabled
      runner.assertOutputContains(finalList, 'Tags: updated'); // concurrent-2 should be updated

      // Clean up
      for (const server of servers) {
        await runner.runMcpCommand('remove', { args: [server] });
      }
    });
  });

  describe('Performance and Reliability', () => {
    it('should handle rapid command sequences efficiently', async () => {
      const startTime = Date.now();
      const serverName = 'performance-test-server';

      // Rapid sequence of operations
      await runner.runMcpCommand('add', {
        args: [serverName, '--command', 'echo', '--args', 'performance'],
      });

      await runner.runMcpCommand('list');
      await runner.runMcpCommand('status', { args: [serverName] });
      await runner.runMcpCommand('disable', { args: [serverName] });
      await runner.runMcpCommand('enable', { args: [serverName] });
      await runner.runMcpCommand('update', { args: [serverName, '--tags', 'performance'] });
      await runner.runMcpCommand('list', { args: ['--verbose'] });
      await runner.runMcpCommand('remove', { args: [serverName] });

      const duration = Date.now() - startTime;

      // Should complete within reasonable time
      expect(duration).toBeLessThan(15000); // 15 seconds

      // Verify final state is clean
      const finalList = await runner.runMcpCommand('list');
      expect(finalList.stdout).not.toContain(serverName);
    });

    it('should maintain state consistency after interruption simulation', async () => {
      const serverName = 'interruption-test-server';

      // Add server
      await runner.runMcpCommand('add', {
        args: [serverName, '--command', 'echo', '--args', 'interruption'],
      });

      // Simulate interruption by adding server with same name (should fail)
      const duplicateResult = await runner.runMcpCommand('add', {
        args: [serverName, '--command', 'node', '--args', '--version'],
        expectError: true,
      });
      runner.assertFailure(duplicateResult, 1);
      runner.assertOutputContains(duplicateResult, 'already exists', true);

      // Verify original server configuration is unchanged
      const listResult = await runner.runMcpCommand('list', { args: ['--verbose'] });
      runner.assertOutputContains(listResult, serverName);
      runner.assertOutputContains(listResult, 'Command: echo');
      runner.assertOutputContains(listResult, 'Args: interruption');

      // Clean up
      await runner.runMcpCommand('remove', { args: [serverName] });
    });
  });

  describe('Cross-Platform Workflow Testing', () => {
    it('should handle path separators and file operations correctly', async () => {
      // Test with different path styles
      const serverName = 'path-test-server';

      const addResult = await runner.runMcpCommand('add', {
        args: [serverName, '--command', 'echo', '--args', 'path-test', '--cwd', '/tmp'],
      });
      runner.assertSuccess(addResult);

      const listResult = await runner.runMcpCommand('list', { args: ['--verbose'] });
      runner.assertOutputContains(listResult, serverName);
      runner.assertOutputContains(listResult, 'Working Directory: /tmp');

      // Clean up
      await runner.runMcpCommand('remove', { args: [serverName] });
    });

    it('should handle environment variables correctly', async () => {
      const serverName = 'env-test-server';

      const addResult = await runner.runMcpCommand('add', {
        args: [serverName, '--command', 'echo', '--args', 'env-test', '--env', 'TEST_VAR=test_value,DEBUG=true'],
      });
      runner.assertSuccess(addResult);

      const listResult = await runner.runMcpCommand('list', { args: ['--verbose'] });
      runner.assertOutputContains(listResult, serverName);
      runner.assertOutputContains(listResult, 'Environment: 2 variables');

      // Clean up
      await runner.runMcpCommand('remove', { args: [serverName] });
    });
  });
});
