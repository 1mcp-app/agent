import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestFixtures } from '@test/e2e/fixtures/TestFixtures.js';
import { CommandTestEnvironment, CliTestRunner } from '@test/e2e/utils/index.js';

describe('App Discover Command E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
    environment = new CommandTestEnvironment(
      TestFixtures.createTestScenario('app-discover-test', 'basic', 'mixed-types'),
    );
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  describe('Basic Discovery', () => {
    it('should discover applications in the system', async () => {
      const result = await runner.runAppCommand('discover');

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Discovering installed desktop applications');
      runner.assertOutputContains(result, 'Discovery Summary');
    });

    it('should show applications with MCP configurations', async () => {
      const result = await runner.runAppCommand('discover');

      runner.assertSuccess(result);
      // Should either show found apps or none found message
      const hasApps = result.stdout.includes('Found Applications with MCP Configurations');
      const noApps = result.stdout.includes('No applications with MCP configurations found');
      expect(hasApps || noApps).toBe(true);
    });

    it('should show empty apps when requested', async () => {
      const result = await runner.runAppCommand('discover', {
        args: ['--show-empty'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Discovering installed desktop applications');
    });

    it('should show configuration paths when requested', async () => {
      const result = await runner.runAppCommand('discover', {
        args: ['--show-paths'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Discovering installed desktop applications');
    });
  });

  describe('Command Options', () => {
    it('should show manual setup applications', async () => {
      const result = await runner.runAppCommand('discover');

      runner.assertSuccess(result);
      // Should show manual setup applications
      const hasManualApps = result.stdout.includes('Manual Setup Applications');
      const hasDiscovery = result.stdout.includes('Discovery Summary');
      expect(hasManualApps || hasDiscovery).toBe(true);
    });

    it('should show next steps and recommendations', async () => {
      const result = await runner.runAppCommand('discover');

      runner.assertSuccess(result);
      // Should either show next steps or manual setup message
      const hasNextSteps = result.stdout.includes('Next steps:') || result.stdout.includes('Quick consolidation');
      const hasManualSetup = result.stdout.includes('Manual Setup Applications');
      const hasTip = result.stdout.includes('Tip:');
      expect(hasNextSteps || hasManualSetup || hasTip).toBe(true);
    });

    it('should combine show-empty and show-paths options', async () => {
      const result = await runner.runAppCommand('discover', {
        args: ['--show-empty', '--show-paths'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Discovering installed desktop applications');
    });
  });

  describe('Help and Usage', () => {
    it('should show help when requested', async () => {
      const result = await runner.runAppCommand('discover', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Discover installed apps with MCP configurations');
      runner.assertOutputContains(result, '--show-empty');
      runner.assertOutputContains(result, '--show-paths');
    });

    it('should show examples in help', async () => {
      const result = await runner.runAppCommand('discover', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Examples:');
      runner.assertOutputContains(result, 'discover');
    });
  });

  describe('Integration Testing', () => {
    it('should work with app list command', async () => {
      const result = await runner.runAppCommand('list');

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Supported Desktop Applications');
    });

    it('should work with app status command', async () => {
      const result = await runner.runAppCommand('status');

      runner.assertSuccess(result);
      expect(result.exitCode).toBe(0);
    });
  });
});
