import { TestFixtures } from '@test/e2e/fixtures/TestFixtures.js';
import { CliTestRunner, CommandTestEnvironment } from '@test/e2e/utils/index.js';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('App List & Status Commands E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
    environment = new CommandTestEnvironment(
      TestFixtures.createTestScenario('app-list-status-test', 'basic', 'mixed-types'),
    );
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  describe('App List Command', () => {
    it('should list supported applications', async () => {
      const result = await runner.runAppCommand('list');

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Supported Desktop Applications');
      runner.assertOutputContains(result, 'claude-desktop');
      runner.assertOutputContains(result, 'cursor');
      runner.assertOutputContains(result, 'vscode');
    });

    it('should show auto-configurable applications', async () => {
      const result = await runner.runAppCommand('list', {
        args: ['--configurable-only'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Auto-Configurable Applications');
    });

    it('should show manual setup applications', async () => {
      const result = await runner.runAppCommand('list', {
        args: ['--manual-only'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Manual Setup Applications');
    });

    it('should show application counts and totals', async () => {
      const result = await runner.runAppCommand('list');

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Total:');
      runner.assertOutputContains(result, 'Auto-configurable:');
      runner.assertOutputContains(result, 'Manual setup:');
    });

    it('should provide usage examples', async () => {
      const result = await runner.runAppCommand('list');

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Usage:');
      runner.assertOutputContains(result, 'npx @1mcp/agent app consolidate');
      runner.assertOutputContains(result, 'npx @1mcp/agent app discover');
    });
  });

  describe('App Status Command', () => {
    it('should show overall application status', async () => {
      const result = await runner.runAppCommand('status');

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Application MCP Configuration Status');
      runner.assertOutputContains(result, 'Application Status Overview');
      runner.assertOutputContains(result, 'Summary');
    });

    it('should show status for specific application', async () => {
      const result = await runner.runAppCommand('status', {
        args: ['vscode'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'VS Code');
    });

    it('should show verbose status information', async () => {
      const result = await runner.runAppCommand('status', {
        args: ['--verbose'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Application MCP Configuration Status');
    });

    it('should handle non-existent application gracefully', async () => {
      const result = await runner.runAppCommand('status', {
        args: ['nonexistent-app'],
        expectError: true,
      });

      // Should handle gracefully
      if (result.exitCode !== 0) {
        const output = result.stderr || result.stdout;
        expect(output).toMatch(/not supported|not found|unsupported/i);
      }
    });

    it('should show configuration status indicators', async () => {
      const result = await runner.runAppCommand('status');

      runner.assertSuccess(result);
      // Should show various status indicators
      const hasStatusIndicators =
        result.stdout.includes('🟢') ||
        result.stdout.includes('🔴') ||
        result.stdout.includes('⚪') ||
        result.stdout.includes('🔧');
      expect(hasStatusIndicators).toBe(true);
    });
  });

  describe('Help and Usage', () => {
    it('should show help for list command', async () => {
      const result = await runner.runAppCommand('list', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'List supported desktop applications');
      runner.assertOutputContains(result, '--configurable-only');
      runner.assertOutputContains(result, '--manual-only');
    });

    it('should show help for status command', async () => {
      const result = await runner.runAppCommand('status', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Show current status of app configurations');
      runner.assertOutputContains(result, '--verbose');
    });

    it('should show examples in help', async () => {
      const result = await runner.runAppCommand('list', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Examples:');
      runner.assertOutputContains(result, 'app list');
    });
  });

  describe('Integration Testing', () => {
    it('should work with app discover command', async () => {
      const result = await runner.runAppCommand('discover');

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Discovering installed desktop applications');
    });

    it('should work with app consolidate command', async () => {
      const result = await runner.runAppCommand('consolidate', {
        expectError: true,
      });

      runner.assertFailure(result, 1);
      runner.assertOutputContains(result, 'Please specify at least one application to consolidate');
    });
  });
});
