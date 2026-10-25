import { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { MCP_SERVER_VERSION } from '@src/constants.js';
import { runBackgroundRuntimeSupervisor } from '@src/core/server/backgroundRuntimeSupervisor.js';
import {
  receiveRuntimeBootstrap,
  type RuntimeLaunchBootstrap,
  waitForChildActivation,
} from '@src/core/server/runtimeLaunchIpc.js';

import { expect, it, vi } from 'vitest';

import { runCooperativeSupervisor } from './cooperativeRuntime.js';

const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn,
}));
vi.mock('@src/core/server/backgroundRuntimeSupervisor.js', () => ({
  runBackgroundRuntimeSupervisor: vi.fn(),
}));
vi.mock('@src/core/server/runtimeLaunchIpc.js', async (original) => ({
  ...(await original<typeof import('@src/core/server/runtimeLaunchIpc.js')>()),
  receiveRuntimeBootstrap: vi.fn(),
  waitForChildActivation: vi.fn(),
  sendChild: vi.fn(),
  sendRuntimeParent: vi.fn(),
}));
vi.mock('@src/core/server/runtimeReplacementConfig.js', async (original) => ({
  ...(await original<typeof import('@src/core/server/runtimeReplacementConfig.js')>()),
  installRuntimeReplacementConfig: vi.fn(),
  activateRuntimeReplacementConfig: vi.fn(),
}));

it('hides the initial and replacement runtime worker consoles while retaining private IPC', async () => {
  // The supervisor must not disconnect the test runner's own IPC channel.
  vi.spyOn(process, 'disconnect').mockImplementation(() => {});
  const scope = fs.mkdtempSync(path.join(os.tmpdir(), 'cooperative-spawn-'));
  const configFilePath = path.join(scope, 'mcp.json');
  fs.writeFileSync(configFilePath, '{"mcpServers":{}}');
  const signals = ['SIGTERM', 'SIGINT', 'SIGHUP'] as const;
  const listeners = signals.map((signal) => new Set(process.listeners(signal)));
  const bootstrap: RuntimeLaunchBootstrap = {
    type: 'runtime-bootstrap',
    nonce: randomUUID(),
    digest: 'a'.repeat(64),
    options: {},
    snapshot: {
      version: 1,
      runtimeScope: scope,
      configFilePath,
      mcpConfig: { mcpServers: {} },
      appConfig: {},
      runtimeEnvironment: {},
      parentEnvironment: {},
      explicitInputs: { version: 1, values: {} },
    },
  };
  vi.mocked(receiveRuntimeBootstrap).mockResolvedValue(bootstrap);
  spawn.mockImplementation(() => {
    const child = new ChildProcess();
    Object.defineProperty(child, 'pid', { value: 1000 + spawn.mock.calls.length });
    return child;
  });
  vi.mocked(waitForChildActivation).mockImplementation(async (child, launch) => ({
    type: 'runtime-activated',
    nonce: launch.nonce,
    claimId: launch.claimId,
    digest: launch.digest,
    version: MCP_SERVER_VERSION,
    runtime: {
      pid: child.pid,
      url: 'http://127.0.0.1:3000',
      port: 3000,
      host: '127.0.0.1',
      transport: 'http',
      startedAt: new Date().toISOString(),
      configDir: scope,
    },
  }));
  vi.mocked(runBackgroundRuntimeSupervisor).mockImplementation(async (options, dependencies) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const child = dependencies!.spawnWorker!(options.workerCommand, options.workerArgs!, { stdio: 'ignore' });
      await dependencies!.waitForReady!(child);
      if (!(child instanceof ChildProcess)) throw new Error('Expected a child process fixture');
      child.emit('exit', 1, null);
      child.emit('close', 1, null);
    }
  });

  try {
    await runCooperativeSupervisor();
    expect(spawn).toHaveBeenCalledTimes(2);
    for (let call = 1; call <= 2; call += 1) {
      expect(spawn).toHaveBeenNthCalledWith(
        call,
        expect.any(String),
        expect.arrayContaining(['serve', '--cooperative-bootstrap=worker', '--config', configFilePath]),
        { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
      );
    }
  } finally {
    signals.forEach((signal, index) => {
      for (const listener of process.listeners(signal)) {
        if (!listeners[index].has(listener)) process.removeListener(signal, listener);
      }
    });
    fs.rmSync(scope, { recursive: true, force: true });
    vi.restoreAllMocks();
  }
});
