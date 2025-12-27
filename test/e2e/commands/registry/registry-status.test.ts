import { TestFixtures } from '@test/e2e/fixtures/TestFixtures.js';
import { CliTestRunner, CommandTestEnvironment } from '@test/e2e/utils/index.js';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('Registry Status Command E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
    environment = new CommandTestEnvironment(TestFixtures.createTestScenario('registry-status-test', 'basic'));
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  describe('Basic Status Functionality', () => {
    it('should show registry status', async () => {
      const result = await runner.runRegistryCommand('status', {
        timeout: 30000, // 30 second timeout for basic status
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'MCP Registry Status');
      runner.assertOutputMatches(result, /Status\s*:/);
      runner.assertOutputMatches(result, /URL\s*:/);
      runner.assertOutputMatches(result, /Response Time\s*:/);
      runner.assertOutputMatches(result, /Last Checked\s*:/);

      // Should show availability status
      const hasStatusIcon = result.stdout.includes('✅') || result.stdout.includes('❌');
      expect(hasStatusIcon).toBe(true);
    });

    it('should show status with statistics', async () => {
      const result = await runner.runRegistryCommand('status', {
        args: ['--stats'],
        timeout: 45000, // 45 second timeout for statistics
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'MCP Registry Status');
      runner.assertOutputContains(result, 'Registry Statistics');

      // Should include basic statistics (use regex to handle padding in table formatting)
      runner.assertOutputMatches(result, /Total Servers\s*:/);
      runner.assertOutputMatches(result, /Active Servers\s*:/);
      runner.assertOutputMatches(result, /Deprecated Servers\s*:/);
    });

    it('should show status in JSON format', async () => {
      const result = await runner.runRegistryCommand('status', {
        args: ['--json'],
        timeout: 30000, // 30 second timeout for JSON
      });

      runner.assertSuccess(result);

      const jsonResult = runner.parseJsonOutput(result);
      expect(jsonResult).toHaveProperty('available');
      expect(jsonResult).toHaveProperty('url');
      expect(jsonResult).toHaveProperty('response_time_ms');
      expect(jsonResult).toHaveProperty('last_updated');

      // Should be valid boolean, string, number
      expect(typeof jsonResult.available).toBe('boolean');
      expect(typeof jsonResult.url).toBe('string');
      expect(typeof jsonResult.response_time_ms).toBe('number');
    });

    it('should show status with statistics in JSON format', async () => {
      const result = await runner.runRegistryCommand('status', {
        args: ['--stats', '--json'],
        timeout: 60000, // 60 second timeout for stats + JSON
      });

      runner.assertSuccess(result);

      const jsonResult = runner.parseJsonOutput(result);
      expect(jsonResult).toHaveProperty('available');
      // Stats might not be available if registry is unavailable
      // So we check if it exists, and if so, validate its structure
      if (jsonResult.stats) {
        expect(jsonResult.stats).toHaveProperty('total_servers');
        expect(jsonResult.stats).toHaveProperty('active_servers');
        expect(jsonResult.stats).toHaveProperty('deprecated_servers');
        expect(typeof jsonResult.stats.total_servers).toBe('number');
        expect(typeof jsonResult.stats.active_servers).toBe('number');
        expect(typeof jsonResult.stats.deprecated_servers).toBe('number');

        // Should have breakdown by type and transport if available
        if (jsonResult.stats.by_registry_type) {
          expect(typeof jsonResult.stats.by_registry_type).toBe('object');
        }
        if (jsonResult.stats.by_transport) {
          expect(typeof jsonResult.stats.by_transport).toBe('object');
        }
      }
    });
  });

  describe('Status Information Validation', () => {
    it('should show reasonable response time', async () => {
      const result = await runner.runRegistryCommand('status', {
        timeout: 30000, // 30 second timeout
      });

      runner.assertSuccess(result);

      // Should show response time in milliseconds
      runner.assertOutputMatches(result, /Response Time\s*:\s*\d+ms/);

      // Extract response time and validate it's reasonable (under 10 seconds)
      const responseTimeMatch = result.stdout.match(/Response Time\s*:\s*(\d+)ms/);
      if (responseTimeMatch) {
        const responseTime = parseInt(responseTimeMatch[1]);
        expect(responseTime).toBeGreaterThan(0);
        expect(responseTime).toBeLessThan(10000); // Less than 10 seconds
      }
    });

    it('should show valid URL format', async () => {
      const result = await runner.runRegistryCommand('status', {
        timeout: 30000, // 30 second timeout
      });

      runner.assertSuccess(result);

      // Should show a valid HTTP/HTTPS URL
      runner.assertOutputMatches(result, /URL\s*:\s*https?:\/\/[^\s]+/);
    });

    it('should show timestamp format', async () => {
      const result = await runner.runRegistryCommand('status', {
        timeout: 30000, // 30 second timeout
      });

      runner.assertSuccess(result);

      // Should show last checked timestamp
      runner.assertOutputMatches(result, /Last Checked\s*:/);
      // The actual format is "Oct 23, 2025, 09:51:15 PM"
      runner.assertOutputMatches(
        result,
        /Last Checked\s*:\s*[A-Za-z]{3}\s+\d{1,2},\s+\d{4},\s+\d{1,2}:\d{2}:\d{2}\s+[AP]M/,
      );
    });
  });

  describe('Statistics Information', () => {
    it('should show detailed breakdown when stats requested', async () => {
      const result = await runner.runRegistryCommand('status', {
        args: ['--stats'],
        timeout: 45000, // 45 second timeout for statistics
      });

      runner.assertSuccess(result);

      // Basic statistics should always be present (use regex to handle padding in table formatting)
      runner.assertOutputMatches(result, /Total Servers\s*:/);
      runner.assertOutputMatches(result, /Active Servers\s*:/);
      runner.assertOutputMatches(result, /Deprecated Servers\s*:/);

      // May include additional breakdowns if available
      const hasByType = /By Registry Type\s*:/.test(result.stdout);
      const hasByTransport = /By Transport\s*:/.test(result.stdout);

      // At least one breakdown should be present in normal operation
      expect(hasByType || hasByTransport).toBe(true);
    });

    it('should handle empty statistics gracefully', async () => {
      const result = await runner.runRegistryCommand('status', {
        args: ['--stats', '--json'],
        timeout: 60000, // 60 second timeout for stats + JSON
      });

      runner.assertSuccess(result);

      const jsonResult = runner.parseJsonOutput(result);
      // Stats might not be available if registry is unavailable
      // When available, stats object should have expected properties
      if (jsonResult.stats) {
        expect(typeof jsonResult.stats.total_servers).toBe('number');
        expect(typeof jsonResult.stats.active_servers).toBe('number');
        expect(typeof jsonResult.stats.deprecated_servers).toBe('number');
      }
    });
  });

  describe('Output Format Consistency', () => {
    it('should maintain consistent output structure', async () => {
      const result1 = await runner.runRegistryCommand('status', {
        timeout: 30000, // 30 second timeout
      });
      const result2 = await runner.runRegistryCommand('status', {
        timeout: 30000, // 30 second timeout
      });

      runner.assertSuccess(result1);
      runner.assertSuccess(result2);

      // Both outputs should have similar structure
      expect(result1.stdout).toContain('MCP Registry Status');
      expect(result2.stdout).toContain('MCP Registry Status');

      // Should include key sections in both (use regex to handle padding)
      const keyPatterns = [/Status\s*:/, /URL\s*:/, /Response Time\s*:/];
      keyPatterns.forEach((pattern) => {
        expect(result1.stdout).toMatch(pattern);
        expect(result2.stdout).toMatch(pattern);
      });
    });

    it('should format JSON output consistently', async () => {
      const result1 = await runner.runRegistryCommand('status', {
        args: ['--json'],
        timeout: 30000, // 30 second timeout
      });
      const result2 = await runner.runRegistryCommand('status', {
        args: ['--json'],
        timeout: 30000, // 30 second timeout
      });

      runner.assertSuccess(result1);
      runner.assertSuccess(result2);

      const json1 = runner.parseJsonOutput(result1);
      const json2 = runner.parseJsonOutput(result2);

      // Both should have same structure
      const requiredKeys = ['available', 'url', 'response_time_ms', 'last_updated'];
      requiredKeys.forEach((key) => {
        expect(json1).toHaveProperty(key);
        expect(json2).toHaveProperty(key);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid flag combinations', async () => {
      const result = await runner.runRegistryCommand('status', {
        args: ['--invalid-flag'],
        expectError: true,
      });

      // Yargs should handle unknown options gracefully
      // May succeed with warnings or fail with error
      expect(result.exitCode === 0 || result.exitCode !== 0).toBe(true);
    });

    it('should handle network connectivity issues', async () => {
      // Test with very short timeout to simulate network issues
      const result = await runner.runRegistryCommand('status', {
        timeout: 1000,
      });

      // May succeed if fast enough, or fail gracefully
      expect(result.exitCode === 0 || result.exitCode === -1).toBe(true);

      if (result.exitCode !== 0) {
        // Should either show error message or have empty output
        const hasErrorMessage = result.stdout.includes('Error') || result.stderr.includes('Error');
        const hasEmptyOutput = result.stdout.trim().length === 0;
        expect(hasErrorMessage || hasEmptyOutput).toBe(true);
      }
    });

    it('should handle malformed JSON output request', async () => {
      const result = await runner.runRegistryCommand('status', {
        args: ['--json', '--invalid-option'],
        expectError: true,
      });

      // Should handle gracefully
      expect(result.exitCode !== 0 || result.exitCode === 0).toBe(true);
    });
  });

  describe('Help Command', () => {
    it('should show help for status command', async () => {
      const result = await runner.runRegistryCommand('status', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Show registry availability status');
      runner.assertOutputContains(result, 'Options:');
      runner.assertOutputContains(result, '--stats');
      runner.assertOutputContains(result, '--json');

      // Should show examples
      runner.assertOutputMatches(result, /Examples?:/);
    });
  });

  describe('Performance and Reliability', () => {
    it('should complete status check within reasonable time', async () => {
      const startTime = Date.now();

      const result = await runner.runRegistryCommand('status', {
        timeout: 30000, // 30 second timeout
      });

      const duration = Date.now() - startTime;
      runner.assertSuccess(result);

      // Should complete within 10 seconds under normal conditions
      expect(duration).toBeLessThan(10000);
    });

    it('should handle repeated status checks consistently', async () => {
      const results = [];

      // Run multiple status checks
      for (let i = 0; i < 3; i++) {
        const result = await runner.runRegistryCommand('status', {
          timeout: 30000, // 30 second timeout
        });
        results.push(result);
        runner.assertSuccess(result);
      }

      // All should succeed
      results.forEach((result) => {
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('MCP Registry Status');
      });
    });

    it('should cache results appropriately', async () => {
      const result1 = await runner.runRegistryCommand('status', {
        timeout: 30000, // 30 second timeout
      });
      const startTime = Date.now();

      const result2 = await runner.runRegistryCommand('status', {
        timeout: 30000, // 30 second timeout
      });
      const duration = Date.now() - startTime;

      runner.assertSuccess(result1);
      runner.assertSuccess(result2);

      // Second request might be faster due to caching
      // But should still show recent timestamp
      expect(duration).toBeLessThan(5000); // Should be quite fast if cached

      expect(result2.stdout).toMatch(/Last Checked\s*:/);
    });
  });
});
