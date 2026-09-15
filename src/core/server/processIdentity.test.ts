import childProcess from 'node:child_process';
import fs from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { inspectProcessIdentity, type ProcessIdentity, readProcessIdentity } from './processIdentity.js';

const identity: ProcessIdentity = { platform: 'linux', bootId: 'boot', pidNamespace: 'pid:[1]', startTime: '10' };

describe('process incarnation evidence', () => {
  it('recognizes the same live process', () => {
    expect(inspectProcessIdentity(1, identity, { readIdentity: () => identity, processAlive: () => true })).toBe(
      'alive',
    );
  });
  it('does not mistake a reused PID for the owner', () => {
    expect(
      inspectProcessIdentity(1, identity, {
        readIdentity: () => ({ ...identity, startTime: '20' }),
        processAlive: () => true,
      }),
    ).toBe('dead');
  });
  it('does not interpret a PID in a different namespace as the owner', () => {
    expect(
      inspectProcessIdentity(1, identity, {
        readIdentity: () => ({ ...identity, pidNamespace: 'pid:[2]' }),
        processAlive: () => false,
      }),
    ).toBe('unknown');
  });
  it('fails closed for legacy and unavailable identity evidence', () => {
    const processAlive = vi.fn(() => true);
    expect(inspectProcessIdentity(1, undefined, { processAlive })).toBe('unknown');
    expect(inspectProcessIdentity(1, identity, { readIdentity: () => undefined, processAlive })).toBe('unknown');
  });
});

describe('platform identity capture', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads Linux start ticks after a parenthesized process name', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    vi.spyOn(fs, 'readFileSync').mockImplementation((file) =>
      String(file).endsWith('/stat')
        ? `1 (node worker (test)) S ${Array(18).fill('0').join(' ')} 12345 0`
        : 'boot-id\n',
    );
    vi.spyOn(fs, 'readlinkSync').mockReturnValue('pid:[123]');
    expect(readProcessIdentity(1)).toEqual({
      platform: 'linux',
      bootId: 'boot-id',
      pidNamespace: 'pid:[123]',
      startTime: '12345',
    });
  });

  it('fails closed when procfs is unavailable', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('EACCES');
    });
    expect(readProcessIdentity(1)).toBeUndefined();
  });

  it('records macOS birth time using a fixed locale', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    const exec = vi.spyOn(childProcess, 'execFileSync').mockReturnValue('Tue Sep 15 10:00:00 2026\n');
    expect(readProcessIdentity(123)).toMatchObject({ platform: 'darwin', startTime: 'Tue Sep 15 10:00:00 2026' });
    expect(exec).toHaveBeenCalledWith(
      '/usr/bin/env',
      ['LC_ALL=C', '/bin/ps', '-p', '123', '-o', 'lstart='],
      expect.any(Object),
    );
  });

  it('records Windows UTC process-start ticks', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    vi.spyOn(childProcess, 'execFileSync').mockReturnValue('639250000000000000\r\n');
    expect(readProcessIdentity(123)).toMatchObject({ platform: 'win32', startTime: '639250000000000000' });
  });

  it('fails closed on unsupported platforms and malformed process IDs', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('freebsd');
    expect(readProcessIdentity(123)).toBeUndefined();
    expect(readProcessIdentity(-1)).toBeUndefined();
  });
});
