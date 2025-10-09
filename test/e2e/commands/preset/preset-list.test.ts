import { TestFixtures } from '@test/e2e/fixtures/TestFixtures.js';
import { CliTestRunner, CommandTestEnvironment } from '@test/e2e/utils/index.js';

import { PresetManager } from '@src/domains/preset/manager/presetManager.js';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('Preset List Command E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
    PresetManager.resetInstance();
    environment = new CommandTestEnvironment(TestFixtures.createTestScenario('preset-list-test', 'empty'));
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  describe('Basic Listing', () => {
    it('should list presets when they exist', async () => {
      // Create a few presets
      await runner.runCommand('preset', 'create', {
        args: ['list-test-1', '--filter', 'web,api'],
      });

      await runner.runCommand('preset', 'create', {
        args: ['list-test-2', '--filter', 'web AND database', '--description', 'AND logic preset'],
      });

      const result = await runner.runCommand('preset', 'list');

      runner.assertSuccess(result);
      // Check for preset list content - either table headers or specific presets
      const hasPresetContent =
        result.stdout.includes('📋 Available Presets') ||
        result.stdout.includes('Name') ||
        (result.stdout.includes('list-test-1') && result.stdout.includes('list-test-2'));
      if (!hasPresetContent) {
        throw new Error(`Output does not contain preset list content. Actual output: ${result.stdout}`);
      }
      runner.assertOutputContains(result, 'list-test-1');
      runner.assertOutputContains(result, 'list-test-2');
      runner.assertOutputContains(result, 'Advanced');
    });

    it('should handle empty preset list', async () => {
      const result = await runner.runCommand('preset', 'list');

      runner.assertSuccess(result);
      runner.assertOutputContains(result, '⚠️  No presets found');
      runner.assertOutputContains(result, 'Create your first preset with:');
      runner.assertOutputContains(result, '1mcp preset create <name> --filter "web,api,database"');
    });
  });

  describe('Output Formatting', () => {
    it('should display preset information in a table format', async () => {
      // Create a preset
      await runner.runCommand('preset', 'create', {
        args: ['format-test', '--filter', 'web,api,database', '--description', 'Test description'],
      });

      const result = await runner.runCommand('preset', 'list');

      runner.assertSuccess(result);
      // Check for table headers (flexible matching)
      const hasTableFormat = result.stdout.includes('Name') || result.stdout.includes('format-test');
      if (!hasTableFormat) {
        throw new Error(`Output does not contain expected table format. Actual output: ${result.stdout}`);
      }

      // Check for preset data
      runner.assertOutputContains(result, 'format-test');
      // Note: descriptions don't show in list format, only in show command
      // Check for strategy info (flexible)
      const hasStrategyInfo = result.stdout.includes('Advanced') || result.stdout.includes('OR logic');
      if (!hasStrategyInfo) {
        throw new Error(`Output does not contain strategy information. Actual output: ${result.stdout}`);
      }
    });
  });

  describe('Help and Usage', () => {
    it('should show help for list command', async () => {
      const result = await runner.runCommand('preset', 'list', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'List all available presets');
    });
  });

  describe('Integration Testing', () => {
    it('should show updated list after creating and deleting presets', async () => {
      // Initially empty
      const initialList = await runner.runCommand('preset', 'list');
      runner.assertOutputContains(initialList, '⚠️  No presets found');

      // Create presets
      await runner.runCommand('preset', 'create', {
        args: ['int-test-1', '--filter', 'web'],
      });

      await runner.runCommand('preset', 'create', {
        args: ['int-test-2', '--filter', 'api'],
      });

      // List should show both
      const listAfterCreate = await runner.runCommand('preset', 'list');
      runner.assertOutputContains(listAfterCreate, 'int-test-1');
      runner.assertOutputContains(listAfterCreate, 'int-test-2');

      // Delete one preset
      await runner.runCommand('preset', 'delete', {
        args: ['int-test-1'],
      });

      // List should show only one
      const listAfterDelete = await runner.runCommand('preset', 'list');
      runner.assertOutputContains(listAfterDelete, 'int-test-2');
      expect(listAfterDelete.stdout).not.toContain('int-test-1');
    });
  });
});
