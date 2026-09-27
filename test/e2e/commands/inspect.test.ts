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
    await writeFile(join(environment.getTempDir(), '.1mcprc'), '{}', 'utf8');
    runner = new CliTestRunner(environment);
    servePort = await getAvailablePort();
  });

  afterEach(async () => {
    await stopServeProcess();
    await environment.cleanup();
  });

  it('prints a readable schema summary by default', async () => {
    await startServeProcess();

    const result = await runner.runInspectCommand('runner/echo_args', {
      cwd: environment.getTempDir(),
      args: getCliSessionCacheArgs(),
    });

    runner.assertSuccess(result);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('kind: tool');
    expect(result.stdout).not.toContain('qualifiedName');
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

    const result = await runner.runInspectCommand('runner', {
      cwd: environment.getTempDir(),
      args: getCliSessionCacheArgs(),
    });

    runner.assertSuccess(result);
    expect(result.stdout).toContain('kind: server');
    expect(result.stdout).toContain('server: runner');
    expect(result.stdout).toContain('totalTools: 4');
    expect(result.stdout).toContain('echo_args,');
    expect(result.stdout).toContain('summarize,');
  });

  it('hides disabled tools from server inventory', async () => {
    await disableRunnerTool('echo_args');

    await startServeProcess();

    const result = await runner.runInspectCommand('runner', {
      cwd: environment.getTempDir(),
      args: getCliSessionCacheArgs(),
    });

    runner.assertSuccess(result);
    expect(result.stdout).toContain('totalTools: 3');
    expect(result.stdout).not.toContain('echo_args,');
    expect(result.stdout).toContain('summarize,');
  });

  it('returns a disabled-tool error for tool inspect', async () => {
    await disableRunnerTool('echo_args');

    await startServeProcess();

    const result = await runner.runInspectCommand('runner/echo_args', {
      cwd: environment.getTempDir(),
      args: getCliSessionCacheArgs(),
    });

    runner.assertFailure(result, 1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Tool is disabled: runner:echo_args');
  });

  it('prints normalized json with --format json', async () => {
    await startServeProcess();

    const result = await runner.runInspectCommand('runner/echo_args', {
      cwd: environment.getTempDir(),
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
      cwd: environment.getTempDir(),
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

  it('walks bounded pages across separate CLI invocations when upstream ignores limit', async () => {
    await startServeProcess();
    const names: string[] = [];
    let cursor: string | undefined;
    do {
      const result = await runner.runInspectCommand('runner', {
        cwd: environment.getTempDir(),
        args: [
          ...getCliSessionCacheArgs(),
          '--format',
          'json',
          '--limit',
          '1',
          ...(cursor ? ['--cursor', cursor] : []),
        ],
      });
      runner.assertSuccess(result);
      const page = JSON.parse(result.stdout) as {
        tools: Array<{ tool: string }>;
        totalTools: number;
        nextCursor?: string;
      };
      expect(page.tools).toHaveLength(1);
      expect(page.totalTools).toBe(4);
      expect(result.stdout).not.toMatch(/qualifiedName|qualified_name/);
      names.push(page.tools[0].tool);
      cursor = page.nextCursor;
    } while (cursor && names.length < 5);
    expect(names).toHaveLength(4);
    expect(new Set(names).size).toBe(4);
    expect(cursor).toBeUndefined();
  });

  it('reports unknown tools cleanly', async () => {
    await startServeProcess();

    const result = await runner.runInspectCommand('runner/missing_tool', {
      cwd: environment.getTempDir(),
      args: getCliSessionCacheArgs(),
    });

    runner.assertFailure(result, 1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Tool not found');
  });

  it('works when --tags filter is passed (no URL validation regression)', async () => {
    await startServeProcess();

    const result = await runner.runInspectCommand('runner/echo_args', {
      cwd: environment.getTempDir(),
      args: [...getCliSessionCacheArgs(), '--tags', 'test'],
    });

    runner.assertSuccess(result);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('tool: echo_args');
  });

  it('retries with a fresh session when the cache is stale', async () => {
    await startServeProcess();

    const first = await runner.runInspectCommand('runner/echo_args', {
      cwd: environment.getTempDir(),
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
      cwd: environment.getTempDir(),
      args: [...getCliSessionCacheArgs(), '--format', 'json'],
    });
    runner.assertSuccess(second);
  });

  it('completes the instructions, inspect, run, and wait CLI journey', async () => {
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
    expect(listResult.stdout).toContain(
      'servers[2]{server,type,status,available,loadTracked,toolCount,hasInstructions}:',
    );
    expect(listResult.stdout).toContain('runner,external,connected,true,true,4,false');
    expect(listResult.stdout).toContain('serena,template,disconnected,false,false,0,true');
    expect(listResult.stdout).not.toContain('# 1MCP - Model Context Protocol Proxy');

    const runResult = await runner.runRunCommand('runner/echo_args', {
      cwd: environment.getTempDir(),
      args: [...getCliSessionCacheArgs(), '--args', '{"message":"journey complete"}', '--format', 'json'],
    });

    runner.assertSuccess(runResult);
    expect(runner.parseJsonOutput<{ echoed: string }>(runResult).echoed).toContain('journey complete');

    const waitResult = await runner.runCommand('wait', 'runner', {
      cwd: environment.getTempDir(),
      args: ['--config-dir', environment.getConfigDir(), ...getCliSessionCacheArgs(), '--format', 'json'],
    });

    runner.assertSuccess(waitResult);
    const waitOutput = runner.parseJsonOutput<{
      kind: string;
      servers: Array<{ server: string; status: string; available: boolean; loadTracked: boolean }>;
      waitedMs: number;
    }>(waitResult);
    expect(waitOutput).toMatchObject({
      kind: 'wait',
      servers: [{ server: 'runner', status: 'connected', available: true, loadTracked: true }],
    });
    expect(Number.isInteger(waitOutput.waitedMs)).toBe(true);
    expect(waitOutput.waitedMs).toBeGreaterThanOrEqual(0);

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
    expect(serverResult.stdout).toContain('find_symbol,');
  });

  async function configureSearchInventory(): Promise<void> {
    const fixture = join(process.cwd(), 'test/e2e/fixtures/inspect-search-server.js');
    await writeFile(
      environment.getConfigPath(),
      JSON.stringify({
        templateSettings: { cacheContext: true },
        mcpServers: {
          visible: {
            transport: 'stdio',
            command: 'node',
            args: [fixture],
            tags: ['search'],
            disabledTools: ['hidden'],
            toolDescriptionOverrides: { alpha: 'Needle alpha effective override' },
          },
          excluded: { transport: 'stdio', command: 'node', args: [fixture], tags: ['other'] },
        },
        mcpTemplates: {
          contextual: {
            transport: 'stdio',
            command: 'node',
            args: [join(process.cwd(), 'test/e2e/fixtures/inspect-template-server.js'), '{{project.path}}'],
            tags: ['search'],
            template: { shareable: true },
          },
        },
      }),
      'utf8',
    );
    runner.assertSuccess(
      await runner.runCommand('preset', 'create', {
        args: ['search-only', '--filter', 'search', '--config-dir', environment.getConfigDir()],
      }),
    );
    await startServeProcess();
  }

  async function search(query: string, args: string[] = [], target = '') {
    return runner.runInspectCommand(target, {
      cwd: environment.getTempDir(),
      args: [
        ...getCliSessionCacheArgs(),
        '--search',
        query,
        ...(args.includes('--format') ? [] : ['--format', 'json']),
        ...args,
      ],
    });
  }

  it('searches the complete visible inventory with compact identities and template context', async () => {
    await configureSearchInventory();
    const result = await search('VISIBLE/ALPHA', ['--tags', 'search']);
    runner.assertSuccess(result);
    const page = JSON.parse(result.stdout);
    expect(page.totalTools).toBe(2);
    expect(page.tools).toEqual([
      { server: 'visible', tool: 'alpha', requiredArgs: 1, optionalArgs: 1 },
      { server: 'visible', tool: 'alpha.late', requiredArgs: 1, optionalArgs: 1 },
    ]);
    expect(result.stdout).not.toMatch(/description|inputSchema|qualifiedName/);
    const template = await search('contextual/find', ['--tags', 'search']);
    runner.assertSuccess(template);
    expect(JSON.parse(template.stdout).tools).toEqual([
      { server: 'contextual', tool: 'find_symbol', requiredArgs: 1, optionalArgs: 1 },
    ]);
    const preset = await search('alpha', ['--preset', 'search-only']);
    runner.assertSuccess(preset);
    expect(JSON.parse(preset.stdout).tools.map((tool: { server: string }) => tool.server)).toEqual([
      'visible',
      'visible',
    ]);
    const expression = await search('alpha', ['--tag-filter', 'search AND NOT other']);
    runner.assertSuccess(expression);
    expect(JSON.parse(expression.stdout).tools).toEqual(page.tools);
    const hidden = await search('hidden', ['--tags', 'search']);
    runner.assertSuccess(hidden);
    expect(JSON.parse(hidden.stdout).tools).toEqual([]);
    const excluded = await search('excluded', ['--tags', 'search']);
    runner.assertSuccess(excluded);
    expect(JSON.parse(excluded.stdout).tools).toEqual([]);
  });

  it('paginates after matching and binds continuations to matching options and visibility', async () => {
    await configureSearchInventory();
    const first = await search('alpha', ['--tags', 'search', '--limit', '1']);
    runner.assertSuccess(first);
    const page = JSON.parse(first.stdout);
    expect(page.totalTools).toBe(2);
    expect(page.tools.map((tool: { tool: string }) => tool.tool)).toEqual(['alpha']);
    expect(page.nextCursor).toEqual(expect.any(String));
    const rest = await search('alpha', ['--tags', 'search', '--cursor', page.nextCursor, '--all']);
    runner.assertSuccess(rest);
    expect(JSON.parse(rest.stdout).tools.map((tool: { tool: string }) => tool.tool)).toEqual(['alpha.late']);
    runner.assertFailure(await search('beta', ['--tags', 'search', '--cursor', page.nextCursor]), 1);
    for (const changed of [
      ['--glob', '--tags', 'search'],
      ['--include-descriptions', '--tags', 'search'],
      ['--tags', 'other'],
    ]) {
      const result = await search('alpha', [...changed, '--cursor', page.nextCursor]);
      runner.assertFailure(result, 1);
    }
  });

  it('matches literal punctuation by default and only explicit whole-reference glob wildcards', async () => {
    await configureSearchInventory();
    for (const [query, flags, names] of [
      ['alpha.', [], ['alpha.late']],
      ['alpha*', [], []],
      ['VISIBLE/ALPH?', ['--glob'], ['alpha']],
      ['*/alpha.*', ['--glob'], ['alpha.late']],
      ['alpha*', ['--glob'], []],
      ['*/alpha[.]late', ['--glob'], []],
    ] as Array<[string, string[], string[]]>) {
      const result = await search(query, flags, 'visible');
      runner.assertSuccess(result);
      expect(JSON.parse(result.stdout).tools.map((tool: { tool: string }) => tool.tool)).toEqual(names);
    }
  });

  it('matches effective descriptions independently from display in all output formats', async () => {
    await configureSearchInventory();
    for (const format of ['json', 'toon', 'text']) {
      for (const include of [false, true]) {
        for (const show of [false, true]) {
          const result = await search(
            'Needle',
            [
              '--format',
              format,
              ...(include ? ['--include-descriptions'] : []),
              ...(show ? ['--show-descriptions'] : []),
            ],
            'visible',
          );
          runner.assertSuccess(result);
          if (include) {
            expect(result.stdout).toContain('alpha.late');
            if (show) expect(result.stdout).toContain('Needle alpha effective override');
            else expect(result.stdout).not.toContain('Needle alpha effective override');
          } else {
            expect(result.stdout).not.toContain('alpha');
          }
          expect(result.stdout).not.toContain('Original description');
          expect(result.stdout).not.toContain('hidden');
        }
      }
    }
    const glob = await search('*NEEDLE*', ['--glob', '--include-descriptions'], 'visible');
    runner.assertSuccess(glob);
    expect(JSON.parse(glob.stdout).totalTools).toBe(2);
    const deduplicated = await search('alpha', ['--include-descriptions'], 'visible');
    runner.assertSuccess(deduplicated);
    expect(JSON.parse(deduplicated.stdout).totalTools).toBe(2);
    const absent = await search('no_description', ['--include-descriptions', '--show-descriptions'], 'visible');
    runner.assertSuccess(absent);
    expect(JSON.parse(absent.stdout).tools).toHaveLength(1);
  });

  it('rejects invalid search combinations without changing ordinary inspection', async () => {
    await startServeProcess();
    for (const args of [['--glob'], ['--include-descriptions'], ['--show-descriptions'], ['--search', '   ']]) {
      const result = await runner.runInspectCommand('runner', {
        cwd: environment.getTempDir(),
        args: [...getCliSessionCacheArgs(), ...args],
      });
      runner.assertFailure(result, 1);
    }
    runner.assertFailure(await search('echo', [], 'runner/echo_args'), 1);
    runner.assertFailure(await search('echo', [], 'missing-server'), 1);
    const ordinary = await runner.runInspectCommand('runner/echo_args', {
      cwd: environment.getTempDir(),
      args: [...getCliSessionCacheArgs(), '--format', 'json'],
    });
    runner.assertSuccess(ordinary);
    expect(JSON.parse(ordinary.stdout).description).toEqual(expect.any(String));
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
