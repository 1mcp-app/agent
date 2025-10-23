import { TestFixtures } from '@test/e2e/fixtures/TestFixtures.js';
import { CliTestRunner, CommandTestEnvironment } from '@test/e2e/utils/index.js';

import { afterEach, beforeEach, describe, it } from 'vitest';

describe('Registry Help Commands E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
    environment = new CommandTestEnvironment(TestFixtures.createTestScenario('registry-help-test', 'basic'));
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  describe('Help Command Validation', () => {
    it('should show help for registry search command', async () => {
      const result = await runner.runRegistryCommand('search', {
        args: ['--help'],
        timeout: 10000, // 10 second timeout for help
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Search for MCP servers');
      runner.assertOutputContains(result, 'Positionals:');
      runner.assertOutputContains(result, 'query');
      runner.assertOutputContains(result, '--format');
      runner.assertOutputContains(result, '--status');
    });

    it('should show help for registry status command', async () => {
      const result = await runner.runRegistryCommand('status', {
        args: ['--help'],
        timeout: 10000,
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Show registry availability status');
      runner.assertOutputContains(result, 'Options:');
      runner.assertOutputContains(result, '--stats');
      runner.assertOutputContains(result, '--json');
    });

    it('should show help for registry show command', async () => {
      const result = await runner.runRegistryCommand('show', {
        args: ['--help'],
        timeout: 10000,
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Show detailed information');
      runner.assertOutputContains(result, 'Positionals:');
      runner.assertOutputContains(result, 'server-id');
      runner.assertOutputContains(result, 'Options:');
      runner.assertOutputContains(result, '--ver');
      runner.assertOutputContains(result, '--format');
    });

    it('should show help for registry versions command', async () => {
      const result = await runner.runRegistryCommand('versions', {
        args: ['--help'],
        timeout: 10000,
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'List all versions');
      runner.assertOutputContains(result, 'Positionals:');
      runner.assertOutputContains(result, 'server-id');
      runner.assertOutputContains(result, 'Options:');
      runner.assertOutputContains(result, '--format');
    });
  });
});
