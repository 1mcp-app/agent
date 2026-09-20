import { afterEach, describe, expect, it, vi } from 'vitest';

import { RuntimeAdmission, RuntimeDrainingError, RuntimeReplacementDrain } from './runtimeDrain.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture() {
  const gate = new RuntimeAdmission();
  const ports = {
    close: vi.fn(async () => gate.close()),
    resume: vi.fn(async () => gate.resume()),
    commit: vi.fn(async () => gate.commit()),
  };
  const drain = new RuntimeReplacementDrain(ports);
  gate.subscribe((snapshot) => drain.update(snapshot));
  return { gate, ports, drain };
}

afterEach(() => vi.useRealTimers());

describe('RuntimeAdmission', () => {
  it('counts nested and detached dispatch once until every dispatched operation completes', async () => {
    const gate = new RuntimeAdmission();
    const detached = deferred<void>();
    let child!: Promise<void>;
    await gate.run(async () => {
      child = gate.run(() => detached.promise);
      expect(gate.snapshot().active).toBe(1);
    });
    expect(gate.close()).toMatchObject({ active: 1, closed: true });
    await expect(gate.run(async () => undefined)).rejects.toBeInstanceOf(RuntimeDrainingError);
    detached.resolve();
    await child;
    expect(gate.snapshot().active).toBe(0);
    gate.resume();
    await expect(gate.run(async () => 'resumed')).resolves.toBe('resumed');
  });

  it('releases failures exactly once and prevents irreversible admission reopening', async () => {
    const gate = new RuntimeAdmission();
    const release = gate.begin();
    gate.close();
    expect(() => gate.commit()).toThrow('not drained');
    release();
    release();
    expect(gate.snapshot().active).toBe(0);
    gate.commit();
    expect(() => gate.resume()).toThrow('cannot resume');
  });
});

describe('RuntimeReplacementDrain', () => {
  it('rejects new work, allows active completion, and expires even after fully drained', async () => {
    vi.useFakeTimers();
    const { gate, drain, ports } = fixture();
    const release = gate.begin();
    expect(await drain.prepare('op', 'digest')).toMatchObject({ state: 'draining', active: 1 });
    expect(() => gate.begin()).toThrow(RuntimeDrainingError);
    release();
    expect(drain.status('op').state).toBe('drained');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(drain.status('op').state).toBe('aborted');
    expect(gate.snapshot().closed).toBe(false);
    expect(ports.commit).not.toHaveBeenCalled();
    await expect(drain.commit('op', 'digest')).rejects.toThrow('not drained');
  });

  it('does not extend duplicate preparation and rejects competing IDs and mismatched digest', async () => {
    vi.useFakeTimers();
    const { drain, ports } = fixture();
    const first = await drain.prepare('op', 'digest', 1000);
    await vi.advanceTimersByTimeAsync(500);
    expect((await drain.prepare('op', 'digest', 9000)).deadlineUnixMs).toBe(first.deadlineUnixMs);
    await expect(drain.prepare('other', 'digest')).rejects.toThrow('already in progress');
    await expect(drain.prepare('op', 'wrong')).rejects.toThrow('digest mismatch');
    await vi.advanceTimersByTimeAsync(500);
    expect(drain.status('op').state).toBe('aborted');
    expect(ports.close).toHaveBeenCalledTimes(1);
  });

  it('commits once and excludes expiry while waiting for the worker acknowledgement', async () => {
    vi.useFakeTimers();
    const { drain, gate, ports } = fixture();
    await drain.prepare('op', 'digest', 100);
    const ack = deferred<ReturnType<RuntimeAdmission['snapshot']>>();
    ports.commit.mockImplementation(() => ack.promise);
    const first = drain.commit('op', 'digest');
    const duplicate = drain.commit('op', 'digest');
    await vi.advanceTimersByTimeAsync(100);
    expect(gate.snapshot().closed).toBe(true);
    ack.resolve(gate.commit());
    await expect(first).resolves.toMatchObject({ state: 'committing' });
    await expect(duplicate).resolves.toMatchObject({ state: 'committing' });
    expect(ports.commit).toHaveBeenCalledTimes(1);
    expect(ports.resume).not.toHaveBeenCalled();
  });

  it('resumes a late close acknowledgement after coordinator loss and never accepts late commit', async () => {
    vi.useFakeTimers();
    const { drain, gate, ports } = fixture();
    const ack = deferred<ReturnType<RuntimeAdmission['snapshot']>>();
    ports.close.mockImplementation(() => ack.promise);
    const preparation = drain.prepare('op', 'digest', 100);
    await vi.advanceTimersByTimeAsync(100);
    ack.resolve(gate.close());
    await expect(preparation).resolves.toMatchObject({ state: 'aborted' });
    expect(gate.snapshot().closed).toBe(false);
    await expect(drain.commit('op', 'digest')).rejects.toThrow('not drained');
  });

  it('does not claim successful commit when worker acknowledgement is invalid, including duplicates', async () => {
    const { drain, ports } = fixture();
    await drain.prepare('op', 'digest');
    ports.commit.mockResolvedValue({ closed: false, active: 0, committed: false });
    await expect(drain.commit('op', 'digest')).rejects.toThrow('ownership must be retained');
    await expect(drain.commit('op', 'digest')).rejects.toThrow('ownership must be retained');
  });
});

it('retains aborted operation IDs so a stale prepare never closes admission again', async () => {
  vi.useFakeTimers();
  const { drain, ports } = fixture();
  await drain.prepare('old', 'digest', 10);
  await vi.advanceTimersByTimeAsync(10);
  await drain.prepare('new', 'digest', 10);
  await vi.advanceTimersByTimeAsync(10);
  await expect(drain.prepare('old', 'digest')).resolves.toMatchObject({ state: 'aborted' });
  expect(ports.close).toHaveBeenCalledTimes(2);
});

it('invalidates a drained worker on observed exit so a fresh open worker cannot be committed', async () => {
  const { drain, ports } = fixture();
  await drain.prepare('op', 'digest');
  expect(drain.status('op').state).toBe('drained');
  expect(drain.workerExited()).toBe(false);
  drain.update({ closed: false, committed: false, active: 0 });
  expect(drain.status('op').state).toBe('aborted');
  await expect(drain.commit('op', 'digest')).rejects.toThrow('not drained');
  expect(ports.commit).not.toHaveBeenCalled();
});

it('requires supervisor retirement rather than worker respawn after an irreversible decision', async () => {
  const { drain, ports } = fixture();
  await drain.prepare('op', 'digest');
  await drain.commit('op', 'digest');
  expect(drain.workerExited()).toBe(true);
  expect(drain.status('op').state).toBe('committing');
  expect(ports.resume).not.toHaveBeenCalled();
});
