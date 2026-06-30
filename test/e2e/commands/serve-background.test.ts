import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { createServer } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * E2E coverage for `serve --background`: real detached spawn, readiness wait,
 * idempotency, Runtime Scope isolation, and orphaned-PID recovery.
 */
describe('serve --background E2E', () => {
  const cliPath = join(process.cwd(), 'build', 'index.js');
  const startedPids: number[] = [];
  const tempDirs: string[] = [];

  beforeAll(() => {
    if (!existsSync(cliPath)) {
      throw new Error(`Built CLI not found at ${cliPath}. Run "pnpm build" before E2E.`);
    }
  });

  afterEach(() => {
    for (const pid of startedPids.splice(0)) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // already gone
      }
    }
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
    const pidFile = join(configDir, 'server.pid');
    if (existsSync(pidFile)) {
      try {
        const info = JSON.parse(readFileSync(pidFile, 'utf8')) as { pid: number };
        if (info.pid) startedPids.push(info.pid);
      } catch {
        // ignore
      }
    }
    return result;
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

  it('is idempotent: a second --background does not start a second runtime', async () => {
    const scope = makeScope();
    const port = await getFreePort();

    const first = runBackground(scope, port);
    expect(first.status).toBe(0);
    const firstPid = readPid(scope).pid;

    const second = runBackground(scope, port);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('already running');
    expect(readPid(scope).pid).toBe(firstPid);
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
    expect(stop.stdout).toContain('Stopped runtime');

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
