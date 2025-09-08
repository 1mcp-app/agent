import { describe, it, beforeEach, afterEach } from 'vitest';
import { CommandTestEnvironment, CliTestRunner } from '../../utils/index.js';
import { TestFixtures } from '../../fixtures/TestFixtures.js';

describe('Preset Delete Command E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
    environment = new CommandTestEnvironment(TestFixtures.createTestScenario('preset-delete-test', 'empty'));
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  describe('Basic Deletion', () => {
    it('should delete an existing preset', async () => {
      // First create a preset
      await runner.runCommand('preset', 'create', {
        args: ['delete-test', '--filter', 'web,api'],
      });

      // Verify the preset exists
      const listBefore = await runner.runCommand('preset', 'list');
      runner.assertOutputContains(listBefore, 'delete-test');

      // Delete the preset
      const result = await runner.runCommand('preset', 'delete', {
        args: ['delete-test'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, "✅ Preset 'delete-test' deleted successfully.");

      // Verify the preset is gone
      const listAfter = await runner.runCommand('preset', 'list');
      runner.assertOutputContains(listAfter, '⚠️  No presets found');
    });
  });

  describe('Error Handling', () => {
    it('should handle deletion of non-existent preset', async () => {
      const result = await runner.runCommand('preset', 'delete', {
        args: ['nonexistent-preset'],
        expectError: true,
      });

      runner.assertSuccess(result); // Command succeeds but shows error message
      runner.assertOutputContains(result, "Preset 'nonexistent-preset' not found");
    });
  });

  describe('Help and Usage', () => {
    it('should show help for delete command', async () => {
      const result = await runner.runCommand('preset', 'delete', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Delete an existing preset');
      runner.assertOutputContains(result, '<name>');
    });
  });

  describe('Integration Testing', () => {
    it('should handle create -> list -> delete -> list workflow', async () => {
      // Create a preset
      await runner.runCommand('preset', 'create', {
        args: ['workflow-test', '--filter', 'web,api', '--description', 'Workflow test preset'],
      });

      // List to verify it exists
      const listAfterCreate = await runner.runCommand('preset', 'list');
      runner.assertOutputContains(listAfterCreate, 'workflow-test');
      runner.assertOutputContains(listAfterCreate, 'Workflow test preset');

      // Delete the preset
      const deleteResult = await runner.runCommand('preset', 'delete', {
        args: ['workflow-test'],
      });
      runner.assertSuccess(deleteResult);
      runner.assertOutputContains(deleteResult, "✅ Preset 'workflow-test' deleted successfully.");

      // List to verify it's gone
      const listAfterDelete = await runner.runCommand('preset', 'list');
      runner.assertOutputContains(listAfterDelete, '⚠️  No presets found');
    });
  });
});
