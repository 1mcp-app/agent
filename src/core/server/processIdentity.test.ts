import childProcess from 'node:child_process';
import fs from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  inspectProcessIdentity,
  type ProcessIdentity,
  processIdentityRecoveryMessage,
  readProcessIdentity,
} from './processIdentity.js';

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
  it('recognizes macOS processes after a hostname change within the same boot', () => {
    const recorded: ProcessIdentity = {
      platform: 'darwin',
      hostname: 'old-host',
      bootId: 'boot-session',
      startTime: 'birth',
    };
    expect(
      inspectProcessIdentity(123, recorded, {
        readIdentity: () => ({ ...recorded, hostname: 'new-host' }),
      }),
    ).toBe('alive');
  });

  it('rejects macOS evidence from another boot or without the recorded boot ID', () => {
    const recorded: ProcessIdentity = {
      platform: 'darwin',
      hostname: 'host',
      bootId: 'boot-session',
      startTime: 'birth',
    };
    for (const bootId of ['other-boot', undefined]) {
      expect(
        inspectProcessIdentity(123, recorded, {
          readIdentity: () => ({ ...recorded, bootId }),
        }),
      ).toBe('unknown');
    }
  });

  it('retains hostname checks for legacy macOS records', () => {
    const recorded: ProcessIdentity = { platform: 'darwin', hostname: 'host', startTime: 'birth' };
    expect(
      inspectProcessIdentity(123, recorded, {
        readIdentity: () => ({ ...recorded, bootId: 'boot-session' }),
      }),
    ).toBe('alive');
    expect(
      inspectProcessIdentity(123, recorded, {
        readIdentity: () => ({ ...recorded, hostname: 'other-host', bootId: 'boot-session' }),
      }),
    ).toBe('unknown');
  });

  it('still detects macOS PID reuse after a hostname change', () => {
    const recorded: ProcessIdentity = {
      platform: 'darwin',
      hostname: 'old-host',
      bootId: 'boot-session',
      startTime: 'birth',
    };
    expect(
      inspectProcessIdentity(123, recorded, {
        readIdentity: () => ({ ...recorded, hostname: 'new-host', startTime: 'later' }),
      }),
    ).toBe('dead');
  });

  it('fails closed for legacy and unavailable identity evidence', () => {
    const processAlive = vi.fn(() => true);
    expect(inspectProcessIdentity(1, undefined, { processAlive })).toBe('unknown');
    expect(inspectProcessIdentity(1, identity, { readIdentity: () => undefined, processAlive })).toBe('unknown');
  });
});

describe('platform identity capture', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.skipIf(process.platform !== 'darwin')('recognizes the same live process across caller timezones', () => {
    vi.stubEnv('TZ', 'UTC');
    const recorded = readProcessIdentity(process.pid);
    expect(recorded).toBeDefined();

    vi.stubEnv('TZ', 'Asia/Shanghai');
    expect(readProcessIdentity(process.pid)).toEqual(recorded);
    expect(inspectProcessIdentity(process.pid, recorded)).toBe('alive');
  });

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

  it('records macOS birth time using a fixed locale and timezone', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    const exec = vi
      .spyOn(childProcess, 'execFileSync')
      .mockImplementation((file) => (file === '/usr/sbin/sysctl' ? 'boot-session\n' : 'Tue Sep 15 10:00:00 2026\n'));
    expect(readProcessIdentity(123)).toMatchObject({
      platform: 'darwin',
      bootId: 'boot-session',
      startTime: 'Tue Sep 15 10:00:00 2026',
    });
    expect(exec).toHaveBeenCalledWith(
      '/usr/bin/env',
      ['LC_ALL=C', 'TZ=UTC', '/bin/ps', '-p', '123', '-o', 'lstart='],
      expect.any(Object),
    );
  });

  it('fails closed when the macOS boot session cannot be read', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    vi.spyOn(childProcess, 'execFileSync').mockImplementation((file) => {
      if (file === '/usr/sbin/sysctl') throw new Error('EACCES');
      return 'Tue Sep 15 10:00:00 2026\n';
    });
    expect(readProcessIdentity(123)).toBeUndefined();
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

describe('process identity recovery guidance', () => {
  it.each([
    ['missing birth evidence', undefined, () => identity, 'legacy format'],
    ['unavailable OS evidence', identity, () => undefined, 'permissions or platform tools'],
    ['another boot', identity, () => ({ ...identity, bootId: 'other' }), 'another boot session'],
    ['another namespace', identity, () => ({ ...identity, pidNamespace: 'other' }), 'another PID namespace'],
  ])('explains %s without authorizing cleanup', (_label, recorded, readIdentity, reason) => {
    const message = processIdentityRecoveryMessage(123, recorded, { readIdentity });
    expect(message).toContain(reason);
    expect(message).toContain('PID 123');
    expect(message).toContain('Do not delete lifecycle metadata');
    expect(message).toContain('original CLI or service manager');
  });

  it('identifies hostname changes in legacy macOS records', () => {
    const recorded: ProcessIdentity = { platform: 'darwin', hostname: 'old', startTime: 'birth' };
    expect(
      processIdentityRecoveryMessage(123, recorded, {
        readIdentity: () => ({ ...recorded, hostname: 'new' }),
      }),
    ).toContain('hostname differs');
  });

  it('reports unreadable target evidence separately from unreadable CLI evidence', () => {
    expect(
      processIdentityRecoveryMessage(123, identity, {
        readIdentity: (pid) => (pid === process.pid ? identity : undefined),
        processAlive: () => true,
      }),
    ).toContain('its birth evidence could not be read');
  });

  it('asks for a retry when evidence changes during diagnostic re-read', () => {
    expect(
      processIdentityRecoveryMessage(123, identity, {
        readIdentity: () => identity,
      }),
    ).toContain('retry the command');
  });
});
