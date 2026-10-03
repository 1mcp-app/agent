import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

import logger from '@src/logger/logger.js';

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

  it.each(['Z', 'X'])('does not record birth evidence for a Linux process in state %s', (state) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    vi.spyOn(fs, 'readFileSync').mockReturnValue(`1 (node) ${state} ${Array(18).fill('0').join(' ')} 12345 0`);
    expect(readProcessIdentity(1)).toBeUndefined();
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

  it.each([
    ['ETIMEDOUT', 'retry after reducing system load'],
    ['ENOENT', 'platform process-inspection tool'],
    ['EACCES', 'process-inspection permissions'],
    ['EPERM', 'process-inspection permissions'],
  ])('retains safe Windows %s acquisition diagnostics without trusting the PID', (code, guidance) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValue(3100);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    const exec = vi.spyOn(childProcess, 'execFileSync').mockImplementation(() => {
      throw Object.assign(new Error('private stderr and command details'), { code, stderr: 'private stderr' });
    });
    const recorded: ProcessIdentity = { platform: 'win32', hostname: os.hostname(), startTime: '123' };
    expect(readProcessIdentity(123)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith('Process birth evidence acquisition failed', {
      platform: 'win32',
      pid: 123,
      elapsedMs: 3000,
      code,
    });
    expect(inspectProcessIdentity(123, recorded, { processAlive: () => true })).toBe('unknown');
    const message = processIdentityRecoveryMessage(123, recorded);
    expect(message).toContain(`code=${code}`);
    expect(message).toContain(guidance);
    expect(message).toContain(`lookup PID=${process.pid}`);
    expect(message).not.toContain('private');
    expect(message).toContain('Do not delete lifecycle metadata');
    expect(exec).toHaveBeenCalledWith('powershell.exe', expect.any(Array), {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  });

  it('reports malformed Windows evidence without logging the raw process output', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    vi.spyOn(childProcess, 'execFileSync').mockReturnValue('private unexpected output');
    const recorded: ProcessIdentity = { platform: 'win32', hostname: os.hostname(), startTime: '123' };
    expect(inspectProcessIdentity(123, recorded)).toBe('unknown');
    expect(processIdentityRecoveryMessage(123, recorded)).toContain('code=MALFORMED_PROCESS_EVIDENCE');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private');
  });

  it('does not expose unknown acquisition error codes or messages', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    vi.spyOn(childProcess, 'execFileSync').mockImplementation(() => {
      throw Object.assign(new Error('private acquisition detail'), { code: 'PRIVATE_TOKEN' });
    });
    const recorded: ProcessIdentity = { platform: 'win32', hostname: os.hostname(), startTime: '123' };
    const message = processIdentityRecoveryMessage(123, recorded);
    expect(message).toContain('code=PROCESS_EVIDENCE_UNAVAILABLE');
    expect(message).not.toContain('PRIVATE_TOKEN');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_TOKEN');
    expect(message).not.toContain('private');
  });

  it('keeps missing recorded evidence distinct from acquisition failure without a lookup', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const exec = vi.spyOn(childProcess, 'execFileSync');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    expect(inspectProcessIdentity(123, undefined)).toBe('unknown');
    expect(processIdentityRecoveryMessage(123)).toContain('legacy format');
    expect(exec).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not attach when Windows process context differs', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    vi.spyOn(os, 'hostname').mockReturnValue('current-host');
    const exec = vi.spyOn(childProcess, 'execFileSync').mockReturnValue('123');
    const recorded: ProcessIdentity = { platform: 'win32', hostname: 'other-host', startTime: '123' };
    expect(inspectProcessIdentity(123, recorded)).toBe('unknown');
    expect(processIdentityRecoveryMessage(123, recorded)).toContain('hostname differs');
    expect(exec).toHaveBeenCalledTimes(2); // Each inspection stops after the CLI context lookup.
  });

  it('identifies a Windows target acquisition failure separately from CLI context failure', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    vi.spyOn(childProcess, 'execFileSync').mockImplementation((_file, args) => {
      if (args?.some((arg) => arg.includes(`-Id ${process.pid} `))) return '123';
      throw Object.assign(new Error('private target error'), { code: 'ETIMEDOUT' });
    });
    const recorded: ProcessIdentity = { platform: 'win32', hostname: os.hostname(), startTime: '123' };
    expect(inspectProcessIdentity(123, recorded, { processAlive: () => true })).toBe('unknown');
    const message = processIdentityRecoveryMessage(123, recorded, { processAlive: () => true });
    expect(message).toContain('its birth evidence could not be read');
    expect(message).toContain('lookup PID=123');
    expect(message).toContain('code=ETIMEDOUT');
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
