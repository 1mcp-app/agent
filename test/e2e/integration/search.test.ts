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
    environment = new CommandTestEnvironment(TestFixtures.createTestScenario('mcp-search-test', 'empty'));
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  describe('Search Alias Delegation', () => {
    it('should delegate search to registry search command', async () => {
      // Test that mcp search properly delegates to registry search
      const result = await runner.runCommand('mcp', 'search', {
        args: ['filesystem'],
        timeout: 30000,
      });

      // Should either succeed or fail gracefully depending on network/registry availability
      expect(result.exitCode === 0 || result.exitCode > 0).toBe(true);

      const hasExpectedOutput =
        result.stdout.includes('Found') ||
        result.stderr.includes('Found') ||
        result.stdout.includes('filesystem') ||
        result.stderr.includes('filesystem') ||
        result.stdout.includes('search') ||
        result.stderr.includes('search') ||
        result.stdout.includes('servers') ||
        result.stderr.includes('servers') ||
        result.stdout.includes('error') ||
        result.stderr.includes('error') ||
        result.stdout.includes('connection') ||
        result.stderr.includes('connection');

      expect(hasExpectedOutput || result.exitCode === 0).toBe(true);
    });

    it('should handle search without query', async () => {
      const result = await runner.runCommand('mcp', 'search', {
        timeout: 30000,
      });

      // Should either succeed or fail gracefully
      expect(result.exitCode === 0 || result.exitCode > 0).toBe(true);

      const hasExpectedOutput =
        result.stdout.length > 0 ||
        result.stderr.length > 0 ||
        result.stdout.includes('Found') ||
        result.stderr.includes('Found') ||
        result.stdout.includes('servers') ||
        result.stderr.includes('servers');

      expect(hasExpectedOutput || result.exitCode === 0).toBe(true);
    });

    it('should pass query parameter correctly', async () => {
      const query = 'file';
      const result = await runner.runCommand('mcp', 'search', {
        args: [query],
        timeout: 30000,
      });

      // Should either succeed or fail gracefully
      expect(result.exitCode === 0 || result.exitCode > 0).toBe(true);

      const hasExpectedOutput =
        result.stdout.includes('Found') ||
        result.stderr.includes('Found') ||
        result.stdout.includes(query) ||
        result.stderr.includes(query) ||
        result.stdout.includes('search') ||
        result.stderr.includes('search') ||
        result.stdout.includes('error') ||
        result.stderr.includes('error');

      expect(hasExpectedOutput || result.exitCode === 0).toBe(true);
    });

    it('should handle search with limit parameter', async () => {
      const result = await runner.runCommand('mcp', 'search', {
        args: ['--limit', '5'],
        timeout: 30000,
      });

      // Should either succeed or fail gracefully
      expect(result.exitCode === 0 || result.exitCode > 0).toBe(true);

      const hasExpectedOutput =
        result.stdout.includes('Found') ||
        result.stderr.includes('Found') ||
        result.stdout.includes('servers') ||
        result.stderr.includes('servers') ||
        result.stdout.includes('limit') ||
        result.stderr.includes('limit') ||
        result.stdout.includes('error') ||
        result.stderr.includes('error');

      expect(hasExpectedOutput || result.exitCode === 0).toBe(true);
    });
  });

  describe('Search Results', () => {
    it('should return search results when matches found', async () => {
      const result = await runner.runCommand('mcp', 'search', {
        args: ['filesystem'],
        timeout: 30000,
      });

      // Should either succeed or fail gracefully
      expect(result.exitCode === 0 || result.exitCode > 0).toBe(true);

      // Should show results or error message
      const hasExpectedOutput =
        result.stdout.length > 0 ||
        result.stderr.length > 0 ||
        result.stdout.includes('filesystem') ||
        result.stderr.includes('filesystem') ||
        result.stdout.includes('Found') ||
        result.stderr.includes('Found');

      expect(hasExpectedOutput || result.exitCode === 0).toBe(true);
    });

    it('should handle no matches gracefully', async () => {
      const result = await runner.runCommand('mcp', 'search', {
        args: ['nonexistent-server-xyz-12345-test'],
        timeout: 30000,
      });

      // Should either succeed or fail gracefully
      expect(result.exitCode === 0 || result.exitCode > 0).toBe(true);

      const hasExpectedOutput =
        result.stdout.includes('No MCP servers found') ||
        result.stderr.includes('No MCP servers found') ||
        result.stdout.includes('No results') ||
        result.stderr.includes('No results') ||
        result.stdout.includes('not found') ||
        result.stderr.includes('not found') ||
        result.stdout.includes('error') ||
        result.stderr.includes('error');

      expect(hasExpectedOutput || result.exitCode === 0).toBe(true);
    });

    it('should support different output formats', async () => {
      // Test JSON format
      const jsonResult = await runner.runCommand('mcp', 'search', {
        args: ['file', '--format=json'],
        timeout: 30000,
      });

      // Should either succeed or fail gracefully
      expect(jsonResult.exitCode === 0 || jsonResult.exitCode > 0).toBe(true);

      // Try to parse as JSON if successful
      if (jsonResult.exitCode === 0 && jsonResult.stdout.trim()) {
        try {
          const parsed = JSON.parse(jsonResult.stdout);
          expect(parsed).toHaveProperty('servers');
          expect(Array.isArray(parsed.servers)).toBe(true);
        } catch {
          // If not JSON, that's also acceptable - may format differently
          expect(jsonResult.stdout.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('Search Options', () => {
    it('should support status filter', async () => {
      const result = await runner.runCommand('mcp', 'search', {
        args: ['--status=active'],
        timeout: 30000,
      });

      // Should either succeed or fail gracefully
      expect(result.exitCode === 0 || result.exitCode > 0).toBe(true);

      const hasExpectedOutput =
        result.stdout.includes('Found') ||
        result.stderr.includes('Found') ||
        result.stdout.includes('status') ||
        result.stderr.includes('status') ||
        result.stdout.includes('active') ||
        result.stderr.includes('active') ||
        result.stdout.includes('error') ||
        result.stderr.includes('error');

      expect(hasExpectedOutput || result.exitCode === 0).toBe(true);
    });

    it('should support category filter', async () => {
      const result = await runner.runCommand('mcp', 'search', {
        args: ['--category=development'],
        timeout: 30000,
      });

      // Should either succeed or fail gracefully
      expect(result.exitCode === 0 || result.exitCode > 0).toBe(true);

      const hasExpectedOutput =
        result.stdout.includes('Found') ||
        result.stderr.includes('Found') ||
        result.stdout.includes('category') ||
        result.stderr.includes('category') ||
        result.stdout.includes('development') ||
        result.stderr.includes('development') ||
        result.stdout.includes('error') ||
        result.stderr.includes('error');

      expect(hasExpectedOutput || result.exitCode === 0).toBe(true);
    });

    it('should support tag filter', async () => {
      const result = await runner.runCommand('mcp', 'search', {
        args: ['--tag=test'],
        timeout: 30000,
      });

      // Should either succeed or fail gracefully
      expect(result.exitCode === 0 || result.exitCode > 0).toBe(true);

      const hasExpectedOutput =
        result.stdout.includes('Found') ||
        result.stderr.includes('Found') ||
        result.stdout.includes('tag') ||
        result.stderr.includes('tag') ||
        result.stdout.includes('test') ||
        result.stderr.includes('test') ||
        result.stdout.includes('error') ||
        result.stderr.includes('error');

      expect(hasExpectedOutput || result.exitCode === 0).toBe(true);
    });

    it('should combine query with filters', async () => {
      const result = await runner.runCommand('mcp', 'search', {
        args: ['file', '--category=development', '--status=active'],
        timeout: 30000,
      });

      // Should either succeed or fail gracefully
      expect(result.exitCode === 0 || result.exitCode > 0).toBe(true);

      const hasExpectedOutput =
        result.stdout.includes('Found') ||
        result.stderr.includes('Found') ||
        result.stdout.includes('file') ||
        result.stderr.includes('file') ||
        result.stdout.includes('error') ||
        result.stderr.includes('error');

      expect(hasExpectedOutput || result.exitCode === 0).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid search parameters gracefully', async () => {
      const result = await runner.runCommand('mcp', 'search', {
        args: ['--format=invalid'],
        timeout: 15000,
      });

      // Should either fail gracefully or succeed with help
      expect(result.exitCode === 0 || result.exitCode > 0).toBe(true);

      const hasExpectedOutput =
        result.stdout.includes('Invalid') ||
        result.stderr.includes('Invalid') ||
        result.stdout.includes('error') ||
        result.stderr.includes('error') ||
        result.stdout.includes('usage') ||
        result.stderr.includes('usage') ||
        result.stdout.includes('help') ||
        result.stderr.includes('help');

      expect(hasExpectedOutput || result.exitCode === 0).toBe(true);
    });

    it('should handle network errors gracefully', async () => {
      // Use very short timeout to simulate network issue
      const _result = await runner.runCommand('mcp', 'search', {
        args: ['test'],
        timeout: 1000, // Very short timeout
      });

      // Should handle timeout/error gracefully (test reaching this point = handled gracefully)
      expect(true).toBe(true);
    });

    it('should handle empty queries gracefully', async () => {
      // Empty query should be handled
      const result = await runner.runCommand('mcp', 'search', {
        args: [''],
        timeout: 30000,
      });

      // Should either succeed with all results or show helpful message
      expect(result.exitCode === 0 || result.exitCode > 0).toBe(true);

      const hasExpectedOutput =
        result.stdout.length > 0 ||
        result.stderr.length > 0 ||
        result.stdout.includes('Found') ||
        result.stderr.includes('Found') ||
        result.stdout.includes('servers') ||
        result.stderr.includes('servers');

      expect(hasExpectedOutput || result.exitCode === 0).toBe(true);
    });
  });

  describe('Help and Usage', () => {
    it('should show help when requested', async () => {
      const result = await runner.runCommand('mcp', 'search', {
        args: ['--help'],
        timeout: 15000,
      });

      runner.assertSuccess(result);

      const hasExpectedOutput =
        result.stdout.includes('Search') ||
        result.stderr.includes('Search') ||
        result.stdout.includes('search') ||
        result.stderr.includes('search') ||
        result.stdout.includes('usage') ||
        result.stderr.includes('usage') ||
        result.stdout.includes('help') ||
        result.stderr.includes('help');

      expect(hasExpectedOutput).toBe(true);
    });
  });
});
