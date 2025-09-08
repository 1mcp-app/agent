import { describe, it, beforeEach, afterEach } from 'vitest';
import { CommandTestEnvironment, CliTestRunner } from '../../utils/index.js';
import { TestFixtures } from '../../fixtures/TestFixtures.js';

describe('Preset Create Command E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
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
      runner.assertOutputContains(result, '📋 Strategy: advanced');
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
      runner.assertOutputContains(result, '📋 Strategy: advanced');
    });
  });

  describe('Error Handling', () => {
    it('should require preset name', async () => {
      const result = await runner.runCommand('preset', 'create', {
        args: ['--filter', 'web'],
        expectError: true,
      });

      runner.assertFailure(result, 1);
      runner.assertOutputContains(result, '❌ Preset name is required');
    });

    it('should require filter expression', async () => {
      const result = await runner.runCommand('preset', 'create', {
        args: ['no-filter-preset'],
        expectError: true,
      });

      runner.assertFailure(result, 1);
      runner.assertOutputContains(result, '❌ Filter expression is required');
    });

    it('should handle empty filter expression', async () => {
      const result = await runner.runCommand('preset', 'create', {
        args: ['empty-filter-preset', '--filter', ''],
        expectError: true,
      });

      runner.assertFailure(result, 1);
      runner.assertOutputContains(result, '❌ Invalid filter expression');
    });

    it('should show examples for invalid filter expressions', async () => {
      const result = await runner.runCommand('preset', 'create', {
        args: ['invalid-filter-preset', '--filter', 'invalid filter expression'],
        expectError: true,
      });

      runner.assertFailure(result, 1);
      runner.assertOutputContains(result, '❌ Invalid filter expression');
      runner.assertOutputContains(result, 'Examples:');
      runner.assertOutputContains(result, '--filter "web,api,database"');
      runner.assertOutputContains(result, '--filter "web AND database"');
      runner.assertOutputContains(result, '--filter "(web OR api) AND database"');
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
        args: ['persistent-preset', '--filter', 'web,api', '--description', 'Test description'],
      });

      // List presets to verify it was saved
      const listResult = await runner.runCommand('preset', 'list');
      runner.assertSuccess(listResult);
      runner.assertOutputContains(listResult, 'persistent-preset');
      runner.assertOutputContains(listResult, 'Test description');
    });
  });
});
