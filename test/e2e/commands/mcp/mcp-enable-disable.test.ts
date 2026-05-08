import { TestFixtures } from '@test/e2e/fixtures/TestFixtures.js';
import { CliTestRunner, CommandTestEnvironment } from '@test/e2e/utils/index.js';

import { type ChildProcess, spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('MCP Enable/Disable Commands E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;
  let serveProcess: ChildProcess | undefined;
  let servePort: number;
  let serveStderr = '';

  async function runMcpToolsCommand(args: string[], expectError: boolean = false) {
    return runner.runCommand('mcp', 'tools', {
      args: [...args, '--config', environment.getConfigPath()],
      expectError,
    });
  }

  async function runInteractiveMcpToolsCommand(args: string[]) {
    const startTime = Date.now();
    const timeout = 8000;

    return await new Promise<{
      exitCode: number;
      stdout: string;
      stderr: string;
      duration: number;
      error?: Error;
    }>((resolve) => {
      const child = spawn(
        process.execPath,
        [join(process.cwd(), 'test/e2e/fixtures/tty-cli-wrapper.js'), 'build/index.js', 'mcp', 'tools', ...args],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            ...environment.getEnvironmentVariables(),
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );

      let stdout = '';
      let stderr = '';
      let resolved = false;

      const timeoutHandle = setTimeout(() => {
        if (resolved) {
          return;
        }

        resolved = true;
        child.kill('SIGTERM');
        resolve({
          exitCode: -1,
          stdout,
          stderr,
          error: new Error(`Command timed out after ${timeout}ms`),
          duration: Date.now() - startTime,
        });
      }, timeout);

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('spawn', () => {
        setTimeout(() => {
          child.stdin?.write(' \r');
          child.stdin?.end();
        }, 400);
      });

      child.on('exit', (code, signal) => {
        if (resolved) {
          return;
        }

        resolved = true;
        clearTimeout(timeoutHandle);
        resolve({
          exitCode: code !== null ? code : signal === 'SIGTERM' ? -1 : -2,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          duration: Date.now() - startTime,
        });
      });

      child.on('error', (error) => {
        if (resolved) {
          return;
        }

        resolved = true;
        clearTimeout(timeoutHandle);
        resolve({
          exitCode: -1,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          error,
          duration: Date.now() - startTime,
        });
      });
    });
  }

  beforeEach(async () => {
    environment = new CommandTestEnvironment(TestFixtures.createTestScenario('mcp-enable-disable-test', 'mixed'));
    await environment.setup();
    await writeFile(join(environment.getTempDir(), '.1mcprc'), '{}', 'utf8');
    runner = new CliTestRunner(environment);
    servePort = await getAvailablePort();
    serveStderr = '';
  });

  afterEach(async () => {
    await stopServeProcess();
    await environment.cleanup();
  });

  describe('Enable Command', () => {
    it('should enable a disabled server', async () => {
      // First verify the server is disabled
      const initialStatus = await runner.runMcpCommand('list', { args: ['--show-disabled'] });
      runner.assertOutputContains(initialStatus, 'disabled-server');
      runner.assertOutputContains(initialStatus, '🔴'); // Disabled icon

      // Enable the server
      const result = await runner.runMcpCommand('enable', {
        args: ['disabled-server'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, '✅ Successfully enabled server');
      runner.assertOutputContains(result, 'disabled-server');

      // Verify the server is now enabled
      const finalStatus = await runner.runMcpCommand('list');
      runner.assertOutputContains(finalStatus, 'disabled-server');
      runner.assertOutputContains(finalStatus, '🟢'); // Enabled icon
    });

    it('should handle enabling an already enabled server', async () => {
      const result = await runner.runMcpCommand('enable', {
        args: ['echo-server'], // This server should already be enabled
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'is already enabled');
    });

    it('should handle non-existent server', async () => {
      const result = await runner.runMcpCommand('enable', {
        args: ['nonexistent-server'],
        expectError: true,
      });

      runner.assertFailure(result, 1);
      runner.assertOutputContains(result, 'does not exist', true);
    });

    it('should enable multiple servers', async () => {
      // First add another disabled server
      await runner.runMcpCommand('add', {
        args: ['another-disabled', '--type', 'stdio', '--command', 'echo', '--args', 'test', '--disabled'],
      });

      // Enable first server
      const result1 = await runner.runMcpCommand('enable', {
        args: ['disabled-server'],
      });

      // Enable second server
      const result2 = await runner.runMcpCommand('enable', {
        args: ['another-disabled'],
      });

      runner.assertSuccess(result1);
      runner.assertSuccess(result2);
      runner.assertOutputContains(result1, '✅ Successfully enabled server');
      runner.assertOutputContains(result2, '✅ Successfully enabled server');

      // Verify both servers are enabled
      const listResult = await runner.runMcpCommand('list');
      runner.assertOutputContains(listResult, 'disabled-server');
      runner.assertOutputContains(listResult, 'another-disabled');
    });
  });

  describe('Disable Command', () => {
    it('should disable an enabled server', async () => {
      // Verify the server is initially enabled
      const initialStatus = await runner.runMcpCommand('list');
      runner.assertOutputContains(initialStatus, 'echo-server');
      runner.assertOutputContains(initialStatus, '🟢'); // Enabled icon

      // Disable the server
      const result = await runner.runMcpCommand('disable', {
        args: ['echo-server'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, '✅ Successfully disabled server');
      runner.assertOutputContains(result, 'echo-server');

      // Verify the server is now disabled (not shown in default list)
      const finalStatus = await runner.runMcpCommand('list');
      expect(finalStatus.stdout).not.toContain('echo-server');

      // But should be shown with --show-disabled
      const disabledStatus = await runner.runMcpCommand('list', { args: ['--show-disabled'] });
      runner.assertOutputContains(disabledStatus, 'echo-server');
      runner.assertOutputContains(disabledStatus, '🔴'); // Disabled icon
    });

    it('should handle disabling an already disabled server', async () => {
      const result = await runner.runMcpCommand('disable', {
        args: ['disabled-server'], // This server should already be disabled
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'is already disabled');
    });

    it('should handle non-existent server', async () => {
      const result = await runner.runMcpCommand('disable', {
        args: ['nonexistent-server'],
        expectError: true,
      });

      runner.assertFailure(result, 1);
      runner.assertOutputContains(result, 'does not exist', true);
    });

    it('should disable multiple servers', async () => {
      // Add another enabled server first
      await runner.runMcpCommand('add', {
        args: ['another-enabled', '--type', 'stdio', '--command', 'echo', '--args', 'test'],
      });

      // Disable first server
      const result1 = await runner.runMcpCommand('disable', {
        args: ['echo-server'],
      });

      // Disable second server
      const result2 = await runner.runMcpCommand('disable', {
        args: ['another-enabled'],
      });

      runner.assertSuccess(result1);
      runner.assertSuccess(result2);
      runner.assertOutputContains(result1, '✅ Successfully disabled server');
      runner.assertOutputContains(result2, '✅ Successfully disabled server');

      // Verify both servers are disabled
      const listResult = await runner.runMcpCommand('list');
      expect(listResult.stdout).not.toContain('echo-server');
      expect(listResult.stdout).not.toContain('another-enabled');
    });
  });

  describe('State Persistence', () => {
    it('should persist enable state to configuration', async () => {
      // Enable a disabled server
      await runner.runMcpCommand('enable', { args: ['disabled-server'] });

      // Verify persistence by checking config file
      const fs = await import('fs/promises');
      const configContent = await fs.readFile(environment.getConfigPath(), 'utf-8');
      const config = JSON.parse(configContent);

      expect(config.mcpServers['disabled-server']).toBeDefined();
      expect(config.mcpServers['disabled-server'].disabled).toBeFalsy();
    });

    it('should persist disable state to configuration', async () => {
      // Disable an enabled server
      await runner.runMcpCommand('disable', { args: ['echo-server'] });

      // Verify persistence by checking config file
      const fs = await import('fs/promises');
      const configContent = await fs.readFile(environment.getConfigPath(), 'utf-8');
      const config = JSON.parse(configContent);

      expect(config.mcpServers['echo-server']).toBeDefined();
      expect(config.mcpServers['echo-server'].disabled).toBe(true);
    });

    it('should maintain server configuration when changing state', async () => {
      // Get initial server configuration
      const initialList = await runner.runMcpCommand('list', { args: ['--verbose'] });
      const initialTags = initialList.stdout.match(/Tags: ([^\n]+)/)?.[1];

      // Disable and re-enable server
      await runner.runMcpCommand('disable', { args: ['echo-server'] });
      await runner.runMcpCommand('enable', { args: ['echo-server'] });

      // Verify configuration is maintained
      const finalList = await runner.runMcpCommand('list', { args: ['--verbose'] });
      if (initialTags) {
        runner.assertOutputContains(finalList, initialTags);
      }
      runner.assertOutputContains(finalList, 'Command: echo');
    });
  });

  describe('Tool-level disable commands', () => {
    it('should fail fast for bare interactive tools command in non-TTY environments', async () => {
      const result = await runMcpToolsCommand([], true);

      runner.assertFailure(result, 1);
      runner.assertOutputContains(result, 'Interactive mode requires a TTY', true);
    });

    it('should exit on its own after saving interactive tool selection', async () => {
      await environment.updateConfig({
        servers: [
          {
            name: 'runner',
            command: 'node',
            args: [join(process.cwd(), 'test/e2e/fixtures/run-tool-server.js')],
            tags: ['test', 'run'],
            type: 'stdio',
          },
        ],
      });

      const result = await runInteractiveMcpToolsCommand([
        '--server',
        'runner',
        '--config',
        environment.getConfigPath(),
        '--config-dir',
        environment.getConfigDir(),
      ]);

      runner.assertSuccess(result);
      runner.assertOutputContains(result, "Saved tool selection for server 'runner'");

      const config = JSON.parse(await readFile(environment.getConfigPath(), 'utf8')) as {
        mcpServers?: Record<string, { disabledTools?: string[] }>;
      };
      expect(config.mcpServers?.runner?.disabledTools).toEqual(['echo_args']);
    });

    it('should disable a tool in config and list it', async () => {
      const disableResult = await runMcpToolsCommand(['disable', 'echo-server', 'write_file']);

      runner.assertSuccess(disableResult);
      runner.assertOutputContains(disableResult, "Successfully disabled tool 'write_file' on server 'echo-server'");
      runner.assertOutputContains(disableResult, 'mcp tools list echo-server --disabled');

      const listResult = await runMcpToolsCommand(['list', 'echo-server', '--disabled']);

      runner.assertSuccess(listResult);
      runner.assertOutputContains(listResult, 'Disabled tools');
      runner.assertOutputContains(listResult, 'write_file');
    });

    it('should enable a previously disabled tool in config', async () => {
      await runMcpToolsCommand(['disable', 'echo-server', 'write_file']);

      const enableResult = await runMcpToolsCommand(['enable', 'echo-server', 'write_file']);

      runner.assertSuccess(enableResult);
      runner.assertOutputContains(enableResult, "Successfully enabled tool 'write_file' on server 'echo-server'");

      const listResult = await runMcpToolsCommand(['list', 'echo-server', '--disabled']);
      runner.assertSuccess(listResult);
      expect(listResult.stdout).not.toContain('write_file');
      runner.assertOutputContains(listResult, 'No disabled tools configured.');
    });

    it('should persist disabledTools to configuration', async () => {
      await runMcpToolsCommand(['disable', 'echo-server', 'write_file']);

      const fs = await import('fs/promises');
      const configContent = await fs.readFile(environment.getConfigPath(), 'utf-8');
      const config = JSON.parse(configContent);

      expect(config.mcpServers['echo-server'].disabledTools).toEqual(['write_file']);
    });

    it('should let serve hot reload tool disable and enable changes', async () => {
      await environment.updateConfig({
        servers: [
          {
            name: 'runner',
            command: 'node',
            args: [join(process.cwd(), 'test/e2e/fixtures/run-tool-server.js')],
            tags: ['test', 'run'],
            type: 'stdio',
          },
        ],
      });

      const disableResult = await runMcpToolsCommand(['disable', 'runner', 'echo_args']);
      runner.assertSuccess(disableResult);
      await mirrorRunnerDisabledTools('echo_args');

      await startServeProcess();
      await waitForInspectState('disabled');

      const disabledInspect = await runner.runInspectCommand('runner/echo_args', {
        cwd: environment.getTempDir(),
        args: ['--url', `http://127.0.0.1:${servePort}/mcp`, '--config-dir', environment.getConfigDir()],
      });
      runner.assertFailure(disabledInspect, 1);
      runner.assertOutputContains(disabledInspect, 'Tool is disabled: runner:echo_args', true);

      const enableResult = await runMcpToolsCommand(['enable', 'runner', 'echo_args']);
      runner.assertSuccess(enableResult);
      await mirrorRunnerDisabledTools();

      await waitForInspectState('enabled');

      const enabledInspect = await runner.runInspectCommand('runner/echo_args', {
        cwd: environment.getTempDir(),
        args: ['--url', `http://127.0.0.1:${servePort}/mcp`, '--config-dir', environment.getConfigDir()],
      });
      runner.assertSuccess(enabledInspect);
      runner.assertOutputContains(enabledInspect, 'qualifiedName: runner_1mcp_echo_args');
    });
  });

  describe('Batch Operations', () => {
    it('should handle mixed enable/disable operations gracefully', async () => {
      // Try to enable an enabled server and disable a disabled server
      const enableResult = await runner.runMcpCommand('enable', {
        args: ['echo-server'], // Already enabled
      });

      const disableResult = await runner.runMcpCommand('disable', {
        args: ['disabled-server'], // Already disabled
      });

      runner.assertSuccess(enableResult);
      runner.assertSuccess(disableResult);
      runner.assertOutputContains(enableResult, 'already enabled');
      runner.assertOutputContains(disableResult, 'already disabled');
    });

    it('should provide clear feedback for batch operations', async () => {
      // Add a few servers for testing
      await runner.runMcpCommand('add', {
        args: ['batch-test-1', '--type', 'stdio', '--command', 'echo', '--args', 'test1'],
      });
      await runner.runMcpCommand('add', {
        args: ['batch-test-2', '--type', 'stdio', '--command', 'echo', '--args', 'test2', '--disabled'],
      });

      // Test enable one server
      const enableResult = await runner.runMcpCommand('enable', {
        args: ['batch-test-2'],
      });

      runner.assertSuccess(enableResult);
      runner.assertOutputContains(enableResult, 'batch-test-2');
    });
  });

  describe('Error Scenarios', () => {
    it('should handle invalid config file', async () => {
      const result = await runner.runMcpCommand('enable', {
        args: ['echo-server', '--config', '/nonexistent/config.json'],
        expectError: true,
      });

      runner.assertFailure(result, 1);
      runner.assertOutputContains(result, 'Failed to enable server', true);
    });

    it('should validate server name arguments', async () => {
      const result = await runner.runMcpCommand('enable', {
        args: [], // Missing server name
        expectError: true,
      });

      runner.assertFailure(result, 1);
      runner.assertOutputContains(result, 'Not enough non-option arguments', true);
    });

    it('should handle partial failures in batch operations', async () => {
      const result = await runner.runMcpCommand('enable', {
        args: ['nonexistent-server'],
        expectError: true,
      });

      // Should fail due to nonexistent server
      runner.assertFailure(result, 1);
      runner.assertOutputContains(result, 'does not exist', true);
    });
  });

  describe('Help and Usage', () => {
    it('should show help for enable command', async () => {
      const result = await runner.runMcpCommand('enable', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Enable a disabled MCP server');
    });

    it('should show help for disable command', async () => {
      const result = await runner.runMcpCommand('disable', {
        args: ['--help'],
      });

      runner.assertSuccess(result);
      runner.assertOutputContains(result, 'Disable an MCP server');
    });
  });

  describe('Integration with List Command', () => {
    it('should show correct counts after enable/disable operations', async () => {
      // Get initial counts
      const initial = await runner.runMcpCommand('list', { args: ['--show-disabled'] });
      const initialEnabled = (initial.stdout.match(/🟢/g) || []).length;
      const initialDisabled = (initial.stdout.match(/🔴/g) || []).length;

      // Disable an enabled server
      await runner.runMcpCommand('disable', { args: ['echo-server'] });

      // Check new counts
      const afterDisable = await runner.runMcpCommand('list', { args: ['--show-disabled'] });
      const afterDisableEnabled = (afterDisable.stdout.match(/🟢/g) || []).length;
      const afterDisableDisabled = (afterDisable.stdout.match(/🔴/g) || []).length;

      expect(afterDisableEnabled).toBe(initialEnabled - 1);
      expect(afterDisableDisabled).toBe(initialDisabled + 1);

      // Enable the server back
      await runner.runMcpCommand('enable', { args: ['echo-server'] });

      // Check counts are back to initial
      const final = await runner.runMcpCommand('list', { args: ['--show-disabled'] });
      const finalEnabled = (final.stdout.match(/🟢/g) || []).length;
      const finalDisabled = (final.stdout.match(/🔴/g) || []).length;

      expect(finalEnabled).toBe(initialEnabled);
      expect(finalDisabled).toBe(initialDisabled);
    });
  });

  async function startServeProcess(): Promise<void> {
    if (serveProcess) {
      return;
    }

    servePort = await getAvailablePort();
    serveProcess = spawn(
      process.execPath,
      [
        'build/index.js',
        'serve',
        '--transport',
        'http',
        '--port',
        String(servePort),
        '--config',
        environment.getConfigPath(),
        '--config-dir',
        environment.getConfigDir(),
        '--enable-internal-tools',
        '--log-level',
        'error',
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ...environment.getEnvironmentVariables(),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    serveProcess.stderr?.on('data', (data) => {
      serveStderr += data.toString();
    });

    await waitForServeReady();
  }

  async function stopServeProcess(): Promise<void> {
    if (!serveProcess) {
      return;
    }

    const child = serveProcess;
    serveProcess = undefined;
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      setTimeout(() => resolve(), 3000);
    });
  }

  async function waitForServeReady(): Promise<void> {
    const deadline = Date.now() + 15000;

    while (Date.now() < deadline) {
      if (serveProcess?.exitCode !== null && serveProcess?.exitCode !== undefined) {
        throw new Error(`Serve exited early: ${serveStderr}`);
      }

      try {
        const response = await fetch(`http://127.0.0.1:${servePort}/health`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          return;
        }
      } catch {
        // Retry until deadline.
      }

      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    throw new Error(`Timed out waiting for serve to be ready: ${serveStderr}`);
  }

  async function waitForInspectState(expectedState: 'disabled' | 'enabled'): Promise<void> {
    const deadline = Date.now() + 10000;
    let lastOutput = '';

    while (Date.now() < deadline) {
      const result = await runner.runInspectCommand('runner/echo_args', {
        cwd: environment.getTempDir(),
        args: ['--url', `http://127.0.0.1:${servePort}/mcp`, '--config-dir', environment.getConfigDir()],
      });
      lastOutput = `${result.stdout}\n${result.stderr}`;

      if (
        expectedState === 'disabled' &&
        result.exitCode === 1 &&
        lastOutput.includes('Tool is disabled: runner:echo_args')
      ) {
        return;
      }

      if (
        expectedState === 'enabled' &&
        result.exitCode === 0 &&
        lastOutput.includes('qualifiedName: runner_1mcp_echo_args')
      ) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const configContent = await readFile(environment.getConfigPath(), 'utf8');
    throw new Error(
      `Timed out waiting for inspect ${expectedState}. Last output: ${lastOutput}\nConfig: ${configContent}`,
    );
  }

  async function mirrorRunnerDisabledTools(toolName?: string): Promise<void> {
    const config = JSON.parse(await readFile(environment.getConfigPath(), 'utf8')) as {
      mcpServers?: Record<string, { disabledTools?: string[] }>;
      servers?: Array<{ name: string; disabledTools?: string[] }>;
    };

    const disabledTools = toolName ? [toolName] : undefined;
    if (config.mcpServers?.runner) {
      if (disabledTools) {
        config.mcpServers.runner.disabledTools = disabledTools;
      } else {
        delete config.mcpServers.runner.disabledTools;
      }
    }

    const legacyRunner = config.servers?.find((server) => server.name === 'runner');
    if (legacyRunner) {
      if (disabledTools) {
        legacyRunner.disabledTools = disabledTools;
      } else {
        delete legacyRunner.disabledTools;
      }
    }

    await writeFile(environment.getConfigPath(), JSON.stringify(config, null, 2), 'utf8');
  }

  async function getAvailablePort(): Promise<number> {
    return await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          server.close();
          reject(new Error('Failed to allocate port'));
          return;
        }
        const { port } = address;
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(port);
        });
      });
      server.on('error', reject);
    });
  }
});
