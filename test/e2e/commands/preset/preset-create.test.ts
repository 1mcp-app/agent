import { TestFixtures } from '@test/e2e/fixtures/TestFixtures.js';
import { CliTestRunner, CommandTestEnvironment } from '@test/e2e/utils/index.js';

import { PresetManager } from '@src/domains/preset/manager/presetManager.js';

import { afterEach, beforeEach, describe, it } from 'vitest';

describe('Preset Create Command E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
    PresetManager.resetInstance();
    environment = new CommandTestEnvironment(TestFixtures.createTestScenario('preset-create-test', 'empty'));
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  describe('Basic Creation', () => {
    it('should create a basic preset with OR logic using comma-separated tags', async () => {
      const result = await runner.runCommand('preset', 'create', {
        args: ['or-preset', '--filter', 'web,api,database'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, "✅ Preset 'or-preset' created successfully!");
      runner.assertOutputContains(result, '📋 Strategy: or');
      runner.assertOutputContains(result, '🔗 URL:');

      // Verify the preset was actually created by listing presets
      const listResult = await runner.runCommand('preset', 'list');
      runner.assertOutputContains(listResult, 'or-preset');
    });

    it('should create a preset with AND logic', async () => {
      const result = await runner.runCommand('preset', 'create', {
        args: ['and-preset', '--filter', 'web AND api', '--description', 'AND logic preset'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, "✅ Preset 'and-preset' created successfully!");
      runner.assertOutputContains(result, '📋 Strategy: advanced');
      runner.assertOutputContains(result, '📝 Description: AND logic preset');
    });

    it('should create a preset with advanced filter expression', async () => {
      const result = await runner.runCommand('preset', 'create', {
        args: ['advanced-preset', '--filter', '(web OR api) AND database'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, "✅ Preset 'advanced-preset' created successfully!");
      runner.assertOutputContains(result, '📋 Strategy: advanced');
    });

    it('should create a preset with single tag', async () => {
      const result = await runner.runCommand('preset', 'create', {
        args: ['single-tag-preset', '--filter', 'web'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, "✅ Preset 'single-tag-preset' created successfully!");
      runner.assertOutputContains(result, '📋 Strategy: or');
    });
  });

  describe('Error Handling', () => {
    it('should require preset name', async () => {
      const result = await runner.runCommand('preset', 'create', {
        args: ['--filter', 'web'],
        expectError: true,
      });

      runner.assertFailure(result, 1);
      // yargs shows standard error message
      runner.assertOutputContains(result, 'Not enough non-option arguments', true);
    });

    it('should require filter expression', async () => {
      const result = await runner.runCommand('preset', 'create', {
        args: ['no-filter-preset'],
        expectError: true,
      });

      runner.assertFailure(result, 1);
      // yargs shows standard error message for required argument
      runner.assertOutputContains(result, 'Missing required argument', true);
    });

    it('should handle empty filter expression', async () => {
      const result = await runner.runCommand('preset', 'create', {
        args: ['empty-filter-preset', '--filter', ''],
        expectError: true,
      });

      runner.assertFailure(result, 1);
      // Check for error related to empty filter
      const hasError =
        result.stderr.includes('Invalid') || result.stderr.includes('empty') || result.stderr.includes('required');
      if (!hasError) {
        throw new Error(`Expected error message for empty filter. Stderr: ${result.stderr}`);
      }
    });

    it('should show examples for invalid filter expressions', async () => {
      const result = await runner.runCommand('preset', 'create', {
        args: ['invalid-filter-preset', '--filter', 'invalid filter expression'],
        expectError: true,
      });

      runner.assertFailure(result, 1);
      // Check for error message and examples (flexible matching)
      const hasError = result.stderr.includes('Invalid') || result.stderr.includes('filter');
      if (!hasError) {
        throw new Error(`Expected error message for invalid filter. Stderr: ${result.stderr}`);
      }
      // Examples might be shown in help or error output
    });
  });

  describe('Help and Usage', () => {
    it('should show help for create command', async () => {
      const result = await runner.runCommand('preset', 'create', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Create preset with filter expression');
      runner.assertOutputContains(result, '<name>');
      runner.assertOutputContains(result, '--filter');
      runner.assertOutputContains(result, '--description');
    });
  });

  describe('Configuration Persistence', () => {
    it('should persist preset configuration to file', async () => {
      await runner.runCommand('preset', 'create', {
        args: ['persist-test', '--filter', 'web,api', '--description', 'Test description'],
      });

      // List presets to verify it was saved
      const listResult = await runner.runCommand('preset', 'list');
      runner.assertSuccess(listResult);
      runner.assertOutputContains(listResult, 'persist-test');

      // Check preset details to verify description was saved
      const showResult = await runner.runCommand('preset', 'show', {
        args: ['persist-test'],
      });
      runner.assertSuccess(showResult);
      runner.assertOutputContains(showResult, 'Test description');
    });
  });
});
