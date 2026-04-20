import { CliTestRunner, CommandTestEnvironment } from '@test/e2e/utils/index.js';

import { type ChildProcess, spawn } from 'node:child_process';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const supportsLoopbackListen = await canBindLoopback();
const describeRunE2E = supportsLoopbackListen ? describe : describe.skip;

describeRunE2E('run command E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;
  let serveProcess: ChildProcess | undefined;
  let servePort: number;

  beforeEach(async () => {
    environment = new CommandTestEnvironment({
      name: 'run-command',
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

  it('runs a tool with explicit JSON args and keeps stderr clean', async () => {
    await startServeProcess();

    const result = await runner.runRunCommand('runner/echo_args', {
      args: [...getCliSessionCacheArgs(), '--args', '{"message":"hello","count":2}', '--format', 'json'],
    });

    runner.assertSuccess(result);
    expect(result.stderr).toBe('');

    const output = runner.parseJsonOutput<{ echoed: string; count: number }>(result);

    expect(output.echoed).toContain('"message": "hello"');
    expect(output.echoed).toContain('"count": 2');
    expect(output.count).toBe(2);
  });

  it('maps JSON stdin directly to tool arguments', async () => {
    await startServeProcess();

    const result = await runner.runRunCommand('runner/echo_args', {
      input: '{"message":"stdin","payload":{"ok":true}}',
      args: [...getCliSessionCacheArgs(), '--format', 'text'],
    });

    runner.assertSuccess(result);
    expect(result.stdout).toContain('"message": "stdin"');
    expect(result.stdout).toContain('"ok": true');
  });

  it('maps raw stdin into the first required string argument', async () => {
    await startServeProcess();

    const result = await runner.runRunCommand('runner/summarize', {
      input: 'hello world',
      args: [...getCliSessionCacheArgs(), '--format', 'text'],
    });

    runner.assertSuccess(result);
    expect(result.stdout).toBe('summary(2w): hello world');
  });

  it('supports chaining output between successive run invocations', async () => {
    await startServeProcess();

    const first = await runner.runRunCommand('runner/emit_text', {
      input: 'hello chained world',
      args: [...getCliSessionCacheArgs(), '--format', 'text'],
    });
    runner.assertSuccess(first);

    const second = await runner.runRunCommand('runner/summarize', {
      input: first.stdout,
      args: [...getCliSessionCacheArgs(), '--format', 'text'],
    });

    runner.assertSuccess(second);
    expect(second.stdout).toBe('summary(3w): hello chained world');
  });

  it('persists a cli session cache file after the first successful call', async () => {
    await startServeProcess();

    const first = await runner.runRunCommand('runner/echo_args', {
      args: [...getCliSessionCacheArgs(), '--args', '{"message":"cache me"}', '--format', 'text'],
    });
    runner.assertSuccess(first);

    const cachePath = getExpectedCachePath();
    await access(cachePath);

    const cache = JSON.parse(await readFile(cachePath, 'utf8')) as {
      sessionId: string;
      serverUrl: string;
      savedAt: number;
    };

    expect(cache.sessionId.length).toBeGreaterThan(0);
    expect(cache.serverUrl).toContain('/mcp');
    expect(cache.savedAt).toBeGreaterThan(0);

    const second = await runner.runRunCommand('runner/echo_args', {
      args: [...getCliSessionCacheArgs(), '--args', '{"message":"cache me again"}', '--format', 'text'],
    });
    runner.assertSuccess(second);
  });

  it('returns tool errors on stderr with exit code 2', async () => {
    await startServeProcess();

    const result = await runner.runRunCommand('runner/fail_tool', {
      args: [...getCliSessionCacheArgs(), '--args', '{"message":"boom"}', '--format', 'text'],
    });

    runner.assertFailure(result, 2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('tool failed: boom');
  });

  it('fails cleanly when no serve instance is running', async () => {
    const unusedPort = await getAvailablePort();

    const result = await runner.runRunCommand('runner/echo_args', {
      args: [
        ...getCliSessionCacheArgs(),
        '--url',
        `http://127.0.0.1:${unusedPort}/mcp`,
        '--args',
        '{"message":"hello"}',
        '--format',
        'text',
      ],
    });

    runner.assertFailure(result, 1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Cannot connect');
  });

  it('writes a session cache with hasRestEndpoint field after first run', async () => {
    await startServeProcess();

    const result = await runner.runRunCommand('runner/echo_args', {
      args: [...getCliSessionCacheArgs(), '--args', '{"message":"cache-check"}', '--format', 'text'],
    });
    runner.assertSuccess(result);

    const cachePath = getExpectedCachePath();
    const cache = JSON.parse(await readFile(cachePath, 'utf8')) as { hasRestEndpoint?: boolean };
    // hasRestEndpoint is always written (true when REST works, false when MCP fallback)
    expect(typeof cache.hasRestEndpoint).toBe('boolean');
  });

  it('produces consistent output across successive invocations', async () => {
    await startServeProcess();

    const first = await runner.runRunCommand('runner/echo_args', {
      args: [...getCliSessionCacheArgs(), '--args', '{"message":"consistent"}', '--format', 'text'],
    });
    runner.assertSuccess(first);

    const second = await runner.runRunCommand('runner/echo_args', {
      args: [...getCliSessionCacheArgs(), '--args', '{"message":"consistent"}', '--format', 'text'],
    });
    runner.assertSuccess(second);

    expect(first.stdout).toBe(second.stdout);
  });

  it('runs tools for shareable template servers resolved by logical server name', async () => {
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

    const inspectResult = await runner.runInspectCommand('serena', {
      cwd: environment.getTempDir(),
      timeout: 20000,
      args: getCliSessionCacheArgs(),
    });
    runner.assertSuccess(inspectResult);
    expect(inspectResult.stdout).toContain('server: serena');
    expect(inspectResult.stdout).toContain('find_symbol,serena_1mcp_find_symbol');

    const runResult = await runner.runRunCommand('serena/find_symbol', {
      cwd: environment.getTempDir(),
      timeout: 20000,
      args: [...getCliSessionCacheArgs(), '--args', '{"name_path_pattern":"TestSymbol"}', '--format', 'text'],
    });

    runner.assertSuccess(runResult);
    expect(runResult.stdout).toContain('TestSymbol');
  });

  async function startServeProcess(): Promise<void> {
    if (serveProcess) {
      return;
    }

    let lastError = 'unknown startup failure';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      servePort = await getAvailablePort();
      const stderr = await spawnServeProcess();

      try {
        await waitForServeReady(stderr);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (!lastError.includes('EADDRINUSE') || attempt === 2) {
          throw error;
        }
        await stopServeProcess();
      }
    }

    throw new Error(lastError);
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

      setTimeout(() => {
        currentProcess.kill('SIGKILL');
      }, 5000).unref();
    });

    await rm(join(environment.getConfigDir(), 'server.pid'), { force: true });
  }

  async function spawnServeProcess(): Promise<string> {
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
      if (serveProcess?.pid === undefined || serveProcess.pid === currentPid) {
        serveProcess = undefined;
      }
      if (code !== null && code !== 0) {
        stderr += `\nserve exited with code ${code}`;
      }
    });

    const currentPid = serveProcess.pid;
    return stderr;
  }

  async function getAvailablePort(): Promise<number> {
    return await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Failed to allocate an available port.'));
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
});

async function canBindLoopback(): Promise<boolean> {
  try {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    return true;
  } catch {
    return false;
  }
}
