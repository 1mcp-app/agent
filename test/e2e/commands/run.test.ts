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
    await writeFile(join(environment.getTempDir(), '.1mcprc'), '{}', 'utf8');
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

  it('blocks disabled tools before invocation', async () => {
    await disableRunnerTool('echo_args');

    await startServeProcess();

    const result = await runner.runRunCommand('runner/echo_args', {
      args: [...getCliSessionCacheArgs(), '--args', '{"message":"hello"}', '--format', 'text'],
    });

    runner.assertFailure(result, 1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Tool is disabled: runner:echo_args');
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
    expect(result.stderr).toContain('runtime_probe_failed:');
    expect(result.stderr).toContain('Reason: Connection refused (ECONNREFUSED)');
    expect(result.stderr).toContain(
      'Next action: Verify target reachability and configuration, then retry the original command.',
    );
    expect(result.stderr).not.toContain('local_runtime_unavailable');
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

  it('reloads only backends affected by Runtime Scope environment changes', async () => {
    const variable = `ONE_MCP_TEST_RUNTIME_SCOPE_E2E_${process.pid}`;
    const fixture = join(process.cwd(), 'test/e2e/fixtures/inspect-template-server.js');
    const config = {
      mcpServers: {
        affected: { type: 'stdio', command: 'node', args: [fixture, `$${variable}`] },
        unaffected: { type: 'stdio', command: 'node', args: [fixture, 'literal'] },
      },
      mcpTemplates: {
        contextual: {
          type: 'stdio',
          command: 'node',
          args: [fixture, `$${variable}`, '{{project.path}}'],
          template: { shareable: true },
        },
      },
    };
    await writeFile(environment.getConfigPath(), JSON.stringify(config, null, 2), 'utf8');
    await writeFile(join(environment.getConfigDir(), '.env'), `${variable}=first\n`, 'utf8');
    await startServeProcess({ enableConfigReload: true });

    const affectedBefore = await readRuntimeState('affected');
    const unaffectedBefore = await readRuntimeState('unaffected');
    const templateBefore = await readRuntimeState('contextual');
    expect(affectedBefore.runtimeValue).toBe('first');
    expect(unaffectedBefore.runtimeValue).toBe('literal');
    expect(templateBefore.runtimeValue).toBe('first');

    await writeFile(join(environment.getConfigDir(), '.env'), `${variable}=second\n`, 'utf8');

    const affectedAfter = await waitForRuntimeState('affected', 'second', affectedBefore.pid);
    const templateAfter = await waitForRuntimeState('contextual', 'second', templateBefore.pid);
    const unaffectedAfter = await readRuntimeState('unaffected');
    expect(unaffectedAfter).toEqual(unaffectedBefore);
    expect(affectedAfter.pid).not.toBe(affectedBefore.pid);
    expect(templateAfter.pid).not.toBe(templateBefore.pid);
  });

  async function startServeProcess(options: { enableConfigReload?: boolean } = {}): Promise<void> {
    if (serveProcess) {
      return;
    }

    let lastError = 'unknown startup failure';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      servePort = await getAvailablePort();
      const stderr = await spawnServeProcess(options.enableConfigReload);

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

  async function disableRunnerTool(toolName: string): Promise<void> {
    const configPath = environment.getConfigPath();
    const config = JSON.parse(await readFile(configPath, 'utf8')) as {
      mcpServers?: Record<string, { disabledTools?: string[] }>;
      servers?: Array<{ name: string; disabledTools?: string[] }>;
    };

    if (config.mcpServers?.runner) {
      config.mcpServers.runner.disabledTools = [toolName];
    }

    const legacyRunner = config.servers?.find((server) => server.name === 'runner');
    if (legacyRunner) {
      legacyRunner.disabledTools = [toolName];
    }

    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
  }

  function getExpectedCachePath(): string {
    return join(environment.getTempDir(), 'cli-session-cache');
  }

  function getCliSessionCacheArgs(): string[] {
    return ['--cli-session-cache-path', getExpectedCachePath()];
  }

  async function readRuntimeState(serverName: string): Promise<{ runtimeValue: string | null; pid: number }> {
    const result = await runner.runRunCommand(`${serverName}/find_symbol`, {
      cwd: environment.getTempDir(),
      timeout: 20000,
      args: [...getCliSessionCacheArgs(), '--args', '{"name_path_pattern":"RuntimeEnv"}', '--format', 'text'],
    });
    runner.assertSuccess(result);
    return JSON.parse(result.stdout) as { runtimeValue: string | null; pid: number };
  }

  async function waitForRuntimeState(
    serverName: string,
    expectedValue: string,
    previousPid: number,
  ): Promise<{ runtimeValue: string | null; pid: number }> {
    const deadline = Date.now() + 15000;
    let lastError = 'backend did not report updated runtime state';

    while (Date.now() < deadline) {
      try {
        const state = await readRuntimeState(serverName);
        if (state.runtimeValue === expectedValue && state.pid !== previousPid) return state;
        lastError = `runtimeValue=${String(state.runtimeValue)}, pid=${state.pid}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error(`Timed out waiting for ${serverName} Runtime Scope reload. Last state: ${lastError}`);
  }

  async function waitForServeReady(initialStderr: string): Promise<void> {
    const pidPath = join(environment.getConfigDir(), 'server.pid');
    const deadline = Date.now() + 15000;
    let lastError = initialStderr;

    while (Date.now() < deadline) {
      try {
        const raw = await readFile(pidPath, 'utf8');
        const serverInfo = JSON.parse(raw) as { url: string };
        const healthUrl = `http://127.0.0.1:${servePort}/health/ready`;
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

  async function spawnServeProcess(enableConfigReload = false): Promise<string> {
    const reloadArgs = enableConfigReload ? [] : ['--no-enable-config-reload'];
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
        ...reloadArgs,
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
