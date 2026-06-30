import fs from 'fs';
import path from 'path';

import {
  BACKGROUND_GUARD_FLAG,
  buildBackgroundChildArgs,
  defaultBackgroundLogFile,
  resolveSelfInvocation,
  runServeBackground,
  type SpawnedChild,
  waitForBackgroundReady,
} from '@src/commands/serve/serveBackground.js';
import { getPidFilePath, ServerPidInfo, writePidFile } from '@src/core/server/pidFileManager.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const discoverScopedRuntimeMock = vi.fn();

vi.mock('@src/core/server/runtimeLifecycle.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@src/core/server/runtimeLifecycle.js')>();
  return {
    ...actual,
    discoverScopedRuntime: (...args: unknown[]) => discoverScopedRuntimeMock(...args),
  };
});

describe('serveBackground helpers', () => {
  describe('defaultBackgroundLogFile', () => {
    it('defaults to <configDir>/logs/server.log', () => {
      expect(defaultBackgroundLogFile('/scope')).toBe(path.join('/scope', 'logs', 'server.log'));
    });
  });

  describe('buildBackgroundChildArgs', () => {
    it('strips overridden flags and appends http transport, log file, and guard', () => {
      const result = buildBackgroundChildArgs(
        ['--background', '--config-dir', '/x', '--transport', 'sse', '--log-file', '/old.log', '--port', '3050'],
        { logFile: '/new.log' },
      );

      expect(result).not.toContain('--background');
      expect(result).not.toContain('sse');
      expect(result).not.toContain('/old.log');
      // Preserved passthrough args.
      expect(result).toEqual(expect.arrayContaining(['--config-dir', '/x', '--port', '3050']));
      // Forced overrides at the end.
      expect(result).toEqual(
        expect.arrayContaining(['--transport', 'http', '--log-file', '/new.log', `--${BACKGROUND_GUARD_FLAG}`]),
      );
    });

    it('handles = forms and short -t', () => {
      const result = buildBackgroundChildArgs(['--transport=sse', '-t', 'http', '--log-file=/a.log'], {
        logFile: '/b.log',
      });
      expect(result.filter((t) => t === 'http')).toHaveLength(1); // only the appended one
      expect(result).not.toContain('/a.log');
      expect(result).toContain('/b.log');
    });
  });

  describe('resolveSelfInvocation', () => {
    it('uses the JS entry script under Node', () => {
      const { command, baseArgs } = resolveSelfInvocation(['/usr/bin/node', '/app/build/index.js', 'serve']);
      expect(command).toBe(process.execPath);
      expect(baseArgs).toEqual(['/app/build/index.js']);
    });

    it('omits a script for a packaged SEA binary', () => {
      const { baseArgs } = resolveSelfInvocation(['/usr/local/bin/1mcp', 'serve', '--background']);
      expect(baseArgs).toEqual([]);
    });
  });
});

describe('waitForBackgroundReady', () => {
  const testConfigDir = path.join(process.cwd(), '.tmp-test-bg-wait');
  const testPidFilePath = getPidFilePath(testConfigDir);

  const info = (overrides: Partial<ServerPidInfo> = {}): ServerPidInfo => ({
    pid: 4321,
    url: 'http://localhost:3050/mcp',
    port: 3050,
    host: 'localhost',
    transport: 'http',
    startedAt: '2026-06-26T00:00:00.000Z',
    configDir: testConfigDir,
    ...overrides,
  });

  beforeEach(() => fs.mkdirSync(testConfigDir, { recursive: true }));
  afterEach(() => {
    if (fs.existsSync(testPidFilePath)) fs.unlinkSync(testPidFilePath);
    if (fs.existsSync(testConfigDir)) fs.rmdirSync(testConfigDir);
  });

  it('resolves ready when the PID file matches the child and readiness passes', async () => {
    writePidFile(testConfigDir, info({ pid: 4321 }));
    const result = await waitForBackgroundReady(testConfigDir, 4321, {
      readinessProbe: async () => true,
      sleep: async () => {},
    });
    expect(result.ready).toBe(true);
    expect(result.info?.pid).toBe(4321);
  });

  it('fails fast when the child exits before becoming ready', async () => {
    const result = await waitForBackgroundReady(testConfigDir, 4321, {
      isChildAlive: () => false,
      readinessProbe: async () => true,
      sleep: async () => {},
    });
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/exited/);
  });

  it('times out when readiness never passes', async () => {
    writePidFile(testConfigDir, info({ pid: 4321 }));
    let clock = 0;
    const result = await waitForBackgroundReady(testConfigDir, 4321, {
      readinessProbe: async () => false,
      timeoutMs: 1000,
      intervalMs: 100,
      now: () => clock,
      sleep: async () => {
        clock += 100;
      },
    });
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/timed out/);
  });

  it('reports pure progress snapshots during the wait loop', async () => {
    writePidFile(testConfigDir, info({ pid: 4321 }));
    let clock = 0;
    const onProgress = vi.fn();

    const result = await waitForBackgroundReady(testConfigDir, 4321, {
      readinessProbe: async () => false,
      timeoutMs: 300,
      intervalMs: 100,
      now: () => clock,
      sleep: async () => {
        clock += 100;
      },
      onProgress,
    });

    expect(result.ready).toBe(false);
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenNthCalledWith(1, expect.objectContaining({ elapsedMs: 0 }));
    expect(onProgress).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        info: expect.objectContaining({ pid: 4321 }),
      }),
    );
  });
});

