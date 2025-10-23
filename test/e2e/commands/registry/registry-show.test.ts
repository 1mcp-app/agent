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
    it('should show server details for valid server ID', async () => {
      // Use a real server ID from the MCP registry
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system'], // Common server that should exist
      });

      runner.assertSuccess(result);
      // Should show server information
      runner.assertOutputContains(result, 'Server Details');
      runner.assertOutputContains(result, 'Name:');
      runner.assertOutputContains(result, 'Description:');
      runner.assertOutputContains(result, 'Version:');
    });

    it('should show server details in detailed format (default)', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system'],
      });

      runner.assertSuccess(result);
      // Detailed format should show comprehensive information
      runner.assertOutputContains(result, 'Server Details');
      runner.assertOutputContains(result, 'Basic Information');
      runner.assertOutputContains(result, 'Package Information');
      // Should have structured sections
    });

    it('should show server details in table format', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system', '--format=table'],
      });

      runner.assertSuccess(result);
      // Table format should be more compact
      runner.assertOutputContains(result, '┌'); // Table border character
      runner.assertOutputContains(result, '│'); // Table border character
    });

    it('should show server details in JSON format', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system', '--format=json'],
      });

      runner.assertSuccess(result);

      const jsonResult = runner.parseJsonOutput(result);
      expect(jsonResult).toHaveProperty('name');
      expect(jsonResult).toHaveProperty('description');
      expect(jsonResult).toHaveProperty('version');
      expect(jsonResult).toHaveProperty('packages');
      expect(Array.isArray(jsonResult.packages)).toBe(true);
    });
  });

  describe('Version Specific Requests', () => {
    it('should show specific version with --ver flag', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system', '--ver=1.0.0'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Version: 1.0.0');
    });

    it('should show specific version with -v alias', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system', '-v', '1.0.0'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Version: 1.0.0');
    });

    it('should handle version request in different output formats', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system', '--ver=1.0.0', '--format=json'],
      });

      runner.assertSuccess(result);

      const jsonResult = runner.parseJsonOutput(result);
      expect(jsonResult).toHaveProperty('version');
      expect(jsonResult.version).toBe('1.0.0');
    });

    it('should default to latest version when version not specified', async () => {
      const result1 = await runner.runRegistryCommand('show', {
        args: ['file-system'],
      });
      const result2 = await runner.runRegistryCommand('show', {
        args: ['file-system', '--format=json'],
      });

      runner.assertSuccess(result1);
      runner.assertSuccess(result2);

      const jsonResult = runner.parseJsonOutput(result2);
      expect(jsonResult).toHaveProperty('version');
      // Should have a valid semantic version
      expect(jsonResult.version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe('Server Information Content', () => {
    it('should show comprehensive server metadata', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system', '--format=json'],
      });

      runner.assertSuccess(result);

      const jsonResult = runner.parseJsonOutput(result);

      // Should have basic server information
      expect(jsonResult).toHaveProperty('name');
      expect(jsonResult).toHaveProperty('description');
      expect(jsonResult).toHaveProperty('version');
      expect(jsonResult).toHaveProperty('author');
      expect(jsonResult).toHaveProperty('license');
      expect(jsonResult).toHaveProperty('homepage');

      // Should have package information
      expect(jsonResult).toHaveProperty('packages');
      expect(Array.isArray(jsonResult.packages)).toBe(true);

      if (jsonResult.packages.length > 0) {
        const package_ = jsonResult.packages[0];
        expect(package_).toHaveProperty('name');
        expect(package_).toHaveProperty('registry_type');
        expect(package_).toHaveProperty('transport');
      }
    });

    it('should show package information details', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system'],
      });

      runner.assertSuccess(result);
      // Should show package information section
      runner.assertOutputContains(result, 'Package Information');
      runner.assertOutputContains(result, 'Registry Type:');
      runner.assertOutputContains(result, 'Transport:');
    });

    it('should show installation instructions', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system'],
      });

      runner.assertSuccess(result);
      // Should show how to install/use the server
      runner.assertOutputContains(result, 'Installation');
      runner.assertOutputContains(result, 'Usage');
    });
  });

  describe('Output Format Validation', () => {
    it('should format detailed output consistently', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system'],
      });

      runner.assertSuccess(result);
      // Should have consistent section headers
      runner.assertOutputMatches(result, /═+/); // Section separator
      runner.assertOutputContains(result, 'Server Details');

      // Should include key information fields
      const keyFields = ['Name:', 'Description:', 'Version:', 'Author:'];
      keyFields.forEach((field) => {
        expect(result.stdout).toContain(field);
      });
    });

    it('should format table output properly', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system', '--format=table'],
      });

      runner.assertSuccess(result);
      // Should have table structure
      expect(result.stdout).toContain('┌');
      expect(result.stdout).toContain('┐');
      expect(result.stdout).toContain('│');
      expect(result.stdout).toContain('└');
      expect(result.stdout).toContain('┘');
    });

    it('should format JSON output with proper structure', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system', '--format=json'],
      });

      runner.assertSuccess(result);

      const jsonResult = runner.parseJsonOutput(result);

      // Should be valid JSON with expected structure
      expect(typeof jsonResult).toBe('object');
      expect(jsonResult).not.toBeNull();

      // Required top-level fields
      const requiredFields = ['name', 'description', 'version', 'packages'];
      requiredFields.forEach((field) => {
        expect(jsonResult).toHaveProperty(field);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent server ID', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['non-existent-server-xyz-12345'],
        expectError: true,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Server not found');
      runner.assertOutputContains(result, 'Make sure server ID is correct');
    });

    it('should handle non-existent version', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system', '--ver=999.999.999'],
        expectError: true,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Server not found');
      runner.assertOutputContains(result, 'Check if version');
    });

    it('should handle malformed version number', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system', '--ver=invalid-version'],
        expectError: true,
      });

      runner.assertFailure(result);
      // Should handle gracefully
      expect(result.exitCode !== 0).toBe(true);
    });

    it('should handle invalid output format', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system', '--format=invalid'],
        expectError: true,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Invalid choices');
    });

    it('should handle missing server ID', async () => {
      const result = await runner.runRegistryCommand('show', {
        expectError: true,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'server-id');
      runner.assertOutputContains(result, 'required');
    });

    it('should handle network timeout', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['file-system'],
        timeout: 5000, // Short timeout
      });

      // May succeed if fast enough, or fail gracefully
      expect(result.exitCode === 0 || result.exitCode === -1).toBe(true);

      if (result.exitCode !== 0) {
        runner.assertOutputContains(result, 'Error fetching MCP server details');
      }
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
      });

      const duration = Date.now() - startTime;
      runner.assertSuccess(result);

      // Should complete within 15 seconds under normal conditions
      expect(duration).toBeLessThan(15000);
    });

    it('should handle repeated show requests consistently', async () => {
      const results = [];

      // Run multiple show requests
      for (let i = 0; i < 3; i++) {
        const result = await runner.runRegistryCommand('show', {
          args: ['file-system'],
        });
        results.push(result);
        runner.assertSuccess(result);
      }

      // All should succeed and have consistent information
      results.forEach((result) => {
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('Server Details');
        expect(result.stdout).toContain('Name:');
      });
    });

    it('should cache results appropriately', async () => {
      const result1 = await runner.runRegistryCommand('show', {
        args: ['file-system'],
      });
      const startTime = Date.now();

      const result2 = await runner.runRegistryCommand('show', {
        args: ['file-system'],
      });
      const duration = Date.now() - startTime;

      runner.assertSuccess(result1);
      runner.assertSuccess(result2);

      // Second request might be faster due to caching
      expect(duration).toBeLessThan(5000);

      // Both should contain same server name
      expect(result1.stdout).toContain('Name:');
      expect(result2.stdout).toContain('Name:');
    });

    it('should handle different servers efficiently', async () => {
      const serverIds = ['file-system', 'git', 'database'];
      const results = [];

      const startTime = Date.now();

      for (const serverId of serverIds) {
        const result = await runner.runRegistryCommand('show', {
          args: [serverId],
          timeout: 30000,
        });
        results.push(result);
        // Note: Some of these might not exist, which is fine for testing
      }

      const duration = Date.now() - startTime;

      // Should complete all requests within reasonable time
      expect(duration).toBeLessThan(60000); // 60 seconds for 3 requests

      // At least one should succeed (using file-system which should exist)
      const successCount = results.filter((r) => r.exitCode === 0).length;
      expect(successCount).toBeGreaterThan(0);
    });
  });

  describe('Input Validation', () => {
    it('should handle special characters in server ID', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['test@#$%^&*()'],
        expectError: true,
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
      });

      runner.assertFailure(result);
      // Should handle gracefully
      expect(result.exitCode !== 0).toBe(true);
    });

    it('should handle empty string server ID', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: [''],
        expectError: true,
      });

      runner.assertFailure(result);
      // Should handle gracefully
      expect(result.exitCode !== 0).toBe(true);
    });
  });
});
