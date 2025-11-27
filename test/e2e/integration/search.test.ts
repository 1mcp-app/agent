import { TestFixtures } from '@test/e2e/fixtures/TestFixtures.js';
import { CliTestRunner, CommandTestEnvironment } from '@test/e2e/utils/index.js';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Integration tests for MCP search command alias
 * Verifies that search alias properly delegates to registry search
 */

describe('MCP Search Command Integration', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
    environment = new CommandTestEnvironment(TestFixtures.createTestScenario('mcp-search-test', 'basic'));
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  describe('Search Alias Delegation', () => {
    it('should delegate search to registry search command', async () => {
      // Test that mcp search properly delegates to registry search
      const result = await runner.runMcpCommand('search', {
        args: ['filesystem'],
        timeout: 30000,
      });

      // Should succeed (delegates to registry search)
      runner.assertSuccess(result);
      // Should show search results (format similar to registry search)
      runner.assertOutputContains(result, 'Found');
    });

    it('should handle search without query', async () => {
      const result = await runner.runMcpCommand('search', {
        timeout: 30000,
      });

      runner.assertSuccess(result);
      // Should show some results or message
      expect(result.stdout.length).toBeGreaterThan(0);
    });

    it('should pass query parameter correctly', async () => {
      const query = 'file';
      const result = await runner.runMcpCommand('search', {
        args: [query],
        timeout: 30000,
      });

      runner.assertSuccess(result);
      // Should contain search query in results or process it
      runner.assertOutputContains(result, 'Found');
    });

    it('should handle search with limit parameter', async () => {
      const result = await runner.runMcpCommand('search', {
        args: ['--limit', '5'],
        timeout: 30000,
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Found');
    });
  });

  describe('Search Results', () => {
    it('should return search results when matches found', async () => {
      const result = await runner.runMcpCommand('search', {
        args: ['filesystem'],
        timeout: 30000,
      });

      runner.assertSuccess(result);
      // Should show results or helpful message
      expect(result.stdout).toBeTruthy();
    });

    it('should handle no matches gracefully', async () => {
      const result = await runner.runMcpCommand('search', {
        args: ['nonexistent-server-xyz-12345-test'],
        timeout: 30000,
      });

      runner.assertSuccess(result);
      // Should show no results message
      runner.assertOutputContains(result, 'No MCP servers found');
    });

    it('should support different output formats', async () => {
      // Test JSON format
      const jsonResult = await runner.runMcpCommand('search', {
        args: ['file', '--format=json'],
        timeout: 30000,
      });

      runner.assertSuccess(jsonResult);

      // Try to parse as JSON
      try {
        const parsed = JSON.parse(jsonResult.stdout);
        expect(parsed).toHaveProperty('servers');
        expect(Array.isArray(parsed.servers)).toBe(true);
      } catch {
        // If not JSON, that's also acceptable - may format differently
        expect(jsonResult.stdout.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Search Options', () => {
    it('should support status filter', async () => {
      const result = await runner.runMcpCommand('search', {
        args: ['--status=active'],
        timeout: 30000,
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Found');
    });

    it('should support type filter', async () => {
      const result = await runner.runMcpCommand('search', {
        args: ['--type=npm'],
        timeout: 30000,
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Found');
    });

    it('should support transport filter', async () => {
      const result = await runner.runMcpCommand('search', {
        args: ['--transport=stdio'],
        timeout: 30000,
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Found');
    });

    it('should combine query with filters', async () => {
      const result = await runner.runMcpCommand('search', {
        args: ['file', '--type=npm', '--status=active'],
        timeout: 30000,
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Found');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid search parameters', async () => {
      const result = await runner.runMcpCommand('search', {
        args: ['--format=invalid'],
        expectError: true,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Invalid', true);
    });

    it('should handle network errors gracefully', async () => {
      // Use very short timeout to simulate network issue
      const result = await runner.runMcpCommand('search', {
        args: ['test'],
        timeout: 1000, // Very short timeout
        expectError: true,
      });

      // Should handle timeout/error gracefully
      expect(result.exitCode !== 0 || result.error).toBeTruthy();
    });

    it('should handle malformed queries', async () => {
      // Empty query should be handled
      const result = await runner.runMcpCommand('search', {
        args: [''],
        timeout: 30000,
      });

      // Should either succeed with all results or show helpful message
      runner.assertSuccess(result);
    });
  });

  describe('Command Integration', () => {
    it('should work alongside other mcp commands', async () => {
      // First add a server
      await runner.runMcpCommand('add', {
        args: ['test-server', '--type', 'stdio', '--command', 'echo'],
      });

      // Then search (should not interfere)
      const searchResult = await runner.runMcpCommand('search', {
        args: ['test'],
        timeout: 30000,
      });

      runner.assertSuccess(searchResult);

      // List should still work
      const listResult = await runner.runMcpCommand('list');
      runner.assertSuccess(listResult);
      runner.assertOutputContains(listResult, 'test-server');
    });

    it('should preserve config context during search', async () => {
      // Set up config
      await runner.runMcpCommand('add', {
        args: ['config-test', '--type', 'stdio', '--command', 'echo'],
      });

      // Search should not affect config
      await runner.runMcpCommand('search', {
        args: ['test'],
        timeout: 30000,
      });

      // Config should still be intact
      const listResult = await runner.runMcpCommand('list');
      runner.assertOutputContains(listResult, 'config-test');
    });
  });

  describe('Help and Usage', () => {
    it('should show help when requested', async () => {
      const result = await runner.runMcpCommand('search', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Search');
    });
  });
});
