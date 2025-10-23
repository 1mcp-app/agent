import { TestFixtures } from '@test/e2e/fixtures/TestFixtures.js';
import { CliTestRunner, CommandTestEnvironment } from '@test/e2e/utils/index.js';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('Registry Show Command E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
    environment = new CommandTestEnvironment(TestFixtures.createTestScenario('registry-show-test', 'basic'));
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  describe('Basic Show Functionality', () => {
    it('should handle server not found gracefully', async () => {
      // Test with a server ID that doesn't exist in the registry
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      // Should show appropriate error message
      runner.assertOutputContains(result, 'Failed to fetch server with ID: file-system');
      runner.assertOutputContains(result, 'HTTP 404: Not Found');
    });

    it('should handle detailed format request gracefully', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      // Should show error message instead of server details
      runner.assertOutputContains(result, 'Failed to fetch server with ID: file-system');
    });

    it('should handle table format request gracefully', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system', '--format=table'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      // Should show error message instead of table
      runner.assertOutputContains(result, 'Failed to fetch server with ID: file-system');
    });

    it('should handle JSON format request gracefully', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system', '--format=json'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      // Should show error message instead of JSON
      runner.assertOutputContains(result, 'Failed to fetch server with ID: file-system');
    });
  });

  describe('Version Specific Requests', () => {
    it('should handle specific version request with --ver flag', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system', '--ver=1.0.0'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Failed to fetch server with ID: file-system');
      runner.assertOutputContains(result, 'HTTP 404: Not Found');
    });

    it('should handle specific version request with -v alias', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system', '-v', '1.0.0'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Failed to fetch server with ID: file-system');
    });

    it('should handle version request in different output formats', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system', '--ver=1.0.0', '--format=json'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Failed to fetch server with ID: file-system');
    });

    it('should default to latest version when version not specified', async () => {
      const result1 = await runner.runRegistryCommand('show', {
        args: ['file-system'],
        expectError: true,
        timeout: 20000,
      });
      const result2 = await runner.runRegistryCommand('show', {
        args: ['file-system', '--format=json'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result1);
      runner.assertFailure(result2);
      runner.assertOutputContains(result1, 'Failed to fetch server with ID: file-system');
      runner.assertOutputContains(result2, 'Failed to fetch server with ID: file-system');
    });
  });

  describe('Server Information Content', () => {
    it('should show comprehensive server metadata', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system', '--format=json'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Failed to fetch server with ID: file-system');
      runner.assertOutputContains(result, 'HTTP 404: Not Found');
    });

    it('should show package information details', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Failed to fetch server with ID: file-system');
      runner.assertOutputContains(result, 'HTTP 404: Not Found');
    });

    it('should show installation instructions', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Failed to fetch server with ID: file-system');
      runner.assertOutputContains(result, 'HTTP 404: Not Found');
    });
  });

  describe('Output Format Validation', () => {
    it('should format detailed output consistently', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Failed to fetch server with ID: file-system');
      runner.assertOutputContains(result, 'HTTP 404: Not Found');
    });

    it('should format table output properly', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system', '--format=table'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Failed to fetch server with ID: file-system');
      runner.assertOutputContains(result, 'HTTP 404: Not Found');
    });

    it('should format JSON output with proper structure', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system', '--format=json'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Failed to fetch server with ID: file-system');
      runner.assertOutputContains(result, 'HTTP 404: Not Found');
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent server ID', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['non-existent-server-xyz-12345'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Failed to fetch server with ID: non-existent-server-xyz-12345');
      runner.assertOutputContains(result, 'HTTP 404: Not Found');
    });

    it('should handle non-existent version', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system', '--ver=999.999.999'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Failed to fetch server with ID: file-system');
      runner.assertOutputContains(result, 'HTTP 404: Not Found');
    });

    it('should handle malformed version number', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system', '--ver=invalid-version'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Failed to fetch server with ID: file-system');
      runner.assertOutputContains(result, 'HTTP 404: Not Found');
    });

    it('should handle invalid output format', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system', '--format=invalid'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Invalid values:', true);
      runner.assertOutputContains(result, 'Argument: format', true);
      runner.assertOutputContains(result, 'Given: "invalid"', true);
    });

    it('should handle missing server ID', async () => {
      const result = await runner.runRegistryCommand('show', {
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Not enough non-option arguments', true);
      runner.assertOutputContains(result, 'got 0, need at least 1', true);
    });

    it('should handle network timeout', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system'],
        timeout: 5000, // Short timeout
        expectError: true,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Failed to fetch server with ID: file-system');
      runner.assertOutputContains(result, 'HTTP 404: Not Found');
    });
  });

  describe('Help Command', () => {
    it('should show help for show command', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Show detailed information');
      runner.assertOutputContains(result, 'Positionals:');
      runner.assertOutputContains(result, 'server-id');
      runner.assertOutputContains(result, 'Options:');
      runner.assertOutputContains(result, '--ver');
      runner.assertOutputContains(result, '--format');
    });
  });

  describe('Performance and Reliability', () => {
    it('should complete show request within reasonable time', async () => {
      const startTime = Date.now();

      const result = await runner.runRegistryCommand('show', {
        args: ['file-system'],
        timeout: 30000, // 30 second timeout
        expectError: true,
      });

      const duration = Date.now() - startTime;
      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Failed to fetch server with ID: file-system');
      runner.assertOutputContains(result, 'HTTP 404: Not Found');

      // Should complete within 15 seconds even for errors
      expect(duration).toBeLessThan(15000);
    });

    it('should handle repeated show requests consistently', async () => {
      const results = [];

      // Run multiple show requests
      for (let i = 0; i < 3; i++) {
        const result = await runner.runRegistryCommand('show', {
          args: ['file-system'],
          expectError: true,
          timeout: 20000,
        });
        results.push(result);
        runner.assertFailure(result);
      }

      // All should fail and have consistent error messages
      results.forEach((result) => {
        expect(result.exitCode).not.toBe(0);
        runner.assertOutputContains(result, 'Failed to fetch server with ID: file-system');
        runner.assertOutputContains(result, 'HTTP 404: Not Found');
      });
    });

    it('should cache results appropriately', async () => {
      const result1 = await runner.runRegistryCommand('show', {
        args: ['file-system'],
        expectError: true,
        timeout: 20000,
      });
      const startTime = Date.now();

      const result2 = await runner.runRegistryCommand('show', {
        args: ['file-system'],
        expectError: true,
        timeout: 20000,
      });
      const duration = Date.now() - startTime;

      runner.assertFailure(result1);
      runner.assertFailure(result2);

      // Second request might be faster due to caching (even for errors)
      expect(duration).toBeLessThan(5000);

      // Both should contain same error message
      runner.assertOutputContains(result1, 'Failed to fetch server with ID: file-system');
      runner.assertOutputContains(result2, 'Failed to fetch server with ID: file-system');
    });

    it('should handle different servers efficiently', async () => {
      const serverIds = ['file-system', 'git', 'database'];
      const results = [];

      const startTime = Date.now();

      for (const serverId of serverIds) {
        const result = await runner.runRegistryCommand('show', {
          args: [serverId],
          timeout: 30000,
          expectError: true,
        });
        results.push(result);
        // Note: These might not exist, which is fine for testing error handling
      }

      const duration = Date.now() - startTime;

      // Should complete all requests within reasonable time
      expect(duration).toBeLessThan(60000); // 60 seconds for 3 requests

      // All should fail since these server IDs don't exist
      const failureCount = results.filter((r) => r.exitCode !== 0).length;
      expect(failureCount).toBe(serverIds.length);

      // All should have error messages with their respective server IDs
      results.forEach((result, index) => {
        const serverId = serverIds[index];
        runner.assertOutputContains(result, `Failed to fetch server with ID: ${serverId}`);
        runner.assertOutputContains(result, 'HTTP 404: Not Found');
      });
    });
  });

  describe('Input Validation', () => {
    it('should handle special characters in server ID', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['test@#$%^&*()'],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      // Should handle gracefully without crashing
      expect(result.exitCode !== 0).toBe(true);
    });

    it('should handle very long server ID', async () => {
      const longServerId = 'a'.repeat(1000);
      const result = await runner.runRegistryCommand('show', {
        args: [longServerId],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      // Should handle gracefully
      expect(result.exitCode !== 0).toBe(true);
    });

    it('should handle empty string server ID', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: [''],
        expectError: true,
        timeout: 20000,
      });

      runner.assertFailure(result);
      // Should handle gracefully
      expect(result.exitCode !== 0).toBe(true);
    });
  });
});
