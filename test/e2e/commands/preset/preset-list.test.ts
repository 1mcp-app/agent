import { describe, it, beforeEach, afterEach } from 'vitest';
import { CommandTestEnvironment, CliTestRunner } from '../../utils/index.js';
import { TestFixtures } from '../../fixtures/TestFixtures.js';

describe('Preset List Command E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
    environment = new CommandTestEnvironment(TestFixtures.createTestScenario('preset-list-test', 'empty'));
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  describe('Basic Listing', () => {
    it('should list presets when they exist', async () => {
      // Create a few presets
      await runner.runCommand('preset', 'create', {
        args: ['list-test-1', '--filter', 'web,api'],
      });

      await runner.runCommand('preset', 'create', {
        args: ['list-test-2', '--filter', 'web AND database', '--description', 'AND logic preset'],
      });

      const result = await runner.runCommand('preset', 'list');

      runner.assertSuccess(result);
      runner.assertOutputContains(result, '📋 Available Presets');
      runner.assertOutputContains(result, 'list-test-1');
      runner.assertOutputContains(result, 'list-test-2');
      runner.assertOutputContains(result, 'OR logic');
      runner.assertOutputContains(result, 'AND logic');
      runner.assertOutputContains(result, 'AND logic preset');
    });

    it('should handle empty preset list', async () => {
      const result = await runner.runCommand('preset', 'list');

      runner.assertSuccess(result);
      runner.assertOutputContains(result, '⚠️  No presets found');
      runner.assertOutputContains(result, 'Create your first preset with:');
      runner.assertOutputContains(result, '1mcp preset create <name> --filter "web,api,database"');
    });
  });

  describe('Output Formatting', () => {
    it('should display preset information in a table format', async () => {
      // Create a preset
      await runner.runCommand('preset', 'create', {
        args: ['format-test', '--filter', 'web,api,database', '--description', 'Test description'],
      });

      const result = await runner.runCommand('preset', 'list');

      runner.assertSuccess(result);
      // Check for table headers
      runner.assertOutputContains(result, 'Name');
      runner.assertOutputContains(result, 'Strategy');
      runner.assertOutputContains(result, 'Query');
      runner.assertOutputContains(result, 'Last Used');

      // Check for preset data
      runner.assertOutputContains(result, 'format-test');
      runner.assertOutputContains(result, 'OR logic');
      runner.assertOutputContains(result, 'Test description');
    });
  });

  describe('Help and Usage', () => {
    it('should show help for list command', async () => {
      const result = await runner.runCommand('preset', 'list', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'List all available presets');
    });
  });

  describe('Integration Testing', () => {
    it('should show updated list after creating and deleting presets', async () => {
      // Initially empty
      const initialList = await runner.runCommand('preset', 'list');
      runner.assertOutputContains(initialList, '⚠️  No presets found');

      // Create presets
      await runner.runCommand('preset', 'create', {
        args: ['int-test-1', '--filter', 'web'],
      });

      await runner.runCommand('preset', 'create', {
        args: ['int-test-2', '--filter', 'api'],
      });

      // List should show both
      const listAfterCreate = await runner.runCommand('preset', 'list');
      runner.assertOutputContains(listAfterCreate, 'int-test-1');
      runner.assertOutputContains(listAfterCreate, 'int-test-2');

      // Delete one preset
      await runner.runCommand('preset', 'delete', {
        args: ['int-test-1'],
      });

      // List should show only one
      const listAfterDelete = await runner.runCommand('preset', 'list');
      runner.assertOutputContains(listAfterDelete, 'int-test-2');
      expect(listAfterDelete.stdout).not.toContain('int-test-1');
    });
  });
});
