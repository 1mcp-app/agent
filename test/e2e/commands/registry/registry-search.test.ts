import { TestFixtures } from '@test/e2e/fixtures/TestFixtures.js';
import { CliTestRunner, CommandTestEnvironment } from '@test/e2e/utils/index.js';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('Registry Search Command E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
    environment = new CommandTestEnvironment(TestFixtures.createTestScenario('registry-search-test', 'basic'));
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  describe('Basic Search Functionality', () => {
    it('should search without query and return active servers', async () => {
      const result = await runner.runRegistryCommand('search', {
        timeout: 20000, // 20 second timeout for network calls
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Found');
      runner.assertOutputContains(result, 'MCP server');
      // Should show next steps information
      runner.assertOutputContains(result, 'Installation');
    });

    it('should search with specific query', async () => {
      const result = await runner.runRegistryCommand('search', {
        args: ['filesystem'],
        timeout: 20000,
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Found');
      runner.assertOutputContains(result, 'filesystem');
    });

    it('should handle no results gracefully', async () => {
      const result = await runner.runRegistryCommand('search', {
        args: ['nonexistent-server-xyz-12345'],
        timeout: 20000,
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'No MCP servers found');
      runner.assertOutputContains(result, 'Try a different search query');
    });
  });

  describe('Output Formats', () => {
    it('should support table format (default)', async () => {
      const result = await runner.runRegistryCommand('search', {
        args: ['file'],
        timeout: 20000,
      });

      runner.assertSuccess(result);
      // Table format should show table structure
      runner.assertOutputContains(result, 'Name');
      runner.assertOutputContains(result, 'Description');
      runner.assertOutputContains(result, 'Status');
    });

    it('should support list format', async () => {
      const result = await runner.runRegistryCommand('search', {
        args: ['file', '--format=list'],
      });

      runner.assertSuccess(result);
      // List format should show colored output
      runner.assertOutputContains(result, 'Found');
      // Should show individual entries with numbering
      runner.assertOutputMatches(result, /\n \d+\./);
    });

    it('should support JSON format', async () => {
      const result = await runner.runRegistryCommand('search', {
        args: ['file', '--format=json'],
        timeout: 20000,
      });

      runner.assertSuccess(result);

      const jsonResult = runner.parseJsonOutput(result);
      expect(jsonResult).toHaveProperty('servers');
      expect(jsonResult).toHaveProperty('count');
      expect(Array.isArray(jsonResult.servers)).toBe(true);
      // next_cursor may be present (string, null, or undefined) depending on pagination
      if ('next_cursor' in jsonResult) {
        expect(
          jsonResult.next_cursor === null ||
            jsonResult.next_cursor === undefined ||
            typeof jsonResult.next_cursor === 'string',
        ).toBe(true);
      }
    });
  });

  describe('Search Filters', () => {
    it('should filter by status', async () => {
      const result = await runner.runRegistryCommand('search', {
        args: ['--status=active'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Found');
    });

    it('should filter by registry type', async () => {
      const result = await runner.runRegistryCommand('search', {
        args: ['--type=npm'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Found');
    });

    it('should filter by transport', async () => {
      const result = await runner.runRegistryCommand('search', {
        args: ['--transport=stdio'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Found');
    });

    it('should combine multiple filters', async () => {
      const result = await runner.runRegistryCommand('search', {
        args: ['--type=npm', '--transport=stdio', '--status=active'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Found');
    });
  });

  describe('Pagination', () => {
    it('should limit results with limit parameter', async () => {
      const result = await runner.runRegistryCommand('search', {
        args: ['--limit=5'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Found');

      // Should show limited results count
      if (result.stdout.includes('Found')) {
        // Should show the actual number found (e.g., "Found 5 MCP servers:")
        runner.assertOutputMatches(result, /Found \d+ MCP servers/);
      }
    });

    it('should handle limit parameter properly', async () => {
      const result = await runner.runRegistryCommand('search', {
        args: ['--limit=1'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Found 1 MCP server');
    });

    it('should respect maximum limit of 100', async () => {
      const result = await runner.runRegistryCommand('search', {
        args: ['--limit=200'], // Should be capped at 100
      });

      runner.assertSuccess(result);
      // Command should succeed but with reasonable limit
      runner.assertOutputContains(result, 'Found');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid format option gracefully', async () => {
      const result = await runner.runRegistryCommand('search', {
        args: ['--format=invalid'],
        expectError: true,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Invalid values', true);
    });

    it('should handle invalid status filter', async () => {
      const result = await runner.runRegistryCommand('search', {
        args: ['--status=invalid'],
        expectError: true,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Invalid values', true);
    });

    it('should handle invalid type filter', async () => {
      const result = await runner.runRegistryCommand('search', {
        args: ['--type=invalid'],
        expectError: true,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Invalid values', true);
    });

    it('should handle network timeout gracefully', async () => {
      const result = await runner.runRegistryCommand('search', {
        args: ['test'],
        timeout: 5000, // Short timeout to test error handling
      });

      // May succeed if fast enough, or fail gracefully with timeout
      expect(result.exitCode === 0 || result.exitCode === -1).toBe(true);

      if (result.exitCode !== 0) {
        runner.assertOutputContains(result, 'Error searching MCP registry');
      }
    });
  });

  describe('Help Command', () => {
    it('should show help for search command', async () => {
      const result = await runner.runRegistryCommand('search', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Search for MCP servers');
      runner.assertOutputContains(result, 'Options:');
      runner.assertOutputContains(result, 'query');
      runner.assertOutputContains(result, '--format');
    });
  });

  describe('Performance and Scalability', () => {
    it('should complete search within reasonable time', async () => {
      const startTime = Date.now();

      const result = await runner.runRegistryCommand('search', {
        args: ['file'],
        timeout: 30000, // 30 second timeout
      });

      const duration = Date.now() - startTime;
      runner.assertSuccess(result);

      // Should complete within 15 seconds under normal conditions
      expect(duration).toBeLessThan(15000);
    });

    it('should handle large result sets efficiently', async () => {
      const result = await runner.runRegistryCommand('search', {
        args: ['--limit=50'],
        timeout: 30000,
      });

      runner.assertSuccess(result);
      // Should handle large result sets without memory issues
      expect(result.stdout.length).toBeGreaterThan(100);
    });
  });
});
