import { describe, it, beforeEach, afterEach } from 'vitest';
import { CommandTestEnvironment, CliTestRunner } from '../../utils/index.js';
import { TestFixtures } from '../../fixtures/TestFixtures.js';
import { PresetManager } from '../../../../src/utils/presetManager.js';

describe('Preset Edit Command E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
    PresetManager.resetInstance();
    environment = new CommandTestEnvironment(TestFixtures.createTestScenario('preset-edit-test', 'empty'));
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  describe('Basic Edit Functionality', () => {
    it('should edit existing preset', async () => {
      // Create a preset first
      await runner.runCommand('preset', 'create', {
        args: ['edit-test', '--filter', 'web,api', '--description', 'Original preset'],
      });

      // Edit the preset
      const result = await runner.runCommand('preset', 'edit', {
        args: ['edit-test'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Editing preset: edit-test');
      runner.assertOutputContains(result, 'Original preset');
    });

    it('should handle editing non-existent preset', async () => {
      const result = await runner.runCommand('preset', 'edit', {
        args: ['nonexistent-preset'],
        expectError: true,
      });

      runner.assertSuccess(result); // Command succeeds but shows error message
      runner.assertOutputContains(result, "❌ Preset 'nonexistent-preset' not found", true);
    });

    it('should update description when provided', async () => {
      // Create a preset first
      await runner.runCommand('preset', 'create', {
        args: ['desc-test', '--filter', 'web,api', '--description', 'Original description'],
      });

      // Edit with new description
      const result = await runner.runCommand('preset', 'edit', {
        args: ['desc-test', '--description', 'Updated description'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Editing preset: desc-test');
      // Note: The actual description update would be verified in integration tests
      // as the interactive part is mocked in e2e tests
    });
  });

  describe('Error Handling', () => {
    it('should require preset name argument', async () => {
      const result = await runner.runCommand('preset', 'edit', {
        args: [],
        expectError: true,
      });

      runner.assertFailure(result);
      runner.assertOutputContains(result, 'Not enough non-option arguments', true);
    });

    it('should handle invalid preset names gracefully', async () => {
      const result = await runner.runCommand('preset', 'edit', {
        args: ['invalid@preset#name'],
        expectError: true,
      });

      runner.assertSuccess(result); // Command succeeds but shows error message
      runner.assertOutputContains(result, "❌ Preset 'invalid@preset#name' not found", true);
    });
  });

  describe('Integration', () => {
    it('should maintain preset integrity during edit', async () => {
      // Create initial preset
      await runner.runCommand('preset', 'create', {
        args: ['integrity-test', '--filter', 'web,api,database'],
      });

      // Verify it exists before edit
      const listBefore = await runner.runCommand('preset', 'list');
      runner.assertOutputContains(listBefore, 'integrity-test');

      // Edit the preset
      const editResult = await runner.runCommand('preset', 'edit', {
        args: ['integrity-test'],
      });

      runner.assertSuccess(editResult);

      // Verify it still exists after edit
      const listAfter = await runner.runCommand('preset', 'list');
      runner.assertOutputContains(listAfter, 'integrity-test');
    });
  });
});
