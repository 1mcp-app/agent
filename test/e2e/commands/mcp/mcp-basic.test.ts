import { describe, it, beforeEach, afterEach } from 'vitest';
import { TestFixtures } from '@test/e2e/fixtures/TestFixtures.js';
import { CommandTestEnvironment, CliTestRunner } from '@test/e2e/utils/index.js';

describe('MCP Basic Commands E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
    environment = new CommandTestEnvironment(TestFixtures.createTestScenario('mcp-basic-test', 'basic'));
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  describe('Add Command', () => {
    it('should add a basic stdio server', async () => {
      const result = await runner.runMcpCommand('add', {
        args: ['test-server', '--type', 'stdio', '--command', 'echo', '--args', 'hello'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Successfully added server');
    });

    it('should add an HTTP server', async () => {
      const result = await runner.runMcpCommand('add', {
        args: ['http-test', '--type', 'http', '--url', 'http://localhost:8080/mcp'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Successfully added server');
    });
  });

  describe('List Command', () => {
    it('should list servers', async () => {
      const result = await runner.runMcpCommand('list');

      runner.assertSuccess(result);
      // Should have at least the basic echo-server from fixtures
      runner.assertOutputContains(result, 'echo-server');
    });
  });

  describe('Status Command', () => {
    it('should show status', async () => {
      const result = await runner.runMcpCommand('status');

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'MCP Servers Status');
    });
  });

  describe('Help Commands', () => {
    it('should show help for add command', async () => {
      const result = await runner.runMcpCommand('add', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Add a new MCP server');
    });
  });
});
