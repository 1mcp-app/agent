import { describe, it, beforeEach, afterEach } from 'vitest';
import { CommandTestEnvironment, CliTestRunner } from '../../utils/index.js';
import { TestFixtures } from '../../fixtures/TestFixtures.js';

describe('Preset Select Command E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
    environment = new CommandTestEnvironment(TestFixtures.createTestScenario('preset-select-test', 'empty'));
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  describe('List Mode', () => {
    it('should list presets in select mode', async () => {
      // Create a preset first
      await runner.runCommand('preset', 'create', {
        args: ['select-list-test', '--filter', 'web,api'],
      });

      const result = await runner.runCommand('preset', 'select', {
        args: ['--list'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Available Presets');
      runner.assertOutputContains(result, 'select-list-test');
    });

    it('should handle empty list in select mode', async () => {
      const result = await runner.runCommand('preset', 'select', {
        args: ['--list'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, '❌ No presets found', true);
    });
  });

  describe('Save Mode', () => {
    it('should save selection as preset', async () => {
      // Note: In e2e tests, the interactive selector is mocked
      // So we test the command flow rather than actual interaction
      const result = await runner.runCommand('preset', 'select', {
        args: ['--save', 'saved-preset', '--description', 'Saved from select'],
      });

      runner.assertSuccess(result);
      // In e2e tests, select command with --save will show a summary
      expect(result.stdout.length).toBeGreaterThan(0);
    });
  });

  describe('Load Mode', () => {
    it('should load existing preset for editing', async () => {
      // Create a preset first
      await runner.runCommand('preset', 'create', {
        args: ['load-test', '--filter', 'web,api', '--description', 'To be loaded'],
      });

      const result = await runner.runCommand('preset', 'select', {
        args: ['--load', 'load-test'],
      });

      runner.assertSuccess(result);
      // Should show editing message
      runner.assertOutputContains(result, 'Editing preset: load-test');
      runner.assertOutputContains(result, 'To be loaded');
    });

    it('should handle loading non-existent preset', async () => {
      const result = await runner.runCommand('preset', 'select', {
        args: ['--load', 'nonexistent-preset'],
        expectError: true,
      });

      runner.assertSuccess(result); // Command succeeds but shows error message
      runner.assertOutputContains(result, "❌ Preset 'nonexistent-preset' not found", true);
    });
  });

  describe('URL Mode', () => {
    it('should generate URL for existing preset in select mode', async () => {
      // Create a preset first
      await runner.runCommand('preset', 'create', {
        args: ['url-select-test', '--filter', 'web,api'],
      });

      const result = await runner.runCommand('preset', 'select', {
        args: ['url-select-test', '--url-only'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'url-select-test');
    });

    it('should handle URL generation for non-existent preset', async () => {
      const result = await runner.runCommand('preset', 'select', {
        args: ['nonexistent-preset', '--url-only'],
        expectError: true,
      });

      runner.assertSuccess(result); // Command succeeds but shows error message
      runner.assertOutputContains(result, "❌ Preset 'nonexistent-preset' not found", true);
    });
  });

  describe('Preview Mode', () => {
    it('should preview existing preset', async () => {
      // Create a preset first
      await runner.runCommand('preset', 'create', {
        args: ['preview-test', '--filter', 'web,api'],
      });

      const result = await runner.runCommand('preset', 'select', {
        args: ['preview-test', '--preview'],
      });

      runner.assertSuccess(result);
      // Preview uses testPreset which in e2e tests will show a message
      expect(result.stdout.length).toBeGreaterThan(0);
      runner.assertOutputContains(result, 'preview-test');
    });

    it('should handle preview of non-existent preset', async () => {
      const result = await runner.runCommand('preset', 'select', {
        args: ['nonexistent-preset', '--preview'],
        expectError: true,
      });

      runner.assertSuccess(result); // Command succeeds but shows error message
      runner.assertOutputContains(result, "❌ Preset 'nonexistent-preset' not found", true);
    });
  });

  describe('Delete Mode', () => {
    it('should delete preset in select mode', async () => {
      // Create a preset first
      await runner.runCommand('preset', 'create', {
        args: ['delete-select-test', '--filter', 'web,api'],
      });

      // Verify it exists
      const listBefore = await runner.runCommand('preset', 'list');
      runner.assertOutputContains(listBefore, 'delete-select...');

      // Delete via select mode
      const result = await runner.runCommand('preset', 'select', {
        args: ['--delete', 'delete-select-test'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, "✅ Preset 'delete-select-test' deleted successfully.");

      // Verify it's gone
      const listAfter = await runner.runCommand('preset', 'list');
      runner.assertOutputContains(listAfter, '⚠️  No presets found');
    });

    it('should handle deletion of non-existent preset', async () => {
      const result = await runner.runCommand('preset', 'select', {
        args: ['--delete', 'nonexistent-preset'],
        expectError: true,
      });

      runner.assertSuccess(result); // Command succeeds but shows error message
      runner.assertOutputContains(result, "❌ Preset 'nonexistent-preset' not found", true);
    });
  });

  describe('Help and Usage', () => {
    it('should show help for select command', async () => {
      const result = await runner.runCommand('preset', 'select', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Interactive server selection with TUI');
      runner.assertOutputContains(result, '--save');
      runner.assertOutputContains(result, '--load');
      runner.assertOutputContains(result, '--list');
      runner.assertOutputContains(result, '--delete');
      runner.assertOutputContains(result, '--preview');
      runner.assertOutputContains(result, '--url-only');
    });
  });

  describe('Integration Testing', () => {
    it('should handle complex workflow: create -> select load -> select save', async () => {
      // Create a preset
      await runner.runCommand('preset', 'create', {
        args: ['workflow-test', '--filter', 'web,api', '--description', 'Original preset'],
      });

      // Load it for editing
      const loadResult = await runner.runCommand('preset', 'select', {
        args: ['--load', 'workflow-test'],
      });

      runner.assertSuccess(loadResult);
      runner.assertOutputContains(loadResult, 'Editing preset: workflow-test');
      runner.assertOutputContains(loadResult, 'Original preset');

      // Save with new parameters (in real usage this would be interactive)
      const saveResult = await runner.runCommand('preset', 'select', {
        args: ['--save', 'edited-preset', '--description', 'Edited preset'],
      });

      runner.assertSuccess(saveResult);
      expect(saveResult.stdout.length).toBeGreaterThan(0);
    });
  });
});
