import { TestFixtures } from '@test/e2e/fixtures/TestFixtures.js';
import { CliTestRunner, CommandTestEnvironment } from '@test/e2e/utils/index.js';

import { PresetManager } from '@src/domains/preset/manager/presetManager.js';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('Preset Test Command E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
    PresetManager.resetInstance();
    environment = new CommandTestEnvironment(TestFixtures.createTestScenario('preset-test-test', 'empty'));
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  describe('Basic Testing', () => {
    it('should test an existing preset', async () => {
      // Create a preset
      await runner.runCommand('preset', 'create', {
        args: ['test-preset', '--filter', 'web,api,database'],
      });

      const result = await runner.runCommand('preset', 'test', {
        args: ['test-preset'],
      });

      runner.assertSuccess(result);
      // The test command uses InteractiveSelector.testPreset which in e2e tests
      // will show a message about testing the preset
      expect(result.stdout.length).toBeGreaterThan(0);
    });

    it('should test preset with AND strategy', async () => {
      // Create a preset with AND strategy
      await runner.runCommand('preset', 'create', {
        args: ['and-test-preset', '--filter', 'web AND api'],
      });

      const result = await runner.runCommand('preset', 'test', {
        args: ['and-test-preset'],
      });

      runner.assertSuccess(result);
      expect(result.stdout.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle testing non-existent preset', async () => {
      const result = await runner.runCommand('preset', 'test', {
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
    it('should show help for test command', async () => {
      const result = await runner.runCommand('preset', 'test', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Test preset against current server configuration');
      runner.assertOutputContains(result, '<name>');
    });
  });

  describe('Integration Testing', () => {
    it('should handle create -> test workflow', async () => {
      // Create a preset
      await runner.runCommand('preset', 'create', {
        args: ['workflow-test-preset', '--filter', 'web,api', '--description', 'Workflow test'],
      });

      // Test the preset
      const testResult = await runner.runCommand('preset', 'test', {
        args: ['workflow-test-preset'],
      });

      runner.assertSuccess(testResult);
      expect(testResult.stdout.length).toBeGreaterThan(0);
    });
  });
});