describe('runServeBackground orchestration', () => {
  let stdout: string;
  let stderr: string;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  const tmpDir = path.join(process.cwd(), '.tmp-test-bg-run');

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
    discoverScopedRuntimeMock.mockReset();
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    process.exitCode = undefined;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const fakeChild = (pid: number | undefined): SpawnedChild => ({
    pid,
    unref: vi.fn(),
    once: vi.fn(),
  });

  it('rejects stdio transport without spawning', async () => {
    const spawnChild = vi.fn();
    await runServeBackground({ transport: 'stdio' } as any, {
      loadAppConfig: () => ({}),
      spawnChild,
    });

    expect(spawnChild).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('stdio');
    expect(discoverScopedRuntimeMock).not.toHaveBeenCalled();
  });

  it('is idempotent when a ready runtime already occupies the scope', async () => {
    discoverScopedRuntimeMock.mockResolvedValue({
      status: 'running',
      info: { pid: 999, url: 'http://localhost:3050/mcp', logFile: '/l.log' },
    });
    const spawnChild = vi.fn();

    await runServeBackground({ 'config-dir': tmpDir } as any, {
      loadAppConfig: () => ({}),
      spawnChild,
    });

    expect(spawnChild).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
    expect(stdout).toContain('already running');
    expect(stdout).toContain('PID: 999');
  });

  it('refuses to start when an alive-but-unreachable runtime occupies the scope', async () => {
    discoverScopedRuntimeMock.mockResolvedValue({
      status: 'unreachable',
      info: { pid: 555, url: 'http://localhost:3050/mcp' },
    });
    const spawnChild = vi.fn();

    await runServeBackground({ 'config-dir': tmpDir } as any, {
      loadAppConfig: () => ({}),
      spawnChild,
    });

    expect(spawnChild).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('not ready yet');
    expect(stderr).toContain('555');
  });

  it('exits 1 without waiting when the child fails to spawn (no pid)', async () => {
    discoverScopedRuntimeMock.mockResolvedValue({ status: 'not-running', info: null });
    const spawnChild = vi.fn().mockReturnValue(fakeChild(undefined));
    const waitForReady = vi.fn();

    await runServeBackground({ 'config-dir': tmpDir } as any, {
      loadAppConfig: () => ({}),
      rawArgv: ['serve', '--background', '--config-dir', tmpDir],
      spawnChild,
      waitForReady,
    });

    expect(spawnChild).toHaveBeenCalledOnce();
    expect(waitForReady).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('failed to spawn');
  });

  it('spawns a detached child and reports success when ready', async () => {
    discoverScopedRuntimeMock.mockResolvedValue({ status: 'not-running', info: null });
    const spawnChild = vi.fn().mockReturnValue(fakeChild(7777));
    const waitForReady = vi.fn().mockResolvedValue({
      ready: true,
      info: { pid: 7777, url: 'http://localhost:3050/mcp', logFile: path.join(tmpDir, 'logs', 'server.log') },
    });

    await runServeBackground({ 'config-dir': tmpDir } as any, {
      loadAppConfig: () => ({}),
      rawArgv: ['serve', '--background', '--config-dir', tmpDir],
      spawnChild,
      waitForReady,
    });

    expect(spawnChild).toHaveBeenCalledOnce();
    const [, spawnArgs, spawnOpts] = spawnChild.mock.calls[0];
    expect(spawnArgs).toEqual(expect.arrayContaining(['serve', '--transport', 'http', `--${BACKGROUND_GUARD_FLAG}`]));
    expect(spawnOpts).toMatchObject({ detached: true, stdio: 'ignore' });
    expect(process.exitCode).toBe(0);
    expect(stdout).toContain('Background runtime started');
    expect(stdout).toContain('PID: 7777');
  });

  it('terminates the child and exits non-zero when readiness fails', async () => {
    discoverScopedRuntimeMock.mockResolvedValue({ status: 'not-running', info: null });
    const spawnChild = vi.fn().mockReturnValue(fakeChild(8888));
    const waitForReady = vi.fn().mockResolvedValue({ ready: false, reason: 'timed out' });
    const killChild = vi.fn();

    await runServeBackground({ 'config-dir': tmpDir } as any, {
      loadAppConfig: () => ({}),
      rawArgv: ['serve', '--background', '--config-dir', tmpDir],
      spawnChild,
      waitForReady,
      killChild,
    });

    expect(killChild).toHaveBeenCalledWith(8888);
    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('did not become ready');
    expect(stderr).toContain(path.join(tmpDir, 'logs', 'server.log'));
  });
});
