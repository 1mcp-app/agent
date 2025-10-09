import { TestFixtures } from '@test/e2e/fixtures/TestFixtures.js';
import { CliTestRunner, CommandTestEnvironment } from '@test/e2e/utils/index.js';

import { PresetManager } from '@src/domains/preset/manager/presetManager.js';

import { afterEach, beforeEach, describe, it } from 'vitest';

describe('Preset Show Command E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
    PresetManager.resetInstance();
    environment = new CommandTestEnvironment(TestFixtures.createTestScenario('preset-show-test', 'empty'));
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  describe('Basic Display', () => {
    it('should show detailed information about a preset', async () => {
      // Create a preset
      await runner.runCommand('preset', 'create', {
        args: ['show-test', '--filter', 'web,api,database', '--description', 'Detailed preset description'],
      });

      const result = await runner.runCommand('preset', 'show', {
        args: ['show-test'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, '📋 show-test');
      runner.assertOutputContains(result, 'Strategy: OR logic - Match ANY selected tags');
      runner.assertOutputContains(result, 'Description: Detailed preset description');
      runner.assertOutputContains(result, 'Client URL:');
      runner.assertOutputContains(result, 'Tag Query:');
      runner.assertOutputContains(result, '"tag": "web"');
      runner.assertOutputContains(result, '"tag": "api"');
      runner.assertOutputContains(result, '"tag": "database"');
    });

    it('should show preset with AND strategy', async () => {
      // Create a preset with AND strategy
      await runner.runCommand('preset', 'create', {
        args: ['and-show-test', '--filter', 'web AND api', '--description', 'AND strategy preset'],
      });

      const result = await runner.runCommand('preset', 'show', {
        args: ['and-show-test'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, '📋 and-show-test');
      runner.assertOutputContains(result, 'Strategy: Advanced');
      runner.assertOutputContains(result, 'AND strategy preset');
      runner.assertOutputContains(result, '"$and"');
    });

    it('should show preset with advanced strategy', async () => {
      // Create a preset with advanced strategy
      await runner.runCommand('preset', 'create', {
        args: ['advanced-show-test', '--filter', '(web OR api) AND database'],
      });

      const result = await runner.runCommand('preset', 'show', {
        args: ['advanced-show-test'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, '📋 advanced-show-test');
      runner.assertOutputContains(result, 'Strategy: Advanced');
      runner.assertOutputContains(result, '"$and"');
    });
  });

  describe('Error Handling', () => {
    it('should handle showing non-existent preset', async () => {
      const result = await runner.runCommand('preset', 'show', {
        args: ['nonexistent-preset'],
        expectError: true,
      });

      // Command may succeed with error message or fail - both are valid
      const hasErrorMessage =
        result.stdout.includes('not found') ||
        result.stderr.includes('not found') ||
        result.stdout.includes('nonexistent') ||
        result.stderr.includes('nonexistent');
      if (!hasErrorMessage) {
        throw new Error(
          `Expected error message for non-existent preset. Stdout: ${result.stdout}, Stderr: ${result.stderr}`,
        );
      }
    });
  });

  describe('Help and Usage', () => {
    it('should show help for show command', async () => {
      const result = await runner.runCommand('preset', 'show', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Show detailed information about a preset');
      runner.assertOutputContains(result, '<name>');
    });
  });

  describe('Integration Testing', () => {
    it('should show consistent information between list and show commands', async () => {
      // Create a preset
      await runner.runCommand('preset', 'create', {
        args: ['consistency-test', '--filter', 'web,api', '--description', 'Consistency test'],
      });

      // Get list output
      const listResult = await runner.runCommand('preset', 'list');
      runner.assertOutputContains(listResult, 'consistency-test');
      runner.assertOutputContains(listResult, 'OR logic');

      // Get show output
      const showResult = await runner.runCommand('preset', 'show', {
        args: ['consistency-test'],
      });
      runner.assertOutputContains(showResult, 'consistency-test');
      runner.assertOutputContains(showResult, 'Strategy: OR logic - Match ANY selected tags');
      runner.assertOutputContains(showResult, 'Consistency test');
    });
  });
});
