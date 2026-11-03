import { access, mkdtemp, rm, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { bootstrapOwner, recoverEndedSessionOwner, releaseSessionOwner } from './bootstrapOwnership.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, unlink: vi.fn(actual.unlink) };
});

const directories: string[] = [];
afterEach(async () => {
  vi.mocked(unlink).mockReset();
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(unlink).mockImplementation(actual.unlink);
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

it.each(['SessionEnd', 'recover'] as const)(
  'resumes %s after credential removal but failed final terminal-marker deletion',
  async (retry) => {
    const storage = await mkdtemp(path.join(os.tmpdir(), 'terminal-resume-'));
    directories.push(storage);
    const options = {
      client: 'codex' as const,
      event: 'SessionStart' as const,
      'config-dir': storage,
      project: [storage],
    };
    const owner = await bootstrapOwner(options, JSON.stringify({ hook_event_name: 'SessionStart', session_id: retry }));
    const end = { ...options, event: 'SessionEnd' as const };
    const input = JSON.stringify({ hook_event_name: 'SessionEnd', session_id: retry });
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    let injected = false;
    vi.mocked(unlink).mockImplementation(async (file) => {
      if (file === `${owner}.ended` && !injected) {
        injected = true;
        throw Object.assign(new Error('injected final unlink failure'), { code: 'EACCES' });
      }
      await actual.unlink(file);
    });
    await expect(releaseSessionOwner(end, input, async () => {})).rejects.toThrow('injected');
    await expect(access(owner)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(`${owner}.ended`)).resolves.toBeUndefined();
    const unexpectedRelease = async () => {
      throw new Error('Released terminal cleanup must not repeat runtime effects');
    };
    if (retry === 'SessionEnd') await releaseSessionOwner(end, input, unexpectedRelease);
    else await recoverEndedSessionOwner(owner, unexpectedRelease);
    await expect(access(`${owner}.ended`)).rejects.toMatchObject({ code: 'ENOENT' });
  },
);
