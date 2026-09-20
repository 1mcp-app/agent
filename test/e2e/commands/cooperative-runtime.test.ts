import { type ChildProcess, fork, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}
interface Owner {
  pid: number;
  claimId: string;
}
interface Runtime {
  pid: number;
  port: number;
  ownerClaimId: string;
}
interface Scope {
  directory: string;
  managed: boolean;
  inspectionLog: string;
}
interface Audit {
  invocation: string;
  event: string;
}
const buildRoot = path.resolve('build');
const nodeCli = path.join(buildRoot, 'index.js');
const binary = process.env.ONE_MCP_TEST_BINARY;
const fixtures = path.resolve('test/e2e/fixtures');
const scopes: Scope[] = [];
const temporaryDirectories: string[] = [];
const fixtureChildren = new Set<ChildProcess>();
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function environment(scope: Scope): Record<string, string | undefined> {
  const env = { ...process.env };
  // Do not inherit the developer's CLI scope, preset, auth, or logging overrides.
  for (const name of Object.keys(env)) if (name.startsWith('ONE_MCP_')) delete env[name];
  env.NODE_ENV = 'test';
  env.COOPERATIVE_TEST_INSPECTION_LOG = scope.inspectionLog;
  if (!binary)
    env.NODE_OPTIONS = `--import=${pathToFileURL(path.join(fixtures, 'cooperative-inspection-denied.mjs')).href}`;
  else delete env.NODE_OPTIONS; // SEA does not promise support for Node preload injection.
  return env;
}

function scope(): Scope {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), '1mcp-cooperative-e2e-'));
  const result = { directory, managed: false, inspectionLog: path.join(directory, 'inspection.ndjson') };
  fs.writeFileSync(path.join(directory, 'mcp.json'), '{"mcpServers":{}}');
  scopes.push(result);
  return result;
}

function owner(s: Scope): Owner {
  return JSON.parse(fs.readFileSync(path.join(s.directory, 'runtime.owner', 'owner.json'), 'utf8')) as Owner;
}
function runtime(s: Scope): Runtime {
  return JSON.parse(fs.readFileSync(path.join(s.directory, 'server.pid'), 'utf8')) as Runtime;
}
function hasOwner(s: Scope): boolean {
  return fs.existsSync(path.join(s.directory, 'runtime.owner'));
}

function run(
  s: Scope,
  args: string[],
  options: { cli?: string; timeout?: number; output?: (text: string) => void } = {},
): Promise<CliResult> {
  const useBinary = binary && !options.cli;
  const executable = useBinary ? path.resolve(binary) : process.execPath;
  const prefix = useBinary ? [] : [options.cli ?? nodeCli];
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...prefix, ...args, '--config-dir', s.directory], {
      cwd: s.directory,
      env: environment(s),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill(); // This exact spawned CLI, never an arbitrary PID from lifecycle metadata.
      reject(new Error(`CLI timed out: ${args.join(' ')}\n${stdout}\n${stderr}`));
    }, options.timeout ?? 25000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (text: string) => {
      stdout += text;
      options.output?.(text);
    });
    child.stderr.on('data', (text: string) => {
      stderr += text;
      options.output?.(text);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function freePort(): Promise<number> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No fixture port'));
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function start(s: Scope, port: number, cli?: string): Promise<CliResult> {
  s.managed = true;
  const result = await run(s, ['serve', '--background', '--port', String(port), '--host', '127.0.0.1'], { cli });
  expect(result.code, result.stderr + result.stdout).toBe(0);
  expect(result.stdout).toContain('Runtime activated');
  return result;
}

async function eventually(check: () => boolean | Promise<boolean>, timeout = 10000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await pause(30);
  }
  throw new Error('Timed out waiting for fixture state');
}

async function healthy(port: number): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
  expect(response.status).toBe(200);
}

function audit(file: string): Audit[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Audit);
}

async function invoke(port: number, invocation: string, delayMs = 0): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/api/v1/tool-invocations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tool: 'fixture/wait', args: { invocation, delayMs } }),
    signal: AbortSignal.timeout(12000),
  });
}

function configureSlowFixture(s: Scope, initializationGate?: string): string {
  const journal = path.join(s.directory, 'calls.ndjson');
  fs.writeFileSync(
    path.join(s.directory, 'mcp.json'),
    JSON.stringify({
      mcpServers: {
        fixture: {
          type: 'stdio',
          command: process.execPath,
          args: [
            path.join(fixtures, 'cooperative-slow-server.mjs'),
            journal,
            ...(initializationGate ? [initializationGate] : []),
          ],
        },
      },
    }),
  );
  return journal;
}

