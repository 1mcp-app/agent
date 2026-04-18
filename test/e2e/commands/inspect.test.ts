import { CliTestRunner, CommandTestEnvironment } from '@test/e2e/utils/index.js';

import { type ChildProcess, spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const supportsLoopbackListen = await canBindLoopback();
const describeInspectE2E = supportsLoopbackListen ? describe : describe.skip;

describeInspectE2E('inspect command E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;
  let serveProcess: ChildProcess | undefined;
  let servePort: number;

  beforeEach(async () => {
    environment = new CommandTestEnvironment({
      name: 'inspect-command',
      createConfigFile: true,
      mockMcpServers: [
        {
          name: 'runner',
          command: 'node',
          args: [join(process.cwd(), 'test/e2e/fixtures/run-tool-server.js')],
          tags: ['test', 'run'],
          type: 'stdio',
        },
      ],
    });
    await environment.setup();
    runner = new CliTestRunner(environment);
    servePort = await getAvailablePort();
  });

  afterEach(async () => {
    await stopServeProcess();
    await environment.cleanup();
  });

  it('prints a readable schema summary by default', async () => {
    await startServeProcess();

    const result = await runner.runInspectCommand('runner/echo_args', { args: getCliSessionCacheArgs() });

    runner.assertSuccess(result);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('kind: tool');
    expect(result.stdout).toContain('qualifiedName: runner_1mcp_echo_args');
    expect(result.stdout).toContain('requiredArgs[1]');
    expect(result.stdout).toContain('message,true,string,Message to echo back.');
    expect(result.stdout).toContain('optionalArgs[3]');
    expect(result.stdout).toContain('outputSchema:');
    expect(result.stdout).toContain('echoed:');
    expect(result.stdout).toContain('enumValues[2]: plain,json');
    expect(result.stdout).toContain('defaultValue: plain');
  });

  it('lists a server tool inventory for bare server targets', async () => {
    await startServeProcess();

    const result = await runner.runInspectCommand('runner', { args: getCliSessionCacheArgs() });

    runner.assertSuccess(result);
    expect(result.stdout).toContain('kind: server');
    expect(result.stdout).toContain('server: runner');
    expect(result.stdout).toContain('totalTools: 4');
    expect(result.stdout).toContain('echo_args,runner_1mcp_echo_args');
    expect(result.stdout).toContain('summarize,runner_1mcp_summarize');
  });

  it('prints normalized json with --format json', async () => {
    await startServeProcess();

    const result = await runner.runInspectCommand('runner/echo_args', {
      args: [...getCliSessionCacheArgs(), '--format', 'json'],
    });

    runner.assertSuccess(result);
    const parsed = JSON.parse(result.stdout) as {
      server: string;
      tool: string;
      requiredArgs: Array<{ name: string }>;
      optionalArgs: Array<{ name: string }>;
    };

    expect(parsed.server).toBe('runner');
    expect(parsed.tool).toBe('echo_args');
    expect(parsed.requiredArgs.map((arg) => arg.name)).toEqual(['message']);
    expect(parsed.optionalArgs.map((arg) => arg.name)).toContain('mode');
  });

  it('prints normalized server json for bare server targets', async () => {
    await startServeProcess();

    const result = await runner.runInspectCommand('runner', {
      args: [...getCliSessionCacheArgs(), '--format', 'json'],
    });

    runner.assertSuccess(result);
    const parsed = JSON.parse(result.stdout) as {
      kind: string;
      server: string;
      tools: Array<{ tool: string }>;
    };

    expect(parsed.kind).toBe('server');
    expect(parsed.server).toBe('runner');
    expect(parsed.tools.map((tool) => tool.tool)).toContain('echo_args');
    expect(parsed.tools.map((tool) => tool.tool)).toContain('summarize');
  });

  it('reports unknown tools cleanly', async () => {
    await startServeProcess();

    const result = await runner.runInspectCommand('runner/missing_tool', { args: getCliSessionCacheArgs() });

    runner.assertFailure(result, 1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Tool not found');
  });

  it('works when --tags filter is passed (no URL validation regression)', async () => {
    await startServeProcess();

    const result = await runner.runInspectCommand('runner/echo_args', {
      args: [...getCliSessionCacheArgs(), '--tags', 'test'],
    });

    runner.assertSuccess(result);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('runner_1mcp_echo_args');
  });

  it('retries with a fresh session when the cache is stale', async () => {
    await startServeProcess();

    const first = await runner.runInspectCommand('runner/echo_args', {
      args: [...getCliSessionCacheArgs(), '--format', 'json'],
    });
    runner.assertSuccess(first);

    const cachePath = getExpectedCachePath();
    const cache = JSON.parse(await readFile(cachePath, 'utf8')) as {
      sessionId: string;
      serverUrl: string;
      savedAt: number;
      hasRestEndpoint?: boolean;
    };
    cache.sessionId = 'stale-session';
    await writeFile(cachePath, JSON.stringify(cache), 'utf8');

    const second = await runner.runInspectCommand('runner/echo_args', {
      args: [...getCliSessionCacheArgs(), '--format', 'json'],
    });
    runner.assertSuccess(second);
  });

  it('shows CLI instructions and keeps bare inspect as the server list entrypoint', async () => {
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

    const templateConfig = {
      templateSettings: {
        cacheContext: true,
      },
      mcpServers: {
        runner: {
          transport: 'stdio',
          command: 'node',
          args: [join(process.cwd(), 'test/e2e/fixtures/run-tool-server.js')],
          tags: ['test', 'run'],
        },
      },
      mcpTemplates: {
        serena: {
          transport: 'stdio',
          command: 'node',
          args: [join(process.cwd(), 'test/e2e/fixtures/inspect-template-server.js'), '{{project.path}}'],
          tags: ['serena'],
          template: {
            shareable: true,
          },
        },
      },
    };
    await writeFile(environment.getConfigPath(), JSON.stringify(templateConfig, null, 2), 'utf8');

    await startServeProcess();

    const instructionsResult = await runner.runCommand('instructions', '', {
      cwd: environment.getTempDir(),
      args: ['--config-dir', environment.getConfigDir()],
    });

    runner.assertSuccess(instructionsResult);
    expect(instructionsResult.stdout).toContain('1MCP CLI Instructions');
    expect(instructionsResult.stdout).toContain('Run `1mcp inspect <server>`');
    expect(instructionsResult.stdout).toContain('=== SERVER SUMMARY ===');
    expect(instructionsResult.stdout).toContain('<server_summary name="serena">');
    expect(instructionsResult.stdout).toContain('type: template');
    expect(instructionsResult.stdout).toContain('<server_instructions name="serena">');
    expect(instructionsResult.stdout).toContain('# Serena Instructions');
    expect(instructionsResult.stdout).toContain('Use Serena for semantic code navigation and editing.');

    const listResult = await runner.runCommand('inspect', '', {
      cwd: environment.getTempDir(),
      args: ['--config-dir', environment.getConfigDir()],
    });

    runner.assertSuccess(listResult);
    expect(listResult.stdout).toContain('kind: servers');
    expect(listResult.stdout).toContain('servers[2]{server,type,status,available,toolCount,hasInstructions}:');
    expect(listResult.stdout).toContain('serena,template,disconnected,false,0,true');
    expect(listResult.stdout).not.toContain('# 1MCP - Model Context Protocol Proxy');

    const serverResult = await runner.runInspectCommand('serena', {
      cwd: environment.getTempDir(),
      args: getCliSessionCacheArgs(),
    });

    runner.assertSuccess(serverResult);
    expect(serverResult.stdout).toContain('kind: server');
    expect(serverResult.stdout).toContain('server: serena');
    expect(serverResult.stdout).not.toContain('instructions:');
    expect(serverResult.stdout).not.toContain('# Serena Instructions');
    expect(serverResult.stdout).not.toContain('# 1MCP - Model Context Protocol Proxy');
    expect(serverResult.stdout).toContain('find_symbol,serena_1mcp_find_symbol');
  });

  async function startServeProcess(): Promise<void> {
    if (serveProcess) {
      return;
    }

    serveProcess = spawn(
      'node',
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
        '--no-enable-config-reload',
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

    let stderr = '';
    serveProcess.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    serveProcess.on('exit', (code) => {
      if (code !== null && code !== 0) {
        stderr += `\nserve exited with code ${code}`;
      }
    });

    await waitForServeReady(stderr);
  }

  function getExpectedCachePath(): string {
    return join(environment.getTempDir(), 'cli-session-cache');
  }

  function getCliSessionCacheArgs(): string[] {
    return ['--cli-session-cache-path', getExpectedCachePath()];
  }

  async function waitForServeReady(initialStderr: string): Promise<void> {
    const pidPath = join(environment.getConfigDir(), 'server.pid');
    const deadline = Date.now() + 15000;
    let lastError = initialStderr;

    while (Date.now() < deadline) {
      try {
        const raw = await readFile(pidPath, 'utf8');
        const serverInfo = JSON.parse(raw) as { url: string };
        const healthUrl = `http://127.0.0.1:${servePort}/oauth/`;
        expect(serverInfo.url).toBe(`http://127.0.0.1:${servePort}/mcp`);
        const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1000) });
        if (response.ok) {
          return;
        }
        lastError = `HTTP ${response.status} from ${healthUrl}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error(`Timed out waiting for 1mcp serve to become ready. Last error: ${lastError}`);
  }

  async function stopServeProcess(): Promise<void> {
    if (!serveProcess) {
      return;
    }

    const currentProcess = serveProcess;
    serveProcess = undefined;

    await new Promise<void>((resolve) => {
      if (currentProcess.exitCode !== null || currentProcess.signalCode !== null) {
        resolve();
        return;
      }

      currentProcess.once('exit', () => resolve());
      currentProcess.kill('SIGTERM');
    });
  }
});

async function canBindLoopback(): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();

    server.once('error', () => {
      resolve(false);
    });

    server.listen(0, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate loopback port.')));
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
  });
}
