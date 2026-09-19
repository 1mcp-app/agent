import childProcess from 'node:child_process';
import fs from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { readProcessEvidence } from './processEvidence.js';

const expectedArgs = ['node', 'a path', '', 'quote"and\\slash'];
afterEach(() => vi.restoreAllMocks());

describe('Linux process evidence', () => {
  it.each([0, -1, NaN, Infinity, 1.2, 2147483648])('rejects invalid pid %s', (pid) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    expect(readProcessEvidence(pid)).toBeUndefined();
  });

  it.each(['darwin', 'win32'] as const)('uses guided recovery on %s without reading process files', (platform) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);
    const open = vi.spyOn(fs, 'openSync');
    expect(readProcessEvidence(123)).toBeUndefined();
    expect(open).not.toHaveBeenCalled();
  });

  it('reads procfs with exact argv and rejects changing birth evidence', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const descriptors = new Map<number, { content: Buffer; offset: number }>();
    let nextFd = 100;
    let statReads = 0;
    let state = 'S';
    const stat = (birth: string) => `123 (a tricky ) name) ${state} 12 ${Array(17).fill('0').join(' ')} ${birth}`;
    const files: Record<string, string> = {
      '/proc/123/status': 'Uid:\t501\t501\t501\t501\n',
      '/proc/123/cmdline': 'node\0a path\0\0quote"and\\slash\0',
      '/proc/sys/kernel/random/boot_id': 'boot-id\n',
    };
    vi.spyOn(fs, 'openSync').mockImplementation((filename) => {
      const name = String(filename);
      const content = name.endsWith('/stat') ? stat(++statReads > 2 ? '200' : '100') : files[name];
      if (content === undefined) throw new Error('not found');
      const fd = nextFd++;
      descriptors.set(fd, { content: Buffer.from(content), offset: 0 });
      return fd;
    });
    vi.spyOn(fs, 'readSync').mockImplementation((...args: unknown[]) => {
      const [fd, buffer, offset, length] = args as [number, Buffer, number, number];
      const source = descriptors.get(fd)!;
      const count = source.content.copy(buffer, offset, source.offset, source.offset + length);
      source.offset += count;
      return count;
    });
    vi.spyOn(fs, 'closeSync').mockImplementation(() => undefined);
    vi.spyOn(fs, 'readlinkSync').mockImplementation((filename) => {
      const name = String(filename);
      if (state === 'Z' && name.endsWith('/mnt')) throw new Error('namespace unavailable');
      return name.endsWith('/exe') ? '/usr/bin/node' : `${name.split('/').at(-1)}:[1]`;
    });
    expect(readProcessEvidence(123)?.argv).toEqual(expectedArgs);
    statReads = 1;
    expect(readProcessEvidence(123)).toBeUndefined();
    files['/proc/123/cmdline'] = 'unterminated';
    expect(readProcessEvidence(123)).toBeUndefined();
    state = 'Z';
    expect(readProcessEvidence(123)).toMatchObject({
      exited: true,
      executable: '',
      argv: [],
      birth: '200',
      context: { pidNamespace: 'pid:[1]' },
    });
    expect(readProcessEvidence(123)?.context).not.toHaveProperty('mountNamespace', expect.any(String));
    state = 'X';
    expect(readProcessEvidence(123)?.exited).toBe(true);
  });

  it.skipIf(process.platform !== 'linux')('captures a real unreaped Linux child as exited', async () => {
    const parent = childProcess.spawn(
      process.execPath,
      [
        '-e',
        `
      const child = require('node:child_process').spawn('/bin/sh', ['-c', 'exit 0']);
      const wait = new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(wait, 0, 0, 500);
      console.log(child.pid);
      Atomics.wait(wait, 0, 0, 1500);
    `,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const exit = new Promise<void>((resolve) => parent.once('exit', () => resolve()));
    try {
      const pid = await new Promise<number>((resolve, reject) => {
        parent.stdout.once('data', (data: Buffer) => resolve(Number(data.toString().trim())));
        parent.once('error', reject);
      });
      expect(readProcessEvidence(pid)).toMatchObject({
        pid,
        ppid: parent.pid,
        exited: true,
        executable: '',
        argv: [],
        context: { platform: 'linux', pidNamespace: expect.stringMatching(/^pid:/) },
      });
    } finally {
      await exit;
    }
  });

  it.skipIf(process.platform !== 'linux')('reads a live Linux process', () => {
    const actual = readProcessEvidence(process.pid);
    expect(actual?.pid).toBe(process.pid);
    expect(actual?.ppid).toBe(process.ppid);
    expect(actual?.uid).toBe(process.geteuid!());
    expect(actual?.argv[0]).toBeTruthy();
    expect(actual?.birth).toBeTruthy();
  });
});
