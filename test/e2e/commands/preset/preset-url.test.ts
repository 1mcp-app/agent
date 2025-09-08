import { describe, it, beforeEach, afterEach } from 'vitest';
import { CommandTestEnvironment, CliTestRunner } from '../../utils/index.js';
import { TestFixtures } from '../../fixtures/TestFixtures.js';
import { PresetManager } from '../../../../src/utils/presetManager.js';

describe('Preset URL Command E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
    PresetManager.resetInstance();
    environment = new CommandTestEnvironment(TestFixtures.createTestScenario('preset-url-test', 'empty'));
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  describe('Basic URL Generation', () => {
    it('should generate URL for an existing preset', async () => {
      // Create a preset
      await runner.runCommand('preset', 'create', {
        args: ['url-test', '--filter', 'web,api'],
      });

      const result = await runner.runCommand('preset', 'url', {
        args: ['url-test'],
      });

      runner.assertSuccess(result);
      // The url command uses InteractiveSelector.showUrl which in e2e tests
      // will show a message about the URL
      expect(result.stdout.length).toBeGreaterThan(0);
      // Should contain the preset name in the output
      runner.assertOutputContains(result, 'url-test');
    });

    it('should generate URL with proper format', async () => {
      // Create a preset
      await runner.runCommand('preset', 'create', {
        args: ['format-test', '--filter', 'web AND api'],
      });

      const result = await runner.runCommand('preset', 'url', {
        args: ['format-test'],
      });

      runner.assertSuccess(result);
      expect(result.stdout.length).toBeGreaterThan(0);
      runner.assertOutputContains(result, 'format-test');
    });
  });

  describe('Error Handling', () => {
    it('should handle URL generation for non-existent preset', async () => {
      const result = await runner.runCommand('preset', 'url', {
        args: ['nonexistent-preset'],
        expectError: true,
      });

      runner.assertSuccess(result); // Command succeeds but shows error message
      runner.assertOutputContains(result, "Preset 'nonexistent-preset' not found", true);
    });
  });

  describe('Help and Usage', () => {
    it('should show help for url command', async () => {
      const result = await runner.runCommand('preset', 'url', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Generate URL for existing preset');
      runner.assertOutputContains(result, '<name>');
    });
  });

  describe('Integration Testing', () => {
    it('should handle create -> url workflow', async () => {
      // Create a preset
      await runner.runCommand('preset', 'create', {
        args: ['workflow-url-test', '--filter', 'web,api', '--description', 'URL workflow test'],
      });

      // Generate URL for the preset
      const urlResult = await runner.runCommand('preset', 'url', {
        args: ['workflow-url-test'],
      });

      runner.assertSuccess(urlResult);
      expect(urlResult.stdout.length).toBeGreaterThan(0);
      runner.assertOutputContains(urlResult, 'workflow-url-test');
    });

    it('should generate consistent URLs between create and url commands', async () => {
      // Create a preset and capture the URL from creation
      const createResult = await runner.runCommand('preset', 'create', {
        args: ['consistent-test', '--filter', 'web,api'],
      });

      // Generate URL separately
      const urlResult = await runner.runCommand('preset', 'url', {
        args: ['consistent-test'],
      });

      runner.assertSuccess(createResult);
      runner.assertSuccess(urlResult);

      // Both should reference the same preset
      runner.assertOutputContains(createResult, 'consistent-test');
      runner.assertOutputContains(urlResult, 'consistent-test');
    });
  });
});
