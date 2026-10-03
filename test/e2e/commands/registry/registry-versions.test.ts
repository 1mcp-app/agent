import { TestFixtures } from '@test/e2e/fixtures/TestFixtures.js';
import { CliTestRunner, type CommandResult, CommandTestEnvironment } from '@test/e2e/utils/index.js';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('Registry Versions Command E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  const assertBoundedFailure = (result: CommandResult, serverId: string): void => {
    runner.assertFailure(result);
    runner.assertOutputContains(result, 'event="versions.versions.command.failed.508dbd17"');
    runner.assertOutputContains(result, 'error_kind="other"');
    runner.assertOutputContains(result, 'error_code="other"');
    runner.assertOutputContains(result, `Server not found: ${serverId}`.trimEnd(), true);
    runner.assertOutputContains(result, 'Make sure the server ID is correct and the server exists in the registry.');
    runner.assertOutputContains(result, 'Use "registry search" to find available servers.');

    const retainedEvents = result.stdout
      .split('\n')
      .filter((line) => line.includes(' event="'))
      .join('\n');
    expect(retainedEvents).not.toContain('Failed to fetch versions for server with ID:');
    if (serverId) expect(retainedEvents).not.toContain(serverId);
  };

  beforeEach(async () => {
    environment = new CommandTestEnvironment({
      ...TestFixtures.createTestScenario('registry-versions-test', 'basic'),
      mockRegistry: true,
    });
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  describe('Basic Versions Functionality', () => {
    it('should handle 404 error for non-existent server ID', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      assertBoundedFailure(result, 'file-system');
    });

    it('should handle 404 error in table format (default)', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      assertBoundedFailure(result, 'file-system');
    });

    it('should handle 404 error in detailed format', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=detailed'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      assertBoundedFailure(result, 'file-system');
    });

    it('should handle 404 error in JSON format', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=json'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      assertBoundedFailure(result, 'file-system');
    });
  });

  describe('Version Information Content', () => {
    it('should handle 404 error for comprehensive version metadata', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=json'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      assertBoundedFailure(result, 'file-system');
    });

    it('should handle 404 error for semantic version numbers', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      assertBoundedFailure(result, 'file-system');
    });

    it('should handle 404 error for release dates', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      assertBoundedFailure(result, 'file-system');
    });

    it('should handle 404 error for download statistics', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      assertBoundedFailure(result, 'file-system');
    });
  });

  describe('Output Format Validation', () => {
    it('should handle 404 error for table output', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=table'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      assertBoundedFailure(result, 'file-system');
    });

    it('should handle 404 error for detailed output', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=detailed'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      assertBoundedFailure(result, 'file-system');
    });

    it('should handle 404 error for JSON output', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=json'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      assertBoundedFailure(result, 'file-system');
    });

    it('should handle 404 error across multiple format requests', async () => {
      const resultTable = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=table'],
        expectError: true,
        timeout: 20000,
      });
      const resultJson = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=json'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(resultTable);
      runner.assertFailure(resultJson);

      assertBoundedFailure(resultTable, 'file-system');
      assertBoundedFailure(resultJson, 'file-system');
    });
  });

  describe('Version Sorting and Ordering', () => {
    it('should handle 404 error for version sorting', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=json'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      assertBoundedFailure(result, 'file-system');
    });

    it('should handle 404 error for latest version identification', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=json'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      assertBoundedFailure(result, 'file-system');
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent server ID', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['non-existent-server-xyz-12345'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      assertBoundedFailure(result, 'non-existent-server-xyz-12345');
    });

    it('should handle empty server ID', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: [''],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      assertBoundedFailure(result, '');
    });

    it('should handle missing server ID', async () => {
      const result = await runner.runRegistryCommand('versions', {
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Not enough non-option arguments', true);
      runner.assertOutputContains(result, 'need at least 1', true);
    });

    it('should handle invalid output format', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=invalid'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Invalid values', true);
      runner.assertOutputContains(result, 'Given: "invalid"', true);
    });

    it('should handle network timeout', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system'],
        expectError: true,
        timeout: 5000, // Short timeout
      });

      runner.assertFailure(result);
      assertBoundedFailure(result, 'file-system');
    });

    it('should handle special characters in server ID', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['test@#$%^&*()'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      assertBoundedFailure(result, 'test@#$%^&*()');
      // Should handle gracefully without crashing
      expect(result.exitCode !== 0).toBe(true);
    });
  });

  describe('Help Command', () => {
    it('should show help for versions command', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'List all versions');
      runner.assertOutputContains(result, 'Positionals:');
      runner.assertOutputContains(result, 'server-id');
      runner.assertOutputContains(result, 'Options:');
      runner.assertOutputContains(result, '--format');

      // Should show examples
      runner.assertOutputMatches(result, /Examples?:/);
    });
  });

  describe('Reliability', () => {
    it('should handle repeated 404 errors consistently', async () => {
      const results = [];

      // Run multiple versions requests
      for (let i = 0; i < 3; i++) {
        const result = await runner.runRegistryCommand('versions', {
          args: ['file-system'],
          expectError: true,
          timeout: 20000,
        });
        results.push(result);
        runner.assertFailure(result);
      }

      // All should fail with consistent error messages
      results.forEach((result) => {
        expect(result.exitCode).not.toBe(0);
        assertBoundedFailure(result, 'file-system');
      });
      expect(environment.getMockRegistryRequests()).toEqual([
        { method: 'GET', pathname: '/v0.1/servers/file-system/versions', search: '' },
        { method: 'GET', pathname: '/v0.1/servers/file-system/versions', search: '' },
        { method: 'GET', pathname: '/v0.1/servers/file-system/versions', search: '' },
      ]);
    });

    it('should handle 404 errors efficiently with timeout', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system'],
        expectError: true,
        timeout: 30000,
      });

      runner.assertFailure(result);
      assertBoundedFailure(result, 'file-system');

      // Output should contain error message but not be excessive
      expect(result.stdout.length).toBeGreaterThan(10);
      expect(result.stdout.length).toBeLessThan(5000);
    });
  });

  describe('Data Quality and Validation', () => {
    it('should handle 404 error for semantic version validation', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=json'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      assertBoundedFailure(result, 'file-system');
    });

    it('should handle 404 error for release date validation', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=json'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      assertBoundedFailure(result, 'file-system');
    });

    it('should handle 404 error for download count validation', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=json'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      assertBoundedFailure(result, 'file-system');
    });

    it('should handle 404 error for latest version flag validation', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=json'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      assertBoundedFailure(result, 'file-system');
    });
  });
});