async function waitForFixture(port: number): Promise<void> {
  await eventually(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/tools`, { signal: AbortSignal.timeout(2000) });
    return response.ok && (await response.text()).includes('wait');
  });
}

beforeAll(() => {
  expect(fs.existsSync(nodeCli), 'Build the Node distribution before cooperative lifecycle E2E').toBe(true);
  if (binary) expect(fs.existsSync(binary), 'ONE_MCP_TEST_BINARY must name the built SEA executable').toBe(true);
});

afterEach(async () => {
  for (const child of fixtureChildren) {
    if (child.connected) child.send('stop');
    await eventually(() => child.exitCode !== null || child.signalCode !== null, 3000).catch(() => child.kill());
  }
  fixtureChildren.clear();
  const failures: string[] = [];
  for (const s of scopes.splice(0)) {
    if (s.managed && hasOwner(s)) {
      const stopped = await run(s, ['serve', '--stop'], { timeout: 15000 }).catch((error: unknown) => ({
        code: -1,
        stdout: '',
        stderr: String(error),
      }));
      if (stopped.code !== 0 || hasOwner(s)) {
        failures.push(`Scope retained for recovery: ${s.directory}: ${stopped.stderr}`);
        continue; // Never discard evidence or signal a numeric PID read from metadata.
      }
    }
    if (!binary && fs.existsSync(s.inspectionLog)) {
      const entries = fs
        .readFileSync(s.inspectionLog, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { kind: string; detail?: string });
      if (entries.some((entry) => entry.kind === 'attempt'))
        failures.push(
          `Unexpected process inspection in ${s.directory}: ${JSON.stringify(entries.filter((entry) => entry.kind === 'attempt'))}`,
        );
    }
    fs.rmSync(s.directory, { recursive: true, force: true });
  }
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
  expect(failures).toEqual([]);
});

describe('cooperative runtime real-process lifecycle', () => {
  it(
    'launches, attaches, restarts preserving explicit port, reports status and stops without inspection',
    { timeout: 55_000 },
    async () => {
      const s = scope();
      const port = await freePort();
      await start(s, port);
      const firstOwner = owner(s);
      const firstRuntime = runtime(s);
      expect(firstRuntime.ownerClaimId).toBe(firstOwner.claimId);
      await healthy(port);
      const status = await run(s, ['serve', '--status']);
      expect(status.code, status.stderr).toBe(0);
      expect(status.stdout).toContain(String(firstRuntime.pid));
      const attached = await run(s, ['inspect']);
      expect(attached.code, attached.stderr + attached.stdout).toBe(0);
      if (!binary) {
        const loaded = fs
          .readFileSync(s.inspectionLog, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as { kind: string; pid: number })
          .filter((entry) => entry.kind === 'loaded');
        expect(loaded.some((entry) => entry.pid === firstOwner.pid)).toBe(true);
        expect(loaded.some((entry) => entry.pid === firstRuntime.pid)).toBe(true);
      }
      const restarted = await run(s, ['serve', '--restart']);
      expect(restarted.code, restarted.stderr + restarted.stdout).toBe(0);
      expect(owner(s).claimId).not.toBe(firstOwner.claimId);
      expect(owner(s).pid).not.toBe(firstOwner.pid);
      expect(runtime(s).pid).not.toBe(firstRuntime.pid);
      expect(runtime(s).port).toBe(port);
      await healthy(port);
      expect((await run(s, ['serve', '--stop'])).code).toBe(0);
      expect(hasOwner(s)).toBe(false);
      expect(fs.existsSync(path.join(s.directory, 'server.pid'))).toBe(false);
      expect(fs.existsSync(path.join(s.directory, 'runtime-control.json'))).toBe(false);
    },
  );

  it(
    'attaches contextual CLI and STDIO proxy clients to the authenticated cooperative owner',
    { timeout: 55_000 },
    async () => {
      const s = scope();
      fs.writeFileSync(
        path.join(s.directory, 'mcp.json'),
        JSON.stringify({
          mcpServers: {},
          mcpTemplates: {
            contextual: {
              type: 'stdio',
              command: process.execPath,
              args: [path.join(fixtures, 'inspect-template-server.js'), '{{project.path}}'],
              template: { shareable: true },
            },
          },
        }),
      );
      await start(s, await freePort());
      const original = owner(s);
      const result = await run(s, [
        'run',
        'contextual/find_symbol',
        '--args',
        '{"name_path_pattern":"ContextFromCli"}',
        '--format',
        'text',
      ]);
      expect(result.code, result.stderr + result.stdout).toBe(0);
      expect(result.stdout).toContain('ContextFromCli');
      expect(result.stdout).toContain(JSON.stringify(fs.realpathSync(s.directory)).slice(1, -1));
      const proxy = new StdioClientTransport({
        command: binary ? path.resolve(binary) : process.execPath,
        args: [...(binary ? [] : [nodeCli]), 'proxy', '--config-dir', s.directory],
        cwd: s.directory,
        env: Object.fromEntries(
          Object.entries(environment(s)).filter((entry): entry is [string, string] => entry[1] !== undefined),
        ),
        stderr: 'pipe',
      });
      const client = new Client({ name: 'cooperative-proxy-fixture', version: '1.0.0' }, { capabilities: {} });
      try {
        await client.connect(proxy);
        const listed = await client.listTools();
        const tool = listed.tools.find((entry) => entry.name.endsWith('find_symbol'));
        expect(tool).toBeDefined();
        if (!tool) throw new Error('Contextual template tool was not published to proxy');
        const called = await client.callTool({ name: tool.name, arguments: { name_path_pattern: 'ContextFromProxy' } });
        expect(JSON.stringify(called)).toContain('ContextFromProxy');
        expect(JSON.stringify(called)).toContain(
          JSON.stringify(fs.realpathSync(s.directory)).slice(1, -1).replaceAll('\\', '\\\\'),
        );
        expect(owner(s)).toEqual(original);
      } finally {
        await client.close();
      }
    },
  );

  it('keeps a canceled backend call in the drain until its real response arrives', { timeout: 55_000 }, async () => {
    const s = scope();
    const journal = configureSlowFixture(s);
    const port = await freePort();
    await start(s, port);
    await waitForFixture(port);
    const original = owner(s);
    const proxy = new StdioClientTransport({
      command: binary ? path.resolve(binary) : process.execPath,
      args: [...(binary ? [] : [nodeCli]), 'proxy', '--config-dir', s.directory],
      cwd: s.directory,
      env: Object.fromEntries(
        Object.entries(environment(s)).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
      stderr: 'pipe',
    });
    const client = new Client({ name: 'cancel-drain-fixture', version: '1.0.0' }, { capabilities: {} });
    try {
      await client.connect(proxy);
      const tool = (await client.listTools()).tools.find((item) => item.name.endsWith('wait'));
      if (!tool) throw new Error('Slow tool missing');
      const cancellation = new AbortController();
      const call = client.callTool(
        { name: tool.name, arguments: { invocation: 'canceled-backend', delayMs: 5000 } },
        undefined,
        { signal: cancellation.signal },
      );
      void call.catch(() => undefined);
      await eventually(() =>
        audit(journal).some((entry) => entry.invocation === 'canceled-backend' && entry.event === 'start'),
      );
      cancellation.abort();
      await expect(call).rejects.toBeDefined();
      const restart = await run(s, ['serve', '--restart', '--drain-timeout', '0.3']);
      expect(restart.code, restart.stdout + restart.stderr).not.toBe(0);
      expect(restart.stdout + restart.stderr).toMatch(/aborted|deadline/);
      expect(owner(s)).toEqual(original);
      await eventually(() =>
        audit(journal).some((entry) => entry.invocation === 'canceled-backend' && entry.event === 'finish'),
      );
      expect(
        audit(journal).filter((entry) => entry.invocation === 'canceled-backend' && entry.event === 'start'),
      ).toHaveLength(1);
      const retried = await run(s, ['serve', '--restart']);
      expect(retried.code, retried.stdout + retried.stderr).toBe(0);
    } finally {
      await client.close();
    }
  });

  it(
    'keeps current backend files after a worker crash without changing supervisor launch settings',
    { timeout: 55_000 },
    async () => {
      const s = scope();
      const port = await freePort();
      const originalJournal = path.join(s.directory, 'original.ndjson');
      const currentJournal = path.join(s.directory, 'current.ndjson');
      fs.writeFileSync(path.join(s.directory, '.env'), `COOPERATIVE_RESTART_JOURNAL=${originalJournal}\n`);
      fs.writeFileSync(path.join(s.directory, 'config.toml'), 'host = "127.0.0.1"\n');
      await start(s, port);
      const initialOwner = owner(s);
      const initialRuntime = runtime(s);

      fs.writeFileSync(path.join(s.directory, '.env'), `COOPERATIVE_RESTART_JOURNAL=${currentJournal}\n`);
      fs.writeFileSync(
        path.join(s.directory, 'mcp.json'),
        JSON.stringify({
          mcpServers: {
            fixture: {
              type: 'stdio',
              command: process.execPath,
              args: [path.join(fixtures, 'cooperative-slow-server.mjs'), '${COOPERATIVE_RESTART_JOURNAL}'],
            },
          },
        }),
      );
      await waitForFixture(port);
      expect((await invoke(port, 'before-crash')).ok).toBe(true);
      await eventually(() => audit(currentJournal).some((entry) => entry.invocation === 'before-crash'));
      // Ordinary crash recovery preserves app launch settings; changing these needs serve --restart.
      fs.writeFileSync(path.join(s.directory, 'config.toml'), 'transport = "stdio"\n');
      expect(runtime(s).ownerClaimId).toBe(initialOwner.claimId);
      process.kill(initialRuntime.pid, 'SIGKILL');
      await eventually(() => {
        try {
          return runtime(s).pid !== initialRuntime.pid;
        } catch {
          return false;
        }
      }, 15000);
      await eventually(async () => {
        try {
          return (await invoke(port, 'after-crash')).ok;
        } catch {
          return false;
        }
      }, 15000);
      expect(owner(s)).toEqual(initialOwner);
      await eventually(() => audit(currentJournal).some((entry) => entry.invocation === 'after-crash'));
      expect(fs.existsSync(originalJournal)).toBe(false);
    },
  );

  it('retains a custom configuration filename across restart by scope', { timeout: 55_000 }, async () => {
    const s = scope();
    const custom = path.join(s.directory, 'custom.json');
    fs.renameSync(path.join(s.directory, 'mcp.json'), custom);
    s.managed = true;
    const launched = await run(s, [
      'serve',
      '--background',
      '--config',
      custom,
      '--port',
      String(await freePort()),
      '--host',
      '127.0.0.1',
    ]);
    expect(launched.code, launched.stdout + launched.stderr).toBe(0);
    const original = owner(s);
    const restarted = await run(s, ['serve', '--restart']);
    expect(restarted.code, restarted.stdout + restarted.stderr).toBe(0);
    expect(owner(s).claimId).not.toBe(original.claimId);
    expect(fs.existsSync(path.join(s.directory, 'mcp.json'))).toBe(false);
  });

  it('activates the listener before a held backend with async loading disabled', { timeout: 55_000 }, async () => {
    const s = scope();
    const gate = path.join(s.directory, 'allow-backend-initialize');
    const journal = configureSlowFixture(s, gate);
    const port = await freePort();
    s.managed = true;
    try {
      const result = await run(
        s,
        ['serve', '--background', '--port', String(port), '--host', '127.0.0.1', '--enable-async-loading=false'],
        { timeout: 10000 },
      );
      expect(result.code, result.stderr + result.stdout).toBe(0);
      expect(result.stdout).toContain('Runtime activated');
      await eventually(() =>
        audit(journal).some((entry) => entry.invocation === '__initialize__' && entry.event === 'start'),
      );
      expect(audit(journal).some((entry) => entry.event === 'finish')).toBe(false);
      const readiness = await fetch(`http://127.0.0.1:${port}/health/mcp`, { signal: AbortSignal.timeout(2000) });
      expect(readiness.status).toBe(202);
      expect((await readiness.json()).summary).toMatchObject({ loading: 1, ready: 0 });
    } finally {
      fs.writeFileSync(gate, 'release');
    }
    await waitForFixture(port);
    expect((await invoke(port, 'after-backend-release')).status).toBe(200);
  });

  it('allows one owner when two independent starts race for the same scope', { timeout: 55_000 }, async () => {
    const s = scope();
    const port = await freePort();
    s.managed = true;
    const args = ['serve', '--background', '--port', String(port), '--host', '127.0.0.1'];
    const outcomes = await Promise.all([run(s, args), run(s, args)]);
    expect(
      outcomes.filter((result) => result.code === 0),
      JSON.stringify(outcomes),
    ).toHaveLength(1);
    expect(outcomes.filter((result) => result.code !== 0)).toHaveLength(1);
    expect(runtime(s).ownerClaimId).toBe(owner(s).claimId);
    await healthy(port);
  });

  it('resumes admission when the preparing coordinator exits without committing', { timeout: 55_000 }, async () => {
    const s = scope();
    configureSlowFixture(s);
    const port = await freePort();
    await start(s, port);
    await waitForFixture(port);
    const original = owner(s);
    const coordinator = fork(path.join(fixtures, 'cooperative-abandon-prepare.mjs'), [buildRoot, s.directory], {
      cwd: s.directory,
      env: environment(s),
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    fixtureChildren.add(coordinator);
    let prepared = false;
    coordinator.on('message', (message: unknown) => {
      if (message && typeof message === 'object' && 'type' in message && message.type === 'prepared') prepared = true;
    });
    await eventually(() => prepared);
    expect((await invoke(port, 'while-coordinator-disappears')).status).toBe(503);
    await eventually(() => coordinator.exitCode === 0);
    fixtureChildren.delete(coordinator);
    await eventually(async () => (await invoke(port, 'after-coordinator-disappears')).status === 200);
    expect(owner(s)).toEqual(original);
    await healthy(port);
  });

  it(
    'rejects malformed current files and invalid explicit overrides while the old owner serves',
    { timeout: 55_000 },
    async () => {
      const s = scope();
      const port = await freePort();
      await start(s, port);
      const original = owner(s);
      for (const [file, source] of [
        ['mcp.json', '{broken'],
        ['config.toml', 'port = "invalid"'],
      ]) {
        fs.writeFileSync(path.join(s.directory, file), source);
        const rejected = await run(s, ['serve', '--restart']);
        expect(rejected.code).not.toBe(0);
        expect(owner(s)).toEqual(original);
        await healthy(port);
        if (file === 'mcp.json') fs.writeFileSync(path.join(s.directory, file), '{"mcpServers":{}}');
        else fs.unlinkSync(path.join(s.directory, file));
      }
      const invalidOption = await run(s, ['serve', '--restart', '--port', '99999']);
      expect(invalidOption.code).not.toBe(0);
      expect(owner(s)).toEqual(original);
      await healthy(port);
    },
  );

  it(
    'replaces a synthetic earlier compatible Node distribution with the invoking installation',
    { timeout: 55_000 },
    async () => {
      const s = scope();
      const distribution = fs.mkdtempSync(path.join(os.tmpdir(), '1mcp-synthetic-previous-'));
      temporaryDirectories.push(distribution);
      fs.cpSync(buildRoot, path.join(distribution, 'build'), {
        recursive: true,
        filter: (source) => path.basename(source) !== '.tmp',
      });
      fs.copyFileSync(path.resolve('package.json'), path.join(distribution, 'package.json'));
      fs.symlinkSync(
        path.resolve('node_modules'),
        path.join(distribution, 'node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const versionFile = path.join(distribution, 'build/constants/mcp.js');
      const original = fs.readFileSync(versionFile, 'utf8');
      const modified = original.replace(/(MCP_SERVER_VERSION\s*=\s*)['"][^'"]+['"]/, "$1'0.0.0-cooperative-fixture'");
      expect(modified).not.toBe(original);
      fs.writeFileSync(versionFile, modified);
      // This fixture changes only the advertised version; it is not evidence for an actual historical release.
      const launched = await start(s, await freePort(), path.join(distribution, 'build/index.js'));
      expect(launched.stdout).toContain('0.0.0-cooperative-fixture');
      const previousOwner = owner(s);
      const previousRuntime = runtime(s);
      const upgraded = await run(s, ['serve', '--restart']);
      expect(upgraded.code, upgraded.stderr + upgraded.stdout).toBe(0);
      expect(upgraded.stdout).not.toContain('0.0.0-cooperative-fixture');
      expect(owner(s).claimId).not.toBe(previousOwner.claimId);
      expect(owner(s).pid).not.toBe(previousOwner.pid);
      expect(runtime(s).pid).not.toBe(previousRuntime.pid);
      expect(runtime(s).port).toBe(previousRuntime.port);
    },
  );

  it(
    'drains a slow REST call, rejects new work, resumes on timeout, then retries without replay',
    { timeout: 55_000 },
    async () => {
      const s = scope();
      const journal = path.join(s.directory, 'calls.ndjson');
      fs.writeFileSync(
        path.join(s.directory, 'mcp.json'),
        JSON.stringify({
          mcpServers: {
            fixture: {
              type: 'stdio',
              command: process.execPath,
              args: [path.join(fixtures, 'cooperative-slow-server.mjs'), journal],
            },
          },
        }),
      );
      const port = await freePort();
      await start(s, port);
      await eventually(async () => {
        const response = await fetch(`http://127.0.0.1:${port}/api/v1/tools`, { signal: AbortSignal.timeout(2000) });
        return response.ok && (await response.text()).includes('wait');
      });
      const attached = await run(s, ['inspect', 'fixture']);
      expect(attached.code, attached.stderr + attached.stdout).toBe(0);
      expect(attached.stdout).toContain('wait');
      const original = owner(s);
      const slow = invoke(port, 'slow-original', 3500);
      void slow.catch(() => undefined);
      await eventually(() =>
        audit(journal).some((event) => event.invocation === 'slow-original' && event.event === 'start'),
      );
      let preparing = false;
      const restarting = run(s, ['serve', '--restart', '--drain-timeout', '0.5'], {
        output: (text) => {
          if (text.includes('Draining')) preparing = true;
        },
      });
      void restarting.catch(() => undefined);
      await eventually(() => preparing);
      let refused: Response | undefined;
      for (let attempt = 0; attempt < 12; attempt++) {
        const response = await invoke(port, `probe-${attempt}`);
        if (response.status === 503) {
          refused = response;
          break;
        }
        await pause(20);
      }
      expect(refused?.status).toBe(503);
      const aborted = await restarting;
      expect(aborted.code).not.toBe(0);
      expect(aborted.stderr + aborted.stdout).toMatch(/aborted|deadline/i);
      expect(owner(s)).toEqual(original);
      expect((await slow).status).toBe(200);
      expect((await invoke(port, 'after-resume')).status).toBe(200);
      const retry = await run(s, ['serve', '--restart']);
      expect(retry.code, retry.stderr + retry.stdout).toBe(0);
      expect(owner(s).claimId).not.toBe(original.claimId);
      const starts = audit(journal).filter((entry) => entry.event === 'start');
      expect(starts.filter((entry) => entry.invocation === 'slow-original')).toHaveLength(1);
      expect(new Set(starts.map((entry) => entry.invocation)).size).toBe(starts.length);
    },
  );

  it(
    'preserves incompatible authenticated owners and unreachable cooperative metadata',
    { timeout: 55_000 },
    async () => {
      const s = scope();
      const child = fork(path.join(fixtures, 'cooperative-incompatible-owner.mjs'), [buildRoot, s.directory], {
        cwd: s.directory,
        env: environment(s),
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      });
      fixtureChildren.add(child);
      const methods: string[] = [];
      let ready = false;
      child.on('message', (message: unknown) => {
        if (!message || typeof message !== 'object' || !('type' in message)) return;
        if (message.type === 'ready') ready = true;
        if (message.type === 'operation' && 'method' in message) methods.push(String(message.method));
      });
      await eventually(() => ready);
      const original = owner(s);
      const rejected = await run(s, ['serve', '--restart']);
      expect(rejected.code).not.toBe(0);
      expect(owner(s)).toEqual(original);
      expect(methods).toContain('describe');
      expect(methods).not.toContain('prepare-replacement');
      expect(methods).not.toContain('commit-replacement');
      child.send('stop');
      await eventually(() => child.exitCode !== null);
      fixtureChildren.delete(child);
      fs.mkdirSync(path.join(s.directory, 'runtime.owner'));
      const evidence = JSON.stringify({
        version: 1,
        pid: process.pid,
        claimId: randomUUID(),
        kind: 'background-supervisor',
        cooperative: true,
        claimedAt: new Date().toISOString(),
      });
      fs.writeFileSync(path.join(s.directory, 'runtime.owner', 'owner.json'), evidence);
      const unreachable = await run(s, ['serve', '--restart']);
      expect(unreachable.code).not.toBe(0);
      expect(fs.readFileSync(path.join(s.directory, 'runtime.owner', 'owner.json'), 'utf8')).toBe(evidence);
    },
  );
});
