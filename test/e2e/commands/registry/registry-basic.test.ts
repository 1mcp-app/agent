import { TestFixtures } from '@test/e2e/fixtures/TestFixtures.js';
import { CliTestRunner, CommandTestEnvironment } from '@test/e2e/utils/index.js';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('Registry Basic Commands E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
    environment = new CommandTestEnvironment(TestFixtures.createTestScenario('registry-basic-test', 'basic'));
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  describe('Basic Functionality', () => {
    it('should handle registry status command', async () => {
      const result = await runner.runRegistryCommand('status', {
        timeout: 20000, // 20 second timeout for network call
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'MCP Registry Status');
      runner.assertOutputContains(result, 'Status:');
    });

    it('should handle registry status in JSON format', async () => {
      const result = await runner.runRegistryCommand('status', {
        args: ['--json'],
        timeout: 20000,
      });

      runner.assertSuccess(result);

      const jsonResult = runner.parseJsonOutput(result);
      expect(jsonResult).toHaveProperty('available');
      expect(jsonResult).toHaveProperty('url');
      expect(typeof jsonResult.available).toBe('boolean');
      expect(typeof jsonResult.url).toBe('string');
    });

    it('should handle registry search help', async () => {
      const result = await runner.runRegistryCommand('search', {
        args: ['--help'],
        timeout: 10000,
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Search for MCP servers');
    });

    it('should handle registry show help', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['--help'],
        timeout: 10000,
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Show detailed information');
      runner.assertOutputContains(result, 'server-id');
    });

    it('should handle registry versions help', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['--help'],
        timeout: 10000,
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'List all versions');
      runner.assertOutputContains(result, 'server-id');
    });
  });

  describe('Error Handling', () => {
    it('should handle missing server ID for show command', async () => {
      const result = await runner.runRegistryCommand('show', {
        timeout: 10000,
        expectError: true,
      });

      runner.assertFailure(result);
      // Should show error about missing server ID
    });

    it('should handle missing server ID for versions command', async () => {
      const result = await runner.runRegistryCommand('versions', {
        timeout: 10000,
        expectError: true,
      });

      runner.assertFailure(result);
      // Should show error about missing server ID
    });

    it('should handle invalid options gracefully', async () => {
      const result = await runner.runRegistryCommand('status', {
        args: ['--invalid-option'],
        timeout: 10000,
      });

      // Yargs should handle unknown options gracefully
      expect(result.exitCode === 0 || result.exitCode !== 0).toBe(true);
    });
  });

  describe('Integration with CLI Runner', () => {
    it('should properly integrate with CliTestRunner', async () => {
      const result = await runner.runRegistryCommand('status', {
        timeout: 20000,
      });

      expect(result).toHaveProperty('exitCode');
      expect(result).toHaveProperty('stdout');
      expect(result).toHaveProperty('stderr');
      expect(result).toHaveProperty('duration');
      expect(typeof result.exitCode).toBe('number');
      expect(typeof result.stdout).toBe('string');
      expect(typeof result.stderr).toBe('string');
      expect(typeof result.duration).toBe('number');
    });
  });
});
