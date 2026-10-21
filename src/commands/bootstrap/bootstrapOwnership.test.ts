import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { temporaryProjectOwnerStorage } from '@src/commands/shared/projectOwnerStorage.js';
import {
  isProjectOwnerEnded,
  readHookThreadLocator,
  recordProjectOwnerTarget,
} from '@src/commands/shared/projectOwnerStore.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { bootstrapOwner, recoverEndedSessionOwner, releaseSessionOwner } from './bootstrapOwnership.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .flatMap((entry) => [entry, temporaryProjectOwnerStorage(entry)])
      .map((entry) => rm(entry, { recursive: true, force: true })),
  );
});

describe('bootstrap ownership lifecycle', () => {
  it('releases only the main-session credential and its recorded checkouts on SessionEnd', async () => {
    const storage = await mkdtemp(path.join(os.tmpdir(), 'bootstrap-owner-'));
    directories.push(storage);
    const options = { client: 'codex' as const, event: 'SessionStart' as const, 'config-dir': storage };
    const parent = await bootstrapOwner(options, JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'a' }));
    const worker = await bootstrapOwner(
      { ...options, event: 'SubagentStart' },
      JSON.stringify({ hook_event_name: 'SubagentStart', session_id: 'a', agent_id: 'child' }),
    );
    expect(parent).not.toBe(worker);
    await recordProjectOwnerTarget(parent, {
      project: ['/parent'],
      'config-dir': '/runtime',
      runtimeScopeId: 'scope-a',
    });
    await recordProjectOwnerTarget(worker, {
      project: ['/worker'],
      'config-dir': '/runtime',
      runtimeScopeId: 'scope-a',
    });
    const release = vi.fn().mockResolvedValue(undefined);
    await releaseSessionOwner(
      { ...options, event: 'SessionEnd' },
      JSON.stringify({ hook_event_name: 'SessionEnd', session_id: 'a' }),
      release,
    );
    expect(release).toHaveBeenCalledExactlyOnceWith(parent, {
      project: ['/parent'],
      'config-dir': '/runtime',
      runtimeScopeId: 'scope-a',
    });
    expect(await readHookThreadLocator(temporaryProjectOwnerStorage(storage), 'codex', 'a')).toBeUndefined();
    expect((await readHookThreadLocator(temporaryProjectOwnerStorage(storage), 'codex', 'child'))?.ownerFile).toBe(
      worker,
    );
  });

  it('removes private state only after complete terminal release and allows a repeated end event', async () => {
    const storage = await mkdtemp(path.join(os.tmpdir(), 'bootstrap-cleanup-'));
    directories.push(storage);
    const options = { client: 'codex' as const, event: 'SessionStart' as const, 'config-dir': storage };
    const input = JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'ended' });
    const file = await bootstrapOwner(options, input);
    await recordProjectOwnerTarget(file, { project: ['/work'], 'config-dir': storage, runtimeScopeId: 'scope' });
    const end = { ...options, event: 'SessionEnd' as const };
    const terminalInput = JSON.stringify({ hook_event_name: 'SessionEnd', session_id: 'ended' });
    await expect(
      releaseSessionOwner(end, terminalInput, async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('incomplete');
    await expect(access(file)).resolves.toBeUndefined();
    await expect(access(`${file}.targets`)).resolves.toBeUndefined();
    expect((await readHookThreadLocator(temporaryProjectOwnerStorage(storage), 'codex', 'ended'))?.ownerFile).toBe(
      file,
    );
    await releaseSessionOwner(end, terminalInput, async () => {});
    await expect(access(file)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(`${file}.targets`)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(releaseSessionOwner(end, terminalInput, async () => {})).resolves.toBeUndefined();
  });

  it('accepts terminal records for the full valid Unicode session identity range', async () => {
    const storage = await mkdtemp(path.join(os.tmpdir(), 'bootstrap-long-owner-'));
    directories.push(storage);
    const session = '会'.repeat(512);
    const options = { client: 'codex' as const, event: 'SessionStart' as const, 'config-dir': storage };
    const file = await bootstrapOwner(
      options,
      JSON.stringify({ hook_event_name: 'SessionStart', session_id: session }),
    );
    await recordProjectOwnerTarget(file, { project: ['/work'], 'config-dir': storage, runtimeScopeId: 'scope' });
    await expect(
      releaseSessionOwner(
        { ...options, event: 'SessionEnd' },
        JSON.stringify({ hook_event_name: 'SessionEnd', session_id: session }),
        async (owner) => {
          expect(await isProjectOwnerEnded(owner)).toBe(true);
        },
      ),
    ).resolves.toBeUndefined();
    await expect(access(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('recovers only a recorded terminal owner and leaves live workers protected', async () => {
    const storage = await mkdtemp(path.join(os.tmpdir(), 'bootstrap-recovery-'));
    directories.push(storage);
    const options = { client: 'codex' as const, event: 'SessionStart' as const, 'config-dir': storage };
    const parent = await bootstrapOwner(
      options,
      JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'root' }),
    );
    const worker = await bootstrapOwner(
      { ...options, event: 'SubagentStart', project: [storage] },
      JSON.stringify({ hook_event_name: 'SubagentStart', session_id: 'root', agent_id: 'child' }),
    );
    const released: string[] = [];
    const release = async (file: string) => {
      released.push(file);
    };
    await expect(recoverEndedSessionOwner(worker, release)).rejects.toThrow('No verified terminal');
    await recordProjectOwnerTarget(parent, { project: ['/work'], 'config-dir': storage, runtimeScopeId: 'scope' });
    await expect(
      releaseSessionOwner(
        { ...options, event: 'SessionEnd' },
        JSON.stringify({ hook_event_name: 'SessionEnd', session_id: 'root' }),
        async () => {
          throw new Error('offline');
        },
      ),
    ).rejects.toThrow('incomplete');
    await recoverEndedSessionOwner(parent, release);
    expect(released).toEqual([parent]);
    await expect(access(parent)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(worker)).resolves.toBeUndefined();
  });

  it('rejects turn completion, missing session identity and missing worker identity', async () => {
    const storage = await mkdtemp(path.join(os.tmpdir(), 'bootstrap-owner-'));
    directories.push(storage);
    const options = { client: 'claude' as const, event: 'SubagentStart' as const, 'config-dir': storage };
    await expect(
      bootstrapOwner(options, JSON.stringify({ hook_event_name: 'SubagentStart', session_id: 'parent' })),
    ).rejects.toThrow();
    await expect(
      bootstrapOwner(
        { ...options, event: 'SessionStart' },
        JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'parent', agent_id: 'child', cwd: storage }),
      ),
    ).rejects.toThrow();
    const release = vi.fn();
    for (const event of ['Stop', 'SubagentStop', 'SessionStart']) {
      await expect(
        releaseSessionOwner(
          { ...options, event: 'SessionEnd' },
          JSON.stringify({ hook_event_name: event, session_id: 'parent' }),
          release,
        ),
      ).rejects.toThrow();
    }
    await expect(
      releaseSessionOwner(
        { ...options, event: 'SessionEnd' },
        JSON.stringify({ hook_event_name: 'SessionEnd' }),
        release,
      ),
    ).rejects.toThrow();
    expect(release).not.toHaveBeenCalled();
  });
});
