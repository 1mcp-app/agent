import { describe, it, beforeEach, afterEach } from 'vitest';
import { CommandTestEnvironment, CliTestRunner } from '../../utils/index.js';
import { TestFixtures } from '../../fixtures/TestFixtures.js';

describe('Preset Test Command E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
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

      runner.assertSuccess(result); // Command succeeds but shows error message
      runner.assertOutputContains(result, "Preset 'nonexistent-preset' not found");
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
