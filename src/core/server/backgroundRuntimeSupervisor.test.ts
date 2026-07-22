import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

import {
  BACKGROUND_SUPERVISOR_STATE_FILE,
  type BackgroundRuntimeSignal,
  type BackgroundSupervisorState,
  BackgroundSupervisorStateReadError,
  readBackgroundSupervisorState,
  runBackgroundRuntimeSupervisor,
  type SupervisedRuntimeWorker,
  writeBackgroundSupervisorState,
} from '@src/core/server/backgroundRuntimeSupervisor.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

class FakeWorker extends EventEmitter implements SupervisedRuntimeWorker {
  constructor(
    readonly pid: number,
    private readonly autoExitOnKill = true,
  ) {
    super();
  }

  kill = vi.fn((signal: BackgroundRuntimeSignal = 'SIGTERM') => {
    if (this.autoExitOnKill) queueMicrotask(() => this.exit(null, signal));
  });

  exit(code: number | null, signal: BackgroundRuntimeSignal | null = null): void {
    this.emit('exit', code, signal);
  }
}

const state = (overrides: Partial<BackgroundSupervisorState> = {}): BackgroundSupervisorState => ({
  version: 1,
  status: 'running',
  supervisorPid: 100,
  runtimePid: 101,
  restartAttempt: 0,
  lastExit: null,
  nextRetryAt: null,
  readyAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
  ...overrides,
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

describe('background supervisor state store', () => {
  const scope = path.join(process.cwd(), '.tmp-background-supervisor-state');

  afterEach(() => fs.rmSync(scope, { recursive: true, force: true }));

  it('round-trips an atomic structured lifecycle snapshot', () => {
    writeBackgroundSupervisorState(scope, state());

    expect(readBackgroundSupervisorState(scope)).toEqual(state());
    expect(fs.existsSync(path.join(scope, BACKGROUND_SUPERVISOR_STATE_FILE))).toBe(true);
  });

  it('distinguishes absent state from malformed state so discovery can fail closed', () => {
    expect(readBackgroundSupervisorState(scope)).toBeNull();
    fs.mkdirSync(scope, { recursive: true });
    fs.writeFileSync(path.join(scope, BACKGROUND_SUPERVISOR_STATE_FILE), '{"status":"running"}');

    expect(() => readBackgroundSupervisorState(scope)).toThrow(BackgroundSupervisorStateReadError);
  });
});

describe('runBackgroundRuntimeSupervisor', () => {
  it.each(['state', 'event'] as const)(
    'stops the active worker before propagating a %s persistence failure',
    async (failure) => {
      const worker = new FakeWorker(199);
      let stateWrites = 0;
      const running = runBackgroundRuntimeSupervisor(
        { configDir: '/scope', workerCommand: '1mcp', workerArgs: ['serve'], supervisorPid: 100 },
        {
          spawnWorker: () => worker,
          waitForReady: async () => true,
          writeState: () => {
            stateWrites += 1;
            if (failure === 'state' && stateWrites === 2) throw new Error('state write failed');
          },
          appendEvent: () => {
            if (failure === 'event') throw new Error('event append failed');
          },
          waitForStop: () => new Promise<void>(() => {}),
        },
      );

      await expect(running).rejects.toThrow(`${failure === 'state' ? 'state write' : 'event append'} failed`);
      expect(worker.kill).toHaveBeenCalledWith('SIGTERM');
    },
  );

  it('reuses the original worker args and applies the five bounded delays before crash-loop residency', async () => {
    const workers = Array.from({ length: 6 }, (_, index) => new FakeWorker(200 + index));
    const spawnWorker = vi.fn((_command: string, _args: readonly string[]) => {
      const worker = workers.shift();
      if (!worker) throw new Error('unexpected spawn');
      queueMicrotask(() => worker.exit(1));
      return worker;
    });
    const states: BackgroundSupervisorState[] = [];
    const delays: number[] = [];
    const events: string[] = [];
    const stop = deferred<void>();
    const workerArgs = ['serve', '--port', '4050', '--log-level', 'debug'];

    const running = runBackgroundRuntimeSupervisor(
      { configDir: '/scope', workerCommand: '/usr/bin/node', workerArgs, supervisorPid: 100 },
      {
        spawnWorker,
        waitForReady: async () => false,
        writeState: (snapshot) => states.push(snapshot),
        sleep: async (ms) => {
          delays.push(ms);
        },
        now: () => new Date('2026-07-22T00:00:00.000Z'),
        appendEvent: (event) => events.push(event.event),
        waitForStop: () => stop.promise,
      },
    );

    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('crash-loop'));
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000]);
    expect(spawnWorker).toHaveBeenCalledTimes(6);
    expect(spawnWorker.mock.calls.every(([, args]) => args === spawnWorker.mock.calls[0][1])).toBe(true);
    expect(spawnWorker.mock.calls[0][1]).toEqual(workerArgs);
    expect(states.at(-1)).toMatchObject({
      status: 'crash-loop',
      runtimePid: null,
      restartAttempt: 5,
      lastExit: { code: 1, signal: null },
      nextRetryAt: null,
    });
    expect(events).toEqual(expect.arrayContaining(['runtime-exit', 'restart-scheduled', 'retry-exhausted']));

    stop.resolve(undefined);
    await running;
  });

  it('does not kill or restart a live worker that fails readiness', async () => {
    const worker = new FakeWorker(201);
    const states: BackgroundSupervisorState[] = [];
    const stop = deferred<void>();

    const running = runBackgroundRuntimeSupervisor(
      { configDir: '/scope', workerCommand: '1mcp', workerArgs: ['serve'], supervisorPid: 100 },
      {
        spawnWorker: () => worker,
        waitForReady: async () => false,
        writeState: (snapshot) => states.push(snapshot),
        sleep: async () => {},
        waitForStop: () => stop.promise,
      },
    );

    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('running'));
    expect(states.at(-1)?.runtimePid).toBe(201);
    expect(worker.kill).not.toHaveBeenCalled();

    stop.resolve(undefined);
    await running;
    expect(worker.kill).toHaveBeenCalledOnce();
  });

  it('waits for the deliberately stopped worker to exit before the supervisor returns', async () => {
    const worker = new FakeWorker(201, false);
    const stop = deferred<void>();
    let returned = false;
    const running = runBackgroundRuntimeSupervisor(
      { configDir: '/scope', workerCommand: '1mcp', workerArgs: ['serve'], supervisorPid: 100 },
      {
        spawnWorker: () => worker,
        waitForReady: async () => true,
        writeState: () => {},
        waitForStop: () => stop.promise,
      },
    ).then(() => {
      returned = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    stop.resolve(undefined);
    await vi.waitFor(() => expect(worker.kill).toHaveBeenCalledWith('SIGTERM'));
    expect(returned).toBe(false);
    worker.exit(null, 'SIGTERM');
    await running;
    expect(returned).toBe(true);
  });

  it('resets the attempt counter only after a ready replacement remains alive for five minutes', async () => {
    const first = new FakeWorker(201);
    const replacement = new FakeWorker(202);
    const secondReplacement = new FakeWorker(203);
    const workers = [first, replacement, secondReplacement];
    const states: BackgroundSupervisorState[] = [];
    const sleeps: Array<{ ms: number; resolve: () => void }> = [];
    const stop = deferred<void>();

    const running = runBackgroundRuntimeSupervisor(
      { configDir: '/scope', workerCommand: '1mcp', workerArgs: ['serve'], supervisorPid: 100 },
      {
        spawnWorker: () => workers.shift()!,
        waitForReady: async () => true,
        writeState: (snapshot) => states.push(snapshot),
        sleep: (ms) =>
          new Promise<void>((resolve) => {
            sleeps.push({ ms, resolve });
          }),
        waitForStop: () => stop.promise,
      },
    );

    await vi.waitFor(() => expect(states.at(-1)?.runtimePid).toBe(201));
    first.exit(1);
    await vi.waitFor(() => expect(sleeps[0]?.ms).toBe(1000));
    sleeps[0].resolve();
    await vi.waitFor(() => expect(states.at(-1)?.runtimePid).toBe(202));
    expect(states.at(-1)?.restartAttempt).toBe(1);
    await vi.waitFor(() => expect(sleeps[1]?.ms).toBe(300_000));
    sleeps[1].resolve();
    await vi.waitFor(() => expect(states.at(-1)?.restartAttempt).toBe(0));

    replacement.exit(9);
    await vi.waitFor(() => expect(sleeps[2]?.ms).toBe(1000));
    sleeps[2].resolve();
    await vi.waitFor(() => expect(states.at(-1)?.runtimePid).toBe(203));
    expect(states.at(-1)?.restartAttempt).toBe(1);

    stop.resolve(undefined);
    await running;
  });

  it('keeps observing an alive replacement until it becomes ready, then starts the stable reset', async () => {
    const first = new FakeWorker(301);
    const replacement = new FakeWorker(302);
    const workers = [first, replacement];
    const readiness = [true, false, true];
    const states: BackgroundSupervisorState[] = [];
    const sleeps: Array<{ ms: number; resolve: () => void }> = [];
    const stop = deferred<void>();

    const running = runBackgroundRuntimeSupervisor(
      { configDir: '/scope', workerCommand: '1mcp', workerArgs: ['serve'], supervisorPid: 100 },
      {
        spawnWorker: () => workers.shift()!,
        waitForReady: async () => readiness.shift()!,
        writeState: (snapshot) => states.push(snapshot),
        sleep: (ms) =>
          new Promise<void>((resolve) => {
            sleeps.push({ ms, resolve });
          }),
        waitBeforeReadinessRetry: (ms) =>
          new Promise<void>((resolve) => {
            sleeps.push({ ms, resolve });
          }),
        waitForStop: () => stop.promise,
      },
    );

    await vi.waitFor(() => expect(states.at(-1)?.runtimePid).toBe(301));
    first.exit(1);
    await vi.waitFor(() => expect(sleeps[0]?.ms).toBe(1000));
    sleeps[0].resolve();
    await vi.waitFor(() => expect(states.at(-1)).toMatchObject({ runtimePid: 302, readyAt: null }));
    await vi.waitFor(() => expect(sleeps[1]?.ms).toBe(250));
    sleeps[1].resolve();
    await vi.waitFor(() => expect(states.at(-1)?.readyAt).not.toBeNull());
    expect(sleeps[2]?.ms).toBe(300_000);
    expect(replacement.kill).not.toHaveBeenCalled();

    stop.resolve(undefined);
    await running;
  });
});
