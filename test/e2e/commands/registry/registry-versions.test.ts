import { TestFixtures } from '@test/e2e/fixtures/TestFixtures.js';
import { CliTestRunner, CommandTestEnvironment } from '@test/e2e/utils/index.js';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Type definitions for JSON responses
interface RegistryVersion {
  version: string;
  release_date: string;
  download_count: number;
  is_latest: boolean;
}

interface RegistryVersionsResponse {
  serverId: string;
  versions: RegistryVersion[];
}

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
    it('should list versions for valid server ID', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system'],
      });

      runner.assertSuccess(result);
      // Should show version information
      runner.assertOutputContains(result, 'Version');
      runner.assertOutputContains(result, 'Released');
      runner.assertOutputContains(result, 'Download Count');
    });

    it('should show versions in table format (default)', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system'],
      });

      runner.assertSuccess(result);
      // Table format should be default
      runner.assertOutputContains(result, '┌'); // Table border
      runner.assertOutputContains(result, '│'); // Table border
      runner.assertOutputContains(result, '└'); // Table border
    });

    it('should show versions in detailed format', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=detailed'],
      });

      runner.assertSuccess(result);
      // Detailed format should show more information
      runner.assertOutputContains(result, 'Version Details');
      runner.assertOutputContains(result, 'Release Information');
      runner.assertOutputContains(result, 'Download Statistics');
    });

    it('should show versions in JSON format', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=json'],
      });

      runner.assertSuccess(result);

      const jsonResult = runner.parseJsonOutput(result) as RegistryVersionsResponse;
      expect(jsonResult).toHaveProperty('serverId');
      expect(jsonResult).toHaveProperty('versions');
      expect(Array.isArray(jsonResult.versions)).toBe(true);
    });
  });

  describe('Version Information Content', () => {
    it('should show comprehensive version metadata', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=json'],
      });

      runner.assertSuccess(result);

      const jsonResult = runner.parseJsonOutput(result) as RegistryVersionsResponse;
      expect(jsonResult).toHaveProperty('serverId');
      expect(jsonResult).toHaveProperty('versions');

      if (jsonResult.versions.length > 0) {
        const version = jsonResult.versions[0];
        expect(version).toHaveProperty('version');
        expect(version).toHaveProperty('release_date');
        expect(version).toHaveProperty('download_count');
        expect(version).toHaveProperty('is_latest');
        expect(typeof version.version).toBe('string');
        expect(typeof version.download_count).toBe('number');
        expect(typeof version.is_latest).toBe('boolean');
      }
    });

    it('should show semantic version numbers', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system'],
      });

      runner.assertSuccess(result);

      // Should contain valid semantic version patterns
      runner.assertOutputMatches(result, /\d+\.\d+\.\d+/);
    });

    it('should show release dates', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system'],
      });

      runner.assertSuccess(result);

      // Should show date information
      runner.assertOutputContains(result, 'Released');
      runner.assertOutputMatches(result, /\d{4}-\d{2}-\d{2}/); // Date format
    });

    it('should show download statistics', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system'],
      });

      runner.assertSuccess(result);

      // Should show download information
      runner.assertOutputContains(result, 'Download');
      runner.assertOutputMatches(result, /\d+/); // At least some numbers
    });
  });

  describe('Output Format Validation', () => {
    it('should format table output correctly', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=table'],
      });

      runner.assertSuccess(result);

      // Should have proper table structure
      expect(result.stdout).toContain('┌');
      expect(result.stdout).toContain('┐');
      expect(result.stdout).toContain('│');
      expect(result.stdout).toContain('└');
      expect(result.stdout).toContain('┘');

      // Should have column headers
      runner.assertOutputContains(result, 'Version');
      runner.assertOutputContains(result, 'Released');
      runner.assertOutputContains(result, 'Downloads');
    });

    it('should format detailed output correctly', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=detailed'],
      });

      runner.assertSuccess(result);

      // Should have section separators
      runner.assertOutputMatches(result, /═+/); // Section separator
      runner.assertOutputContains(result, 'Version Details');

      // Should include key information sections
      expect(result.stdout).toContain('Release Information');
      expect(result.stdout).toContain('Download Statistics');
    });

    it('should format JSON output with proper structure', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=json'],
      });

      runner.assertSuccess(result);

      const jsonResult = runner.parseJsonOutput(result) as RegistryVersionsResponse;

      // Should be valid JSON with expected structure
      expect(typeof jsonResult).toBe('object');
      expect(jsonResult).not.toBeNull();

      // Required top-level fields
      expect(jsonResult).toHaveProperty('serverId');
      expect(jsonResult).toHaveProperty('versions');

      // Versions array should have expected fields
      if (jsonResult.versions.length > 0) {
        const version = jsonResult.versions[0];
        expect(version).toHaveProperty('version');
        expect(version).toHaveProperty('release_date');
        expect(version).toHaveProperty('download_count');
        expect(version).toHaveProperty('is_latest');
      }
    });

    it('should maintain consistent output across formats', async () => {
      const resultTable = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=table'],
      });
      const resultJson = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=json'],
      });

      runner.assertSuccess(resultTable);
      runner.assertSuccess(resultJson);

      const jsonResult = runner.parseJsonOutput(resultJson) as RegistryVersionsResponse;

      // Both should contain version information
      expect(resultTable.stdout).toMatch(/\d+\.\d+\.\d+/);
      expect(jsonResult.versions.length).toBeGreaterThan(0);

      // Version numbers should be consistent
      const tableVersionMatch = resultTable.stdout.match(/\d+\.\d+\.\d+/);
      if (tableVersionMatch && jsonResult.versions.length > 0) {
        expect(jsonResult.versions[0].version).toBe(tableVersionMatch[0]);
      }
    });
  });

  describe('Version Sorting and Ordering', () => {
    it('should show versions in descending order', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=json'],
      });

      runner.assertSuccess(result);

      const jsonResult = runner.parseJsonOutput(result) as RegistryVersionsResponse;
      expect(jsonResult.versions.length).toBeGreaterThan(1);

      // Versions should be sorted in descending order (newest first)
      for (let i = 0; i < jsonResult.versions.length - 1; i++) {
        const current = jsonResult.versions[i];
        const next = jsonResult.versions[i + 1];

        // Compare versions semantically (simplified check)
        const currentParts = current.version.split('.').map(Number);
        const nextParts = next.version.split('.').map(Number);

        for (let j = 0; j < 3; j++) {
          if (currentParts[j] !== nextParts[j]) {
            expect(currentParts[j]).toBeGreaterThanOrEqual(nextParts[j]);
            break;
          }
        }
      }
    });

    it('should identify latest version correctly', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=json'],
      });

      runner.assertSuccess(result);

      const jsonResult = runner.parseJsonOutput(result) as RegistryVersionsResponse;
      expect(jsonResult.versions.length).toBeGreaterThan(0);

      // Only first version should be marked as latest
      const latestVersions = jsonResult.versions.filter((v: RegistryVersion) => v.is_latest);
      expect(latestVersions.length).toBe(1);
      expect(jsonResult.versions[0].is_latest).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent server ID', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['non-existent-server-xyz-12345'],
        expectError: true,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Server not found');
      runner.assertOutputContains(result, 'Make sure server ID is correct');
      runner.assertOutputContains(result, 'Use "registry search"');
    });

    it('should handle empty server ID', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: [''],
        expectError: true,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'server-id');
      runner.assertOutputContains(result, 'required');
    });

    it('should handle missing server ID', async () => {
      const result = await runner.runRegistryCommand('versions', {
        expectError: true,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'server-id');
      runner.assertOutputContains(result, 'required');
    });

    it('should handle invalid output format', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=invalid'],
        expectError: true,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Invalid choices');
    });

    it('should handle network timeout', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system'],
        timeout: 5000, // Short timeout
      });

      // May succeed if fast enough, or fail gracefully
      expect(result.exitCode === 0 || result.exitCode === -1).toBe(true);

      if (result.exitCode !== 0) {
        runner.assertOutputContains(result, 'Error fetching MCP server versions');
      }
    });

    it('should handle special characters in server ID', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['test@#$%^&*()'],
        expectError: true,
      });

      runner.assertFailure(result);
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
    it('should complete versions request within reasonable time', async () => {
      const startTime = Date.now();

      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system'],
        timeout: 30000, // 30 second timeout
      });

      const duration = Date.now() - startTime;
      runner.assertSuccess(result);

      // Should complete within 20 seconds under normal conditions
      expect(duration).toBeLessThan(20000);
    });

    it('should handle repeated versions requests consistently', async () => {
      const results = [];

      // Run multiple versions requests
      for (let i = 0; i < 3; i++) {
        const result = await runner.runRegistryCommand('versions', {
          args: ['file-system'],
        });
        results.push(result);
        runner.assertSuccess(result);
      }

      // All should succeed and have consistent information
      results.forEach((result) => {
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('Version');
        expect(result.stdout).toContain('Released');
      });
    });

    it('should cache results appropriately', async () => {
      const result1 = await runner.runRegistryCommand('versions', {
        args: ['file-system'],
      });
      const startTime = Date.now();

      const result2 = await runner.runRegistryCommand('versions', {
        args: ['file-system'],
      });
      const duration = Date.now() - startTime;

      runner.assertSuccess(result1);
      runner.assertSuccess(result2);

      // Second request might be faster due to caching
      expect(duration).toBeLessThan(5000);

      // Both should contain version information
      expect(result1.stdout).toContain('Version');
      expect(result2.stdout).toContain('Version');
    });

    it('should handle servers with many versions efficiently', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system'],
        timeout: 30000,
      });

      runner.assertSuccess(result);

      // Should handle multiple versions without issues
      const versionMatches = result.stdout.match(/\d+\.\d+\.\d+/g);
      if (versionMatches) {
        expect(versionMatches.length).toBeGreaterThan(1);
      }

      // Output should be reasonable size
      expect(result.stdout.length).toBeGreaterThan(100);
    });
  });

  describe('Data Quality and Validation', () => {
    it('should show valid semantic versions', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=json'],
      });

      runner.assertSuccess(result);

      const jsonResult = runner.parseJsonOutput(result) as RegistryVersionsResponse;

      if (jsonResult.versions.length > 0) {
        jsonResult.versions.forEach((version: RegistryVersion) => {
          // Should be valid semantic version
          expect(version.version).toMatch(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+)?$/);
          expect(typeof version.version).toBe('string');
          expect(version.version.length).toBeGreaterThan(0);
        });
      }
    });

    it('should show valid release dates', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=json'],
      });

      runner.assertSuccess(result);

      const jsonResult = runner.parseJsonOutput(result) as RegistryVersionsResponse;

      if (jsonResult.versions.length > 0) {
        jsonResult.versions.forEach((version: RegistryVersion) => {
          // Release date should be valid ISO date or reasonable format
          expect(typeof version.release_date).toBe('string');
          expect(version.release_date.length).toBeGreaterThan(0);

          // Should be parseable as date
          const date = new Date(version.release_date);
          expect(date.getTime()).not.toBeNaN();
        });
      }
    });

    it('should show valid download counts', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=json'],
      });

      runner.assertSuccess(result);

      const jsonResult = runner.parseJsonOutput(result) as RegistryVersionsResponse;

      if (jsonResult.versions.length > 0) {
        jsonResult.versions.forEach((version: RegistryVersion) => {
          // Download count should be valid number
          expect(typeof version.download_count).toBe('number');
          expect(version.download_count).toBeGreaterThanOrEqual(0);
        });
      }
    });

    it('should have consistent latest version flags', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['file-system', '--format=json'],
      });

      runner.assertSuccess(result);

      const jsonResult = runner.parseJsonOutput(result) as RegistryVersionsResponse;

      if (jsonResult.versions.length > 0) {
        const latestVersions = jsonResult.versions.filter((v: RegistryVersion) => v.is_latest);

        // Should have exactly one latest version
        expect(latestVersions.length).toBe(1);

        // Should have valid boolean flags
        jsonResult.versions.forEach((version: RegistryVersion) => {
          expect(typeof version.is_latest).toBe('boolean');
        });

        // First version should be latest
        expect(jsonResult.versions[0].is_latest).toBe(true);

        // Other versions should not be latest
        if (jsonResult.versions.length > 1) {
          for (let i = 1; i < jsonResult.versions.length; i++) {
            expect(jsonResult.versions[i].is_latest).toBe(false);
          }
        }
      }
    });
  });
});
