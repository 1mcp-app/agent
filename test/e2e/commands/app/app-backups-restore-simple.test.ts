import { TestFixtures } from '@test/e2e/fixtures/TestFixtures.js';
import { CliTestRunner, CommandTestEnvironment } from '@test/e2e/utils/index.js';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('App Backups & Restore Commands E2E (Simple)', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
    environment = new CommandTestEnvironment(
      TestFixtures.createTestScenario('app-backups-test', 'basic', 'mixed-types'),
    );
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  describe('Backups Command', () => {
    it('should list available backups or show empty message', async () => {
      const result = await runner.runAppCommand('backups');

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'MCP Configuration Backup Management');

      // Should either show backups or indicate none exist
      const hasBackups = result.stdout.includes('📋 All Available Backups:');
      const hasNoBackups = result.stdout.includes('📭 No backups found');
      expect(hasBackups || hasNoBackups).toBe(true);
    });

    it('should list backups for specific application', async () => {
      const result = await runner.runAppCommand('backups', {
        args: ['vscode'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'MCP Configuration Backup Management');

      // Should either show backups for the app or indicate none exist
      const hasBackups = result.stdout.includes('📋 Backups for');
      const hasNoBackups = result.stdout.includes('📭 No backups found for vscode');
      expect(hasBackups || hasNoBackups).toBe(true);
    });

    it('should verify backup integrity when requested', async () => {
      const result = await runner.runAppCommand('backups', {
        args: ['--verify'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'MCP Configuration Backup Management');

      // Should either show verification results or no backups message
      const hasVerification = result.stdout.includes('✅ Verified:') || result.stdout.includes('❌ Corrupted:');
      const hasNoBackups = result.stdout.includes('📭 No backups found');
      expect(hasVerification || hasNoBackups).toBe(true);
    });

    it('should handle cleanup of old backups', async () => {
      const result = await runner.runAppCommand('backups', {
        args: ['--cleanup=365'], // Use a high number to avoid deleting real backups
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Cleaning up backups older than 365 days');
    });

    it('should show help for backups command', async () => {
      const result = await runner.runAppCommand('backups', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'List all available backups');
      runner.assertOutputContains(result, '--cleanup');
      runner.assertOutputContains(result, '--verify');
    });
  });

  describe('Restore Command', () => {
    it('should show help for restore command', async () => {
      const result = await runner.runAppCommand('restore', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Restore desktop applications to pre-consolidation state');
      runner.assertOutputContains(result, '--dry-run');
      runner.assertOutputContains(result, '--backup');
    });

    it('should handle restore with missing app name', async () => {
      const result = await runner.runAppCommand('restore', {
        expectError: true,
      });

      // Should either succeed (if showing help) or fail gracefully
      if (result.exitCode !== 0) {
        expect(result.stderr || result.stdout).toContain('restore');
      }
    });

    it('should handle non-existent application restore', async () => {
      const result = await runner.runAppCommand('restore', {
        args: ['nonexistent-app'],
        expectError: true,
      });

      // Should handle gracefully
      if (result.exitCode !== 0) {
        const output = result.stderr || result.stdout;
        expect(output).toMatch(/no.*backup|not.*found|unsupported/i);
      }
    });
  });

  describe('Integration with App Discovery', () => {
    it('should work with app list command', async () => {
      const result = await runner.runAppCommand('list');

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Supported Desktop Applications');
    });

    it('should work with app status command', async () => {
      const result = await runner.runAppCommand('status');

      runner.assertSuccess(result);
      // Status command should work regardless of whether apps are configured
      expect(result.exitCode).toBe(0);
    });
  });
});
