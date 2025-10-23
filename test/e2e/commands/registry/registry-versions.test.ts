import { TestFixtures } from '@test/e2e/fixtures/TestFixtures.js';
import { CliTestRunner, CommandTestEnvironment } from '@test/e2e/utils/index.js';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('Registry Versions Command E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
    environment = new CommandTestEnvironment(TestFixtures.createTestScenario('registry-versions-test', 'basic'));
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
      runner.assertOutputContains(result, 'Failed to fetch versions for server with ID: file-system');
    });

    it('should handle 404 error in table format (default)', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Failed to fetch versions for server with ID: file-system');
    });

    it('should handle 404 error in detailed format', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=detailed'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Failed to fetch versions for server with ID: file-system');
    });

    it('should handle 404 error in JSON format', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=json'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Failed to fetch versions for server with ID: file-system');
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
      runner.assertOutputContains(result, 'Failed to fetch versions for server with ID: file-system');
    });

    it('should handle 404 error for semantic version numbers', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Failed to fetch versions for server with ID: file-system');
    });

    it('should handle 404 error for release dates', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Failed to fetch versions for server with ID: file-system');
    });

    it('should handle 404 error for download statistics', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Failed to fetch versions for server with ID: file-system');
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
      runner.assertOutputContains(result, 'Failed to fetch versions for server with ID: file-system');
    });

    it('should handle 404 error for detailed output', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=detailed'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Failed to fetch versions for server with ID: file-system');
    });

    it('should handle 404 error for JSON output', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=json'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Failed to fetch versions for server with ID: file-system');
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

      runner.assertOutputContains(resultTable, 'Failed to fetch versions for server with ID: file-system');
      runner.assertOutputContains(resultJson, 'Failed to fetch versions for server with ID: file-system');
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
      runner.assertOutputContains(result, 'Failed to fetch versions for server with ID: file-system');
    });

    it('should handle 404 error for latest version identification', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=json'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Failed to fetch versions for server with ID: file-system');
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
      runner.assertOutputContains(result, 'Failed to fetch versions for server with ID: non-existent-server-xyz-12345');
    });

    it('should handle empty server ID', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: [''],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Failed to fetch versions for server with ID: ');
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
      runner.assertOutputContains(result, 'Failed to fetch versions for server with ID: file-system');
    });

    it('should handle special characters in server ID', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['test@#$%^&*()'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Failed to fetch versions for server with ID: test@#$%^&*()');
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

  describe('Performance and Reliability', () => {
    it('should complete 404 error handling within reasonable time', async () => {
      const startTime = Date.now();

      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system'],
        expectError: true,
        timeout: 30000, // 30 second timeout
      });

      const duration = Date.now() - startTime;
      runner.assertFailure(result);

      // Should complete within 20 seconds under normal conditions
      expect(duration).toBeLessThan(20000);
      runner.assertOutputContains(result, 'Failed to fetch versions for server with ID: file-system');
    });

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
        runner.assertOutputContains(result, 'Failed to fetch versions for server with ID: file-system');
      });
    });

    it('should handle 404 errors efficiently across multiple requests', async () => {
      const result1 = await runner.runRegistryCommand('versions', {
        args: ['file-system'],
        expectError: true,
        timeout: 20000,
      });
      const startTime = Date.now();

      const result2 = await runner.runRegistryCommand('versions', {
        args: ['file-system'],
        expectError: true,
        timeout: 20000,
      });
      const duration = Date.now() - startTime;

      runner.assertFailure(result1);
      runner.assertFailure(result2);

      // Second request should complete quickly even with error
      expect(duration).toBeLessThan(10000);

      // Both should contain error information
      runner.assertOutputContains(result1, 'Failed to fetch versions for server with ID: file-system');
      runner.assertOutputContains(result2, 'Failed to fetch versions for server with ID: file-system');
    });

    it('should handle 404 errors efficiently with timeout', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system'],
        expectError: true,
        timeout: 30000,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Failed to fetch versions for server with ID: file-system');

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
      runner.assertOutputContains(result, 'Failed to fetch versions for server with ID: file-system');
    });

    it('should handle 404 error for release date validation', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=json'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Failed to fetch versions for server with ID: file-system');
    });

    it('should handle 404 error for download count validation', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=json'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Failed to fetch versions for server with ID: file-system');
    });

    it('should handle 404 error for latest version flag validation', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=json'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Failed to fetch versions for server with ID: file-system');
    });
  });
});
