import { decode } from '@toon-format/toon';

import * as filesystem from 'node:fs/promises';
import * as os from 'node:os';
import { readFile, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatBudgetedToolOutput, validateStdoutBudget } from './stdoutBudget.js';

vi.mock('node:os', { spy: true });
vi.mock('node:fs/promises', { spy: true });

describe('budgeted tool stdout', () => {
  const artifacts: string[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.mocked(os.tmpdir).mockReset();
    vi.mocked(filesystem.writeFile).mockReset();
    await Promise.all(artifacts.splice(0).map((path) => rm(dirname(path), { recursive: true, force: true })));
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
      expect(() => validateStdoutBudget(value, 'json')).toThrow('--stdout-budget-bytes');
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
    const { writeFile: original } = await vi.importActual<typeof filesystem>('node:fs/promises');
    vi.mocked(filesystem.writeFile).mockImplementationOnce(async (path, _data, options) => {
      artifacts.push(String(path));
      await original(path, '{', options);
      throw new Error('disk full');
    });
    const result = { content: [{ type: 'text' as const, text: 'a'.repeat(2000) }] };
    await expect(formatBudgetedToolOutput(result, 'json', 20, validateStdoutBudget(1024, 'json'))).rejects.toThrow(
      'upstream call completed',
    );
    await expect(stat(artifacts.at(-1)!)).rejects.toThrow();
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
