import { TestFixtures } from '@test/e2e/fixtures/TestFixtures.js';
import { CliTestRunner, CommandTestEnvironment } from '@test/e2e/utils/index.js';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('App Consolidate Command E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
    environment = new CommandTestEnvironment(
      TestFixtures.createTestScenario('app-consolidate-test', 'complex', 'mixed-types'),
    );
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  describe('Basic Consolidation', () => {
    it('should require app name argument', async () => {
      const result = await runner.runAppCommand('consolidate', {
        expectError: true,
      });

      runner.assertFailure(result, 1);
      runner.assertOutputContains(result, 'Please specify at least one application to consolidate');
      runner.assertOutputContains(result, 'npx @1mcp/agent app consolidate claude-desktop');
    });

    it('should perform dry-run consolidation for specific app', async () => {
      const result = await runner.runAppCommand('consolidate', {
        args: ['vscode', '--dry-run', '--force'],
      });

      runner.assertSuccess(result);
      // Should either show dry-run behavior or no servers message
      const hasDryRun =
        result.stdout.includes('dry-run') || result.stdout.includes('Preview') || result.stdout.includes('would');
      const hasConsolidation = result.stdout.includes('Starting MCP server consolidation');
      expect(hasDryRun || hasConsolidation).toBe(true);
    });

    it('should handle non-existent app gracefully', async () => {
      const result = await runner.runAppCommand('consolidate', {
        args: ['nonexistent-app', '--dry-run'],
        expectError: true,
      });

      // Should handle gracefully
      if (result.exitCode !== 0) {
        const output = result.stderr || result.stdout;
        expect(output).toMatch(/not supported|not found|unsupported/i);
      }
    });

    it('should support multiple apps', async () => {
      const result = await runner.runAppCommand('consolidate', {
        args: ['vscode', 'cursor', '--dry-run', '--force'],
      });

      runner.assertSuccess(result);
      // Should process multiple apps
      const hasVscode = result.stdout.includes('VS Code');
      const hasCursor = result.stdout.includes('Cursor');
      expect(hasVscode && hasCursor).toBe(true);
    });

    it('should support backup-only mode', async () => {
      const result = await runner.runAppCommand('consolidate', {
        args: ['vscode', '--backup-only', '--force'],
      });

      runner.assertSuccess(result);
      // Should either create backup or show no servers message
      const hasBackup = result.stdout.includes('backup') || result.stdout.includes('Backup');
      const hasConsolidation = result.stdout.includes('Starting MCP server consolidation');
      expect(hasBackup || hasConsolidation).toBe(true);
    });

    it('should support manual-only mode', async () => {
      const result = await runner.runAppCommand('consolidate', {
        args: ['cherry-studio', '--manual-only', '--force'],
      });

      runner.assertSuccess(result);
      // Should contain either 'manual' or 'Manual'
      const hasManual = result.stdout.includes('manual') || result.stdout.includes('Manual');
      expect(hasManual).toBe(true);
    });
  });

  describe('Command Options', () => {
    it('should support custom URL option', async () => {
      const result = await runner.runAppCommand('consolidate', {
        args: ['vscode', '--url', 'http://localhost:3051/mcp', '--force', '--dry-run'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'localhost:3051');
    });

    it('should support force flag', async () => {
      const result = await runner.runAppCommand('consolidate', {
        args: ['vscode', '--force', '--dry-run'],
      });

      runner.assertSuccess(result);
      // Force flag should suppress warnings
      expect(result.exitCode).toBe(0);
    });

    it('should support yes flag for automation', async () => {
      const result = await runner.runAppCommand('consolidate', {
        args: ['vscode', '--yes', '--dry-run', '--force'],
      });

      runner.assertSuccess(result);
      // Yes flag should skip confirmations
      expect(result.exitCode).toBe(0);
    });
  });

  describe('Help and Usage', () => {
    it('should show help for consolidate command', async () => {
      const result = await runner.runAppCommand('consolidate', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Consolidate MCP servers from desktop applications into 1mcp');
      runner.assertOutputContains(result, '--dry-run');
      runner.assertOutputContains(result, '--url');
    });

    it('should provide examples in help', async () => {
      const result = await runner.runAppCommand('consolidate', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Examples:');
      runner.assertOutputContains(result, 'claude-desktop');
    });

    it('should list supported apps in help', async () => {
      const result = await runner.runAppCommand('consolidate', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'SUPPORTED APPS:');
      runner.assertOutputContains(result, 'claude-desktop');
      runner.assertOutputContains(result, 'cursor');
      runner.assertOutputContains(result, 'vscode');
    });
  });

  describe('Integration Testing', () => {
    it('should work with app list command', async () => {
      const result = await runner.runAppCommand('list');

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Supported Desktop Applications');
    });

    it('should work with app status command', async () => {
      const result = await runner.runAppCommand('status');

      runner.assertSuccess(result);
      expect(result.exitCode).toBe(0);
    });
  });
});
