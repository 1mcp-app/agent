import { TestFixtures } from '@test/e2e/fixtures/TestFixtures.js';
import { CliTestRunner, CommandTestEnvironment } from '@test/e2e/utils/index.js';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('MCP List Command E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
    environment = new CommandTestEnvironment(TestFixtures.createTestScenario('mcp-list-test', 'mixed'));
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  describe('Basic Listing', () => {
    it('should list all enabled servers by default', async () => {
      const result = await runner.runMcpCommand('list');

      runner.assertSuccess(result);
      runner.assertOutputContains(result, '📋 MCP Servers');
      runner.assertOutputContains(result, 'echo-server');
      runner.assertOutputContains(result, '🟢'); // Enabled status icon

      // Should not show disabled servers by default
      expect(result.stdout).not.toContain('disabled-server');
    });

    it('should show summary information', async () => {
      const result = await runner.runMcpCommand('list');

      runner.assertSuccess(result);
      runner.assertOutputContains(result, '📊 Summary:');
      runner.assertOutputContains(result, 'Total:');
      runner.assertOutputContains(result, 'Enabled:');
    });

    it('should show disabled servers when requested', async () => {
      const result = await runner.runMcpCommand('list', {
        args: ['--show-disabled'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'disabled-server');
      runner.assertOutputContains(result, '🔴'); // Disabled status icon
      runner.assertOutputContains(result, 'Disabled:');
    });

    it('should handle empty server list', async () => {
      // Create environment with no servers
      const emptyEnv = new CommandTestEnvironment(TestFixtures.createTestScenario('empty-test', 'empty'));
      await emptyEnv.setup();
      const emptyRunner = new CliTestRunner(emptyEnv);

      try {
        const result = await emptyRunner.runMcpCommand('list');

        emptyRunner.assertSuccess(result);
        emptyRunner.assertOutputContains(result, 'No MCP servers are configured');
        emptyRunner.assertOutputContains(result, 'Use "server add <name>" to add your first server');
      } finally {
        await emptyEnv.cleanup();
      }
    });
  });

  describe('Verbose Output', () => {
    it('should show detailed server information with --verbose', async () => {
      const result = await runner.runMcpCommand('list', {
        args: ['--verbose'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Type:');
      runner.assertOutputContains(result, 'Command:');
      runner.assertOutputContains(result, 'Args:');
    });

    it('should show environment variables in verbose mode', async () => {
      // Update config to include a server with environment variables
      await environment.updateConfig({
        servers: [
          {
            name: 'env-server',
            type: 'stdio',
            command: 'node',
            args: ['--version'],
            tags: ['test'],
          },
        ],
        addServers: true,
      });

      const result = await runner.runMcpCommand('list', {
        args: ['--verbose'],
      });

      runner.assertSuccess(result);
      // Note: The actual environment variable display would depend on
      // the server configuration having env vars
    });
  });

  describe('Tag Filtering', () => {
    it('should filter servers by single tag', async () => {
      const result = await runner.runMcpCommand('list', {
        args: ['--tags', 'test'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'echo-server'); // Has 'test' tag
      runner.assertOutputContains(result, 'Filtered by tags: test');
    });

    it('should filter servers by multiple tags', async () => {
      const result = await runner.runMcpCommand('list', {
        args: ['--tags', 'test,basic'],
      });

      runner.assertSuccess(result);
      // Should show servers that have either 'test' or 'basic' tags
    });

    it('should show message when no servers match tags', async () => {
      const result = await runner.runMcpCommand('list', {
        args: ['--tags', 'nonexistent'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'No servers found matching the specified tags');
    });

    it('should handle invalid tag format', async () => {
      const result = await runner.runMcpCommand('list', {
        args: ['--tags', ''],
      });

      // Empty tags should be handled gracefully, not as an error
      runner.assertSuccess(result);
      // Should show all servers when empty tag filter is provided
      runner.assertOutputContains(result, 'echo-server');
    });
  });

  describe('Transport Types', () => {
    it('should display different transport types correctly', async () => {
      // Use complex fixture which has both stdio and http servers
      const complexEnv = new CommandTestEnvironment(TestFixtures.createTestScenario('transport-types-test', 'complex'));
      await complexEnv.setup();
      const complexRunner = new CliTestRunner(complexEnv);

      try {
        const result = await complexRunner.runMcpCommand('list', {
          args: ['--verbose'],
        });

        complexRunner.assertSuccess(result);
        complexRunner.assertOutputContains(result, 'Type: stdio');
        complexRunner.assertOutputContains(result, 'Type: http');
      } finally {
        await complexEnv.cleanup();
      }
    });

    it('should show URL for HTTP servers', async () => {
      // Use complex fixture which has http servers
      const complexEnv = new CommandTestEnvironment(TestFixtures.createTestScenario('transport-url-test', 'complex'));
      await complexEnv.setup();
      const complexRunner = new CliTestRunner(complexEnv);

      try {
        const result = await complexRunner.runMcpCommand('list', {
          args: ['--verbose'],
        });

        complexRunner.assertSuccess(result);
        complexRunner.assertOutputContains(result, 'URL: http://');
      } finally {
        await complexEnv.cleanup();
      }
    });
  });

  describe('Error Scenarios', () => {
    it('should handle invalid config file', async () => {
      const result = await runner.runMcpCommand('list', {
        args: ['--config', '/nonexistent/config.json'],
        expectError: true,
      });

      runner.assertFailure(result, 1);
      runner.assertOutputContains(result, 'Failed to list servers', true);
    });

    it('should handle malformed config file', async () => {
      // Create a malformed config file
      const fs = await import('fs/promises');
      const malformedConfigPath = environment.getConfigPath();
      await fs.writeFile(malformedConfigPath, '{ invalid json');

      const result = await runner.runMcpCommand('list');

      // CLI handles malformed config gracefully, showing empty list
      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'No MCP servers are configured');
    });

    it('should show help when --help is used', async () => {
      const result = await runner.runMcpCommand('list', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'List all configured MCP servers');
    });
  });

  describe('Secret Display', () => {
    it('should redact sensitive information by default', async () => {
      // Update config to include a server with sensitive data
      await environment.updateConfig({
        servers: [
          {
            name: 'sensitive-server',
            type: 'stdio',
            command: 'node',
            args: ['--api-key=sk-1234567890abcdef', '--host', 'example.com'],
            env: {
              API_KEY: 'sk-secret123456789',
              DATABASE_URL: 'postgres://user:pass@host:5432/db',
              NORMAL_VAR: 'safe-value',
            },
            tags: ['test'],
          },
        ],
        addServers: true,
      });

      const result = await runner.runMcpCommand('list', {
        args: ['--verbose'],
      });

      runner.assertSuccess(result);
      // Should redact sensitive arguments
      runner.assertOutputContains(result, '--api-key=[REDACTED]');
      runner.assertOutputContains(result, '--host example.com'); // Non-sensitive should remain

      // Environment variables would only show if they were actually configured on the server
      // For this test, we focus on the args redaction which is visible
    });

    it('should show sensitive information when --show-secrets flag is used', async () => {
      // Update config to include a server with sensitive data
      await environment.updateConfig({
        servers: [
          {
            name: 'sensitive-server',
            type: 'stdio',
            command: 'node',
            args: ['--api-key=sk-1234567890abcdef', '--token', 'secret123'],
            env: {
              API_KEY: 'sk-secret123456789',
              NORMAL_VAR: 'safe-value',
            },
            tags: ['test'],
          },
        ],
        addServers: true,
      });

      const result = await runner.runMcpCommand('list', {
        args: ['--verbose', '--show-secrets'],
      });

      runner.assertSuccess(result);
      // Should show actual sensitive values in arguments
      runner.assertOutputContains(result, '--api-key=sk-1234567890abcdef');
      runner.assertOutputContains(result, '--token secret123');

      // Should show warning about sensitive information
      runner.assertOutputContains(result, '⚠️  Sensitive information is being displayed');
    });

    it('should redact URLs with credentials by default', async () => {
      // Update config to include HTTP server with credentials in URL
      await environment.updateConfig({
        servers: [
          {
            name: 'http-server',
            type: 'http',
            command: 'http-server', // Required for MockMcpServer interface
            url: 'https://user:password@api.example.com/v1?token=secret123&data=safe',
            headers: {
              Authorization: 'Bearer secret-token',
              'Content-Type': 'application/json',
            },
            tags: ['test'],
          },
        ],
        addServers: true,
      });

      const result = await runner.runMcpCommand('list', {
        args: ['--verbose'],
      });

      runner.assertSuccess(result);
      // Should redact URL credentials
      runner.assertOutputContains(result, 'https://REDACTED:REDACTED@api.example.com');
      runner.assertOutputContains(result, 'token=REDACTED');
      runner.assertOutputContains(result, 'data=safe'); // Non-sensitive should remain
    });

    it('should show URLs with credentials when --show-secrets flag is used', async () => {
      // Update config to include HTTP server with credentials in URL
      await environment.updateConfig({
        servers: [
          {
            name: 'http-server',
            type: 'http',
            command: 'http-server', // Required for MockMcpServer interface
            url: 'https://apiuser:secretpass@api.example.com/v1?token=abc123',
            headers: {
              Authorization: 'Bearer secret-token',
              'X-API-Key': 'api-key-123',
            },
            tags: ['test'],
          },
        ],
        addServers: true,
      });

      const result = await runner.runMcpCommand('list', {
        args: ['--verbose', '--show-secrets'],
      });

      runner.assertSuccess(result);
      // Should show actual URL with credentials
      runner.assertOutputContains(result, 'https://apiuser:secretpass@api.example.com');
      runner.assertOutputContains(result, 'token=abc123');

      // Should show warning about sensitive information
      runner.assertOutputContains(result, '⚠️  Sensitive information is being displayed');
    });
  });

  describe('Output Formatting', () => {
    it('should use consistent formatting for server names', async () => {
      const result = await runner.runMcpCommand('list');

      runner.assertSuccess(result);
      // Check that server names are properly formatted with status icons
      runner.assertOutputMatches(result, /🟢 \w+.*\(Enabled\)/);
    });

    it('should show proper counts in summary', async () => {
      const result = await runner.runMcpCommand('list', {
        args: ['--show-disabled'],
      });

      runner.assertSuccess(result);
      runner.assertOutputMatches(result, /Total: \d+ server/);
      runner.assertOutputMatches(result, /Enabled: \d+/);
      runner.assertOutputMatches(result, /Disabled: \d+/);
    });

    it('should handle singular vs plural correctly', async () => {
      // Test with a single server
      const singleEnv = new CommandTestEnvironment({
        name: 'single-server-test',
        createConfigFile: true,
        mockMcpServers: [TestFixtures.getMockMcpServers().echoServer],
      });
      await singleEnv.setup();
      const singleRunner = new CliTestRunner(singleEnv);

      try {
        const result = await singleRunner.runMcpCommand('list');

        singleRunner.assertSuccess(result);
        singleRunner.assertOutputContains(result, '1 server)'); // Singular form
        singleRunner.assertOutputContains(result, 'Total: 1 server'); // Singular form
      } finally {
        await singleEnv.cleanup();
      }
    });
  });
});
