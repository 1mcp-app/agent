import { spawn, spawnSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { createServer } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * E2E coverage for the supervised background lifecycle through real CLI and
 * process boundaries. Exact retry exhaustion/backoff and the five-minute stable
 * reset remain unit-tested instead of making this file sleep through policy.
 */
describe('serve --background E2E', () => {
  const cliPath = join(process.cwd(), 'build', 'index.js');
  const startedPids = new Set<number>();
  const tempDirs: string[] = [];

  beforeAll(() => {
    if (!existsSync(cliPath)) {
      throw new Error(`Built CLI not found at ${cliPath}. Run "pnpm build" before E2E.`);
    }
  });

  afterEach(() => {
    // Ask each scope to stop first so pending retries are cancelled. Then kill
    // every supervisor/worker PID observed during the test as a final backstop.
    for (const dir of tempDirs) {
      const status = runStatus(dir);
      trackLifecyclePids(status);
      runStop(dir);
    }
    for (const pid of startedPids) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // already gone
      }
    }
    startedPids.clear();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeScope(): string {
    const dir = mkdtempSync(join(tmpdir(), '1mcp-bg-'));
    writeFileSync(join(dir, 'mcp.json'), JSON.stringify({ mcpServers: {} }, null, 2));
    tempDirs.push(dir);
    return dir;
  }

  function getFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = createServer();
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        if (addr && typeof addr === 'object') {
          const { port } = addr;
          srv.close(() => resolve(port));
        } else {
          srv.close(() => reject(new Error('could not get a free port')));
        }
      });
      srv.on('error', reject);
    });
  }

  function runBackground(configDir: string, port: number) {
    const result = spawnSync(
      process.execPath,
      [cliPath, 'serve', '--background', '--config-dir', configDir, '--port', String(port), '--host', '127.0.0.1'],
      { encoding: 'utf8', timeout: 45000 },
    );
    trackLifecyclePids(runStatus(configDir));
    return result;
  }

  function runBackgroundAsync(configDir: string, port: number): Promise<CliResult> {
    return runCliAsync([
      'serve',
      '--background',
      '--config-dir',
      configDir,
      '--port',
      String(port),
      '--host',
      '127.0.0.1',
    ]);
  }

  function readPid(configDir: string): { pid: number; url: string; logFile?: string } {
    return JSON.parse(readFileSync(join(configDir, 'server.pid'), 'utf8'));
  }

  function runStop(configDir: string) {
    return spawnSync(process.execPath, [cliPath, 'serve', '--stop', '--config-dir', configDir], {
      encoding: 'utf8',
      timeout: 20000,
    });
  }

  function runStatus(configDir: string) {
    return spawnSync(process.execPath, [cliPath, 'serve', '--status', '--config-dir', configDir], {
      encoding: 'utf8',
      timeout: 10000,
    });
  }

  function runOrdinaryServe(configDir: string, args: string[] = []) {
    return spawnSync(process.execPath, [cliPath, 'serve', '--config-dir', configDir, ...args], {
      encoding: 'utf8',
      input: '',
      timeout: 10000,
    });
  }

  function runRestart(configDir: string, port: number) {
    const result = spawnSync(
      process.execPath,
      [cliPath, 'serve', '--restart', '--config-dir', configDir, '--port', String(port), '--host', '127.0.0.1'],
      { encoding: 'utf8', timeout: 45000 },
    );
    trackLifecyclePids(runStatus(configDir));
    return result;
  }

  interface CliResult {
    status: number | null;
    stdout: string;
    stderr: string;
  }

  interface LifecycleStatus {
    status: string | null;
    supervisorPid: number | null;
    runtimePid: number | null;
    url: string | null;
  }

  interface SupervisorState {
    status: string;
    supervisorPid: number;
    runtimePid: number | null;
  }

  function readSupervisorState(configDir: string): SupervisorState {
    return JSON.parse(readFileSync(join(configDir, 'background-runtime.json'), 'utf8'));
  }

  function parseLifecycleStatus(result: { stdout: string }): LifecycleStatus {
    const value = (pattern: RegExp): string | null => result.stdout.match(pattern)?.[1] ?? null;
    const pid = (pattern: RegExp): number | null => {
      const raw = value(pattern);
      return raw && raw !== 'none' ? Number(raw) : null;
    };
    return {
      status: value(/^Status: (.+)$/m),
      supervisorPid: pid(/^Supervisor PID: (\d+)/m),
      runtimePid: pid(/^Runtime PID: (\d+|none)/m),
      url: value(/^URL: (.+)$/m),
    };
  }

  function trackLifecyclePids(result: { stdout: string }): LifecycleStatus {
    const status = parseLifecycleStatus(result);
    if (status.supervisorPid) startedPids.add(status.supervisorPid);
    if (status.runtimePid) startedPids.add(status.runtimePid);
    return status;
  }

  function runCliAsync(args: string[], timeoutMs = 45000): Promise<CliResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cliPath, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.stderr.on('data', (chunk) => (stderr += chunk));
      child.once('error', reject);
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
      child.once('close', (status) => {
        clearTimeout(timer);
        resolve({ status, stdout, stderr });
      });
    });
  }

  async function waitFor<T>(read: () => T, accept: (value: T) => boolean, timeoutMs = 20000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let value = read();
    while (!accept(value) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      value = read();
    }
    if (!accept(value)) {
      throw new Error(`Timed out waiting for lifecycle state; last value: ${JSON.stringify(value)}`);
    }
    return value;
  }

  function processIsAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error instanceof Error && 'code' in error && (error as { code?: unknown }).code === 'EPERM';
    }
  }

  it('starts a detached runtime and reports PID, URL, and log file', async () => {
    const scope = makeScope();
    const port = await getFreePort();

    const result = runBackground(scope, port);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Background runtime started');
    expect(result.stdout).toContain('PID:');
    expect(result.stdout).toContain(`http://127.0.0.1:${port}/mcp`);

    const info = readPid(scope);
    expect(info.logFile).toBe(join(scope, 'logs', 'server.log'));

    // The detached runtime outlived the parent and is ready.
    const ready = await fetch(`http://127.0.0.1:${port}/health/ready`);
    expect(ready.status).toBe(200);
  });

  it('rejects a duplicate ordinary background start without replacing the runtime', async () => {
    const scope = makeScope();
    const port = await getFreePort();

    const first = runBackground(scope, port);
    expect(first.status).toBe(0);
    const firstPid = readPid(scope).pid;

    const second = runBackground(scope, port);
    expect(second.status).not.toBe(0);
    expect(second.stderr).toContain('already owns this Runtime Scope');
    expect(readPid(scope).pid).toBe(firstPid);
  });

  it('rejects ordinary foreground HTTP and stdio starts while the scope is owned', async () => {
    const scope = makeScope();
    const port = await getFreePort();

    expect(runBackground(scope, port).status).toBe(0);
    const original = trackLifecyclePids(runStatus(scope));

    const foregroundHttp = runOrdinaryServe(scope, ['--port', String(port), '--host', '127.0.0.1']);
    const foregroundStdio = runOrdinaryServe(scope, ['--transport', 'stdio']);

    expect(foregroundHttp.status).not.toBe(0);
    expect(foregroundStdio.status).not.toBe(0);
    const after = trackLifecyclePids(runStatus(scope));
    expect(after).toMatchObject({
      status: 'running',
      supervisorPid: original.supervisorPid,
      runtimePid: original.runtimePid,
    });
    expect((await fetch(`http://127.0.0.1:${port}/health/ready`)).status).toBe(200);
  });

  it('allows exactly one concurrent background claimant to own a Runtime Scope', async () => {
    const scope = makeScope();
    const port = await getFreePort();

    const results = await Promise.all([runBackgroundAsync(scope, port), runBackgroundAsync(scope, port)]);
    const successes = results.filter((result) => result.status === 0);
    const failures = results.filter((result) => result.status !== 0);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].stderr).toMatch(/already owns|already owned|did not become ready/);
    const status = trackLifecyclePids(runStatus(scope));
    expect(status.status).toBe('running');
    expect(status.supervisorPid).not.toBeNull();
    expect(status.runtimePid).not.toBeNull();
  });

  it('runs separate runtimes for two different Runtime Scopes', async () => {
    const scopeA = makeScope();
    const scopeB = makeScope();
    const portA = await getFreePort();
    const portB = await getFreePort();

    expect(runBackground(scopeA, portA).status).toBe(0);
    expect(runBackground(scopeB, portB).status).toBe(0);

    const pidA = readPid(scopeA).pid;
    const pidB = readPid(scopeB).pid;
    expect(pidA).not.toBe(pidB);

    expect((await fetch(`http://127.0.0.1:${portA}/health/ready`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${portB}/health/ready`)).status).toBe(200);
  });

  it('serve --stop terminates the scoped runtime and removes its PID file', async () => {
    const scope = makeScope();
    const port = await getFreePort();

    expect(runBackground(scope, port).status).toBe(0);
    expect((await fetch(`http://127.0.0.1:${port}/health/ready`)).status).toBe(200);

    const stop = runStop(scope);
    expect(stop.status).toBe(0);
    expect(stop.stdout).toContain('Stopped supervised background runtime');

    // PID file removed and the port is no longer served.
    expect(existsSync(join(scope, 'server.pid'))).toBe(false);
    await expect(fetch(`http://127.0.0.1:${port}/health/ready`)).rejects.toThrow();
  });

  it('serve --stop only affects the targeted Runtime Scope', async () => {
    const scopeA = makeScope();
    const scopeB = makeScope();
    const portA = await getFreePort();
    const portB = await getFreePort();

    expect(runBackground(scopeA, portA).status).toBe(0);
    expect(runBackground(scopeB, portB).status).toBe(0);

    expect(runStop(scopeA).status).toBe(0);

    // Scope A is down; scope B is untouched.
    await expect(fetch(`http://127.0.0.1:${portA}/health/ready`)).rejects.toThrow();
    expect((await fetch(`http://127.0.0.1:${portB}/health/ready`)).status).toBe(200);
  });

  it('serve --stop reports cleanly when nothing is running', async () => {
    const scope = makeScope();
    const stop = runStop(scope);
    expect(stop.status).toBe(0);
    expect(stop.stdout).toContain('No runtime is running');
  });

  it('serve --restart stops the old runtime and starts a fresh one with a new PID', async () => {
    const scope = makeScope();
    const port = await getFreePort();

    expect(runBackground(scope, port).status).toBe(0);
    const old = trackLifecyclePids(runStatus(scope));

    const restart = runRestart(scope, port);
    expect(restart.status, `restart stderr:\n${restart.stderr}\nrestart stdout:\n${restart.stdout}`).toBe(0);
    expect(restart.stdout).toContain('Background runtime started');

    const replacement = trackLifecyclePids(runStatus(scope));
    expect(replacement.supervisorPid).not.toBe(old.supervisorPid);
    expect(replacement.runtimePid).not.toBe(old.runtimePid);
    expect((await fetch(`http://127.0.0.1:${port}/health/ready`)).status).toBe(200);
  });

  it('serve --restart replaces a supervisor while it is waiting to restart a crashed worker', async () => {
    const scope = makeScope();
    const port = await getFreePort();

    expect(runBackground(scope, port).status).toBe(0);
    const original = trackLifecyclePids(runStatus(scope));
    process.kill(original.runtimePid!, 'SIGKILL');

    const restartingState = await waitFor(
      () => readSupervisorState(scope),
      (state) => state.status === 'restarting',
    );
    expect(restartingState).toMatchObject({
      status: 'restarting',
      supervisorPid: original.supervisorPid,
      runtimePid: null,
    });

    const restart = runRestart(scope, port);
    expect(restart.status, `restart stderr:\n${restart.stderr}\nrestart stdout:\n${restart.stdout}`).toBe(0);
    const replacement = trackLifecyclePids(runStatus(scope));
    expect(replacement.supervisorPid).not.toBe(original.supervisorPid);
    expect(replacement.runtimePid).not.toBe(original.runtimePid);
    expect((await fetch(`http://127.0.0.1:${port}/health/ready`)).status).toBe(200);
  });

  it('replaces a crashed worker using the original Runtime Scope and port', async () => {
    const scope = makeScope();
    const port = await getFreePort();

    expect(runBackground(scope, port).status).toBe(0);
    const original = trackLifecyclePids(runStatus(scope));
    expect(original.supervisorPid).not.toBeNull();
    expect(original.runtimePid).not.toBeNull();

    process.kill(original.runtimePid!, 'SIGKILL');
    const replacement = await waitFor(
      () => trackLifecyclePids(runStatus(scope)),
      (status) =>
        status.status === 'running' &&
        status.runtimePid !== null &&
        status.runtimePid !== original.runtimePid &&
        status.url === `http://127.0.0.1:${port}/mcp`,
    );

    expect(replacement.supervisorPid).toBe(original.supervisorPid);
    expect(readPid(scope)).toMatchObject({ pid: replacement.runtimePid, configDir: scope, port });
    expect((await fetch(`http://127.0.0.1:${port}/health/ready`)).status).toBe(200);
  });

  it('serve --stop cancels supervision and does not respawn the worker', async () => {
    const scope = makeScope();
    const port = await getFreePort();

    expect(runBackground(scope, port).status).toBe(0);
    const original = trackLifecyclePids(runStatus(scope));
    expect(runStop(scope).status).toBe(0);

    await waitFor(
      () => runStatus(scope),
      (status) => status.status === 3,
    );
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(runStatus(scope).status).toBe(3);
    expect(processIsAlive(original.supervisorPid!)).toBe(false);
    expect(processIsAlive(original.runtimePid!)).toBe(false);
  });

  it('reports and recovers an orphan when the supervisor dies before its worker', async () => {
    const scope = makeScope();
    const port = await getFreePort();

    expect(runBackground(scope, port).status).toBe(0);
    const original = trackLifecyclePids(runStatus(scope));
    process.kill(original.supervisorPid!, 'SIGKILL');

    const orphanResult = await waitFor(
      () => runStatus(scope),
      (result) => result.status === 7,
    );
    const orphan = trackLifecyclePids(orphanResult);
    expect(orphan.status).toBe('orphaned');
    expect(orphan.supervisorPid).toBe(original.supervisorPid);
    expect(orphan.runtimePid).toBe(original.runtimePid);
    expect(processIsAlive(original.runtimePid!)).toBe(true);

    const stop = runStop(scope);
    expect(stop.status).toBe(0);
    expect(stop.stdout).toContain('Recovered orphaned runtime');
    await waitFor(
      () => processIsAlive(original.runtimePid!),
      (alive) => !alive,
    );
    expect(runStatus(scope).status).toBe(3);
  });

  it('serve --restart replaces an orphaned supervisor and worker', async () => {
    const scope = makeScope();
    const port = await getFreePort();

    expect(runBackground(scope, port).status).toBe(0);
    const original = trackLifecyclePids(runStatus(scope));
    process.kill(original.supervisorPid!, 'SIGKILL');
    await waitFor(
      () => runStatus(scope),
      (result) => result.status === 7,
    );

    const restart = runRestart(scope, port);
    expect(restart.status, `restart stderr:\n${restart.stderr}\nrestart stdout:\n${restart.stdout}`).toBe(0);
    const replacement = trackLifecyclePids(runStatus(scope));
    expect(replacement.supervisorPid).not.toBe(original.supervisorPid);
    expect(replacement.runtimePid).not.toBe(original.runtimePid);
    await waitFor(
      () => processIsAlive(original.runtimePid!),
      (alive) => !alive,
    );
    expect((await fetch(`http://127.0.0.1:${port}/health/ready`)).status).toBe(200);
  });

  it('serve --restart cold-starts a runtime when nothing is running', async () => {
    const scope = makeScope();
    const port = await getFreePort();

    const restart = runRestart(scope, port);
    expect(restart.status, `restart stderr:\n${restart.stderr}\nrestart stdout:\n${restart.stdout}`).toBe(0);
    expect(existsSync(join(scope, 'server.pid'))).toBe(true);
    expect((await fetch(`http://127.0.0.1:${port}/health/ready`)).status).toBe(200);
  });

  it('starts despite an orphaned PID file pointing to a dead process', async () => {
    const scope = makeScope();
    const port = await getFreePort();

    // Pre-seed a stale PID file for a non-existent process.
    writeFileSync(
      join(scope, 'server.pid'),
      JSON.stringify({
        pid: 99999999,
        url: `http://127.0.0.1:${port}/mcp`,
        port,
        host: '127.0.0.1',
        transport: 'http',
        startedAt: new Date().toISOString(),
        configDir: scope,
      }),
    );

    const result = runBackground(scope, port);

    expect(result.status).toBe(0);
    expect(readPid(scope).pid).not.toBe(99999999);
  });
});
