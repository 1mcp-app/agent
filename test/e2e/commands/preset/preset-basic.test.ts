import { TestFixtures } from '@test/e2e/fixtures/TestFixtures.js';
import { CliTestRunner, CommandTestEnvironment } from '@test/e2e/utils/index.js';

import { PresetManager } from '@src/utils/config/presetManager.js';

import { afterEach, beforeEach, describe, it } from 'vitest';

describe('Preset Basic Commands E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
    PresetManager.resetInstance();
    environment = new CommandTestEnvironment(TestFixtures.createTestScenario('preset-basic-test', 'empty'));
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  describe('Create Command', () => {
    it('should create a basic preset with OR logic', async () => {
      const result = await runner.runCommand('preset', 'create', {
        args: ['test-preset', '--filter', 'web,api,database'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, "✅ Preset 'test-preset' created successfully!");
      runner.assertOutputContains(result, '📋 Strategy: or');
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
  });

  describe('List Command', () => {
    it('should list presets', async () => {
      // First create a preset
      await runner.runCommand('preset', 'create', {
        args: ['list-test', '--filter', 'web,api'],
      });

      const result = await runner.runCommand('preset', 'list');

      runner.assertSuccess(result);
      runner.assertOutputContains(result, '📋 Available Presets');
      runner.assertOutputContains(result, 'list-test');
      runner.assertOutputContains(result, 'OR logic');
    });

    it('should handle empty preset list', async () => {
      const result = await runner.runCommand('preset', 'list');

      runner.assertSuccess(result);
      runner.assertOutputContains(result, '⚠️  No presets found');
    });
  });

  describe('Help Commands', () => {
    it('should show help for preset command', async () => {
      const result = await runner.runCommand('preset', '', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Manage server presets for dynamic filtering');
    });

    it('should show help for create subcommand', async () => {
      const result = await runner.runCommand('preset', 'create', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Create preset with filter expression');
      runner.assertOutputContains(result, '--filter');
    });
  });
});
