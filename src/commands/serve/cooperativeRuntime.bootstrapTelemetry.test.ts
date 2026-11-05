import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { MCP_SERVER_VERSION } from '@src/constants.js';
import type { BackgroundSupervisorDependencies } from '@src/core/server/backgroundRuntimeSupervisor.js';
import type { RuntimeControlMethod } from '@src/core/server/runtimeControl.js';
import type { RuntimeLaunchBootstrap } from '@src/core/server/runtimeLaunchIpc.js';
import { prepareRuntimeReplacementConfig } from '@src/core/server/runtimeReplacementConfig.js';
import { getTelemetryStatus } from '@src/observability/telemetry.js';

import { expect, it, vi } from 'vitest';

import { runCooperativeSupervisor } from './cooperativeRuntime.js';

const hooks = vi.hoisted(() => ({ bootstrap: vi.fn(), spawn: vi.fn(), startControl: vi.fn(), supervise: vi.fn() }));
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: hooks.spawn,
}));
vi.mock('@src/core/server/runtimeLaunchIpc.js', async (original) => ({
  ...(await original<typeof import('@src/core/server/runtimeLaunchIpc.js')>()),
  receiveRuntimeBootstrap: hooks.bootstrap,
}));
vi.mock('@src/core/server/runtimeReplacementConfig.js', async (original) => ({
  ...(await original<typeof import('@src/core/server/runtimeReplacementConfig.js')>()),
  installRuntimeReplacementConfig: () => {},
  activateRuntimeReplacementConfig: () => {},
}));
vi.mock('@src/core/server/runtimeControl.js', async (original) => ({
  ...(await original<typeof import('@src/core/server/runtimeControl.js')>()),
  startRuntimeControl: hooks.startControl,
}));
vi.mock('@src/core/server/backgroundRuntimeSupervisor.js', async (original) => ({
  ...(await original<typeof import('@src/core/server/backgroundRuntimeSupervisor.js')>()),
  runBackgroundRuntimeSupervisor: hooks.supervise,
}));
vi.mock('@src/core/server/backgroundRuntimeSupervisorState.js', async (original) => ({
  ...(await original<typeof import('@src/core/server/backgroundRuntimeSupervisorState.js')>()),
  cleanupBackgroundSupervisorState: () => true,
}));

it('keeps describe side-effect free until each current worker has authenticated activation', async () => {
  const scope = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-bootstrap-order-'));
  fs.writeFileSync(path.join(scope, 'mcp.json'), '{"mcpServers":{}}');
  const prepared = prepareRuntimeReplacementConfig({
    runtimeScope: scope,
    configFilePath: path.join(scope, 'mcp.json'),
    previousExplicitInputs: { version: 1, values: {} },
    invocationExplicitInputs: { version: 1, values: {} },
  });
  hooks.bootstrap.mockResolvedValue({
    type: 'runtime-bootstrap',
    nonce: randomUUID(),
    digest: prepared.digest,
    snapshot: prepared.snapshot,
    options: {},
  });
  let describe!: (method: RuntimeControlMethod, payload: unknown, id: string) => Promise<unknown>;
  hooks.startControl.mockImplementation(async (_scope, _claim, handler) => {
    describe = handler;
    return { close: async () => {} };
  });
  class Worker extends EventEmitter {
    connected = true;
    exitCode = null;
    signalCode = null;
    sent: Array<{ type: string; action?: string }> = [];
    constructor(readonly pid: number) {
      super();
    }
    send(message: RuntimeLaunchBootstrap & { action?: string; id?: string }, callback: (error?: Error) => void) {
      this.sent.push(message);
      callback();
      if (message.type === 'runtime-bootstrap')
        queueMicrotask(() =>
          this.emit('message', {
            type: 'runtime-activated',
            nonce: message.nonce,
            claimId: message.claimId,
            digest: message.digest,
            version: MCP_SERVER_VERSION,
            runtime: {
              pid: this.pid,
              url: 'http://127.0.0.1:3050',
              host: '127.0.0.1',
              port: 3050,
              transport: 'http',
              startedAt: new Date().toISOString(),
              configDir: scope,
            },
          }),
        );
      if (message.action === 'telemetry')
        queueMicrotask(() =>
          this.emit('message', { type: 'runtime-reply', id: message.id, value: getTelemetryStatus() }),
        );
    }
  }
  const first = new Worker(12345);
  const second = new Worker(12346);
  hooks.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);
  let driverError: unknown;
  hooks.supervise.mockImplementation(async (_options, dependencies: BackgroundSupervisorDependencies) => {
    try {
      for (const current of [first, second]) {
        const worker = dependencies.spawnWorker!('unused', [], {}) as unknown as ChildProcess;
        expect(worker).toBe(current);
        const starting = await describe('describe', undefined, randomUUID());
        expect(starting).toMatchObject({ runtime: null });
        expect(current.sent).toEqual([]);
        current.emit('message', { type: 'runtime-hello' });
        await dependencies.waitForReady(worker as never);
        const active = await describe('describe', undefined, randomUUID());
        expect(active).toMatchObject({ runtime: { pid: current.pid }, telemetry: { state: 'disabled' } });
        expect(current.sent.map((message) => message.type)).toEqual([
          'runtime-bootstrap',
          'runtime-activation-recorded',
          'runtime-request',
        ]);
        current.emit('exit', 1);
      }
    } catch (error) {
      driverError = error;
      const stop = process.listeners('SIGTERM').find((listener) => !before[0].has(listener));
      stop?.('SIGTERM');
      throw error;
    }
  });
  const signals = ['SIGTERM', 'SIGINT', 'SIGHUP'] as const;
  const before = signals.map((signal) => new Set<unknown>(process.listeners(signal)));
  const connected = Object.getOwnPropertyDescriptor(process, 'connected');
  Object.defineProperty(process, 'connected', { value: false, configurable: true });
  try {
    await runCooperativeSupervisor();
    expect(hooks.supervise).toHaveBeenCalledOnce();
    if (driverError) throw driverError;
  } finally {
    if (connected) Object.defineProperty(process, 'connected', connected);
    else Reflect.deleteProperty(process, 'connected');
    signals.forEach((signal, i) =>
      process.listeners(signal).forEach((listener) => {
        if (!before[i].has(listener)) process.removeListener(signal, listener);
      }),
    );
    fs.rmSync(scope, { recursive: true, force: true });
  }
});
