import fs from 'fs';
import path from 'path';

import {
  BACKGROUND_GUARD_FLAG,
  buildBackgroundSupervisorArgs,
  buildBackgroundWorkerArgs,
  defaultBackgroundLogFile,
  resolveSelfInvocation,
  runServeBackground,
  runServeBackgroundSupervisor,
  type SpawnedChild,
  waitForBackgroundReady,
  waitForBackgroundSupervisorReady,
} from '@src/commands/serve/serveBackground.js';
import {
  cleanupBackgroundLaunchConfig,
  getBackgroundLaunchConfigPath,
  readBackgroundLaunchConfig,
  writeBackgroundLaunchConfig,
} from '@src/core/server/backgroundLaunchConfig.js';
import { BACKGROUND_SUPERVISOR_STATE_FILE } from '@src/core/server/backgroundRuntimeSupervisorState.js';
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

  describe('buildBackgroundWorkerArgs', () => {
    it('authorizes a worker without recursively bootstrapping another supervisor', () => {
      const args = buildBackgroundWorkerArgs(
        ['--config-dir', '/scope', '--port', '4050', `--${BACKGROUND_GUARD_FLAG}`, '--log-file', '/old.log'],
        { logFile: '/scope/server.log', claimId: 'claim-123' },
      );

      expect(args).toEqual([
        '--config-dir',
        '/scope',
        '--port',
        '4050',
        '--transport',
        'http',
        '--log-file',
        '/scope/server.log',
        '--runtime-owner-claim-id',
        'claim-123',
      ]);
    });

    it('does not propagate restart or other lifecycle actions into a supervised worker', () => {
      const args = buildBackgroundWorkerArgs(
        [
          '--restart',
          '--restart=true',
          '--status=true',
          '--stop',
          '--background',
          '--background=true',
          `--${BACKGROUND_GUARD_FLAG}`,
          `--${BACKGROUND_GUARD_FLAG}=true`,
          '--port',
          '4050',
        ],
        { logFile: '/scope/server.log', claimId: 'claim-123' },
      );

      expect(args.filter((token) => /^--(?:background|restart|status|stop)(?:=|$)/.test(token))).toEqual([]);
      expect(args).not.toContain(`--${BACKGROUND_GUARD_FLAG}`);
      expect(args).not.toContain(`--${BACKGROUND_GUARD_FLAG}=true`);
      expect(args).toEqual(expect.arrayContaining(['--port', '4050']));
    });
  });

  describe('buildBackgroundSupervisorArgs', () => {
    it('materializes effective parsed startup options without lifecycle recursion', () => {
      const args = buildBackgroundSupervisorArgs(
        {
          background: true,
          'config-dir': '/scope',
          port: 4050,
          host: '127.0.0.2',
          'enable-auth': false,
          'async-min-servers': 3,
        } as any,
        { logFile: '/scope/server.log' },
      );

      expect(args).toEqual(
        expect.arrayContaining([
          '--config-dir=/scope',
          '--port=4050',
          '--host=127.0.0.2',
          '--enable-auth=false',
          '--async-min-servers=3',
          '--transport=http',
          '--log-file=/scope/server.log',
          `--${BACKGROUND_GUARD_FLAG}`,
        ]),
      );
      expect(args).not.toContain('--background=true');
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

describe('waitForBackgroundSupervisorReady', () => {
  it('waits through replacement and succeeds only when the current worker is ready', async () => {
    const snapshots = [
      { status: 'restarting' as const, supervisorPid: 100, runtimePid: null },
      { status: 'running' as const, supervisorPid: 100, runtimePid: 202 },
    ];
    const result = await waitForBackgroundSupervisorReady('/scope', 100, {
      readState: () => snapshots.shift() as any,
      readRuntimeInfo: () => ({ pid: 202, url: 'http://localhost:4050/mcp' }) as ServerPidInfo,
      readinessProbe: async () => true,
      isSupervisorAlive: () => true,
      sleep: async () => {},
    });

    expect(result).toMatchObject({ ready: true, info: { pid: 202 } });
  });

  it('returns terminal failure without stopping a resident crash-loop supervisor', async () => {
    const result = await waitForBackgroundSupervisorReady('/scope', 100, {
      readState: () => ({ status: 'crash-loop', supervisorPid: 100, runtimePid: null }) as any,
      isSupervisorAlive: () => true,
      sleep: async () => {},
    });

    expect(result).toEqual({ ready: false, terminal: true, reason: 'background runtime entered crash-loop' });
  });
});

describe('runServeBackgroundSupervisor', () => {
  const scope = path.join(process.cwd(), '.tmp-background-supervisor-bootstrap');

  afterEach(() => fs.rmSync(scope, { recursive: true, force: true }));

  it('holds one scope claim while running workers authorized with the original effective args', async () => {
    const release = vi.fn();
    const runSupervisor = vi.fn(async (options: any, dependencies: any) => {
      expect(options.configDir).toBe(scope);
      expect(options.workerArgs).toEqual(
        expect.arrayContaining([
          'serve',
          '--config-dir',
          scope,
          '--port',
          '4050',
          '--runtime-owner-claim-id',
          'claim-123',
        ]),
      );
      expect(options.workerArgs).not.toContain(`--${BACKGROUND_GUARD_FLAG}`);
      dependencies.appendEvent({ at: '2026-07-22T00:00:00.000Z', event: 'runtime-ready', supervisorPid: 100 });
    });

    await runServeBackgroundSupervisor({ 'config-dir': scope } as any, {
      rawArgv: ['serve', '--background-bootstrap', '--config-dir', scope, '--port', '4050'],
      loadAppConfig: () => ({}),
      claimScope: () => ({
        record: {
          version: 1,
          pid: 100,
          claimId: 'claim-123',
          kind: 'background-supervisor',
          claimedAt: '2026-07-22T00:00:00.000Z',
        },
        release,
      }),
      runSupervisor,
    });

    expect(runSupervisor).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(fs.readFileSync(defaultBackgroundLogFile(scope), 'utf8')).toContain('runtime-ready');
  });

  it('retains ownership when guarded state cleanup fails closed', async () => {
    const release = vi.fn();

    await expect(
      runServeBackgroundSupervisor({ 'config-dir': scope } as any, {
        rawArgv: ['serve', '--background-bootstrap', '--config-dir', scope],
        loadAppConfig: () => ({}),
        claimScope: () => ({
          record: {
            version: 1,
            pid: 100,
            claimId: 'claim-123',
            kind: 'background-supervisor',
            claimedAt: '2026-07-22T00:00:00.000Z',
          },
          release,
        }),
        runSupervisor: async () => {
          fs.writeFileSync(path.join(scope, BACKGROUND_SUPERVISOR_STATE_FILE), '{malformed');
        },
      }),
    ).rejects.toThrow(/state is unreadable/i);

    expect(release).not.toHaveBeenCalled();
  });

  it('retains ownership and chains the supervisor failure when guarded cleanup detects replacement state', async () => {
    const release = vi.fn();
    const supervisorFailure = new Error('supervisor failed');

    await expect(
      runServeBackgroundSupervisor({ 'config-dir': scope } as any, {
        rawArgv: ['serve', '--background-bootstrap', '--config-dir', scope],
        loadAppConfig: () => ({}),
        claimScope: () => ({
          record: {
            version: 1,
            pid: 100,
            claimId: 'claim-123',
            kind: 'background-supervisor',
            claimedAt: '2026-07-22T00:00:00.000Z',
          },
          release,
        }),
        runSupervisor: async () => {
          writeBackgroundLaunchConfig(scope, 'replacement-claim', {});
          throw supervisorFailure;
        },
      }),
    ).rejects.toMatchObject({
      message: 'Background launch configuration changed before supervisor cleanup',
      cause: supervisorFailure,
    });
    expect(release).not.toHaveBeenCalled();
  });

  it('snapshots app startup config once so later changes cannot alter replacement workers', async () => {
    const appConfig = {
      port: 4050,
      host: '127.0.0.2',
      logging: { level: 'debug' as const, maxSize: '10m', maxFiles: 4 },
      auth: { enabled: true, sessionTtl: 90 },
      asyncLoading: { enabled: true, minServers: 2 },
    };

    await runServeBackgroundSupervisor({ 'config-dir': scope } as any, {
      rawArgv: ['serve', '--background-bootstrap', '--config-dir', scope],
      loadAppConfig: () => appConfig,
      claimScope: () => ({
        record: {
          version: 1,
          pid: 100,
          claimId: 'claim-snapshot',
          kind: 'background-supervisor',
          claimedAt: '2026-07-22T00:00:00.000Z',
        },
        release: vi.fn(),
      }),
      runSupervisor: async (options) => {
        const snapshotFlagIndex = options.workerArgs.indexOf('--background-launch-config');
        expect(snapshotFlagIndex).toBeGreaterThan(0);
        const snapshotPath = options.workerArgs[snapshotFlagIndex + 1];
        appConfig.port = 4999;
        appConfig.auth.enabled = false;

        expect(readBackgroundLaunchConfig(snapshotPath).appConfig).toMatchObject({
          port: 4050,
          host: '127.0.0.2',
          logging: { level: 'debug', maxSize: '10m', maxFiles: 4 },
          auth: { enabled: true, sessionTtl: 90 },
          asyncLoading: { enabled: true, minServers: 2 },
        });
      },
    });
  });
});

describe('background launch config cleanup', () => {
  const scope = path.join(process.cwd(), '.tmp-background-launch-cleanup');

  afterEach(() => fs.rmSync(scope, { recursive: true, force: true }));

  it('removes an orphan snapshot only for the matching ownership generation', () => {
    fs.mkdirSync(scope, { recursive: true });
    writeBackgroundLaunchConfig(scope, 'old-claim', { port: 4050 });

    expect(cleanupBackgroundLaunchConfig(scope, 'replacement-claim')).toBe(false);
    expect(fs.existsSync(getBackgroundLaunchConfigPath(scope))).toBe(true);
    expect(cleanupBackgroundLaunchConfig(scope, 'old-claim')).toBe(true);
    expect(fs.existsSync(getBackgroundLaunchConfigPath(scope))).toBe(false);
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

  it('fails when a ready runtime already occupies the scope', async () => {
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
    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('already owns');
    expect(stderr).toContain('999');
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

  it('refuses to start when the scoped PID file cannot be read', async () => {
    discoverScopedRuntimeMock.mockResolvedValue({
      status: 'error',
      info: null,
      error: 'PID file present but unreadable',
    });
    const spawnChild = vi.fn();

    await runServeBackground({ 'config-dir': tmpDir } as any, {
      loadAppConfig: () => ({}),
      spawnChild,
    });

    expect(spawnChild).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(stderr).toContain('Cannot inspect Runtime Scope');
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

  it('spawns a detached supervisor and reports success when its worker is ready', async () => {
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
    expect(spawnArgs).toEqual(expect.arrayContaining(['serve', '--transport=http', `--${BACKGROUND_GUARD_FLAG}`]));
    expect(spawnOpts).toMatchObject({ detached: true, stdio: 'ignore' });
    expect(process.exitCode).toBe(0);
    expect(stdout).toContain('Background runtime started');
    expect(stdout).toContain('PID: 7777');
  });

  it('uses the directory containing --config as the Runtime Scope', async () => {
    discoverScopedRuntimeMock.mockResolvedValue({ status: 'not-running', info: null });
    const spawnChild = vi.fn().mockReturnValue(fakeChild(7777));
    const waitForReady = vi.fn().mockResolvedValue({
      ready: true,
      info: { pid: 7777, url: 'http://localhost:3050/mcp', logFile: path.join(tmpDir, 'logs', 'server.log') },
    });
    const configPath = path.join(tmpDir, 'custom-config.json');

    await runServeBackground({ config: configPath } as any, {
      loadAppConfig: () => ({}),
      rawArgv: ['serve', '--background', '--config', configPath],
      spawnChild,
      waitForReady,
    });

    expect(discoverScopedRuntimeMock).toHaveBeenCalledWith(tmpDir);
    expect(waitForReady).toHaveBeenCalledWith(tmpDir, 7777, expect.any(Object));
    expect(process.exitCode).toBe(0);
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

  it('leaves a terminal crash-loop supervisor resident', async () => {
    discoverScopedRuntimeMock.mockResolvedValue({ status: 'not-running', info: null });
    const spawnChild = vi.fn().mockReturnValue(fakeChild(8888));
    const waitForReady = vi.fn().mockResolvedValue({
      ready: false,
      terminal: true,
      reason: 'background runtime entered crash-loop',
    });
    const killChild = vi.fn();

    await runServeBackground({ 'config-dir': tmpDir } as any, {
      loadAppConfig: () => ({}),
      rawArgv: ['serve', '--background', '--config-dir', tmpDir],
      spawnChild,
      waitForReady,
      killChild,
    });

    expect(killChild).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
