import * as childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { acquireRuntimeFileLock } from '@src/core/server/runtimeFileLock.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', { spy: true });

describe('Runtime filesystem locks', () => {
  let directory: string;
  const platform = process.platform;
  beforeEach(() => {
    vi.resetAllMocks();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), '1mcp-flock-'));
  });
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: platform });
    vi.restoreAllMocks();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('retains the descriptor after flock exits, then closes it once without unlinking', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const spawn = vi
      .spyOn(childProcess, 'spawnSync')
      .mockReturnValue({ status: 0 } as ReturnType<typeof childProcess.spawnSync>);
    const close = vi.spyOn(fs, 'closeSync');
    const lockPath = path.join(directory, 'runtime.owner.flock');
    const lock = acquireRuntimeFileLock(lockPath)!;
    const descriptor = (spawn.mock.calls[0][2]!.stdio as number[])[3];
    expect(spawn).toHaveBeenCalledWith('flock', ['-n', '3'], expect.objectContaining({ timeout: 5000 }));
    expect(fs.fstatSync(descriptor).isFile()).toBe(true);
    lock.release();
    lock.release();
    expect(close).toHaveBeenCalledExactlyOnceWith(descriptor);
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it.each([1, 2])('closes the descriptor on unsuccessful flock status %s', (status) => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    vi.spyOn(childProcess, 'spawnSync').mockReturnValue({
      status,
      stderr: Buffer.from('failed'),
    } as ReturnType<typeof childProcess.spawnSync>);
    const close = vi.spyOn(fs, 'closeSync');
    expect(() => acquireRuntimeFileLock(path.join(directory, 'lock'))).toThrow(
      status === 1 ? /held/ : /requires a working flock/,
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it('fails closed when flock is missing', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    vi.spyOn(childProcess, 'spawnSync').mockReturnValue({
      status: null,
      error: new Error('ENOENT'),
    } as ReturnType<typeof childProcess.spawnSync>);
    expect(() => acquireRuntimeFileLock(path.join(directory, 'lock'))).toThrow(/requires a working flock.*ENOENT/);
  });

  it.each(['darwin', 'win32'])('uses identity-only coordination on %s', (value) => {
    Object.defineProperty(process, 'platform', { value });
    const spawn = vi.spyOn(childProcess, 'spawnSync');
    expect(acquireRuntimeFileLock(path.join(directory, 'lock'))).toBeNull();
    expect(spawn).not.toHaveBeenCalled();
  });

  it.skipIf(platform !== 'linux')('excludes a second descriptor until the first lock is released', () => {
    const lockPath = path.join(directory, 'lock');
    const first = acquireRuntimeFileLock(lockPath)!;
    try {
      expect(() => acquireRuntimeFileLock(lockPath)).toThrow(/held/);
    } finally {
      first.release();
    }
    acquireRuntimeFileLock(lockPath)!.release();
  });
});
