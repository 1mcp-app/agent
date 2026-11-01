import { decode } from '@toon-format/toon';

import * as filesystem from 'node:fs/promises';
import * as os from 'node:os';
import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatBudgetedToolOutput, prepareSpillDirectory, validateStdoutBudget } from './stdoutBudget.js';

vi.mock('node:os', { spy: true });
vi.mock('node:fs/promises', { spy: true });

describe('budgeted tool stdout', () => {
  const artifacts: string[] = [];
  const directories: string[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.mocked(os.tmpdir).mockReset();
    vi.mocked(filesystem.open).mockReset();
    await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
    await Promise.all(artifacts.splice(0).map((path) => rm(dirname(path), { recursive: true, force: true })));
  });

  it('requires a threshold for a custom directory and rejects invalid paths', () => {
    expect(() => validateStdoutBudget(undefined, 'json', './results')).toThrow('--spill-dir requires');
    for (const path of ['', 'bad\0path']) {
      expect(() => validateStdoutBudget(4096, 'json', path)).toThrow('--spill-dir must');
    }
  });

  it.each(['absolute', 'relative'] as const)(
    'creates a missing %s parent and spills into unique private subdirectories',
    async (kind) => {
      const root = await mkdtemp(join(os.tmpdir(), 'spill-test-'));
      directories.push(root);
      const parent = join(root, 'missing', 'results');
      const path = kind === 'relative' ? relative(process.cwd(), parent) : parent;
      const budget = validateStdoutBudget(1024, 'json', path);
      await prepareSpillDirectory(budget);
      expect(await readdir(parent)).toEqual([]);
      await formatBudgetedToolOutput({ content: [] }, 'json', 20, budget);
      expect(await readdir(parent)).toEqual([]);
      const result = { content: [{ type: 'text' as const, text: 'private'.repeat(1000) }] };
      const outputs = await Promise.all([1, 2].map(() => formatBudgetedToolOutput(result, 'json', 20, budget)));
      const paths = outputs.map((output) => JSON.parse(output).path as string);
      expect(paths[0]).not.toBe(paths[1]);
      for (const artifact of paths) {
        expect(dirname(dirname(artifact))).toBe(parent);
        expect(JSON.parse(await readFile(artifact, 'utf8'))).toEqual(result);
        if (process.platform !== 'win32') {
          expect((await stat(dirname(artifact))).mode & 0o777).toBe(0o700);
          expect((await stat(artifact)).mode & 0o777).toBe(0o600);
        }
      }
    },
  );

  it('preserves existing parent permissions', async () => {
    const parent = await mkdtemp(join(os.tmpdir(), 'spill-parent-'));
    directories.push(parent);
    if (process.platform !== 'win32') await chmod(parent, 0o755);
    const mode = (await stat(parent)).mode;
    const budget = validateStdoutBudget(1024, 'text', parent);
    await prepareSpillDirectory(budget);
    await formatBudgetedToolOutput({ content: [{ type: 'text', text: 'a'.repeat(2000) }] }, 'text', 20, budget);
    expect((await stat(parent)).mode).toBe(mode);
  });

  it('rejects a non-directory destination', async () => {
    const root = await mkdtemp(join(os.tmpdir(), 'spill-file-'));
    directories.push(root);
    const path = join(root, 'file');
    await writeFile(path, 'keep');
    await expect(prepareSpillDirectory(validateStdoutBudget(1024, 'json', path))).rejects.toThrow(
      'Cannot prepare spill directory',
    );
    expect(await readFile(path, 'utf8')).toBe('keep');
  });

  it('rejects an inaccessible parent', async () => {
    vi.mocked(filesystem.access).mockRejectedValueOnce(new Error('EACCES: permission denied'));
    await expect(prepareSpillDirectory(validateStdoutBudget(1024, 'json'))).rejects.toThrow('EACCES');
  });

  it('rejects write denial even when the access check succeeds', async () => {
    vi.mocked(filesystem.open).mockRejectedValueOnce(new Error('EACCES: ACL denied write'));
    await expect(prepareSpillDirectory(validateStdoutBudget(1024, 'json'))).rejects.toThrow('ACL denied write');
  });

  it('uses the custom destination when calculating the minimum receipt size', () => {
    const path = join(os.tmpdir(), 'long'.repeat(300));
    expect(() => validateStdoutBudget(1024, 'json', path)).toThrow('at least');
    expect(validateStdoutBudget(4096, 'json', path)?.temporaryPrefix).toBe(join(path, '1mcp-result-'));
  });

  it('keeps ordinary compact truncation when the budget is absent', async () => {
    const result = { content: [{ type: 'text' as const, text: 'a'.repeat(2000) }] };
    expect(await formatBudgetedToolOutput(result, 'compact', 20)).toBe('aaaaa... [truncated]');
  });

  it.each([1023, 1024])('keeps text at or below the UTF-8 budget including its newline (%s)', async (bytes) => {
    const result = { content: [{ type: 'text' as const, text: 'a'.repeat(bytes - 1) }] };
    const output = await formatBudgetedToolOutput(result, 'text', 20, validateStdoutBudget(1024, 'text'));
    expect(output).toBe(result.content[0].text);
  });

  it('spills Unicode measured in bytes before compact character truncation', async () => {
    const result = { content: [{ type: 'text' as const, text: '🌍'.repeat(256) }] };
    const output = await formatBudgetedToolOutput(result, 'compact', 20, validateStdoutBudget(1024, 'compact'));
    const path = output.split('\n')[0].replace('Temporary JSON artifact: ', '');
    artifacts.push(path);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(result);
    expect(Buffer.byteLength(`${output}\n`)).toBeLessThanOrEqual(1024);
    expect(output).not.toContain('[truncated]');
  });

  it('retains compact representation when the untruncated output fits', async () => {
    const result = { content: [{ type: 'text' as const, text: 'a'.repeat(100) }] };
    expect(await formatBudgetedToolOutput(result, 'compact', 20, validateStdoutBudget(1024, 'compact'))).toBe(
      'aaaaa... [truncated]',
    );
  });

  it.each(['json', 'toon', 'text', 'compact'] as const)(
    'bounds %s receipts and concurrent artifacts',
    async (format) => {
      const result = { content: [{ type: 'text' as const, text: 'a'.repeat(2000) }] };
      const outputs = await Promise.all(
        [1, 2].map(() => formatBudgetedToolOutput(result, format, 20, validateStdoutBudget(1024, format))),
      );
      const paths = outputs.map((output) => {
        expect(Buffer.byteLength(`${output}\n`)).toBeLessThanOrEqual(1024);
        if (format === 'json') return JSON.parse(output).path as string;
        if (format === 'toon') return (decode(output) as { path: string }).path;
        return output.split('\n')[0].replace('Temporary JSON artifact: ', '');
      });
      artifacts.push(...paths);
      expect(paths[0]).not.toBe(paths[1]);
      for (const path of paths) expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(result);
    },
  );

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 1])(
    'rejects invalid or impossible budget %s',
    (value) => {
      expect(() => validateStdoutBudget(value, 'json')).toThrow('--spill-to-file-above-bytes');
    },
  );

  it.each(['json', 'toon', 'text', 'compact'] as const)(
    'preflights escaped Unicode temporary paths for %s',
    (format) => {
      vi.mocked(os.tmpdir).mockReturnValue('/tmp/临时"\\path');
      let minimum = 0;
      try {
        validateStdoutBudget(1, format);
      } catch (error) {
        minimum = Number((error as Error).message.match(/at least (\d+)/)?.[1]);
      }
      expect(minimum).toBeGreaterThan(100);
      expect(() => validateStdoutBudget(minimum - 1, format)).toThrow('at least');
      expect(validateStdoutBudget(minimum, format)?.bytes).toBe(minimum);
    },
  );

  it('reports completed upstream execution after a partial write without returning output', async () => {
    const { open: original } = await vi.importActual<typeof filesystem>('node:fs/promises');
    const cause = new Error('ENOSPC: no space left on device');
    vi.mocked(filesystem.open).mockImplementationOnce(async (path, ...options) => {
      artifacts.push(String(path));
      const handle = await original(path, ...options);
      const write = handle.writeFile.bind(handle);
      vi.spyOn(handle, 'writeFile').mockImplementationOnce(async () => {
        await write('{');
        throw cause;
      });
      return handle;
    });
    const result = { content: [{ type: 'text' as const, text: 'a'.repeat(2000) }] };
    await expect(
      formatBudgetedToolOutput(result, 'json', 20, validateStdoutBudget(1024, 'json')),
    ).rejects.toMatchObject({
      message: expect.stringContaining('ENOSPC: no space left on device'),
      cause,
    });
    await expect(stat(artifacts.at(-1)!)).rejects.toThrow();
  });

  it('bounds a non-Error delivery reason while preserving the complete cause', async () => {
    const cause = `EACCES: permission denied\n${'details'.repeat(1000)}`;
    vi.mocked(filesystem.mkdtemp).mockRejectedValueOnce(cause);
    const result = { content: [{ type: 'text' as const, text: 'a'.repeat(2000) }] };
    const error = await formatBudgetedToolOutput(result, 'json', 20, validateStdoutBudget(1024, 'json')).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).cause).toBe(cause);
    expect((error as Error).message).toContain('EACCES: permission denied');
    expect((error as Error).message).toContain('upstream call completed');
    expect((error as Error).message).toContain('inspect the tool outcome before retrying');
    expect((error as Error).message).not.toContain('\n');
    expect((error as Error).message.length).toBeLessThan(500);
  });

  it('makes the artifact path absolute when the OS temporary directory is relative', async () => {
    vi.mocked(os.tmpdir).mockReturnValue('.');
    const output = await formatBudgetedToolOutput(
      { content: [{ type: 'text', text: 'a'.repeat(2000) }] },
      'json',
      2000,
      validateStdoutBudget(1024, 'json'),
    );
    const { path } = JSON.parse(output);
    artifacts.push(path);
    expect(isAbsolute(path)).toBe(true);
    await expect(readFile(path, 'utf8')).resolves.toContain('aaaa');
  });

  it('saves the complete result before returning a bounded JSON receipt', async () => {
    const result = {
      content: [
        { type: 'text' as const, text: 'secret'.repeat(200) },
        { type: 'image' as const, data: 'aW1hZ2U=', mimeType: 'image/png' },
        { type: 'audio' as const, data: 'YXVkaW8=', mimeType: 'audio/wav' },
        {
          type: 'resource' as const,
          resource: { uri: 'file:///private/blob', blob: 'YmxvYg==', mimeType: 'application/octet-stream' },
        },
        { type: 'resource_link' as const, uri: 'file:///private/link', name: 'link' },
      ],
      structuredContent: { value: 'selected'.repeat(200) },
      _meta: { source: 'private' },
    };
    const budget = validateStdoutBudget(1024, 'json');
    const output = await formatBudgetedToolOutput(result, 'json', 2000, budget);
    const receipt = JSON.parse(output);
    artifacts.push(receipt.path);
    expect(receipt.artifact).toBe('temporary-json');
    expect(isAbsolute(receipt.path)).toBe(true);
    expect(JSON.parse(await readFile(receipt.path, 'utf8'))).toEqual(result);
    expect(receipt.bytes).toBe((await stat(receipt.path)).size);
    expect(Buffer.byteLength(`${output}\n`)).toBeLessThanOrEqual(1024);
    if (process.platform !== 'win32') {
      expect((await stat(receipt.path)).mode & 0o777).toBe(0o600);
      expect((await stat(dirname(receipt.path))).mode & 0o777).toBe(0o700);
    }
  });
});
