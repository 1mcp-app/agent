import { runServeStop, waitForProcessExit } from '@src/commands/serve/serveStop.js';
import { PidFileReadError, type ServerPidInfo } from '@src/core/server/pidFileManager.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('waitForProcessExit', () => {
  it('returns true once the process is gone', async () => {
    let alive = true;
    const result = await waitForProcessExit(123, {
      isAlive: () => alive,
      sleep: async () => {
        alive = false;
      },
    });
    expect(result).toBe(true);
  });

  it('returns false when the process never exits within the timeout', async () => {
    let clock = 0;
    const result = await waitForProcessExit(123, {
      isAlive: () => true,
      timeoutMs: 500,
      intervalMs: 100,
      now: () => clock,
      sleep: async () => {
        clock += 100;
      },
    });
    expect(result).toBe(false);
  });
});

describe('runServeStop', () => {
  let stdout: string;
  let stderr: string;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  const info = (overrides: Partial<ServerPidInfo> = {}): ServerPidInfo => ({
    pid: 4321,
    url: 'http://localhost:3050/mcp',
    port: 3050,
    host: 'localhost',
    transport: 'http',
    startedAt: '2026-06-26T00:00:00.000Z',
    configDir: '/scope',
    ...overrides,
  });

  beforeEach(() => {
    stdout = '';
    stderr = '';
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      stdout += String(chunk);
      return true;
    });
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
      stderr += String(chunk);
      return true;
    });
    process.exitCode = undefined;
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('reports cleanly when nothing is running', async () => {
    const kill = vi.fn();
    const cleanup = vi.fn();
    await runServeStop('/scope', { readInfo: () => null, kill, cleanup });

    expect(kill).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
    expect(stdout).toContain('No runtime is running');
  });

  it('fails closed when the scoped PID file cannot be read', async () => {
    const kill = vi.fn();
    const cleanup = vi.fn();
    await runServeStop('/scope', {
      readInfo: () => {
        throw new PidFileReadError('/scope/server.pid', Object.assign(new Error('denied'), { code: 'EACCES' }));
      },
      kill,
      cleanup,
    });

    expect(kill).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('cannot inspect Runtime Scope');
  });

  it('removes a stale PID file for a dead process without signaling', async () => {
    const kill = vi.fn();
    const cleanup = vi.fn().mockReturnValue(true);
    await runServeStop('/scope', {
      readInfo: () => info({ pid: 99999999 }),
      isAlive: () => false,
      kill,
      cleanup,
    });

    expect(kill).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledWith('/scope', 99999999);
    expect(process.exitCode).toBe(0);
    expect(stdout).toContain('stale PID file');
  });

  it('warns when a stale PID file cannot be removed', async () => {
    const cleanup = vi.fn().mockReturnValue(false);
    await runServeStop('/scope', {
      readInfo: () => info({ pid: 99999999 }),
      isAlive: () => false,
      kill: vi.fn(),
      cleanup,
    });

    expect(process.exitCode).toBe(0);
    expect(stderr).toContain('could not be removed');
  });

  it('gracefully terminates a live runtime and cleans up', async () => {
    const kill = vi.fn();
    const cleanup = vi.fn().mockReturnValue(true);
    const waitForExit = vi.fn().mockResolvedValue(true);

    await runServeStop('/scope', {
      readInfo: () => info({ pid: 4321 }),
      isAlive: () => true,
      kill,
      cleanup,
      waitForExit,
    });

    expect(kill).toHaveBeenCalledWith(4321, 'SIGTERM');
    expect(kill).toHaveBeenCalledTimes(1); // no SIGKILL escalation needed
    expect(cleanup).toHaveBeenCalledWith('/scope', 4321);
    expect(process.exitCode).toBe(0);
    expect(stdout).toContain('Stopped runtime');
  });

  it('escalates to SIGKILL when SIGTERM does not stop the runtime', async () => {
    const kill = vi.fn();
    const cleanup = vi.fn().mockReturnValue(true);
    // First wait (after SIGTERM) fails, second wait (after SIGKILL) succeeds.
    const waitForExit = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await runServeStop('/scope', {
      readInfo: () => info({ pid: 4321 }),
      isAlive: () => true,
      kill,
      cleanup,
      waitForExit,
    });

    expect(kill).toHaveBeenNthCalledWith(1, 4321, 'SIGTERM');
    expect(kill).toHaveBeenNthCalledWith(2, 4321, 'SIGKILL');
    expect(cleanup).toHaveBeenCalledWith('/scope', 4321);
    expect(process.exitCode).toBe(0);
  });

  it('exits non-zero when the runtime cannot be stopped', async () => {
    const kill = vi.fn();
    const cleanup = vi.fn().mockReturnValue(true);
    const waitForExit = vi.fn().mockResolvedValue(false);

    await runServeStop('/scope', {
      readInfo: () => info({ pid: 4321 }),
      isAlive: () => true,
      kill,
      cleanup,
      waitForExit,
    });

    expect(cleanup).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('failed to stop runtime');
  });

  it('continues past a SIGTERM failure and still escalates/cleans up', async () => {
    // process.kill can throw (ESRCH/EPERM); the command must not crash.
    const kill = vi.fn().mockImplementationOnce(() => {
      throw new Error('ESRCH');
    });
    const cleanup = vi.fn().mockReturnValue(true);
    const waitForExit = vi.fn().mockResolvedValue(true);

    await runServeStop('/scope', {
      readInfo: () => info({ pid: 4321 }),
      isAlive: () => true,
      kill,
      cleanup,
      waitForExit,
    });

    expect(process.exitCode).toBe(0);
    expect(stdout).toContain('Stopped runtime');
  });
});
