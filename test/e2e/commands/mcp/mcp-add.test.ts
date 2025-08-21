import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile } from 'fs/promises';
import { CommandTestEnvironment, CliTestRunner } from '../../utils/index.js';
import { TestFixtures } from '../../fixtures/TestFixtures.js';

describe('MCP Add Command E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
    environment = new CommandTestEnvironment(TestFixtures.createTestScenario('mcp-add-test', 'basic'));
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  describe('Adding Stdio Servers', () => {
    it('should add a basic stdio server', async () => {
      const result = await runner.runMcpCommand('add', {
        args: ['new-server', '--type', 'stdio', '--command', 'node', '--args', 'server.js'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, '✅ Successfully added server');
      runner.assertOutputContains(result, 'new-server');

      // Verify server was actually added to config
      const listResult = await runner.runMcpCommand('list');
      runner.assertOutputContains(listResult, 'new-server');
    });

    it('should add server with multiple arguments', async () => {
      const result = await runner.runMcpCommand('add', {
        args: ['multi-arg-server', '--type', 'stdio', '--command', 'echo', '--args', 'hello', '--args', 'world'],
      });

      runner.assertSuccess(result);

      // Verify the arguments were properly parsed
      const listResult = await runner.runMcpCommand('list', { args: ['--verbose'] });
      runner.assertOutputContains(listResult, 'multi-arg-server');
      runner.assertOutputContains(listResult, 'Args: hello world');
    });

    it('should add server with tags', async () => {
      const result = await runner.runMcpCommand('add', {
        args: [
          'tagged-server',
          '--type',
          'stdio',
          '--command',
          'node',
          '--args',
          'server.js',
          '--tags',
          'production,database',
        ],
      });

      runner.assertSuccess(result);

      // Verify tags were added
      const listResult = await runner.runMcpCommand('list', { args: ['--verbose'] });
      runner.assertOutputContains(listResult, 'tagged-server');
      runner.assertOutputContains(listResult, 'Tags: production, database');
    });

    it('should add server with working directory', async () => {
      const result = await runner.runMcpCommand('add', {
        args: ['cwd-server', '--type', 'stdio', '--command', 'pwd', '--cwd', '/tmp'],
      });

      runner.assertSuccess(result);

      // Verify working directory was set
      const listResult = await runner.runMcpCommand('list', { args: ['--verbose'] });
      runner.assertOutputContains(listResult, 'cwd-server');
      runner.assertOutputContains(listResult, 'Working Directory: /tmp');
    });
  });

  describe('Adding HTTP Servers', () => {
    it('should add an HTTP server', async () => {
      const result = await runner.runMcpCommand('add', {
        args: ['http-server', '--type', 'http', '--url', 'http://localhost:8080/mcp'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, '✅ Successfully added server');

      // Verify HTTP server was added
      const listResult = await runner.runMcpCommand('list', { args: ['--verbose'] });
      runner.assertOutputContains(listResult, 'http-server');
      runner.assertOutputContains(listResult, 'Type: http');
      runner.assertOutputContains(listResult, 'URL: http://localhost:8080/mcp');
    });

    it('should add HTTP server with headers', async () => {
      const result = await runner.runMcpCommand('add', {
        args: [
          'auth-http-server',
          '--type',
          'http',
          '--url',
          'http://localhost:8080/mcp',
          '--headers',
          'Authorization=Bearer token123,Content-Type=application/json',
        ],
      });

      runner.assertSuccess(result);

      // Verify headers were added
      const listResult = await runner.runMcpCommand('list', { args: ['--verbose'] });
      runner.assertOutputContains(listResult, 'auth-http-server');
      runner.assertOutputContains(listResult, 'Headers: 1 header');
    });
  });

  describe('Server Configuration', () => {
    it('should add server with timeout setting', async () => {
      const result = await runner.runMcpCommand('add', {
        args: ['timeout-server', '--type', 'stdio', '--command', 'sleep', '--args', '1', '--timeout', '5000'],
      });

      runner.assertSuccess(result);

      // Verify timeout was set
      const listResult = await runner.runMcpCommand('list', { args: ['--verbose'] });
      runner.assertOutputContains(listResult, 'timeout-server');
      runner.assertOutputContains(listResult, 'Timeout: 5000ms');
    });

    it('should add server with environment variables', async () => {
      const result = await runner.runMcpCommand('add', {
        args: [
          'env-server',
          '--type',
          'stdio',
          '--command',
          'node',
          '--args',
          'server.js',
          '--env',
          'NODE_ENV=test',
          '--env',
          'DEBUG=true',
        ],
      });

      runner.assertSuccess(result);

      // Verify environment variables were set
      const listResult = await runner.runMcpCommand('list', { args: ['--verbose'] });
      runner.assertOutputContains(listResult, 'env-server');
      runner.assertOutputContains(listResult, 'Environment: 2 variables');
    });

    it('should add server as disabled', async () => {
      const result = await runner.runMcpCommand('add', {
        args: ['disabled-server', '--type', 'stdio', '--command', 'echo', '--args', 'hello', '--disabled'],
      });

      runner.assertSuccess(result);

      // Verify server was added as disabled
      const listResult = await runner.runMcpCommand('list', { args: ['--show-disabled'] });
      runner.assertOutputContains(listResult, 'disabled-server');
      runner.assertOutputContains(listResult, '🔴'); // Disabled icon
    });

    it('should add server with restart configuration', async () => {
      const result = await runner.runMcpCommand('add', {
        args: [
          'restart-server',
          '--type',
          'stdio',
          '--command',
          'node',
          '--args',
          'server.js',
          '--restart-on-exit',
          '--max-restarts',
          '5',
          '--restart-delay',
          '2000',
        ],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Restart on Exit: Enabled');
      runner.assertOutputContains(result, 'Max Restarts: 5');
      runner.assertOutputContains(result, 'Restart Delay: 2000ms');

      // Verify configuration was persisted
      const configContent = await readFile(environment.getConfigPath(), 'utf-8');
      const config = JSON.parse(configContent);
      expect(config.mcpServers['restart-server'].restartOnExit).toBe(true);
      expect(config.mcpServers['restart-server'].maxRestarts).toBe(5);
      expect(config.mcpServers['restart-server'].restartDelay).toBe(2000);
    });

    it('should add server with restart enabled but no limits', async () => {
      const result = await runner.runMcpCommand('add', {
        args: [
          'unlimited-restart-server',
          '--type',
          'stdio',
          '--command',
          'echo',
          '--args',
          'test',
          '--restart-on-exit',
        ],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Restart on Exit: Enabled');
      runner.assertOutputContains(result, 'Max Restarts: Unlimited');
      runner.assertOutputContains(result, 'Restart Delay: 1000ms (default)');

      // Verify configuration
      const configContent = await readFile(environment.getConfigPath(), 'utf-8');
      const config = JSON.parse(configContent);
      expect(config.mcpServers['unlimited-restart-server'].restartOnExit).toBe(true);
      expect(config.mcpServers['unlimited-restart-server'].maxRestarts).toBeUndefined();
      expect(config.mcpServers['unlimited-restart-server'].restartDelay).toBeUndefined();
    });

    it('should display restart configuration in list command', async () => {
      // Add a server with restart configuration
      await runner.runMcpCommand('add', {
        args: [
          'list-restart-server',
          '--type',
          'stdio',
          '--command',
          'node',
          '--args',
          'server.js',
          '--restart-on-exit',
          '--max-restarts',
          '3',
          '--restart-delay',
          '1500',
        ],
      });

      // Check that restart configuration is displayed in list command
      const listResult = await runner.runMcpCommand('list', { args: ['--verbose'] });
      runner.assertSuccess(listResult);
      runner.assertOutputContains(listResult, 'list-restart-server');
      runner.assertOutputContains(listResult, 'Restart on Exit: Enabled');
      runner.assertOutputContains(listResult, 'Max Restarts: 3');
      runner.assertOutputContains(listResult, 'Restart Delay: 1500ms');
    });
  });

  describe('Error Scenarios', () => {
    it('should reject server with existing name', async () => {
      const result = await runner.runMcpCommand('add', {
        args: ['echo-server', '--type', 'stdio', '--command', 'node', '--args', 'server.js'],
        expectError: true,
      });

      runner.assertFailure(result, 1);
      runner.assertOutputContains(result, 'already exists', true);
    });

    it('should require command for stdio servers', async () => {
      const result = await runner.runMcpCommand('add', {
        args: ['no-command-server', '--type', 'stdio'],
        expectError: true,
      });

      runner.assertFailure(result, 1);
      runner.assertOutputContains(result, 'Command is required', true);
    });

    it('should require URL for HTTP servers', async () => {
      const result = await runner.runMcpCommand('add', {
        args: ['no-url-server', '--type', 'http'],
        expectError: true,
      });

      runner.assertFailure(result, 1);
      runner.assertOutputContains(result, 'URL is required', true);
    });

    it('should validate server name format', async () => {
      const result = await runner.runMcpCommand('add', {
        args: ['invalid name with spaces', '--type', 'stdio', '--command', 'echo'],
        expectError: true,
      });

      runner.assertFailure(result, 1);
      runner.assertOutputContains(result, 'Server name can only contain', true);
    });

    it('should validate URL format for HTTP servers', async () => {
      const result = await runner.runMcpCommand('add', {
        args: ['invalid-url-server', '--type', 'http', '--url', 'not-a-valid-url'],
        expectError: true,
      });

      runner.assertFailure(result, 1);
      runner.assertOutputContains(result, 'Invalid URL', true);
    });

    it('should handle numeric timeout values', async () => {
      const result = await runner.runMcpCommand('add', {
        args: ['timeout-server-numeric', '--type', 'stdio', '--command', 'echo', '--timeout', '5000'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, '✅ Successfully added server');
    });
  });

  describe('Configuration Persistence', () => {
    it('should persist server configuration to file', async () => {
      await runner.runMcpCommand('add', {
        args: ['persistent-server', '--type', 'stdio', '--command', 'node', '--args', 'server.js', '--tags', 'test'],
      });

      // Read the config file directly
      const configContent = await readFile(environment.getConfigPath(), 'utf-8');
      const config = JSON.parse(configContent);

      expect(config.mcpServers['persistent-server']).toBeDefined();
      expect(config.mcpServers['persistent-server'].command).toBe('node');
      expect(config.mcpServers['persistent-server'].args).toContain('server.js');
      expect(config.mcpServers['persistent-server'].tags).toContain('test');
    });

    it('should maintain existing servers when adding new ones', async () => {
      // Get initial server count
      const initialList = await runner.runMcpCommand('list');
      const initialServers = (initialList.stdout.match(/🟢/g) || []).length;

      // Add a new server
      await runner.runMcpCommand('add', {
        args: ['additional-server', '--type', 'stdio', '--command', 'echo', '--args', 'test'],
      });

      // Verify all servers are still present
      const finalList = await runner.runMcpCommand('list');
      const finalServers = (finalList.stdout.match(/🟢/g) || []).length;

      expect(finalServers).toBe(initialServers + 1);
      runner.assertOutputContains(finalList, 'additional-server');
      runner.assertOutputContains(finalList, 'echo-server'); // Original server should still be there
    });
  });

  describe('Help and Usage', () => {
    it('should show help when requested', async () => {
      const result = await runner.runMcpCommand('add', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Add a new MCP server');
      runner.assertOutputContains(result, 'Add a new MCP server');
    });

    it('should show available options in help', async () => {
      const result = await runner.runMcpCommand('add', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, '--command');
      runner.assertOutputContains(result, '--type');
      runner.assertOutputContains(result, '--url');
      runner.assertOutputContains(result, '--tags');
    });
  });

  describe('Double Hyphen Pattern', () => {
    it('should add server using " -- " pattern with npx', async () => {
      const result = await runner.runMcpCommand('add', {
        args: ['double-hyphen-server', '--env', 'TEST_KEY=value', '--', 'npx', '-y', 'test-package'],
      });

      expect(result.exitCode).toBe(0);
      runner.assertOutputContains(result, 'Successfully added server');
      runner.assertOutputContains(result, 'Type: stdio');
      runner.assertOutputContains(result, 'Command: npx');

      const listResult = await runner.runMcpCommand('list', { args: ['--verbose'] });
      runner.assertOutputContains(listResult, 'double-hyphen-server');
      runner.assertOutputContains(listResult, 'npx');
      runner.assertOutputContains(listResult, '-y test-package');
    });

    it('should add server using " -- " pattern with Windows cmd', async () => {
      const result = await runner.runMcpCommand('add', {
        args: ['windows-server', '--', 'cmd', '/c', 'npx', '-y', '@some/package'],
      });

      expect(result.exitCode).toBe(0);
      runner.assertOutputContains(result, 'Successfully added server');
      runner.assertOutputContains(result, 'Type: stdio');
      runner.assertOutputContains(result, 'Command: cmd');

      const listResult = await runner.runMcpCommand('list', { args: ['--verbose'] });
      runner.assertOutputContains(listResult, 'windows-server');
      runner.assertOutputContains(listResult, '/c npx -y @some/package');
    });

    it('should add server with both explicit flags and " -- " pattern (explicit wins)', async () => {
      const result = await runner.runMcpCommand('add', {
        args: ['mixed-server', '--type', 'stdio', '--command', 'explicit-command', '--', 'ignored-command'],
      });

      expect(result.exitCode).toBe(0);
      runner.assertOutputContains(result, 'Successfully added server');
      runner.assertOutputContains(result, 'Command: explicit-command');

      const listResult = await runner.runMcpCommand('list', { args: ['--verbose'] });
      runner.assertOutputContains(listResult, 'mixed-server');
      runner.assertOutputContains(listResult, 'explicit-command');
    });

    it('should handle " -- " pattern with environment variables', async () => {
      const result = await runner.runMcpCommand('add', {
        args: [
          'env-double-hyphen-server',
          '--env',
          'API_KEY=test123',
          '--env',
          'NODE_ENV=development',
          '--tags',
          'test,development',
          '--',
          'node',
          'server.js',
        ],
      });

      expect(result.exitCode).toBe(0);
      runner.assertOutputContains(result, 'Successfully added server');
      runner.assertOutputContains(result, 'Command: node');

      const listResult = await runner.runMcpCommand('list', { args: ['--verbose'] });
      runner.assertOutputContains(listResult, 'env-double-hyphen-server');
      runner.assertOutputContains(listResult, 'test, development');
    });

    it('should fail when " -- " is used without a command', async () => {
      const result = await runner.runMcpCommand('add', {
        args: ['no-command-server', '--'],
        expectError: true,
      });

      expect(result.exitCode).toBe(1);
      runner.assertOutputContains(result, 'No command specified after " -- "', true); // Check stderr
    });

    it('should fail when neither --type nor " -- " pattern is provided', async () => {
      const result = await runner.runMcpCommand('add', {
        args: ['no-type-server'],
        expectError: true,
      });

      expect(result.exitCode).toBe(1);
      runner.assertOutputContains(
        result,
        'Server type must be specified with --type or inferred from " -- " pattern',
        true,
      ); // Check stderr
    });
  });
});
