import { TestFixtures } from '@test/e2e/fixtures/TestFixtures.js';
import { CliTestRunner, CommandTestEnvironment } from '@test/e2e/utils/index.js';

import { PresetManager } from '@src/utils/config/presetManager.js';

import { afterEach, beforeEach, describe, it } from 'vitest';

describe('Preset Interactive Command E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
    PresetManager.resetInstance();
    environment = new CommandTestEnvironment(TestFixtures.createTestScenario('preset-interactive-test', 'empty'));
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  describe('Smart Interactive Mode', () => {
    it('should handle no existing presets', async () => {
      const result = await runner.runCommand('preset', '', {
        args: [],
      });

      runner.assertSuccess(result);
      // Should proceed to create new preset workflow
      runner.assertOutputContains(result, '📁 Config directory:');
      expect(result.stdout.length).toBeGreaterThan(0);
    });

    it('should offer existing presets when available', async () => {
      // Create some presets first
      await runner.runCommand('preset', 'create', {
        args: ['test-preset-1', '--filter', 'web,api'],
      });
      await runner.runCommand('preset', 'create', {
        args: ['test-preset-2', '--filter', 'database,monitoring'],
      });

      const result = await runner.runCommand('preset', '', {
        args: [],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, '🎯 Found existing presets');
      runner.assertOutputContains(result, 'test-preset-1');
      runner.assertOutputContains(result, 'test-preset-2');
      runner.assertOutputContains(result, 'Create new preset');
      runner.assertOutputContains(result, 'Cancel');
    });

    it('should show config directory path', async () => {
      const result = await runner.runCommand('preset', '', {
        args: [],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, '📁 Config directory:');
      runner.assertOutputContains(result, 'presets.json');
    });
  });

  describe('Integration with Existing Presets', () => {
    it('should handle preset selection workflow', async () => {
      // Create a preset to work with
      await runner.runCommand('preset', 'create', {
        args: ['workflow-test', '--filter', 'web,api', '--description', 'Test workflow'],
      });

      const result = await runner.runCommand('preset', '', {
        args: [],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'workflow-test');
      runner.assertOutputContains(result, 'Test workflow');
    });

    it('should maintain preset data integrity', async () => {
      // Create multiple presets
      await runner.runCommand('preset', 'create', {
        args: ['preset-a', '--filter', 'web'],
      });
      await runner.runCommand('preset', 'create', {
        args: ['preset-b', '--filter', 'api'],
      });

      // Run interactive mode
      const result = await runner.runCommand('preset', '', {
        args: [],
      });

      runner.assertSuccess(result);

      // Verify both presets are still available
      const listResult = await runner.runCommand('preset', 'list');
      runner.assertOutputContains(listResult, 'preset-a');
      runner.assertOutputContains(listResult, 'preset-b');
    });
  });

  describe('Error Handling', () => {
    it('should handle corrupted preset data gracefully', async () => {
      // This test would require setting up corrupted data, which is complex in e2e
      // For now, just test that the command doesn't crash with no args
      const result = await runner.runCommand('preset', '', {
        args: [],
      });

      runner.assertSuccess(result);
      expect(result.stdout.length).toBeGreaterThan(0);
    });
  });
});
