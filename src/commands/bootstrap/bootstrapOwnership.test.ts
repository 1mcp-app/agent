import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import * as ownerStore from '@src/commands/shared/projectOwnerStore.js';
import { temporaryProjectOwnerStorage } from '@src/commands/shared/projectOwnerStorage.js';
import {
  acquireProjectOwnerLease,
  isProjectOwnerEnded,
  readHookThreadLocator,
  readProjectOwner,
  recordProjectOwnerTarget,
} from '@src/commands/shared/projectOwnerStore.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { bootstrapOwner, recoverEndedSessionOwner, releaseSessionOwner } from './bootstrapOwnership.js';

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories
      .splice(0)
      .flatMap((entry) => [entry, temporaryProjectOwnerStorage(entry)])
      .map((entry) => rm(entry, { recursive: true, force: true })),
  );
});

describe('bootstrap ownership lifecycle', () => {
  it('resumes an ended owner without discarding its uncertain leases or deleting the new locator during recovery', async () => {
    const storage = await mkdtemp(path.join(os.tmpdir(), 'bootstrap-generation-'));
    directories.push(storage);
    const options = {
      client: 'codex' as const,
      event: 'SessionStart' as const,
      'config-dir': storage,
      project: [storage],
    };
    const input = JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'resumed' });
    const old = await bootstrapOwner(options, input);
    const releaseCall = await acquireProjectOwnerLease(old);
    await expect(
      releaseSessionOwner(
        { ...options, event: 'SessionEnd' },
        JSON.stringify({ hook_event_name: 'SessionEnd', session_id: 'resumed' }),
        async () => {},
      ),
    ).rejects.toThrow('leases');
    let reached!: () => void;
    let continueEnd!: () => void;
    const selected = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const proceed = new Promise<void>((resolve) => {
      continueEnd = resolve;
    });
    const lock = ownerStore.withHookIdentityLock;
    vi.spyOn(ownerStore, 'withHookIdentityLock').mockImplementationOnce(async (...args) => {
      reached();
      await proceed;
      return lock(...args);
    });
    const pendingEnd = releaseSessionOwner(
      { ...options, event: 'SessionEnd' },
      JSON.stringify({ hook_event_name: 'SessionEnd', session_id: 'resumed' }),
      async () => {},
    );
    const rejectedEnd = expect(pendingEnd).rejects.toThrow('leases');
    await selected;
    const resumed = await Promise.all(Array.from({ length: 4 }, () => bootstrapOwner(options, input)));
    expect(new Set(resumed).size).toBe(1);
    continueEnd();
    await rejectedEnd;
    const fresh = resumed[0];
    await expect(bootstrapOwner({ ...options, 'project-owner': old }, input)).rejects.toThrow('Session has ended');
    expect(fresh).not.toBe(old);
    expect(await isProjectOwnerEnded(fresh)).toBe(false);
    expect(await readProjectOwner(fresh)).not.toBe(await readProjectOwner(old));
    expect(await bootstrapOwner(options, input)).toBe(fresh);
    expect(await isProjectOwnerEnded(old)).toBe(true);
    await releaseCall();
    await recoverEndedSessionOwner(old, async () => {});
    expect((await readHookThreadLocator(temporaryProjectOwnerStorage(storage), 'codex', 'resumed'))?.ownerFile).toBe(
      fresh,
    );
  });

  it('allows resumed startup while the ended generation waits for runtime release', async () => {
    const storage = await mkdtemp(path.join(os.tmpdir(), 'bootstrap-slow-release-'));
    directories.push(storage);
    const options = {
      client: 'codex' as const,
      event: 'SessionStart' as const,
      'config-dir': storage,
      project: [storage],
    };
    const input = JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'slow-release' });
    const old = await bootstrapOwner(options, input);
    await recordProjectOwnerTarget(old, { project: [storage], 'config-dir': storage, runtimeScopeId: 'scope' });
    let entered!: () => void;
    let finish!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const ending = releaseSessionOwner(
      { ...options, event: 'SessionEnd' },
      JSON.stringify({ hook_event_name: 'SessionEnd', session_id: 'slow-release' }),
      async () => {
        entered();
        await pending;
      },
    );
    await started;
    let fresh: string;
    try {
      fresh = await bootstrapOwner(options, input);
      expect(fresh).not.toBe(old);
    } finally {
      finish();
      await ending;
    }
    expect(
      (await readHookThreadLocator(temporaryProjectOwnerStorage(storage), 'codex', 'slow-release'))?.ownerFile,
    ).toBe(fresh);
    expect(await isProjectOwnerEnded(fresh)).toBe(false);
  });

  it('rejects an old end event when a cleaned legacy path has been reused by a new credential', async () => {
    const storage = await mkdtemp(path.join(os.tmpdir(), 'bootstrap-reused-path-'));
    directories.push(storage);
    const options = {
      client: 'codex' as const,
      event: 'SessionStart' as const,
      'config-dir': storage,
      project: [storage],
    };
    const input = JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'reused-path' });
    const endInput = JSON.stringify({ hook_event_name: 'SessionEnd', session_id: 'reused-path' });
    const old = await bootstrapOwner(options, input);
    const oldCredential = await readProjectOwner(old);
    let entered!: () => void;
    let finish!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const lock = ownerStore.withHookIdentityLock;
    vi.spyOn(ownerStore, 'withHookIdentityLock').mockImplementationOnce(async (...args) => {
      entered();
      await pending;
      return lock(...args);
    });
    const delayed = releaseSessionOwner({ ...options, event: 'SessionEnd' }, endInput, async () => {});
    const rejected = expect(delayed).rejects.toThrow('changed during terminal selection');
    await started;
    await releaseSessionOwner({ ...options, event: 'SessionEnd' }, endInput, async () => {});
    const fresh = await bootstrapOwner(options, input);
    expect(await readProjectOwner(fresh)).not.toBe(oldCredential);
    finish();
    await rejected;
    expect(await isProjectOwnerEnded(fresh)).toBe(false);
  });

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
