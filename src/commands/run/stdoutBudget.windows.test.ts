import * as filesystem from 'node:fs/promises';
import { ChildProcess, spawn } from 'node:child_process';
import { dirname } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatBudgetedToolOutput, validateStdoutBudget } from './stdoutBudget.js';

vi.mock('node:child_process', { spy: true });
vi.mock('node:fs/promises', { spy: true });

describe('Windows artifact privacy before publication', () => {
  const children: ChildProcess[] = [];
  const events: string[] = [];
  let artifact: string | undefined;
  beforeEach(async () => {
    vi.stubGlobal('process', Object.create(process, { platform: { value: 'win32' } }));
    const actual = await vi.importActual<typeof filesystem>('node:fs/promises');
    vi.mocked(spawn).mockImplementation(() => {
      const child = new ChildProcess();
      vi.spyOn(child, 'kill').mockReturnValue(true);
      vi.spyOn(child, 'unref').mockImplementation(() => undefined);
      children.push(child);
      return child;
    });
    vi.mocked(filesystem.open).mockImplementation(async (...args) => {
      artifact = String(args[0]);
      const handle = await actual.open(...args);
      const write = handle.writeFile.bind(handle);
      const close = handle.close.bind(handle);
      vi.spyOn(handle, 'writeFile').mockImplementation(async (...values) => {
        events.push('write');
        return write(...values);
      });
      vi.spyOn(handle, 'close').mockImplementation(async () => {
        events.push('close');
        return close();
      });
      return handle;
    });
    vi.mocked(filesystem.rm).mockImplementation(async (...args) => {
      events.push('remove');
      return actual.rm(...args);
    });
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.mocked(spawn).mockReset();
    vi.mocked(filesystem.open).mockReset();
    vi.mocked(filesystem.rm).mockReset();
    if (artifact) await filesystem.rm(dirname(artifact), { recursive: true, force: true });
    artifact = undefined;
    children.splice(0);
    events.splice(0);
  });
  function deliver() {
    return formatBudgetedToolOutput(
      { content: [{ type: 'text', text: 'private-result'.repeat(200) }] },
      'json',
      2000,
      validateStdoutBudget(1024, 'json'),
    );
  }
  async function verifier(index: number) {
    await vi.waitFor(() => expect(children).toHaveLength(index + 1));
    return children[index];
  }

  it('initializes directory ACL before creating a file and secures the empty file before writing', async () => {
    const pending = deliver();
    const directoryVerifier = await verifier(0);
    expect(filesystem.open).not.toHaveBeenCalled();
    directoryVerifier.emit('exit', 0);
    const fileVerifier = await verifier(1);
    expect((await filesystem.stat(artifact!)).size).toBe(0);
    expect(events).not.toContain('write');
    fileVerifier.emit('exit', 0);
    const receipt = JSON.parse(await pending);
    expect(receipt.path).toBe(artifact);
    expect(await filesystem.readFile(receipt.path, 'utf8')).toContain('private-result');
    expect(events).toEqual(['write', 'close']);
  });

  it.each(['directory', 'file'] as const)('fails closed when %s ACL verification is denied', async (phase) => {
    const outcome = deliver().catch((error: unknown) => error);
    const directoryVerifier = await verifier(0);
    if (phase === 'directory') directoryVerifier.emit('exit', 1);
    else {
      directoryVerifier.emit('exit', 0);
      (await verifier(1)).emit('exit', 1);
    }
    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('upstream call completed');
    expect((error as Error).message).toContain('privacy verification denied');
    expect(events).not.toContain('write');
    expect(events).toEqual(phase === 'directory' ? ['remove'] : ['close', 'remove']);
    if (artifact) await expect(filesystem.stat(artifact)).rejects.toThrow();
    expect(children).toHaveLength(phase === 'directory' ? 1 : 2);
  });
});
