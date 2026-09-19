import childProcess from 'node:child_process';
import fs from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProcessEvidenceReader, readProcessEvidence } from './processEvidence.js';

const evidence = {
  pid: 123,
  ppid: 12,
  uid: 501,
  realUid: 501,
  executable: '/usr/bin/node',
  argv: ['node', 'a path', '', 'quote"and\\slash'],
  birth: '100.000001',
  context: { platform: 'darwin', bootId: '10.000001' },
};
const seaGlobal = globalThis as typeof globalThis & { __1MCP_SEA_PROCESS_EVIDENCE__?: string };

afterEach(() => {
  vi.restoreAllMocks();
  delete seaGlobal.__1MCP_SEA_PROCESS_EVIDENCE__;
});

describe('readProcessEvidence', () => {
  it.each([0, -1, NaN, Infinity, 1.2, 2147483648])('rejects invalid pid %s', (pid) => {
    expect(readProcessEvidence(pid)).toBeUndefined();
  });

  it('fails closed on unsupported platforms', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    expect(readProcessEvidence(123)).toBeUndefined();
  });

  it('preserves exact macOS arguments and bounds helper execution', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    const exec = vi.spyOn(childProcess, 'execFileSync').mockReturnValue(Buffer.from(JSON.stringify(evidence)));
    expect(readProcessEvidence(123)).toEqual(evidence);
    expect(exec).toHaveBeenCalledWith(expect.stringContaining('/native/process-evidence-darwin'), ['123'], {
      timeout: 3000,
      maxBuffer: 4194304,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  });

  it.each([
    'not json',
    JSON.stringify({ ...evidence, pid: 124 }),
    JSON.stringify({ ...evidence, birth: '' }),
    JSON.stringify({ ...evidence, argv: [] }),
    JSON.stringify({ ...evidence, realUid: -1 }),
  ])('rejects malformed helper evidence', (output) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    vi.spyOn(childProcess, 'execFileSync').mockReturnValue(Buffer.from(output));
    expect(readProcessEvidence(123)).toBeUndefined();
  });

  it('rejects a changed process snapshot', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    vi.spyOn(childProcess, 'execFileSync')
      .mockReturnValueOnce(Buffer.from(JSON.stringify(evidence)))
      .mockReturnValueOnce(Buffer.from(JSON.stringify({ ...evidence, ppid: 1 })));
    expect(readProcessEvidence(123)).toBeUndefined();
  });

  it('removes the private extracted helper even when execution fails', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    seaGlobal.__1MCP_SEA_PROCESS_EVIDENCE__ = Buffer.from('invalid executable').toString('base64');
    let extracted = '';
    vi.spyOn(childProcess, 'execFileSync').mockImplementation((file) => {
      extracted = String(file);
      expect(fs.statSync(extracted).mode & 0o777).toBe(0o700);
      throw new Error('execution denied');
    });
    expect(readProcessEvidence(123)).toBeUndefined();
    expect(extracted).not.toBe('');
    expect(fs.existsSync(extracted)).toBe(false);
  });

  it('extracts once per reader while taking fresh paired snapshots on every read', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    seaGlobal.__1MCP_SEA_PROCESS_EVIDENCE__ = Buffer.from('fixture executable').toString('base64');
    const create = vi.spyOn(fs, 'mkdtempSync');
    const exec = vi.spyOn(childProcess, 'execFileSync').mockReturnValue(Buffer.from(JSON.stringify(evidence)));
    const reader = createProcessEvidenceReader();
    let helper = '';
    try {
      expect(reader.read(123)).toEqual(evidence);
      expect(reader.read(123)).toEqual(evidence);
      expect(create).toHaveBeenCalledTimes(1);
      expect(exec).toHaveBeenCalledTimes(4);
      helper = String(exec.mock.calls[0][0]);
      expect(exec.mock.calls.every(([file]) => String(file) === helper)).toBe(true);
      expect(fs.existsSync(helper)).toBe(true);
    } finally {
      reader.close();
    }
    reader.close();
    expect(fs.existsSync(helper)).toBe(false);
    expect(reader.read(123)).toBeUndefined();
    expect(exec).toHaveBeenCalledTimes(4);
  });

  it('cleans a partially materialized helper when writing fails', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    seaGlobal.__1MCP_SEA_PROCESS_EVIDENCE__ = Buffer.from('fixture executable').toString('base64');
    const create = vi.spyOn(fs, 'mkdtempSync');
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('disk unavailable');
    });
    const reader = createProcessEvidenceReader();
    try {
      expect(reader.read(123)).toBeUndefined();
    } finally {
      reader.close();
    }
    expect(create).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(String(create.mock.results[0].value))).toBe(false);
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
    expect(readProcessEvidence(123)?.argv).toEqual(evidence.argv);
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

  it
    .skipIf(process.platform !== 'darwin' || !fs.existsSync('build/native/process-evidence-darwin'))
    .each(['node', './node'])('preserves equals-style flags with argv0 %s and omits its environment', async (argv0) => {
    seaGlobal.__1MCP_SEA_PROCESS_EVIDENCE__ = fs
      .readFileSync('build/native/process-evidence-darwin')
      .toString('base64');
    const child = childProcess.spawn(
      process.execPath,
      ['-e', 'setInterval(function() {}, 1000)', '--', '--config-dir=/tmp/a path', '--port=3050'],
      {
        argv0,
        env: { EVIDENCE_TEST_SENTINEL: 'must-not-be-returned' },
        stdio: 'ignore',
      },
    );
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      const result = readProcessEvidence(child.pid!);
      expect(result?.argv.slice(-2)).toEqual(['--config-dir=/tmp/a path', '--port=3050']);
      expect(JSON.stringify(result)).not.toContain('must-not-be-returned');
    } finally {
      child.kill();
      await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    }
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

  it.skipIf(process.platform !== 'darwin' || !fs.existsSync('build/native/process-evidence-darwin'))(
    'refuses an ambiguous empty argv0 without returning environment values',
    async () => {
      seaGlobal.__1MCP_SEA_PROCESS_EVIDENCE__ = fs
        .readFileSync('build/native/process-evidence-darwin')
        .toString('base64');
      const child = childProcess.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        argv0: '',
        env: { EVIDENCE_TEST_SENTINEL: 'must-not-be-returned' },
        stdio: 'ignore',
      });
      try {
        await new Promise<void>((resolve, reject) => {
          child.once('spawn', resolve);
          child.once('error', reject);
        });
        expect(readProcessEvidence(child.pid!)).toBeUndefined();
      } finally {
        child.kill();
        await new Promise<void>((resolve) => child.once('exit', () => resolve()));
      }
    },
  );

  it.skipIf(
    process.platform !== 'linux' &&
      !(process.platform === 'darwin' && fs.existsSync('build/native/process-evidence-darwin')),
  )('reads a live process with the native platform adapter', () => {
    if (process.platform === 'darwin') {
      seaGlobal.__1MCP_SEA_PROCESS_EVIDENCE__ = fs
        .readFileSync('build/native/process-evidence-darwin')
        .toString('base64');
    }
    const actual = readProcessEvidence(process.pid);
    expect(actual?.pid).toBe(process.pid);
    expect(actual?.ppid).toBe(process.ppid);
    expect(actual?.uid).toBe(process.geteuid!());
    expect(actual?.argv[0]).toBeTruthy();
    expect(actual?.birth).toBeTruthy();
  });
});
